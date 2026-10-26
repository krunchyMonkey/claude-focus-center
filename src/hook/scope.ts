// Dependency-free: copied next to the hook script, which runs outside VS Code.
// Monitoring scope shared by the extension and the hook: the hook skips writing events for
// excluded or not-included projects, and everything while monitoring is paused.
import * as path from 'node:path';

export const SCOPE_FILE = 'scope.json';

export interface MonitoringScope {
  excludedPaths: string[];
  /** When non-empty, only these project folders (and their subfolders) are monitored. */
  includedPaths: string[];
  paused: boolean;
}

export const DEFAULT_SCOPE: MonitoringScope = { excludedPaths: [], includedPaths: [], paused: false };

/** True when a session in `cwd` may be collected. Unknown cwd is allowed only without an allow-list. */
export function inScope(cwd: string | undefined, scope: MonitoringScope, platform: NodeJS.Platform = process.platform): boolean {
  if (scope.paused) {
    return false;
  }
  if (!cwd) {
    return scope.includedPaths.length === 0;
  }
  if (isUnder(cwd, scope.excludedPaths, platform)) {
    return false;
  }
  return scope.includedPaths.length === 0 || isUnder(cwd, scope.includedPaths, platform);
}

/** True when `cwd` equals or is inside one of `bases`. */
export function isUnder(cwd: string, bases: readonly string[], platform: NodeJS.Platform = process.platform): boolean {
  const target = normalize(cwd, platform);
  const sep = platform === 'win32' ? '\\' : '/';
  return bases.some((b) => {
    const base = normalize(b, platform);
    return base.length > 0 && (target === base || target.startsWith(base.endsWith(sep) ? base : base + sep));
  });
}

/** Parses a scope file defensively; anything malformed falls back to the default (collect, no lists). */
export function parseScope(text: string): MonitoringScope {
  try {
    const v = JSON.parse(text) as Partial<MonitoringScope>;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : []);
    return { excludedPaths: list(v.excludedPaths), includedPaths: list(v.includedPaths), paused: v.paused === true };
  } catch {
    return DEFAULT_SCOPE;
  }
}

function normalize(p: string, platform: NodeJS.Platform): string {
  const impl = platform === 'win32' ? path.win32 : path.posix;
  const trimmed = p.trim();
  if (trimmed === '') {
    return '';
  }
  const n = impl.normalize(platform === 'win32' ? trimmed.replace(/\//g, '\\') : trimmed);
  const stripped = n.length > 1 ? n.replace(/(?<=[^:\\/])[\\/]+$/, '') : n;
  // Case-insensitive file systems: folding can only widen exclusions (and allow-lists).
  return platform === 'win32' || platform === 'darwin' ? stripped.toLowerCase() : stripped;
}
