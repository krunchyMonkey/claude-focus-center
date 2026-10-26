// Rules-first attention classification. Runs inside the reducer for each newly applied event.
//
// Principles (docs/MVP-SPEC.md):
//  - Direct signals (permission requests, explicit dialogs, API failures, task events) first.
//  - Text asks only from closing assistant text, never from subagents, and only when explicit.
//  - Stop / SessionEnd / idle notifications never create "done": they only mark turn boundaries.
//  - Resolution compares source timestamps, so hooks and transcripts may arrive in any order.
//  - Ambiguity becomes Uncertain, never Needs You.
import type { NormalizedEvent } from '../events/types';
import type { AttentionItem, EvidenceRef, FocusState, SessionMarkers } from '../state/types';
import { detectAsk } from './text';

export interface ClassifyOptions {
  /** Text asks older than this are not raised; older open blockers become Uncertain. */
  staleAfterDays: number;
}

export const DEFAULT_CLASSIFY_OPTIONS: ClassifyOptions = { staleAfterDays: 7 };

type Change = { itemId: string; type: 'item-created' | 'item-updated'; summary: string };

/** Applies one event's attention effects to `state`. Returns journal-worthy changes. */
export function classifyEvent(state: FocusState, event: NormalizedEvent, now: Date, options: ClassifyOptions = DEFAULT_CLASSIFY_OPTIONS): Change[] {
  if (event.sidechain) {
    return []; // Subagent traffic is not addressed to the user.
  }
  const changes: Change[] = [];
  const ts = event.timestamp;
  const markers = markersFor(state, event.sessionId);
  updateMarkers(markers, event);

  switch (event.kind) {
    case 'permission-request':
      openOrMerge(state, changes, event, 'permission', now, options);
      break;
    case 'notification':
      if (event.notificationType === 'permission_prompt') {
        openOrMerge(state, changes, event, 'permission', now, options);
      } else if (event.notificationType === 'elicitation_dialog' || event.notificationType === 'agent_needs_input') {
        openOrMerge(state, changes, event, 'decision', now, options);
      }
      break;
    case 'assistant-text':
    case 'stop': {
      const ask = event.excerpt ? detectAsk(event.excerpt) : undefined;
      if (ask && ts && !isOlderThan(ts, now, options.staleAfterDays)) {
        openOrMerge(state, changes, event, ask.kind, now, options, `${ask.kind === 'review' ? 'Review requested' : 'Claude is asking'}: ${ask.sentence}`);
      }
      if (event.kind === 'stop') {
        checkTurnEndedOnFailure(state, changes, event.sessionId, markers, now, options);
      }
      break;
    }
    case 'tool-result':
    case 'tool-failure':
      // The Stop may have arrived first (hooks are faster than transcript reads).
      checkTurnEndedOnFailure(state, changes, event.sessionId, markers, now, options);
      break;
    case 'stop-failure':
      openOrMerge(state, changes, event, 'failure', now, options, `Claude stopped: ${event.reason ?? 'error'}`);
      break;
    case 'system':
      if (event.isError) {
        openOrMerge(state, changes, event, 'turn-ended-on-failure', now, options, 'Claude reported an error');
      }
      break;
    case 'task-created':
    case 'task-completed':
      upsertTask(state, changes, event, now);
      break;
    case 'session-end':
      for (const item of openItems(state, event.sessionId)) {
        const openedAt = item.evidence[item.evidence.length - 1]?.timestamp ?? '';
        if (item.status === 'needs-you' && ts && openedAt < ts) {
          setStatus(item, 'uncertain', SESSION_ENDED_NOTE, now, changes, 'Session ended with item open');
        }
      }
      break;
    default:
      break;
  }

  // Re-evaluate this session's open items against what has happened since each one opened.
  for (const item of openItems(state, event.sessionId)) {
    resolveIfAnswered(state, item, markers, now, changes);
  }
  return changes;
}

/**
 * The turn ended (Stop) right after a failed command with nothing succeeding in between:
 * possibly blocked, possibly expected. Raised as Uncertain, never Needs You. Order-independent.
 */
