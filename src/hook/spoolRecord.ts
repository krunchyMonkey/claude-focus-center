// Dependency-free: copied next to the hook script, which runs outside VS Code.
// Turns an untrusted Claude Code hook payload into the minimal record written to the spool.
// Tool inputs, prompts and full messages are never kept; short excerpts are redacted.
import { createHash } from 'node:crypto';
import { boundedExcerpt } from './redact';

export const SPOOL_RECORD_VERSION = 1;

export interface SpoolRecord {
  v: typeof SPOOL_RECORD_VERSION;
  /** sha256 of the raw stdin payload: identical deliveries (replays, double registration) collapse. */
  id: string;
  event: string;
  sessionId: string;
  /** Time the hook ran; arrival metadata, not part of the identity. */
  receivedAt: string;
  cwd?: string;
  transcriptPath?: string;
  agentId?: string;
  toolName?: string;
  notificationType?: string;
  /** Short redacted text: notification message, task subject, error line or last assistant message tail. */
  excerpt?: string;
  taskId?: string;
  /** SessionStart source, SessionEnd reason or StopFailure error type. */
  reason?: string;
  isInterrupt?: boolean;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_EVENT = /^[A-Za-z]{1,64}$/;

/** Returns undefined for payloads without a usable event name or session id. */
export function toSpoolRecord(raw: string, eventArg: string | undefined, now: Date): SpoolRecord | undefined {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const event = str(payload.hook_event_name) ?? eventArg;
  const sessionId = str(payload.session_id);
  if (!event || !SAFE_EVENT.test(event) || !sessionId || !SAFE_ID.test(sessionId)) {
    return undefined;
  }

  const record: SpoolRecord = {
    v: SPOOL_RECORD_VERSION,
    id: createHash('sha256').update(raw).digest('hex'),
    event,
    sessionId,
    receivedAt: now.toISOString(),
    cwd: bounded(str(payload.cwd), 1024),
    transcriptPath: bounded(str(payload.transcript_path), 1024),
    agentId: safeId(payload.agent_id),
  };

  switch (event) {
    case 'Notification':
      record.notificationType = safeId(payload.notification_type);
      record.excerpt = excerpt(payload.message, 200);
      break;
    case 'PermissionRequest':
      record.toolName = bounded(str(payload.tool_name), 64);
      break;
    case 'PostToolUseFailure':
      record.toolName = bounded(str(payload.tool_name), 64);
      record.isInterrupt = payload.is_interrupt === true ? true : undefined;
      // Docs: key on the first line (e.g. "Exit code 1"); the rest is display text.
      record.excerpt = excerpt(str(payload.error)?.split('\n')[0], 120);
      break;
    case 'TaskCreated':
    case 'TaskCompleted':
      record.taskId = safeId(payload.task_id);
      record.excerpt = excerpt(payload.task_subject, 120);
      break;
    case 'Stop':
      // The closing question or request usually ends the message.
      record.excerpt = excerpt(payload.last_assistant_message, 400, 'end');
      break;
    case 'StopFailure':
      record.reason = safeId(payload.error);
      break;
    case 'SessionStart':
      record.reason = safeId(payload.source);
      break;
    case 'SessionEnd':
      record.reason = safeId(payload.reason);
      break;
    default:
      break;
  }
  for (const key of Object.keys(record) as Array<keyof SpoolRecord>) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
  return record;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function bounded(value: string | undefined, max: number): string | undefined {
  return value && value.length <= max ? value : undefined;
}

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}

function excerpt(value: unknown, max: number, keep: 'start' | 'end' = 'start'): string | undefined {
  return typeof value === 'string' && value.trim() ? boundedExcerpt(value, max, keep) : undefined;
}
