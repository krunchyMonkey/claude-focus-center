// Single-writer lock for Focus Center's shared global-storage state, so two VS Code windows cannot
// overwrite each other's acknowledgements, resolutions or checkpoints with a stale snapshot.
// A heartbeat keeps the lock alive; a lock nobody refreshes becomes stale and can be taken over.
// The writer re-verifies ownership immediately before every save, which closes the window in which
// a suspended window could write after losing the lock.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface LockInfo {
  owner: string;
  pid: number;
  heartbeatAt: number;
}

export interface WriterLockOptions {
  /** A lock whose heartbeat is older than this can be taken over. */
  staleMs?: number;
  now?: () => number;
}

export const DEFAULT_LOCK_STALE_MS = 15_000;

export class WriterLock {
  private owned = false;
  private readonly staleMs: number;
  private readonly now: () => number;

  constructor(private readonly file: string, readonly owner: string, options: WriterLockOptions = {}) {
    this.staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
    this.now = options.now ?? Date.now;
  }

  get held(): boolean {
    return this.owned;
  }

  /** Acquires the lock if it is free, stale, corrupt or already ours. Returns whether we now hold it. */
  async tryAcquire(): Promise<boolean> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      await fs.writeFile(this.file, this.serialize(), { encoding: 'utf8', flag: 'wx' });
      return (this.owned = true);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        return (this.owned = false);
      }
    }
    const current = await this.read();
    if (current && current.owner !== this.owner && this.now() - current.heartbeatAt <= this.staleMs) {
      return (this.owned = false);
    }
    // Free-looking (ours, stale or corrupt): take it with an atomic replace, then confirm we won.
    const tmp = `${this.file}.${process.pid}.${this.owner}.tmp`;
    try {
      await fs.writeFile(tmp, this.serialize(), { encoding: 'utf8' });
      await fs.rename(tmp, this.file);
    } catch {
      return (this.owned = false);
    } finally {
      await fs.rm(tmp, { force: true });
    }
    return (this.owned = await this.verify());
  }

  /** True only if the lock file still names us. Call right before writing shared state. */
  async verify(): Promise<boolean> {
    const current = await this.read();
    return (this.owned = current?.owner === this.owner);
  }

  /** Refreshes our heartbeat. Returns false (and does not touch the file) if we lost the lock. */
  async heartbeat(): Promise<boolean> {
    if (!(await this.verify())) {
      return false;
    }
    try {
      await fs.writeFile(this.file, this.serialize(), 'utf8');
    } catch {
      return (this.owned = false);
    }
    return true;
  }

  /** Releases the lock only if it is ours. */
  async release(): Promise<void> {
    if (await this.verify()) {
      await fs.rm(this.file, { force: true });
    }
    this.owned = false;
  }

  private serialize(): string {
    const info: LockInfo = { owner: this.owner, pid: process.pid, heartbeatAt: this.now() };
    return JSON.stringify(info);
  }

  private async read(): Promise<LockInfo | undefined> {
    try {
      const v: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const o = v as Partial<LockInfo> | null;
      return o && typeof o.owner === 'string' && typeof o.heartbeatAt === 'number' ? (o as LockInfo) : undefined;
    } catch {
      return undefined;
    }
  }
}
