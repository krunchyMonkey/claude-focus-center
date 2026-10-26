import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { normalizeSpoolRecord } from '../../domain/events/hook';
import type { NormalizedEvent } from '../../domain/events/types';

export interface SpoolScanStats {
  dirFound: boolean;
  filesRead: number;
  invalid: number;
  unknownEvents: number;
  duplicatesDropped: number;
  pruned: number;
}

export interface SpoolScanResult {
  events: NormalizedEvent[];
  stats: SpoolScanStats;
}

export interface SpoolConsumerOptions {
  /** Spool files older than this are deleted. */
  retentionMs?: number;
  now?: () => Date;
}

export const DEFAULT_SPOOL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORD_BYTES = 16 * 1024;
const RECORD_NAME = /^(\d{1,15})-[0-9a-f]{16}\.json$/;
const TMP_NAME = /^\.tmp-/;
const STALE_TMP_MS = 60 * 1000;

/**
 * Reads hook spool files written by claude-focus-center-hook.js. Each file is read once; each event
 * id is emitted once, so replays, duplicate hook registrations and rescans add nothing.
 */
export class SpoolConsumer {
  private readonly processed = new Set<string>();
  private readonly seen = new Set<string>();

  constructor(private readonly dir: string, private readonly options: SpoolConsumerOptions = {}) {}

  async scan(): Promise<SpoolScanResult> {
    const stats: SpoolScanStats = { dirFound: true, filesRead: 0, invalid: 0, unknownEvents: 0, duplicatesDropped: 0, pruned: 0 };
    const events: NormalizedEvent[] = [];
    let names: string[];
    try {
      names = (await fs.readdir(this.dir)).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { events, stats: { ...stats, dirFound: false } };
      }
      throw err;
    }

    const now = (this.options.now ?? (() => new Date()))().getTime();
    const retention = this.options.retentionMs ?? DEFAULT_SPOOL_RETENTION_MS;
    for (const name of names) {
      const file = path.join(this.dir, name);
      if (TMP_NAME.test(name)) {
        // A hook that died between write and rename leaves a temp file; clean it up later.
        stats.pruned += (await this.removeIfOlder(file, now - STALE_TMP_MS)) ? 1 : 0;
        continue;
      }
      const match = RECORD_NAME.exec(name);
      if (!match) {
        continue;
      }
      if (Number(match[1]) < now - retention) {
        if (await this.removeIfOlder(file, Number.POSITIVE_INFINITY)) {
          stats.pruned++;
          this.processed.delete(name);
        }
        continue;
      }
      if (this.processed.has(name)) {
        continue;
      }
      // Mark first so a bad file is not retried on every scan.
      this.processed.add(name);
      stats.filesRead++;
      let value: unknown;
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) {
          stats.invalid++;
          continue;
        }
        value = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch {
        stats.invalid++;
        continue;
      }
      const result = normalizeSpoolRecord(value);
      if (!result.ok) {
        stats[result.reason === 'invalid' ? 'invalid' : 'unknownEvents']++;
        continue;
      }
      if (this.seen.has(result.event.id)) {
        stats.duplicatesDropped++;
        continue;
      }
      this.seen.add(result.event.id);
      events.push(result.event);
    }
    return { events, stats };
  }

  private async removeIfOlder(file: string, cutoffMs: number): Promise<boolean> {
    try {
      if (cutoffMs !== Number.POSITIVE_INFINITY && (await fs.stat(file)).mtimeMs >= cutoffMs) {
        return false;
      }
      await fs.rm(file, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