function checkTurnEndedOnFailure(state: FocusState, changes: Change[], sessionId: string, m: SessionMarkers, now: Date, options: ClassifyOptions): void {
  const failure = m.lastToolFailure;
  const stop = m.lastStop;
  if (!failure || !stop || stop.timestamp < failure.timestamp) {
    return;
  }
  if ((m.lastPromptAt ?? '') > failure.timestamp || (m.lastToolOkAt ?? '') > failure.timestamp) {
    return;
  }
  const stopEvent: NormalizedEvent = {
    schema: 1, id: stop.eventId, source: 'hook', sessionId, sourceEventId: stop.eventId, kind: 'stop', timestamp: stop.timestamp,
    ...(failure.excerpt ? { excerpt: failure.excerpt } : {}),
  };
  openOrMerge(state, changes, stopEvent, 'turn-ended-on-failure', now, options);
  const item = openItems(state, sessionId).find((i) => i.id === `fail:${stop.eventId}`);
  if (item && !item.evidence.some((e) => e.eventId === failure.eventId)) {
    item.evidence.push({ sessionId, eventId: failure.eventId, kind: failure.eventId.startsWith('hook:') ? 'hook' : 'message', timestamp: failure.timestamp, ...(failure.excerpt ? { excerpt: failure.excerpt } : {}) });
    item.evidence.sort(byTime);
  }
}

type OpenKind = 'permission' | 'decision' | 'review' | 'failure' | 'turn-ended-on-failure';

const RULES: Record<OpenKind, Pick<AttentionItem, 'kind' | 'status' | 'priority' | 'owner' | 'confidence'> & { prefix: string; next: string }> = {
  'permission': { kind: 'permission', status: 'needs-you', priority: 0, owner: 'you', confidence: 'direct', prefix: 'perm', next: 'Approve or deny the request in the Claude session.' },
  'decision': { kind: 'decision', status: 'needs-you', priority: 1, owner: 'you', confidence: 'inferred', prefix: 'ask', next: 'Answer Claude in the session.' },
  'review': { kind: 'review', status: 'needs-you', priority: 2, owner: 'you', confidence: 'inferred', prefix: 'ask', next: 'Review the work Claude points to.' },
  'failure': { kind: 'failure', status: 'needs-you', priority: 1, owner: 'you', confidence: 'direct', prefix: 'fail', next: 'Check the error and resume or retry the session.' },
  'turn-ended-on-failure': { kind: 'failure', status: 'uncertain', priority: 1, owner: 'unknown', confidence: 'inferred', prefix: 'fail', next: 'Check whether the failure needs you or was expected.' },
};

function openOrMerge(state: FocusState, changes: Change[], event: NormalizedEvent, rule: OpenKind, now: Date, options: ClassifyOptions, title?: string): void {
  const r = RULES[rule];
  const evidence = toEvidence(event);
  // One open item per session and rule family: e.g. PermissionRequest + its permission_prompt
  // notification, or a Stop excerpt + the same message in the transcript, become one item.
  const existing = openItems(state, event.sessionId).find((i) => i.id.startsWith(`${r.prefix}:`) && i.kind === r.kind);
  if (existing) {
    if (!existing.evidence.some((e) => e.eventId === evidence.eventId)) {
      existing.evidence.push(evidence);
      existing.evidence.sort(byTime);
      existing.updatedAt = now.toISOString();
      if (rule === 'permission' && event.toolName) {
        existing.title = `Permission needed: ${event.toolName}`;
      } else if (title) {
        existing.title = title;
      }
      maybeReopen(existing, evidence, changes);
    }
    return;
  }
  const stale = evidence.timestamp && isOlderThan(evidence.timestamp, now, options.staleAfterDays);
  // The session already ended after this event (SessionEnd arrived first): it can't still be pending.
  const endedAt = state.sessions[event.sessionId]?.markers?.lastSessionEndAt;
  const ended = endedAt !== undefined && evidence.timestamp !== '' && endedAt > evidence.timestamp;
  const demoted = (stale || ended) && r.status === 'needs-you';
  const item: AttentionItem = {
    id: `${r.prefix}:${event.id}`,
    workstreamId: `session:${event.sessionId}`,
    kind: r.kind,
    status: demoted ? 'uncertain' : r.status,
    title: title ?? defaultTitle(rule, event),
    nextAction: ended ? SESSION_ENDED_NOTE : stale ? 'This is old; check whether it still applies.' : r.next,
    owner: r.owner,
    priority: r.priority,
    evidence: [evidence],
    sourceSessionIds: [event.sessionId],
    confidence: r.confidence,
    updatedAt: now.toISOString(),
  };
  state.items[item.id] = item;
  changes.push({ itemId: item.id, type: 'item-created', summary: `${statusLabel(item.status)}: ${item.title}` });
}

