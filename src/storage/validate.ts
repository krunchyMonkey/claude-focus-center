// Structural validation of a loaded state file. Focus Center wrote it, but the file can be corrupted,
// hand-edited or written by another version, so every record the renderer and rules dereference is
// checked before the snapshot is accepted. A rejected snapshot triggers recovery (backup, then empty).
import { isCursor } from '../adapters/claudeSessions/reader';
import { FocusState, STATE_SCHEMA_VERSION } from '../domain/state/types';

export type ValidateResult =
  | { ok: true; state: FocusState }
  | { ok: false; reason: 'not-object' | 'newer-version' | 'unknown-version' | 'invalid-shape'; detail: string };

const ITEM_KINDS = ['permission', 'decision', 'failure', 'review', 'task', 'other'];
const STATUSES = ['needs-you', 'in-progress', 'waiting', 'resolved', 'uncertain'];
const OWNERS = ['you', 'claude', 'external', 'unknown'];
const CONFIDENCE = ['direct', 'inferred', 'unknown'];
const EVIDENCE_KINDS = ['hook', 'message', 'user-action'];
const JOURNAL_TYPES = ['session-seen', 'item-created', 'item-updated', 'user-action'];
const WORKSTREAM_BASIS = ['session', 'repo-branch', 'work-item', 'manual'];

export function validateState(value: unknown): ValidateResult {
  if (!isObject(value)) {
    return { ok: false, reason: 'not-object', detail: 'state file does not contain a JSON object' };
  }
  const version = value.schemaVersion;
  if (typeof version === 'number' && version > STATE_SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-version', detail: `state schema ${version} is newer than supported ${STATE_SCHEMA_VERSION}` };
  }
  if (version !== STATE_SCHEMA_VERSION) {
    return { ok: false, reason: 'unknown-version', detail: `unsupported state schema ${String(version)}` };
  }
  const problems: string[] = [];
  for (const key of ['sessions', 'items', 'workstreams', 'manualLinks', 'cursors'] as const) {
    if (!isObject(value[key])) {
      problems.push(`${key} is not an object`);
    }
  }
  for (const key of ['processedEventIds', 'journal'] as const) {
    if (!Array.isArray(value[key])) {
      problems.push(`${key} is not an array`);
    }
  }
  for (const key of ['nextSeq', 'checkpointSeq'] as const) {
    if (!Number.isInteger(value[key]) || (value[key] as number) < 0) {
      problems.push(`${key} is not a non-negative integer`);
    }
  }
  if (problems.length === 0) {
    problems.push(...nestedProblems(value));
  }
  if (problems.length > 0) {
    return { ok: false, reason: 'invalid-shape', detail: problems.slice(0, 5).join('; ') };
  }
  return { ok: true, state: value as unknown as FocusState };
}

function nestedProblems(state: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (!(state.processedEventIds as unknown[]).every((id) => typeof id === 'string')) {
    problems.push('processedEventIds contains non-strings');
  }
  if ((state.checkpointSeq as number) > (state.nextSeq as number)) {
    problems.push('checkpointSeq is beyond nextSeq');
  }
  for (const [id, session] of Object.entries(state.sessions as Record<string, unknown>)) {
    if (!isSession(session, id)) {
      problems.push(`session ${id} is malformed`);
      break;
    }
  }
  for (const [id, item] of Object.entries(state.items as Record<string, unknown>)) {
    if (!isItem(item, id)) {
      problems.push(`item ${id} is malformed`);
      break;
    }
  }
  for (const [id, ws] of Object.entries(state.workstreams as Record<string, unknown>)) {
    if (!isObject(ws) || ws.id !== id || typeof ws.title !== 'string' || !isStringArray(ws.sessionIds) || !WORKSTREAM_BASIS.includes(ws.basis as string)
      || (ws.conflicts !== undefined && !isStringArray(ws.conflicts))) {
      problems.push(`workstream ${id} is malformed`);
      break;
    }
  }
  if (!Object.values(state.manualLinks as Record<string, unknown>).every((v) => typeof v === 'string')) {
    problems.push('manualLinks contains non-strings');
  }
  if (state.manualWorkstreamTitles !== undefined && !(isObject(state.manualWorkstreamTitles) && Object.values(state.manualWorkstreamTitles).every((v) => typeof v === 'string'))) {
    problems.push('manualWorkstreamTitles is malformed');
  }
  for (const [file, cursor] of Object.entries(state.cursors as Record<string, unknown>)) {
    if (!isCursor(cursor)) {
      problems.push(`cursor for ${file} is malformed`);
      break;
    }
  }
  if (!(state.journal as unknown[]).every(isJournalEntry)) {
    problems.push('journal contains a malformed entry');
  }
  if (state.checkpointAt !== undefined && typeof state.checkpointAt !== 'string') {
    problems.push('checkpointAt is not a string');
  }
  return problems;
}

function isSession(value: unknown, id: string): boolean {
  return isObject(value) && value.sessionId === id && value.source === 'claude-local' && typeof value.lastSeenAt === 'string'
    && optionalString(value.cwd) && optionalString(value.repoRoot) && optionalString(value.transcriptPath) && optionalString(value.gitBranch)
    && optionalString(value.entrypoint) && optionalString(value.lastEventAt) && (value.workItemHints === undefined || isStringArray(value.workItemHints))
    && (value.markers === undefined || isMarkers(value.markers));
}

function isMarkers(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }
  const strings = ['lastPromptAt', 'lastToolUseAt', 'lastClaudeActivityAt', 'lastToolOkAt', 'lastSessionEndAt'];
  const failure = value.lastToolFailure;
  const stop = value.lastStop;
  return strings.every((k) => optionalString(value[k]))
    && (failure === undefined || (isObject(failure) && typeof failure.timestamp === 'string' && typeof failure.eventId === 'string' && optionalString(failure.excerpt)))
    && (stop === undefined || (isObject(stop) && typeof stop.timestamp === 'string' && typeof stop.eventId === 'string'));
}

function isItem(value: unknown, id: string): boolean {
  return isObject(value) && value.id === id && typeof value.workstreamId === 'string' && ITEM_KINDS.includes(value.kind as string)
    && STATUSES.includes(value.status as string) && typeof value.title === 'string' && OWNERS.includes(value.owner as string)
    && (value.priority === 0 || value.priority === 1 || value.priority === 2) && CONFIDENCE.includes(value.confidence as string)
    && isStringArray(value.sourceSessionIds) && (value.sourceSessionIds as string[]).length > 0
    && Array.isArray(value.evidence) && value.evidence.every(isEvidence) && typeof value.updatedAt === 'string'
    && optionalString(value.nextAction) && optionalString(value.acknowledgedAt) && optionalString(value.snoozedUntil)
    && optionalString(value.snoozedAt) && optionalString(value.manuallyResolvedAt) && optionalString(value.reopenedAt);
}

function isEvidence(value: unknown): boolean {
  return isObject(value) && typeof value.sessionId === 'string' && typeof value.eventId === 'string' && EVIDENCE_KINDS.includes(value.kind as string)
    && typeof value.timestamp === 'string' && optionalString(value.messageUuid) && optionalString(value.excerpt);
}

function isJournalEntry(value: unknown): boolean {
  return isObject(value) && Number.isInteger(value.seq) && typeof value.at === 'string' && JOURNAL_TYPES.includes(value.type as string)
    && typeof value.summary === 'string' && optionalString(value.sessionId) && optionalString(value.itemId) && optionalString(value.eventId);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
