// Validates spool records (untrusted: any local process could write the spool) and maps them to
// NormalizedEvents. Unknown hook events are ignored rather than guessed.
import { SPOOL_RECORD_VERSION } from '../../hook/spoolRecord';
import { boundedExcerpt } from './redact';
import { EventKind, eventId, NormalizedEvent } from './types';

const KINDS: Record<string, EventKind> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submitted',
  Notification: 'notification',
  PermissionRequest: 'permission-request',
  PostToolUseFailure: 'tool-failure',
  TaskCreated: 'task-created',
  TaskCompleted: 'task-completed',
  Stop: 'stop',
  StopFailure: 'stop-failure',
  SessionEnd: 'session-end',
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;

export type HookNormalizeResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; reason: 'invalid' | 'unknown-event' };

export function normalizeSpoolRecord(value: unknown): HookNormalizeResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'invalid' };
  }
  const r = value as Record<string, unknown>;
  if (r.v !== SPOOL_RECORD_VERSION || typeof r.id !== 'string' || !HASH.test(r.id)
    || typeof r.sessionId !== 'string' || !SAFE_ID.test(r.sessionId) || typeof r.event !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  const kind = KINDS[r.event];
  if (!kind) {
    return { ok: false, reason: 'unknown-event' };
  }
  const event: NormalizedEvent = {
    schema: 1,
    id: eventId('hook', r.sessionId, r.id),
    source: 'hook',
    sessionId: r.sessionId,
    sourceEventId: r.id,
    kind,
    timestamp: isoOrUndefined(r.receivedAt),
    cwd: str(r.cwd, 1024),
    transcriptPath: str(r.transcriptPath, 1024),
    agentId: id(r.agentId),
    toolName: str(r.toolName, 64),
    notificationType: id(r.notificationType),
    taskId: id(r.taskId),
    reason: id(r.reason),
    isError: kind === 'tool-failure' || kind === 'stop-failure' ? true : undefined,
    // Re-bound and re-redact: the spool is not trusted to have done it.
    excerpt: typeof r.excerpt === 'string' && r.excerpt.trim() ? boundedExcerpt(r.excerpt, 400, kind === 'stop' ? 'end' : 'start') : undefined,
  };
  if (r.isInterrupt === true) {
    event.reason = 'interrupt';
  }
  for (const key of Object.keys(event) as Array<keyof NormalizedEvent>) {
    if (event[key] === undefined) {
      delete event[key];
    }
  }
  return { ok: true, event };
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function id(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}
