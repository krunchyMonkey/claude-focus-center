// Pure tree-model builders (no VS Code imports) so tree content is unit-testable.
import * as path from 'node:path';
import type { DiscoveredSession, DiscoveryResult } from '../adapters/claudeSessions/discovery';
import { effectiveStatus, lastEvidenceAt } from '../domain/attention/effective';
import type { AttentionItem, AttentionStatus, FocusState } from '../domain/state/types';

/** A node in the Focus Center tree. */
export interface FocusNode {
  id: string;
  label: string;
  description?: string;
  /** Plain or Markdown tooltip text. */
  tooltip?: string;
  tooltipIsMarkdown?: boolean;
  /** Codicon id. */
  icon?: string;
  /** Theme color id for the icon. */
  iconColor?: string;
  /** Screen-reader label; defaults to label + description. */
  ariaLabel?: string;
  /** Drives context menus, e.g. `item.needs-you`, `session`. */
  contextValue?: string;
  collapsed?: boolean;
  /** Command run when the node is clicked or activated with Enter; receives the node. */
  commandId?: string;
  /** Present on item and session nodes, for commands. */
  itemId?: string;
  sessionId?: string;
  children?: FocusNode[];
}

const GROUPS: Array<{ status: AttentionStatus; label: string; icon: string; color?: string; collapsed?: boolean }> = [
  { status: 'needs-you', label: 'Needs You', icon: 'bell-dot', color: 'problemsErrorIcon.foreground' },
  { status: 'in-progress', label: 'In Progress', icon: 'sync', color: 'charts.blue' },
  { status: 'waiting', label: 'Waiting', icon: 'clock' },
  { status: 'uncertain', label: 'Uncertain', icon: 'question', color: 'problemsWarningIcon.foreground' },
  { status: 'resolved', label: 'Resolved', icon: 'pass', color: 'testing.iconPassed', collapsed: true },
];

const KIND_ICON: Record<AttentionItem['kind'], string> = {
  permission: 'shield',
  decision: 'comment-discussion',
  review: 'eye',
  failure: 'error',
  task: 'checklist',
  other: 'info',
};

/** Status → workstream → item, plus an "All sessions" group for orientation and resume. */
export function buildAttentionNodes(state: FocusState, discovery: DiscoveryResult | undefined, now: Date): FocusNode[] {
  if (Object.keys(state.items).length === 0 && (discovery?.sessions.length ?? 0) === 0) {
    return []; // Lets the view's welcome content (setup guidance) show.
  }
  const byStatus = new Map<AttentionStatus, AttentionItem[]>();
  for (const item of Object.values(state.items)) {
    const status = effectiveStatus(item, now);
    byStatus.set(status, [...(byStatus.get(status) ?? []), item]);
  }

  const roots: FocusNode[] = [];
  for (const group of GROUPS) {
    const items = byStatus.get(group.status) ?? [];
    if (items.length === 0 && group.status !== 'needs-you') {
      continue;
    }
    const children = items.length === 0
      ? [{ id: 'empty:needs-you', label: 'Nothing needs you right now', icon: 'check', contextValue: 'empty' }]
      : workstreamNodes(state, group.status, items, now);
    roots.push({
      id: `group:${group.status}`,
      label: group.label,
      description: String(items.length),
      ariaLabel: `${group.label}: ${items.length} item${items.length === 1 ? '' : 's'}`,
      icon: group.icon,
      iconColor: group.color,
      contextValue: `group.${group.status}`,
      collapsed: group.collapsed,
      children,
    });
  }

  const sessions = discovery?.sessions ?? [];
  if (sessions.length > 0) {
    roots.push({
      id: 'group:sessions',
      label: 'All sessions',
      description: String(sessions.length),
      ariaLabel: `All sessions: ${sessions.length}`,
      icon: 'history',
      contextValue: 'group.sessions',
      collapsed: true,
      children: sessions.map((s) => sessionNode(s, now)),
    });
  }
  return roots;
}

export function needsYouCount(state: FocusState, now: Date): number {
  return Object.values(state.items).filter((i) => effectiveStatus(i, now) === 'needs-you').length;
}

function workstreamNodes(state: FocusState, status: AttentionStatus, items: AttentionItem[], now: Date): FocusNode[] {
  const byWs = new Map<string, AttentionItem[]>();
  for (const item of items) {
    byWs.set(item.workstreamId, [...(byWs.get(item.workstreamId) ?? []), item]);
  }
  const nodes = [...byWs].map(([wsId, wsItems]) => {
    const ws = state.workstreams[wsId];
    const sorted = [...wsItems].sort(compareItems);
    const conflicts = ws?.conflicts ?? [];
    return {
      sortKey: [sorted[0].priority, invert(lastEvidenceAt(sorted[0]) ?? '')].join('|'),
      node: {
        id: `ws:${status}:${wsId}`,
        label: ws?.title ?? wsId,
        description: `${wsItems.length}${conflicts.length ? ' · conflict' : ''}`,
        tooltip: [
          `**${escapeMd(ws?.title ?? wsId)}**`,
          `Grouped by: ${ws?.basis ?? 'session'}; ${ws?.sessionIds.length ?? 1} session(s)`,
          ...conflicts.map((c) => `⚠ ${escapeMd(c)}`),
        ].join('\n\n'),
        tooltipIsMarkdown: true,
        ariaLabel: `Workstream ${ws?.title ?? wsId}, ${wsItems.length} item${wsItems.length === 1 ? '' : 's'}${conflicts.length ? ', has conflicting signals' : ''}`,
        icon: conflicts.length ? 'warning' : 'layers',
        iconColor: conflicts.length ? 'problemsWarningIcon.foreground' : undefined,
        contextValue: 'workstream',
        children: sorted.map((i) => itemNode(state, i, status, now)),
      } satisfies FocusNode,
    };
  });
  return nodes.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((n) => n.node);
}

