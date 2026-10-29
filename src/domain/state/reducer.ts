// Deterministic, idempotent state transitions. Attention classification plugs in here (issue 07);
// this layer records sessions, dedupes events across restarts and keeps the journal bounded.
import { classifyEvent, ClassifyOptions, DEFAULT_CLASSIFY_OPTIONS } from '../attention/classifier';
import type { NormalizedEvent } from '../events/types';
import { refsFromText } from '../workstreams/refs';
import type { FocusState, JournalEntry, SessionRecord } from './types';

export const MAX_PROCESSED_IDS = 50_000;
export const MAX_JOURNAL = 2_000;

export interface ApplyResult {
  /** Events applied for the first time, in input order. */
  applied: NormalizedEvent[];
  duplicates: number;
}

/**
 * Applies events in order, skipping ids already processed (in this batch or any earlier one,
 * including before a restart). Mutates `state`; the same inputs always produce the same state.
 */
export function applyEvents(state: FocusState, events: readonly NormalizedEvent[], now: Date, options: ClassifyOptions = DEFAULT_CLASSIFY_OPTIONS): ApplyResult {
  const processed = new Set(state.processedEventIds);
  const applied: NormalizedEvent[] = [];
  let duplicates = 0;
  for (const event of events) {
    if (processed.has(event.id)) {
      duplicates++;
      continue;
    }
    processed.add(event.id);
    state.processedEventIds.push(event.id);
    applied.push(event);
    recordSession(state, event, now);
    for (const change of classifyEvent(state, event, now, options)) {
      journal(state, now, { type: change.type, sessionId: event.sessionId, itemId: change.itemId, summary: change.summary, eventId: event.id });
    }
  }
  if (state.processedEventIds.length > MAX_PROCESSED_IDS) {
    state.processedEventIds.splice(0, state.processedEventIds.length - MAX_PROCESSED_IDS);
  }
  return { applied, duplicates };
}

/** Records metadata for sessions found by discovery (no events needed). */
export function recordDiscoveredSession(
  state: FocusState,
  s: { sessionId: string; cwd?: string; transcriptPath: string; gitBranch?: string; entrypoint?: string; lastActivityAt: string },
  now: Date,
): void {
  const known = state.sessions[s.sessionId];
  if (!known) {
    journal(state, now, { type: 'session-seen', sessionId: s.sessionId, summary: 'Session discovered' });
  }
  state.sessions[s.sessionId] = withoutUndefined({
    source: 'claude-local',
    sessionId: s.sessionId,
    cwd: s.cwd ?? known?.cwd,
    transcriptPath: s.transcriptPath,
    gitBranch: s.gitBranch ?? known?.gitBranch,
    entrypoint: s.entrypoint ?? known?.entrypoint,
    lastEventAt: known?.lastEventAt,
    lastSeenAt: now.toISOString(),
    markers: known?.markers,
    repoRoot: known?.repoRoot,
    workItemHints: known?.workItemHints,
  });
}

export function journal(state: FocusState, now: Date, entry: Omit<JournalEntry, 'seq' | 'at'>): JournalEntry {
  const full: JournalEntry = { seq: state.nextSeq++, at: now.toISOString(), ...entry };
  state.journal.push(full);
  if (state.journal.length > MAX_JOURNAL) {
    state.journal.splice(0, state.journal.length - MAX_JOURNAL);
  }
  return full;
}

function recordSession(state: FocusState, event: NormalizedEvent, now: Date): void {
  const known: SessionRecord | undefined = state.sessions[event.sessionId];
  if (!known) {
    journal(state, now, { type: 'session-seen', sessionId: event.sessionId, summary: 'Session first seen', eventId: event.id });
  }
  const lastEventAt = newest(known?.lastEventAt, event.timestamp);
  state.sessions[event.sessionId] = withoutUndefined({
    source: 'claude-local',
    sessionId: event.sessionId,
    // Keep the first known values; later records in the same session rarely change them.
    cwd: known?.cwd ?? event.cwd,
    transcriptPath: known?.transcriptPath ?? event.transcriptPath,
    gitBranch: event.gitBranch ?? known?.gitBranch,
    entrypoint: known?.entrypoint,
    lastEventAt,
    lastSeenAt: now.toISOString(),
    markers: known?.markers,
    repoRoot: known?.repoRoot,
    workItemHints: mergeHints(known?.workItemHints, event),
  });
}

const MAX_HINTS = 10;

/** Keeps only explicit work-item tokens from task subjects, never the subject text itself. */
function mergeHints(known: string[] | undefined, event: NormalizedEvent): string[] | undefined {
  if ((event.kind !== 'task-created' && event.kind !== 'task-completed') || !event.excerpt) {
    return known;
  }
  const found = refsFromText(event.excerpt, 'repo').map((r) => r.label);
  const merged = [...(known ?? [])];
  for (const label of found) {
    if (!merged.includes(label) && merged.length < MAX_HINTS) {
      merged.push(label);
    }
  }
  return merged.length ? merged : undefined;
}

/** Persisted objects never carry undefined fields, so in-memory and reloaded state compare equal. */
function withoutUndefined<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
}

function newest(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return b > a ? b : a;
}