function upsertTask(state: FocusState, changes: Change[], event: NormalizedEvent, now: Date): void {
  const key = event.taskId ?? event.id;
  const id = `task:${event.sessionId}:${key}`;
  const evidence = toEvidence(event);
  const completed = event.kind === 'task-completed';
  const existing = state.items[id];
  if (existing) {
    if (existing.evidence.some((e) => e.eventId === evidence.eventId)) {
      return;
    }
    existing.evidence.push(evidence);
    existing.evidence.sort(byTime);
    // Whichever task event is newest decides; completion is Claude's report, not verification.
    const newest = existing.evidence[existing.evidence.length - 1];
    const isCompleted = newest.eventId === evidence.eventId ? completed : existing.status === 'resolved';
    setStatus(existing, isCompleted ? 'resolved' : 'in-progress', isCompleted ? COMPLETED_NOTE : undefined, now, changes, isCompleted ? 'Task reported complete' : 'Task active');
    if (event.excerpt) {
      existing.title = event.excerpt;
    }
    return;
  }
  state.items[id] = {
    id,
    workstreamId: `session:${event.sessionId}`,
    kind: 'task',
    status: completed ? 'resolved' : 'in-progress',
    title: event.excerpt ?? 'Claude task',
    nextAction: completed ? COMPLETED_NOTE : undefined,
    owner: 'claude',
    priority: 2,
    evidence: [evidence],
    sourceSessionIds: [event.sessionId],
    confidence: 'direct',
    updatedAt: now.toISOString(),
  };
  if (!state.items[id].nextAction) {
    delete state.items[id].nextAction;
  }
  changes.push({ itemId: id, type: 'item-created', summary: `${completed ? 'Task reported complete' : 'Task started'}: ${state.items[id].title}` });
}

const SESSION_ENDED_NOTE = 'Session ended while this was open; check whether it still applies.';
const COMPLETED_NOTE = 'Claude reports this task complete; it has not been verified.';

/** Closes open items once later activity shows they were answered; never because of Stop. */
function resolveIfAnswered(state: FocusState, item: AttentionItem, m: SessionMarkers, now: Date, changes: Change[]): void {
  if (item.kind === 'task' || item.status === 'resolved') {
    return;
  }
  const openedAt = item.evidence[item.evidence.length - 1]?.timestamp;
  if (!openedAt) {
    return; // Unknown timing: leave it open rather than guess.
  }
  if (m.lastPromptAt && m.lastPromptAt > openedAt) {
    setStatus(item, 'resolved', 'You replied in the session.', now, changes, 'Answered: you replied');
    return;
  }
  if (item.kind === 'permission' || item.kind === 'failure') {
    // Claude cannot act on a pending permission prompt, so later tool activity means it was answered.
    if (m.lastClaudeActivityAt && m.lastClaudeActivityAt > openedAt) {
      setStatus(item, 'resolved', 'The session continued after this.', now, changes, 'Answered: session continued');
    }
    return;
  }
  // decision / review: if Claude kept working without the user, the "ask" was mid-turn prose.
  // `>=`: a tool call in the same message as the question shares its timestamp.
  if (m.lastToolUseAt && m.lastToolUseAt >= openedAt && !item.acknowledgedAt) {
    delete state.items[item.id];
    changes.push({ itemId: item.id, type: 'item-updated', summary: 'Dropped: Claude continued without input' });
  }
}

function maybeReopen(item: AttentionItem, evidence: EvidenceRef, changes: Change[]): void {
  // New direct evidence after a manual resolution reopens the item; the user's earlier action stays in the journal.
  if (item.manuallyResolvedAt && evidence.timestamp > item.manuallyResolvedAt) {
    delete item.manuallyResolvedAt;
    delete item.acknowledgedAt;
    changes.push({ itemId: item.id, type: 'item-updated', summary: `Reopened by new evidence: ${item.title}` });
  }
}

