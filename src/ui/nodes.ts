// Pure tree-model builders (no VS Code imports) so tree content is unit-testable.
import * as path from 'node:path';
import type { DiscoveredSession, DiscoveryResult } from '../adapters/claudeSessions/discovery';

/** A node in the Focus Center tree. */
export interface FocusNode {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  /** Codicon id. */
  icon?: string;
  children?: FocusNode[];
}

/** Until attention items exist (issues 06–09), the tree lists recent sessions for orientation. */
export function buildSessionNodes(result: DiscoveryResult, now: Date): FocusNode[] {
  if (result.sessions.length === 0) {
    return [];
  }
  return [{
    id: 'group:recent-sessions',
    label: `Recent sessions (${result.sessions.length})`,
    icon: 'history',
    children: result.sessions.map((s) => sessionNode(s, now)),
  }];
}

function sessionNode(s: DiscoveredSession, now: Date): FocusNode {
  const repo = s.cwd ? path.basename(s.cwd.replace(/[\\/]+$/, '')) || s.cwd : s.projectDirName;
  const age = formatAge(new Date(s.lastActivityAt), now);
  return {
    id: `session:${s.sessionId}`,
    label: repo,
    description: [s.gitBranch, age].filter(Boolean).join(' · '),
    tooltip: [
      `Working directory: ${s.cwd ?? 'unknown'}`,
      `Branch: ${s.gitBranch ?? 'unknown'}`,
      `Session: ${s.sessionId}`,
      `Transcript: ${s.transcriptPath}`,
      `Last file change: ${s.lastActivityAt} (${age})`,
    ].join('\n'),
    icon: s.cwd ? 'comment-discussion' : 'question',
  };
}

/** Compact relative age, e.g. "just now", "5m ago", "3h ago", "2d ago". */
export function formatAge(then: Date, now: Date): string {
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (!Number.isFinite(seconds)) {
    return 'unknown age';
  }
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}
