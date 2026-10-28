import type { FocusState } from '../domain/state/types';
import type { LoadResult, StateStore } from './jsonStore';

/** Decides whether this window may write the shared state file (see WriterLock). */
export interface WriteGate {
  /** Called right before each save; false skips the write. */
  canWrite(): Promise<boolean>;
  /** Cheap synchronous view for the UI. */
  isWriter(): boolean;
}

/** Owns the in-memory state and persists it (debounced) through a StateStore. */
export class StateService {
  private timer: NodeJS.Timeout | undefined;
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;
  private scrubNext = false;
  /** While > 0, changes are dropped and nothing is saved (see exclusive()). */
  private blocked = 0;
  lastSavedAt?: string;
  lastSaveError?: string;
  /** Saves skipped because another window owns the data. */
  skippedWrites = 0;

  private constructor(
    private readonly store: StateStore,
    readonly state: FocusState,
    readonly loaded: LoadResult,
    private readonly delayMs: number,
    private readonly gate?: WriteGate,
  ) {}

  static async open(store: StateStore, delayMs = 500, gate?: WriteGate): Promise<StateService> {
    const loaded = await store.load();
    return new StateService(store, loaded.state, loaded, delayMs, gate);
  }

  /** True while another window owns the shared data: this window shows state but never saves it. */
  get readOnly(): boolean {
    return this.gate ? !this.gate.isWriter() : false;
  }

  /** Mutates state and schedules a save. Dropped while exclusive work (e.g. deletion) is running. */
  update(mutate: (state: FocusState) => void): void {
    if (this.blocked > 0) {
      return;
    }
    mutate(this.state);
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Replaces the state in place (callers hold references to it) without writing anything. */
  reset(next: FocusState): void {
    clearTimeout(this.timer);
    this.dirty = false;
    for (const key of Object.keys(this.state) as Array<keyof FocusState>) {
      delete this.state[key];
    }
    Object.assign(this.state, next);
  }

  /**
   * Runs `task` with the state quiesced: pending saves are discarded, an in-flight save is awaited,
   * and changes made meanwhile are dropped. Used for data deletion, so a save that already
   * serialized the old state cannot recreate files after they were removed.
   */
  async exclusive<T>(task: () => Promise<T>): Promise<T> {
    this.blocked++;
    try {
      clearTimeout(this.timer);
      this.dirty = false;
      this.scrubNext = false;
      await this.saving;
      return await task();
    } finally {
      this.blocked--;
    }
  }

  /** Saves now and drops the pre-purge backup (see SaveOptions.scrub). */
  flushScrubbed(): Promise<void> {
    if (this.blocked > 0) {
      return this.saving;
    }
    this.scrubNext = true;
    this.dirty = true;
    return this.flush();
  }

  /** Writes pending changes now. Saves are serialized; never throws (errors go to lastSaveError). */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.saving = this.saving.then(async () => {
      if (!this.dirty || this.blocked > 0) {
        return;
      }
      this.dirty = false;
      const scrub = this.scrubNext;
      this.scrubNext = false;
      try {
        if (this.gate && !(await this.gate.canWrite())) {
          this.skippedWrites++; // another window owns the data; ours lives in memory only
          return;
        }
        await this.store.save(this.state, scrub ? { scrub: true } : undefined);
        this.lastSavedAt = new Date().toISOString();
        this.lastSaveError = undefined;
      } catch (err) {
        this.dirty = true;
        this.scrubNext = this.scrubNext || scrub;
        this.lastSaveError = err instanceof Error ? err.message : String(err);
      }
    });
    return this.saving;
  }
}
