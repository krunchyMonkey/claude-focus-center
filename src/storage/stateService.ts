import type { FocusState } from '../domain/state/types';
import type { LoadResult, StateStore } from './jsonStore';

/** Owns the in-memory state and persists it (debounced) through a StateStore. */
export class StateService {
  private timer: NodeJS.Timeout | undefined;
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;
  lastSavedAt?: string;
  lastSaveError?: string;

  private constructor(private readonly store: StateStore, readonly state: FocusState, readonly loaded: LoadResult, private readonly delayMs: number) {}

  static async open(store: StateStore, delayMs = 500): Promise<StateService> {
    const loaded = await store.load();
    return new StateService(store, loaded.state, loaded, delayMs);
  }

  /** Mutates state and schedules a save. */
  update(mutate: (state: FocusState) => void): void {
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

  /** Writes pending changes now. Saves are serialized; never throws (errors go to lastSaveError). */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.saving = this.saving.then(async () => {
      if (!this.dirty) {
        return;
      }
      this.dirty = false;
      try {
        await this.store.save(this.state);
        this.lastSavedAt = new Date().toISOString();
        this.lastSaveError = undefined;
      } catch (err) {
        this.dirty = true;
        this.lastSaveError = err instanceof Error ? err.message : String(err);
      }
    });
    return this.saving;
  }
}
