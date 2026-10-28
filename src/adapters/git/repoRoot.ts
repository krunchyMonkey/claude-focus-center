import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const MAX_DEPTH = 32;

/**
 * Nearest ancestor of `cwd` (inclusive) that contains `.git` (a folder, or a file for worktrees and
 * submodules). Only checks for existence; never reads repository contents or runs git.
 */
export async function findRepoRoot(cwd: string): Promise<string | undefined> {
  let dir = path.resolve(cwd);
  for (let i = 0; i < MAX_DEPTH; i++) {
    try {
      await fs.stat(path.join(dir, '.git'));
      return dir;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
}

/** Memoizing wrapper: repo roots rarely change during a VS Code session. */
export class RepoRootCache {
  private readonly cache = new Map<string, Promise<string | undefined>>();

  get(cwd: string): Promise<string | undefined> {
    let hit = this.cache.get(cwd);
    if (!hit) {
      hit = findRepoRoot(cwd);
      this.cache.set(cwd, hit);
    }
    return hit;
  }
}
