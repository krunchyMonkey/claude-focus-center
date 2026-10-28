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
/** Used when the scope is unknown or unreadable: collect nothing. */
export const CLOSED_SCOPE: MonitoringScope = { excludedPaths: [], includedPaths: [], paused: true };

/**
 * True when a session in `cwd` may be collected. An unknown location is allowed only when neither
 * an exclusion nor an allow-list is configured: otherwise it could belong to an excluded project.
 */
export function inScope(cwd: string | undefined, scope: MonitoringScope, platform: NodeJS.Platform = process.platform): boolean {
  if (scope.paused) {
    return false;
  }
  if (!cwd) {
    return scope.includedPaths.length === 0 && scope.excludedPaths.length === 0;
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

/**
 * Parses a scope file strictly. Anything unreadable or malformed means the scope is unknown, and an
 * unknown scope collects nothing (CLOSED_SCOPE) rather than everything.
 */
export function parseScope(text: string): MonitoringScope {
  try {
    const v: unknown = JSON.parse(text);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      return CLOSED_SCOPE;
    }
    const o = v as Record<string, unknown>;
    const list = (x: unknown): string[] | undefined => (x === undefined ? [] : Array.isArray(x) && x.every((p) => typeof p === 'string') ? (x as string[]).filter((p) => p.trim() !== '') : undefined);
    const excludedPaths = list(o.excludedPaths);
    const includedPaths = list(o.includedPaths);
    if (!excludedPaths || !includedPaths || (o.paused !== undefined && typeof o.paused !== 'boolean')) {
      return CLOSED_SCOPE;
    }
    return { excludedPaths, includedPaths, paused: o.paused === true };
  } catch {
    return CLOSED_SCOPE;
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
