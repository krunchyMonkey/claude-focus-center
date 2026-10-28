import { FSWatcher, promises as fs, watch } from 'node:fs';
import type { NormalizedEvent } from '../../domain/events/types';
import { SpoolConsumer, SpoolScanStats } from './spool';

export interface SpoolWatcherOptions {
  /** Fallback rescan interval; fs.watch is not reliable on every platform/file system. */
  pollMs?: number;
  debounceMs?: number;
}

/**
 * Watches the hook spool and delivers new events. Scans never overlap; a change during a scan
 * triggers exactly one more scan.
 */
export class SpoolWatcher {
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private disposed = false;

  constructor(
    private readonly dir: string,
    private readonly consumer: SpoolConsumer,
    private readonly onScan: (events: NormalizedEvent[], stats: SpoolScanStats) => void,
    private readonly onError: (err: unknown) => void,
    private readonly options: SpoolWatcherOptions = {},
  ) {}

  async start(): Promise<void> {
    // Restartable: after the spool folder was deleted the old watcher is dead.
    this.closeWatcher();
    clearInterval(this.timer);
    await fs.mkdir(this.dir, { recursive: true });
    try {
      this.watcher = watch(this.dir, () => this.schedule());
      this.watcher.on('error', () => this.closeWatcher());
    } catch {
      this.watcher = undefined; // polling still covers it
    }
    this.timer = setInterval(() => void this.scanNow(), this.options.pollMs ?? 2500);
    await this.scanNow();
  }

  /** Scans now (or once more after the current scan) and resolves when that scan is done. */
  scanNow(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          const { events, stats } = await this.consumer.scan();
          this.onScan(events, stats);
        } catch (err) {
          this.onError(err);
        }
      } while (this.again && !this.disposed);
    })().finally(() => (this.running = undefined));
    return this.running;
  }

  get watching(): boolean {
    return this.watcher !== undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.closeWatcher();
    clearInterval(this.timer);
    clearTimeout(this.debounce);
  }

  private schedule(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.scanNow(), this.options.debounceMs ?? 100);
  }

  private closeWatcher(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }
}
