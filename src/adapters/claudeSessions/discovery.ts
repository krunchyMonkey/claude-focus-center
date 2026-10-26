import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { inScope } from '../../hook/scope';
import { isProjectDirExcluded, isProjectDirPossiblyIncluded } from './paths';

/** Metadata for one local Claude Code session. Holds no message content. */
export interface DiscoveredSession {
  source: 'claude-local';
  sessionId: string;
  transcriptPath: string;
  projectDirName: string;
  /** From the transcript; undefined when no record within the header budget carried it. */
  cwd?: string;
  gitBranch?: string;
  /** File modification time; recent activity, not proof that Claude is running. */
  lastActivityAt: string;
  sizeBytes: number;
}

export type DiscoveryIssueCode =
  | 'root-missing'
  | 'root-unreadable'
  | 'project-unreadable'
  | 'file-unreadable'
  | 'no-metadata'
  | 'invalid-session-id'
  | 'duplicate-session-id'
  | 'truncated-to-limit';

export interface DiscoveryIssue {
  code: DiscoveryIssueCode;
  /** Local path the issue refers to; never transcript content. */
  path: string;
  detail?: string;
}

export interface DiscoveryResult {
  root: string;
  rootFound: boolean;
  sessions: DiscoveredSession[];
  excludedCount: number;
  issues: DiscoveryIssue[];
}

export interface DiscoveryOptions {
  root: string;
  excludedPaths?: readonly string[];
  /** When non-empty, only sessions under these paths are read. */
  includedPaths?: readonly string[];
  /** Most recently modified session files to inspect. */
  maxSessions?: number;
  /** Bytes read from the start of each transcript to find cwd/branch. */
  maxHeaderBytes?: number;
  platform?: NodeJS.Platform;
}

export const DEFAULT_MAX_SESSIONS = 200;
export const DEFAULT_MAX_HEADER_BYTES = 64 * 1024;

// Session IDs end up in terminal commands later; accept only a conservative charset.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface Candidate {
  sessionId: string;
  transcriptPath: string;
  projectDirName: string;
  mtimeMs: number;
  sizeBytes: number;
}

/**
 * Lists session transcripts under `<root>/<project>/<session>.jsonl`. Exclusions are applied to
 * folder names before any transcript is opened, then again to the recorded cwd. Never throws for
 * missing or unreadable paths; reports them as issues instead.
 */
export async function discoverSessions(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const excluded = options.excludedPaths ?? [];
  const included = options.includedPaths ?? [];
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES;
  const result: DiscoveryResult = { root: options.root, rootFound: false, sessions: [], excludedCount: 0, issues: [] };

  let projectDirs: string[];
  try {
    const entries = await fs.readdir(options.root, { withFileTypes: true });
    // Symlinked folders are skipped so discovery stays inside the supported root.
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    result.rootFound = true;
  } catch (err) {
    result.issues.push({ code: isNotFound(err) ? 'root-missing' : 'root-unreadable', path: options.root, detail: errorCode(err) });
    return result;
  }

  const candidates: Candidate[] = [];
  for (const dirName of projectDirs) {
    if (isProjectDirExcluded(dirName, excluded) || !isProjectDirPossiblyIncluded(dirName, included)) {
      result.excludedCount++;
      continue;
    }
    const dirPath = path.join(options.root, dirName);
    let files: string[];
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name);
    } catch (err) {
      result.issues.push({ code: 'project-unreadable', path: dirPath, detail: errorCode(err) });
      continue;
    }
    for (const file of files) {
      const transcriptPath = path.join(dirPath, file);
      const sessionId = file.slice(0, -'.jsonl'.length);
      if (!SESSION_ID.test(sessionId)) {
        result.issues.push({ code: 'invalid-session-id', path: transcriptPath });
        continue;
      }
      try {
        const stat = await fs.stat(transcriptPath);
        candidates.push({ sessionId, transcriptPath, projectDirName: dirName, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
      } catch (err) {
        result.issues.push({ code: 'file-unreadable', path: transcriptPath, detail: errorCode(err) });
      }
    }
  }

  // Newest first; ties broken by path so results are deterministic.
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.transcriptPath.localeCompare(b.transcriptPath));

  const seen = new Map<string, DiscoveredSession>();
  for (const c of candidates) {
    if (seen.size >= maxSessions) {
      result.issues.push({ code: 'truncated-to-limit', path: options.root, detail: `showing the ${maxSessions} most recent sessions` });
      break;
    }
    const prior = seen.get(c.sessionId);
    if (prior) {
      result.issues.push({ code: 'duplicate-session-id', path: c.transcriptPath, detail: `kept newer ${prior.transcriptPath}` });
      continue;
    }
    let header: SessionHeader;
    try {
      header = await readSessionHeader(c.transcriptPath, maxHeaderBytes);
    } catch (err) {
      result.issues.push({ code: 'file-unreadable', path: c.transcriptPath, detail: errorCode(err) });
      continue;
    }
    if (!inScope(header.cwd, { excludedPaths: [...excluded], includedPaths: [...included], paused: false }, options.platform)) {
      result.excludedCount++;
      continue;
    }
    if (!header.cwd) {
      result.issues.push({ code: 'no-metadata', path: c.transcriptPath, detail: 'no cwd in transcript header' });
    }
    seen.set(c.sessionId, {
      source: 'claude-local',
      sessionId: c.sessionId,
      transcriptPath: c.transcriptPath,
      projectDirName: c.projectDirName,
      cwd: header.cwd,
      gitBranch: header.gitBranch,
      lastActivityAt: new Date(c.mtimeMs).toISOString(),
      sizeBytes: c.sizeBytes,
    });
  }
  result.sessions = [...seen.values()];
  return result;
}

export interface SessionHeader {
  cwd?: string;
  gitBranch?: string;
}

/**
 * Reads at most `maxBytes` from the start of a transcript and returns the first cwd/gitBranch found
 * on a complete JSON line. Malformed lines are skipped; nothing else from the records is retained.
 */
export async function readSessionHeader(filePath: string, maxBytes: number): Promise<SessionHeader> {
  const handle = await fs.open(filePath, 'r');
  let text: string;
  let complete: boolean;
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    text = buffer.toString('utf8', 0, bytesRead);
    complete = bytesRead < maxBytes;
  } finally {
    await handle.close();
  }
  const lines = text.split('\n');
  if (!complete) {
    lines.pop(); // Last line may be cut by the byte budget.
  }
  const header: SessionHeader = {};
  for (const line of lines) {
    const record = parseObject(line);
    if (!record) {
      continue;
    }
    if (header.cwd === undefined && typeof record.cwd === 'string' && record.cwd.length > 0) {
      header.cwd = record.cwd;
    }
    if (header.gitBranch === undefined && typeof record.gitBranch === 'string' && record.gitBranch.length > 0) {
      header.gitBranch = record.gitBranch;
    }
    if (header.cwd !== undefined && header.gitBranch !== undefined) {
      break;
    }
  }
  return header;
}

function parseObject(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(trimmed);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function isNotFound(err: unknown): boolean {
  return errorCode(err) === 'ENOENT';
}

function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException)?.code ?? 'unknown error';
}
