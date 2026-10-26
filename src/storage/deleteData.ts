import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface DeletePlan {
  /** Paths that exist and would be removed. */
  paths: string[];
}

/**
 * Focus Center's own files in its global storage: state (and backups / recovered copies), the hook
 * spool and settings backups. The hook script folder is kept while hooks are installed, because
 * removing it would make Claude report hook errors. Nothing outside `storageDir` is ever touched.
 */
export async function planDeletion(storageDir: string, keepHookScripts: boolean): Promise<DeletePlan> {
  let names: string[];
  try {
    names = await fs.readdir(storageDir);
  } catch {
    return { paths: [] };
  }
  const ours = names.filter((n) =>
    n === 'spool' || n === 'backups' || n === 'state.json' || n.startsWith('state.json.') || (!keepHookScripts && n === 'hooks'));
  return { paths: ours.sort().map((n) => path.join(storageDir, n)) };
}

export async function deleteData(plan: DeletePlan, storageDir: string): Promise<string[]> {
  const root = path.resolve(storageDir) + path.sep;
  const removed: string[] = [];
  for (const p of plan.paths) {
    if (!path.resolve(p).startsWith(root)) {
      continue; // Defensive: never delete outside Focus Center's storage.
    }
    await fs.rm(p, { recursive: true, force: true });
    removed.push(p);
  }
  return removed;
}