function itemNode(state: FocusState, item: AttentionItem, status: AttentionStatus, now: Date): FocusNode {
  const sessionId = item.sourceSessionIds[0];
  const session = state.sessions[sessionId];
  const repo = session?.repoRoot ?? session?.cwd;
  const repoName = repo ? path.basename(repo.replace(/[\\/]+$/, '')) : 'unknown project';
  const latest = lastEvidenceAt(item);
  const age = latest ? formatAge(new Date(latest), now) : 'unknown age';
  const flags = [
    item.confidence === 'direct' ? 'direct' : item.confidence === 'inferred' ? 'inferred' : 'unverified',
    item.acknowledgedAt ? 'acknowledged' : undefined,
    item.snoozedUntil && status === 'waiting' ? `snoozed until ${formatTime(item.snoozedUntil)}` : undefined,
    item.manuallyResolvedAt ? 'resolved by you' : undefined,
  ].filter(Boolean);
  const evidenceCount = `${item.evidence.length} evidence`;
  return {
    id: `item:${status}:${item.id}`,
    itemId: item.id,
    sessionId,
    label: item.title,
    description: [repoName, age, ...flags, evidenceCount].join(' · '),
    tooltip: itemTooltip(state, item, status, age),
    tooltipIsMarkdown: true,
    ariaLabel: `${statusWord(status)} ${item.kind}: ${item.title}. ${repoName}, ${age}, ${flags.join(', ')}, ${evidenceCount}.`,
    icon: KIND_ICON[item.kind],
    iconColor: status === 'needs-you' ? (item.priority === 0 ? 'problemsErrorIcon.foreground' : 'problemsWarningIcon.foreground') : undefined,
    contextValue: `item.${status}${item.acknowledgedAt ? '.ack' : ''}`,
    commandId: 'focusCenter.focusSession',
  };
}

function itemTooltip(state: FocusState, item: AttentionItem, status: AttentionStatus, age: string): string {
  const why = item.evidence.slice(-3).map((e) => `- ${e.kind === 'hook' ? 'Hook event' : 'Transcript message'} at ${e.timestamp || 'unknown time'}${e.excerpt ? `: “${escapeMd(e.excerpt)}”` : ''}`);
  const sessions = item.sourceSessionIds.map((id) => {
    const s = state.sessions[id];
    return `- \`${id}\`${s?.cwd ? ` in ${escapeMd(s.cwd)}` : ''}${s?.gitBranch ? ` on ${escapeMd(s.gitBranch)}` : ''}`;
  });
  return [
    `**${escapeMd(item.title)}**`,
    `${statusWord(status)} · ${item.kind} · priority ${item.priority} · ${item.confidence} evidence · ${age}`,
    `**Why:**\n${why.join('\n')}${item.evidence.length > 3 ? `\n- …and ${item.evidence.length - 3} earlier` : ''}`,
    item.nextAction ? `**Next step:** ${escapeMd(item.nextAction)}` : '',
    `**Source session:**\n${sessions.join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

function sessionNode(s: DiscoveredSession, now: Date): FocusNode {
  const repo = s.cwd ? path.basename(s.cwd.replace(/[\\/]+$/, '')) || s.cwd : s.projectDirName;
  const age = formatAge(new Date(s.lastActivityAt), now);
  return {
    id: `session:${s.sessionId}`,
    sessionId: s.sessionId,
    label: repo,
    description: [s.gitBranch, age].filter(Boolean).join(' · '),
    tooltip: [
      `Working directory: ${s.cwd ?? 'unknown'}`,
      `Branch: ${s.gitBranch ?? 'unknown'}`,
      `Session: ${s.sessionId}`,
      `Transcript: ${s.transcriptPath}`,
      `Last file change: ${s.lastActivityAt} (${age})`,
    ].join('\n'),
    icon: s.cwd ? 'terminal' : 'question',
    contextValue: 'session',
  };
}

function compareItems(a: AttentionItem, b: AttentionItem): number {
  return a.priority - b.priority
    || Number(Boolean(a.acknowledgedAt)) - Number(Boolean(b.acknowledgedAt))
    || (lastEvidenceAt(b) ?? '').localeCompare(lastEvidenceAt(a) ?? '')
    || a.id.localeCompare(b.id);
}

/** Lexicographic inversion so newer ISO timestamps sort first. */
function invert(iso: string): string {
  return [...iso].map((c) => String.fromCharCode(0xffff - c.charCodeAt(0))).join('');
}

function statusWord(status: AttentionStatus): string {
  return { 'needs-you': 'Needs you', 'in-progress': 'In progress', 'waiting': 'Waiting', 'uncertain': 'Uncertain', 'resolved': 'Resolved' }[status];
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+!|<>])/g, '\\$1');
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16) + ' UTC';
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
