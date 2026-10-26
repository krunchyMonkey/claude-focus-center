import type { Recap, RecapItem } from '../domain/recap/recap';
import type { FocusState } from '../domain/state/types';
import { formatAge } from './nodes';

export function recapMarkdown(recap: Recap, state: FocusState, now: Date): string {
  const since = recap.checkpointAt ? `${recap.checkpointAt} (${formatAge(new Date(recap.checkpointAt), now)})` : 'Focus Center started tracking';
  const lines = [`# Catch Me Up`, '', `Changes since your last check: **${since}**.`, ''];
  if (recap.truncated) {
    lines.push('> Some older changes were trimmed from the local journal; this recap may be incomplete.', '');
  }
  if (recap.empty) {
    lines.push(`Nothing has changed since your last check.${recap.yourActions ? ` (${recap.yourActions} of your own action(s) recorded.)` : ''}`, '');
    return lines.join('\n');
  }
  section(lines, 'Needs you now', recap.needsYou, state);
  section(lines, 'Resolved since your last check', recap.resolved, state);
  section(lines, 'Other changes', recap.other, state);
  if (recap.newSessions.length) {
    lines.push(`## New sessions (${recap.newSessions.length})`, '');
    for (const id of recap.newSessions.slice(0, 20)) {
      const s = state.sessions[id];
      lines.push(`- ${s?.cwd ? esc(s.cwd) : 'unknown project'}${s?.gitBranch ? ` · ${esc(s.gitBranch)}` : ''} · \`${id}\``);
    }
    if (recap.newSessions.length > 20) {
      lines.push(`- …and ${recap.newSessions.length - 20} more`);
    }
    lines.push('');
  }
  if (recap.yourActions) {
    lines.push(`_${recap.yourActions} of your own triage action(s) are not listed._`, '');
  }
  lines.push('Run **Focus Center: Mark Caught Up** to start the next recap from here.', '');
  return lines.join('\n');
}

function section(lines: string[], title: string, items: RecapItem[], state: FocusState): void {
  if (items.length === 0) {
    return;
  }
  lines.push(`## ${title} (${items.length})`, '');
  for (const r of items) {
    const s = r.sessionId ? state.sessions[r.sessionId] : undefined;
    const where = s?.cwd ? ` — ${esc(s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? s.cwd)}${s.gitBranch ? ` · ${esc(s.gitBranch)}` : ''}` : '';
    lines.push(`- **${esc(r.title)}**${where}${r.status ? '' : ' _(no longer tracked)_'}${r.createdSinceCheckpoint ? ' · new' : ''}`);
    for (const c of r.changes.slice(-3)) {
      lines.push(`  - ${c.at}: ${esc(c.summary)}`);
    }
  }
  lines.push('');
}

function esc(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+!|<>])/g, '\\$1');
}
