// Persisted Focus Center state (schema v1). Holds pointers and bounded, redacted metadata only —
// never raw prompts, tool arguments, command output or transcript content.
import type { ReadCursor } from '../../adapters/claudeSessions/reader';

export const STATE_SCHEMA_VERSION = 1;

export interface SessionRecord {
  source: 'claude-local';
  sessionId: string;
  cwd?: string;
  /** Nearest ancestor of cwd containing `.git`, when it could be determined. */
  repoRoot?: string;
  transcriptPath?: string;
  gitBranch?: string;
  /** Explicit work-item tokens seen in task subjects (e.g. `AB#12`, `PROJ-3`, `#7`), bounded. */
  workItemHints?: string[];
  /** Newest source timestamp seen in any event for this session. */
  lastEventAt?: string;
  /** Last time discovery or an event showed this session. */
  lastSeenAt: string;
  /** Source timestamps the attention rules compare against (order-independent). */
  markers?: SessionMarkers;
}

export interface SessionMarkers {
  /** Latest user prompt (you replied). */
  lastPromptAt?: string;
  /** Latest tool call by Claude (main conversation). */
  lastToolUseAt?: string;
  /** Latest tool call, tool result or assistant text (main conversation). */
  lastClaudeActivityAt?: string;
  lastToolOkAt?: string;
  lastToolFailure?: { timestamp: string; eventId: string; excerpt?: string };
  lastSessionEndAt?: string;
  /** Latest turn end (Stop hook). */
  lastStop?: { timestamp: string; eventId: string };
}

export interface EvidenceRef {
  sessionId: string;
  /** NormalizedEvent id. */
  eventId: string;
  kind: 'hook' | 'message' | 'user-action';
  timestamp: string;
  messageUuid?: string;
  /** Bounded and redacted. */
  excerpt?: string;
}

export type AttentionStatus = 'needs-you' | 'in-progress' | 'waiting' | 'resolved' | 'uncertain';

export interface AttentionItem {
  id: string;
  workstreamId: string;
  kind: 'permission' | 'decision' | 'failure' | 'review' | 'task' | 'other';
  status: AttentionStatus;
  title: string;
  nextAction?: string;
  owner: 'you' | 'claude' | 'external' | 'unknown';
  priority: 0 | 1 | 2;
  evidence: EvidenceRef[];
  sourceSessionIds: string[];
  confidence: 'direct' | 'inferred' | 'unknown';
  acknowledgedAt?: string;
  snoozedUntil?: string;
  /** When the current snooze was set; newer blocking evidence clears it. */
  snoozedAt?: string;
  manuallyResolvedAt?: string;
  /** When the user last reopened the item; counts as "pending since" for the rules. */
  reopenedAt?: string;
  updatedAt: string;
}

export interface Workstream {
  id: string;
  title: string;
  sessionIds: string[];
  /** How the grouping was decided, for explainability. */
  basis: 'session' | 'repo-branch' | 'work-item' | 'manual';
  /** Disagreements between member sessions, kept visible rather than resolved silently. */
  conflicts?: string[];
}

export interface JournalEntry {
  /** Monotonic sequence number; Catch Me Up compares against a checkpoint seq. */
  seq: number;
  at: string;
  type: 'session-seen' | 'item-created' | 'item-updated' | 'user-action';
  sessionId?: string;
  itemId?: string;
  /** Short, already-sanitized description. */
  summary: string;
  eventId?: string;
}

export interface FocusState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  sessions: Record<string, SessionRecord>;
  items: Record<string, AttentionItem>;
  workstreams: Record<string, Workstream>;
  /** Manual session → workstream links; always win over automatic grouping. */
  manualLinks: Record<string, string>;
  /** Names of user-created workstreams (`manual:*`). */
  manualWorkstreamTitles?: Record<string, string>;
  /** Event ids already applied, oldest first (bounded); makes replay across restarts a no-op. */
  processedEventIds: string[];
  /** Transcript read positions keyed by transcript path. */
  cursors: Record<string, ReadCursor>;
  /** Bounded change log, oldest first. */
  journal: JournalEntry[];
  nextSeq: number;
  /** Catch Me Up checkpoint: journal seq the user last caught up to. */
  checkpointSeq: number;
  /** When the user last marked themselves caught up. */
  checkpointAt?: string;
}

export function emptyState(): FocusState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    sessions: {},
    items: {},
    workstreams: {},
    manualLinks: {},
    processedEventIds: [],
    cursors: {},
    journal: [],
    nextSeq: 1,
    checkpointSeq: 0,
  };
}