function setStatus(item: AttentionItem, status: AttentionItem['status'], nextAction: string | undefined, now: Date, changes: Change[], summary: string): void {
  if (item.status === status) {
    return;
  }
  item.status = status;
  if (nextAction) {
    item.nextAction = nextAction;
  }
  item.updatedAt = now.toISOString();
  changes.push({ itemId: item.id, type: 'item-updated', summary: `${summary}: ${item.title}` });
}

export function markersFor(state: FocusState, sessionId: string): SessionMarkers {
  const session = state.sessions[sessionId];
  if (!session.markers) {
    session.markers = {};
  }
  return session.markers;
}

function updateMarkers(m: SessionMarkers, e: NormalizedEvent): void {
  const ts = e.timestamp;
  if (!ts) {
    return;
  }
  const max = (a: string | undefined) => (a && a > ts ? a : ts);
  switch (e.kind) {
    case 'user-prompt':
    case 'prompt-submitted':
      m.lastPromptAt = max(m.lastPromptAt);
      break;
    case 'tool-use':
      m.lastToolUseAt = max(m.lastToolUseAt);
      m.lastClaudeActivityAt = max(m.lastClaudeActivityAt);
      break;
    case 'assistant-text':
      m.lastClaudeActivityAt = max(m.lastClaudeActivityAt);
      break;
    case 'session-end':
      m.lastSessionEndAt = max(m.lastSessionEndAt);
      break;
    case 'stop':
      if (!m.lastStop || ts > m.lastStop.timestamp) {
        m.lastStop = { timestamp: ts, eventId: e.id };
      }
      break;
    case 'tool-result':
    case 'tool-failure':
      m.lastClaudeActivityAt = max(m.lastClaudeActivityAt);
      if (e.kind === 'tool-failure' || e.isError) {
        if (!m.lastToolFailure || ts > m.lastToolFailure.timestamp) {
          m.lastToolFailure = { timestamp: ts, eventId: e.id, ...(e.excerpt ? { excerpt: e.excerpt } : {}) };
        }
      } else {
        m.lastToolOkAt = max(m.lastToolOkAt);
      }
      break;
    default:
      break;
  }
}

function openItems(state: FocusState, sessionId: string): AttentionItem[] {
  return Object.values(state.items).filter((i) => i.sourceSessionIds.includes(sessionId) && i.status !== 'resolved' && i.kind !== 'task');
}

function toEvidence(event: NormalizedEvent): EvidenceRef {
  const ref: EvidenceRef = {
    sessionId: event.sessionId,
    eventId: event.id,
    kind: event.source === 'hook' ? 'hook' : 'message',
    timestamp: event.timestamp ?? '',
  };
  if (event.messageUuid) {
    ref.messageUuid = event.messageUuid;
  }
  if (event.excerpt) {
    ref.excerpt = event.excerpt;
  }
  return ref;
}

function defaultTitle(rule: OpenKind, event: NormalizedEvent): string {
  switch (rule) {
    case 'permission':
      return event.toolName ? `Permission needed: ${event.toolName}` : `Permission needed${event.excerpt ? `: ${event.excerpt}` : ''}`;
    case 'decision':
      return event.excerpt ? `Claude needs input: ${event.excerpt}` : 'Claude needs your input';
    case 'review':
      return 'Review requested';
    case 'failure':
      return 'Claude stopped with an error';
    case 'turn-ended-on-failure':
      return event.excerpt ? `Turn ended after a failure: ${event.excerpt}` : 'Turn ended after a failed command';
  }
}

function statusLabel(status: AttentionItem['status']): string {
  return { 'needs-you': 'Needs you', 'in-progress': 'In progress', 'waiting': 'Waiting', 'resolved': 'Resolved', 'uncertain': 'Uncertain' }[status];
}

function isOlderThan(iso: string, now: Date, days: number): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && now.getTime() - t > days * 86_400_000;
}

function byTime(a: EvidenceRef, b: EvidenceRef): number {
  return a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId);
}
