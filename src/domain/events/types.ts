/** Normalized, source-agnostic event. Holds pointers and bounded, redacted metadata only. */
export interface NormalizedEvent {
  schema: 1;
  /** `${source}:${sessionId}:${sourceEventId}` — stable across rereads, restarts and replays. */
  id: string;
  source: 'transcript' | 'hook';
  sessionId: string;
  /** Source UUID when available, otherwise a content hash. */
  sourceEventId: string;
  kind: EventKind;
  /**
   * When the event happened at the source: the transcript record's timestamp, or the time the hook
   * ran (hooks fire as the event happens). Never the time Focus Center read it.
   */
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  transcriptPath?: string;
  /** Message UUID in the transcript, for evidence links. */
  messageUuid?: string;
  /** Subagent (sidechain) traffic, as opposed to the main conversation. */
  sidechain?: boolean;
  agentId?: string;
  toolName?: string;
  isError?: boolean;
  /** Hook Notification type, e.g. `permission_prompt`, `idle_prompt`. */
  notificationType?: string;
  taskId?: string;
  /** SessionStart source, SessionEnd reason or StopFailure error type. */
  reason?: string;
  /** Short, redacted text; only for kinds where wording matters (assistant text, errors, tasks). */
  excerpt?: string;
}

export type EventKind =
  // Transcript records
  | 'user-prompt'
  | 'assistant-text'
  | 'tool-use'
  | 'tool-result'
  | 'system'
  // Hook events
  | 'session-start'
  | 'prompt-submitted'
  | 'notification'
  | 'permission-request'
  | 'tool-failure'
  | 'task-created'
  | 'task-completed'
  | 'stop'
  | 'stop-failure'
  | 'session-end';

export function eventId(source: NormalizedEvent['source'], sessionId: string, sourceEventId: string): string {
  return `${source}:${sessionId}:${sourceEventId}`;
}
