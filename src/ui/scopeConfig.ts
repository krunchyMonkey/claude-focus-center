import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MonitoringScope } from '../hook/scope';

/** The monitoring scope as currently configured in settings. */
export function currentScope(): MonitoringScope {
  const config = vscode.workspace.getConfiguration('focusCenter');
  return { excludedPaths: pathList('excludedPaths'), includedPaths: pathList('includedPaths'), paused: config.get<unknown>('paused') === true };
}

export function hasRestrictions(scope: MonitoringScope): boolean {
  return scope.excludedPaths.length > 0 || scope.includedPaths.length > 0;
}

function pathList(key: 'excludedPaths' | 'includedPaths'): string[] {
  const configured = vscode.workspace.getConfiguration('focusCenter').get<unknown>(key);
  if (!Array.isArray(configured)) {
    return [];
  }
  return configured
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => (p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p));
}
