// Pure Markdown for the read-only details document of an item or session.
import { effectiveStatus } from '../domain/attention/effective';
import type { FocusState } from '../domain/state/types';
import { formatAge } from './nodes';

export function itemDetailsMarkdown(state: FocusState, itemId: string, now: Date): string {
  const item = state.items[itemId];
  if (!item) {
    return '# Item not found\n\nThis item no longer exists (it may have been dropped or its data deleted).\n';
  }
  const status = effectiveStatus(item, now);
  const lines: string[] = [
    `# ${esc(item.title)}`,
    '',
    `**Status:** ${status}${status !== item.status ? ` (rules say ${item.status}; changed by you)` : ''} · **Kind:** ${item.kind} · **Priority:** ${item.priority} · **Evidence:** ${item.confidence} · **Owner:** ${item.owner}`,
    '',
    '## Why this is here',
    '',
    ...item.evidence.map((e) => `- ${e.timestamp ? `${e.timestamp} (${formatAge(new Date(e.timestamp), now)})` : 'unknown time'} — ${e.kind === 'hook' ? 'hook event' : e.kind === 'message' ? 'transcript message' : 'your action'}${e.excerpt ? `: “${esc(e.excerpt)}”` : ''}  \n  <sub>event ${esc(e.eventId)}${e.messageUuid ? ` · message ${esc(e.messageUuid)}` : ''}</sub>`),
    '',
    item.confidence === 'inferred' ? '_Inferred from wording in the conversation, not from a direct Claude signal._' : item.confidence === 'direct' ? '_Based on a direct Claude Code signal._' : '_Unverified._',
    '',
    '## What changed',
    '',
    ...changes(state, itemId),
    '',
    '## Source session',
    '',
    ...item.sourceSessionIds.flatMap((id) => sessionLines(state, id, now)),
    '',
    '## Next step',
    '',
    esc(item.nextAction ?? 'No action suggested.'),
    '',
    'Resume the session with **Focus Center: Resume Session** (context menu or Command Palette).',
    '',
  ];
  return lines.join('\n');
}

export function sessionDetailsMarkdown(state: FocusState, sessionId: string, now: Date): string {
  if (!state.sessions[sessionId]) {
    return '# Session not found\n\nThis session is not known to Focus Center (it may be excluded or its data deleted).\n';
  }
  const items = Object.values(state.items).filter((i) => i.sourceSessionIds.includes(sessionId));
  return [
    `# Session ${esc(sessionId)}`,
    '',
    ...sessionLines(state, sessionId, now),
    '',
    '## Items',
    '',
    ...(items.length ? items.map((i) => `- ${effectiveStatus(i, now)} · ${esc(i.title)}`) : ['- None']),
    '',
  ].join('\n');
}

function sessionLines(state: FocusState, sessionId: string, now: Date): string[] {
  const s = state.sessions[sessionId];
  if (!s) {
    return [`- Session \`${sessionId}\` — no longer known`];
  }
  const last = s.lastEventAt ?? s.lastSeenAt;
  return [
    `- **Session:** \`${s.sessionId}\``,
    `- **Working directory:** ${s.cwd ? esc(s.cwd) : 'unknown'}`,
    `- **Repository:** ${s.repoRoot ? esc(s.repoRoot) : 'not detected'}${s.gitBranch ? ` · branch ${esc(s.gitBranch)}` : ''}`,
    `- **Transcript:** ${s.transcriptPath ? esc(s.transcriptPath) : 'unknown'}`,
    `- **Last activity:** ${last} (${formatAge(new Date(last), now)}) — activity in the transcript, not proof that Claude is running`,
  ];
}

function changes(state: FocusState, itemId: string): string[] {
  const entries = state.journal.filter((j) => j.itemId === itemId).slice(-10);
  return entries.length ? entries.map((j) => `- ${j.at} — ${esc(j.summary)}`) : ['- No recorded changes.'];
}

function esc(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+!|<>])/g, '\\$1');
}
