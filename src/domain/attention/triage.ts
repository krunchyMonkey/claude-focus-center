// User triage actions. They are explicit user assertions layered over the rule-derived status:
// the original evidence is kept, each action is recorded as evidence and in the journal, and
// Claude's own files are never touched.
import { journal } from '../state/reducer';
import type { AttentionItem, FocusState } from '../state/types';
import { effectiveStatus } from './effective';

export type TriageAction = 'acknowledge' | 'snooze' | 'resolve' | 'reopen';

export interface TriageResult {
  ok: boolean;
  message: string;
}

export function triage(state: FocusState, itemId: string, action: TriageAction, now: Date, snoozeUntil?: Date): TriageResult {
  const item = state.items[itemId];
  if (!item) {
    return { ok: false, message: 'This item no longer exists.' };
  }
  const at = now.toISOString();
  switch (action) {
    case 'acknowledge':
      item.acknowledgedAt = at;
      return record(state, item, now, 'Acknowledged');
    case 'snooze': {
      if (!snoozeUntil || snoozeUntil.getTime() <= now.getTime()) {
        return { ok: false, message: 'Snooze time must be in the future.' };
      }
      item.snoozedUntil = snoozeUntil.toISOString();
      item.snoozedAt = at;
      return record(state, item, now, `Snoozed until ${item.snoozedUntil}`);
    }
    case 'resolve':
      item.manuallyResolvedAt = at;
      delete item.snoozedUntil;
      delete item.snoozedAt;
      return record(state, item, now, 'Marked resolved by you');
    case 'reopen': {
      const wasResolvedByRules = item.status === 'resolved' && !item.manuallyResolvedAt;
      delete item.manuallyResolvedAt;
      delete item.snoozedUntil;
      delete item.snoozedAt;
      delete item.acknowledgedAt;
      item.reopenedAt = at;
      if (wasResolvedByRules) {
        // The user says it still needs them, overriding the rules' "answered" inference.
        item.status = item.kind === 'task' ? 'in-progress' : 'needs-you';
      }
      return record(state, item, now, 'Reopened by you');
    }
  }
}

/** Earliest future snooze expiry, so the UI can re-render exactly then. */
export function nextSnoozeExpiry(state: FocusState, now: Date): Date | undefined {
  const nowIso = now.toISOString();
  let next: string | undefined;
  for (const item of Object.values(state.items)) {
    if (item.snoozedUntil && item.snoozedUntil > nowIso && (!next || item.snoozedUntil < next)) {
      next = item.snoozedUntil;
    }
  }
  return next ? new Date(next) : undefined;
}

/** "Until tomorrow": 09:00 local time on the next day. */
export function tomorrowMorning(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Which actions make sense for an item as currently shown. */
export function availableActions(item: AttentionItem, now: Date): TriageAction[] {
  const status = effectiveStatus(item, now);
  if (status === 'resolved' || status === 'waiting') {
    return ['reopen'];
  }
  return item.acknowledgedAt ? ['snooze', 'resolve'] : ['acknowledge', 'snooze', 'resolve'];
}

function record(state: FocusState, item: AttentionItem, now: Date, summary: string): TriageResult {
  const at = now.toISOString();
  item.evidence.push({ sessionId: item.sourceSessionIds[0], eventId: `user:${item.id}:${at}:${summary.split(' ')[0].toLowerCase()}`, kind: 'user-action', timestamp: at, excerpt: summary });
  item.updatedAt = at;
  journal(state, now, { type: 'user-action', itemId: item.id, sessionId: item.sourceSessionIds[0], summary: `${summary}: ${item.title}` });
  return { ok: true, message: summary };
}
