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
  /** Source timestamp when present and valid; arrival time is not a substitute. */
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  /** Message UUID in the transcript, for evidence links. */
  messageUuid?: string;
  /** Subagent (sidechain) traffic, as opposed to the main conversation. */
  sidechain?: boolean;
  toolName?: string;
  isError?: boolean;
  /** Short, redacted text; only for kinds where wording matters (assistant text, errors). */
  excerpt?: string;
}

export type EventKind =
  | 'user-prompt'
  | 'assistant-text'
  | 'tool-use'
  | 'tool-result'
  | 'system';

export function eventId(source: NormalizedEvent['source'], sessionId: string, sourceEventId: string): string {
  return `${source}:${sessionId}:${sourceEventId}`;
}
