import * as os from 'node:os';
import * as path from 'node:path';
import { isUnder } from '../../hook/scope';

/** Default Claude Code session root, honouring Claude's own CLAUDE_CONFIG_DIR override. */
export function defaultProjectsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  return path.join(configDir ? configDir : path.join(os.homedir(), '.claude'), 'projects');
}

/**
 * Claude Code names each project folder after its cwd with every non-alphanumeric
 * character replaced by '-'. The encoding is lossy, so it is only used to skip
 * excluded projects *before* reading; the cwd recorded in the transcript is authoritative.
 */
export function encodeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * True when a project folder may belong to an excluded path. Errs towards exclusion:
 * a lossy match (e.g. `/a/b-c` vs `/a/b/c`) is treated as excluded.
 */
export function isProjectDirExcluded(dirName: string, excludedPaths: readonly string[]): boolean {
  const dir = dirName.toLowerCase();
  return excludedPaths.some((excluded) => {
    const encoded = encodeProjectDirName(stripTrailingSeparators(excluded)).toLowerCase();
    return encoded.length > 0 && (dir === encoded || dir.startsWith(encoded + '-'));
  });
}

/** True when `cwd` equals or is inside one of the excluded paths. */
export function isPathExcluded(cwd: string, excludedPaths: readonly string[], platform: NodeJS.Platform = process.platform): boolean {
  return isUnder(cwd, excludedPaths, platform);
}

/**
 * With an allow-list, true when a project folder *may* belong to an included path (so it is worth
 * reading its header). Lossy encoding can admit extra folders; the recorded cwd is checked after.
 */
export function isProjectDirPossiblyIncluded(dirName: string, includedPaths: readonly string[]): boolean {
  if (includedPaths.length === 0) {
    return true;
  }
  const dir = dirName.toLowerCase();
  return includedPaths.some((included) => {
    const encoded = encodeProjectDirName(stripTrailingSeparators(included)).toLowerCase();
    return encoded.length > 0 && (dir === encoded || dir.startsWith(encoded + '-'));
  });
}

function stripTrailingSeparators(p: string): string {
  // Keep roots such as "/" or "C:\" intact.
  return p.length > 1 ? p.replace(/(?<=[^:\\/])[\\/]+$/, '') : p;
}
