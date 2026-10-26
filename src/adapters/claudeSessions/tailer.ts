import { normalizeTranscriptLine } from '../../domain/events/transcript';
import type { NormalizedEvent } from '../../domain/events/types';
import { readAppended, ReadCursor, ReadOptions } from './reader';

export interface TailTarget {
  sessionId: string;
  transcriptPath: string;
}

export interface PollStats {
  filesRead: number;
  filesUnchanged: number;
  bytesRead: number;
  invalidLines: number;
  oversizedLines: number;
  resets: number;
  duplicatesDropped: number;
  /** Files that still have unread data because the per-poll byte budget ran out. */
  deferred: number;
  errors: Array<{ path: string; code: string }>;
}

export interface PollResult {
  /** Events not seen before, in file order. */
  events: NormalizedEvent[];
  stats: PollStats;
}

export interface TailerOptions extends ReadOptions {
  /** Soft bound on bytes read across all files in one poll (may be exceeded by one chunk). */
  maxBytesPerPoll?: number;
}

export const DEFAULT_MAX_BYTES_PER_POLL = 16 * 1024 * 1024;

/**
 * Incrementally reads transcripts and emits each normalized event once. Rereads after truncation,
 * rewrites or restarts are deduplicated by stable event id.
 */
export class TranscriptTailer {
  private readonly cursors = new Map<string, ReadCursor>();
  private readonly seen = new Set<string>();

  constructor(private readonly options: TailerOptions = {}) {}

  get seenCount(): number {
    return this.seen.size;
  }

  async poll(targets: readonly TailTarget[]): Promise<PollResult> {
    const budget = this.options.maxBytesPerPoll ?? DEFAULT_MAX_BYTES_PER_POLL;
    const stats: PollStats = { filesRead: 0, filesUnchanged: 0, bytesRead: 0, invalidLines: 0, oversizedLines: 0, resets: 0, duplicatesDropped: 0, deferred: 0, errors: [] };
    const events: NormalizedEvent[] = [];

    for (const target of targets) {
      if (stats.bytesRead >= budget) {
        stats.deferred++;
        continue;
      }
      let read = false;
      try {
        for (;;) {
          // The chunk size stays fixed (it doubles as the max line length); the poll budget is only
          // checked between chunks, so one poll can overshoot it by at most one chunk.
          const result = await readAppended(target.transcriptPath, this.cursors.get(target.transcriptPath), this.options);
          this.cursors.set(target.transcriptPath, result.cursor);
          if (result.unchanged) {
            break;
          }
          read = true;
          stats.bytesRead += result.bytesRead;
          stats.oversizedLines += result.oversizedLines;
          stats.resets += result.reset ? 1 : 0;
          for (const line of result.lines) {
            const parsed = normalizeTranscriptLine(target.sessionId, line.text);
            stats.invalidLines += parsed.invalid ? 1 : 0;
            for (const event of parsed.events) {
              if (this.seen.has(event.id)) {
                stats.duplicatesDropped++;
              } else {
                this.seen.add(event.id);
                events.push(event);
              }
            }
          }
          if (!result.more) {
            break;
          }
          if (stats.bytesRead >= budget) {
            stats.deferred++;
            break;
          }
        }
      } catch (err) {
        stats.errors.push({ path: target.transcriptPath, code: (err as NodeJS.ErrnoException)?.code ?? 'unknown error' });
      }
      if (read) {
        stats.filesRead++;
      } else if (!stats.errors.some((e) => e.path === target.transcriptPath)) {
        stats.filesUnchanged++;
      }
    }
    return { events, stats };
  }
}
