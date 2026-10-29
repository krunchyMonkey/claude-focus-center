// Synthetic Claude Code session fixtures. Every name, path and message here is invented.
// Fixtures are generated into temp directories at test time (the repo ignores *.jsonl).
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { encodeProjectDirName } from '../../adapters/claudeSessions/paths';

export interface FixtureSession {
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  /** Written into every default record, as Claude Code does (`claude-vscode`, `cli`, ...). */
  entrypoint?: string;
  /** Seconds since epoch used for the file mtime. */
  mtime: number;
  /** Raw lines to write instead of the default synthetic records. */
  lines?: string[];
}

export const SYNTHETIC_REPOS = {
  alpha: syntheticPath('repos', 'alpha-service'),
  beta: syntheticPath('repos', 'beta-web'),
  gamma: syntheticPath('repos', 'gamma-tools'),
  delta: syntheticPath('repos', 'delta-docs'),
};

/** Ten sessions across four synthetic repositories, newest first by mtime. */
export function tenSessions(): FixtureSession[] {
  const base = 1_800_000_000;
  const spec: Array<[keyof typeof SYNTHETIC_REPOS, string]> = [
    ['alpha', 'feat/login'], ['alpha', 'feat/login'], ['alpha', 'main'],
    ['beta', 'fix/123-header'], ['beta', 'main'], ['beta', 'feat/search'],
    ['gamma', 'main'], ['gamma', 'chore/deps'],
    ['delta', 'main'], ['delta', 'docs/guide'],
  ];
  return spec.map(([repo, branch], i) => ({
    sessionId: syntheticUuid(i + 1),
    cwd: SYNTHETIC_REPOS[repo],
    gitBranch: branch,
    mtime: base - i * 60,
  }));
}

export function syntheticUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** Records shaped like Claude Code transcript lines; the first carries no cwd, as real summaries do. */
export function defaultLines(s: FixtureSession): string[] {
  const common = { sessionId: s.sessionId, cwd: s.cwd, gitBranch: s.gitBranch, entrypoint: s.entrypoint, version: '2.0.0' };
  return [
    JSON.stringify({ type: 'summary', summary: 'Synthetic session', leafUuid: `${s.sessionId}-leaf` }),
    JSON.stringify({ ...common, type: 'user', uuid: `${s.sessionId}-u1`, parentUuid: null, timestamp: new Date(s.mtime * 1000).toISOString(), message: { role: 'user', content: 'Synthetic request.' } }),
    JSON.stringify({ ...common, type: 'assistant', uuid: `${s.sessionId}-a1`, parentUuid: `${s.sessionId}-u1`, timestamp: new Date(s.mtime * 1000).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'Synthetic reply.' }] } }),
  ];
}

export async function makeTempRoot(prefix = 'focus-center-fixture-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Writes sessions as `<root>/<encoded cwd>/<sessionId>.jsonl`; returns the transcript paths. */
export async function writeSessions(root: string, sessions: FixtureSession[]): Promise<string[]> {
  const written: string[] = [];
  for (const s of sessions) {
    const dir = path.join(root, encodeProjectDirName(s.cwd));
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${s.sessionId}.jsonl`);
    await fs.writeFile(file, (s.lines ?? defaultLines(s)).join('\n') + '\n', 'utf8');
    await fs.utimes(file, s.mtime, s.mtime);
    written.push(file);
  }
  return written;
}

function syntheticPath(...parts: string[]): string {
  return process.platform === 'win32'
    ? path.win32.join('C:\\', 'synthetic', ...parts)
    : path.posix.join('/', 'synthetic', ...parts);
}

/** Synthetic user-level Claude settings with a third-party hook. */
export const SYNTHETIC_SETTINGS = JSON.stringify({
  model: 'synthetic-model',
  hooks: { Stop: [{ hooks: [{ type: 'command', command: '/synthetic/other-tool/notify.sh' }] }] },
}, null, 2) + '\n';
