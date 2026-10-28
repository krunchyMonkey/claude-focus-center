// Deterministic "since your last check" recap from the persisted journal. No model, no network,
// nothing that is not in the journal: no new entries means an empty recap.
import { effectiveStatus } from '../attention/effective';
import { journal } from '../state/reducer';
import type { AttentionStatus, FocusState, JournalEntry } from '../state/types';

export interface RecapItem {
  itemId: string;
  title: string;
  /** Current displayed status, or undefined when the item no longer exists. */
  status?: AttentionStatus;
  /** What happened since the checkpoint, oldest first (journal summaries, already sanitized). */
  changes: Array<{ at: string; summary: string }>;
  sessionId?: string;
  createdSinceCheckpoint: boolean;
}

export interface Recap {
  fromSeq: number;
  toSeq: number;
  checkpointAt?: string;
  needsYou: RecapItem[];
  resolved: RecapItem[];
  other: RecapItem[];
  newSessions: string[];
  yourActions: number;
  /** True when journal entries after the checkpoint were trimmed (bounded journal). */
  truncated: boolean;
  empty: boolean;
}

export interface RecapRange {
  /** Exclusive lower bound; defaults to the durable checkpoint. */
  fromSeq?: number;
  /** Inclusive upper bound; defaults to the end of the journal. */
  toSeq?: number;
}

/**
 * Builds a recap of the journal after `fromSeq` up to `toSeq`. Passing the range a document was
 * opened with keeps that document stable while newer events arrive.
 */
export function buildRecap(state: FocusState, now: Date, range: RecapRange = {}): Recap {
  const fromSeq = range.fromSeq ?? state.checkpointSeq;
  const end = state.nextSeq - 1;
  const toSeq = Math.min(Math.max(range.toSeq ?? end, 0), end);
  const entries = state.journal.filter((j) => j.seq > fromSeq && j.seq <= toSeq);
  const oldest = state.journal[0]?.seq;
  const truncated = oldest !== undefined && oldest > fromSeq + 1 && fromSeq > 0;

  const byItem = new Map<string, JournalEntry[]>();
  const newSessions: string[] = [];
  let yourActions = 0;
  for (const e of entries) {
    if (e.type === 'session-seen') {
      if (e.sessionId && !newSessions.includes(e.sessionId)) {
        newSessions.push(e.sessionId);
      }
      continue;
    }
    if (e.type === 'user-action') {
      yourActions++;
      continue;
    }
    if (e.itemId) {
      byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
    }
  }

  const needsYou: RecapItem[] = [];
  const resolved: RecapItem[] = [];
  const other: RecapItem[] = [];
  for (const [itemId, changes] of byItem) {
    const item = state.items[itemId];
    const status = item ? effectiveStatus(item, now) : undefined;
    const r: RecapItem = {
      itemId,
      title: item?.title ?? changes[changes.length - 1].summary,
      status,
      changes: changes.map((c) => ({ at: c.at, summary: c.summary })),
      sessionId: item?.sourceSessionIds[0] ?? changes[0].sessionId,
      createdSinceCheckpoint: changes.some((c) => c.type === 'item-created'),
    };
    (status === 'needs-you' ? needsYou : status === 'resolved' ? resolved : other).push(r);
  }
  const byPriority = (a: RecapItem, b: RecapItem) =>
    (state.items[a.itemId]?.priority ?? 9) - (state.items[b.itemId]?.priority ?? 9) || lastAt(b).localeCompare(lastAt(a));
  needsYou.sort(byPriority);
  resolved.sort(byPriority);
  other.sort(byPriority);

  return {
    fromSeq,
    toSeq,
    checkpointAt: state.checkpointAt,
    needsYou,
    resolved,
    other,
    newSessions,
    yourActions,
    truncated,
    empty: needsYou.length + resolved.length + other.length + newSessions.length === 0,
  };
}

/**
 * Advances the durable checkpoint to `toSeq` — the end of the recap the user actually saw — so
 * changes that arrived while they were reading still appear next time.
 */
export function markCaughtUp(state: FocusState, now: Date, toSeq: number = state.nextSeq - 1): void {
  if (toSeq <= state.checkpointSeq) {
    return;
  }
  state.checkpointSeq = Math.min(toSeq, state.nextSeq - 1);
  state.checkpointAt = now.toISOString();
  // A user action: counted, never listed as a change in the next recap.
  journal(state, now, { type: 'user-action', summary: 'Caught up' });
}

function lastAt(r: RecapItem): string {
  return r.changes[r.changes.length - 1]?.at ?? '';
}
