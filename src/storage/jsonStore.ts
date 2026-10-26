import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { emptyState, FocusState } from '../domain/state/types';
import { validateState } from './validate';

/** Storage boundary, so the JSON file can later be swapped (e.g. for SQLite) without touching callers. */
export interface StateStore {
  load(): Promise<LoadResult>;
  save(state: FocusState): Promise<void>;
}

export interface LoadResult {
  state: FocusState;
  source: 'primary' | 'backup' | 'empty';
  /** Present when something had to be recovered; the original file was moved, never deleted. */
  recovery?: { problem: string; movedTo?: string };
}

/**
 * Atomic JSON snapshot: write temp, move the previous file to `.bak`, rename temp into place.
 * A crash at any point leaves either the new file, the old file or the `.bak` readable.
 */
export class JsonFileStore implements StateStore {
  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) {}

  get path(): string {
    return this.file;
  }

  get backupPath(): string {
    return `${this.file}.bak`;
  }

  async load(): Promise<LoadResult> {
    const primary = await this.read(this.file);
    if (primary.kind === 'ok') {
      return { state: primary.state, source: 'primary' };
    }
    let recovery: LoadResult['recovery'];
    if (primary.kind === 'bad') {
      recovery = { problem: primary.problem, movedTo: await this.moveAside(this.file, primary.label) };
    }
    const backup = await this.read(this.backupPath);
    if (backup.kind === 'ok') {
      return { state: backup.state, source: 'backup', recovery: recovery ?? { problem: 'state file missing; restored from backup' } };
    }
    if (backup.kind === 'bad') {
      const movedTo = await this.moveAside(this.backupPath, backup.label);
      recovery = { problem: [recovery?.problem, `backup: ${backup.problem}`].filter(Boolean).join('; '), movedTo: recovery?.movedTo ?? movedTo };
    }
    return { state: emptyState(), source: 'empty', recovery };
  }

  async save(state: FocusState): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(state), { encoding: 'utf8', flag: 'wx' });
      try {
        await fs.rename(this.file, this.backupPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
      await fs.rename(tmp, this.file);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  private async read(file: string): Promise<{ kind: 'ok'; state: FocusState } | { kind: 'missing' } | { kind: 'bad'; problem: string; label: string }> {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { kind: 'missing' };
      }
      return { kind: 'bad', problem: `unreadable (${(err as NodeJS.ErrnoException).code ?? 'error'})`, label: 'unreadable' };
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { kind: 'bad', problem: 'not valid JSON (corrupted or partially written)', label: 'corrupt' };
    }
    const result = validateState(value);
    if (!result.ok) {
      return { kind: 'bad', problem: result.detail, label: result.reason === 'newer-version' ? 'newer' : 'invalid' };
    }
    return { kind: 'ok', state: result.state };
  }

  private async moveAside(file: string, label: string): Promise<string | undefined> {
    const target = `${file}.${label}-${this.now().toISOString().replace(/[:.]/g, '-')}.json`;
    try {
      await fs.rename(file, target);
      return target;
    } catch {
      return undefined;
    }
  }
}
