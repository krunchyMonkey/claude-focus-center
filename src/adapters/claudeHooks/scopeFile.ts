import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MonitoringScope, SCOPE_FILE } from '../../hook/scope';

/**
 * Writes the monitoring scope next to the installed hook script (atomic). The hook reads this file
 * before recording anything and treats a missing or unreadable file as "collect nothing", so it
 * must exist whenever hooks are registered.
 */
export async function writeScopeFile(hooksDir: string, scope: MonitoringScope): Promise<void> {
  await fs.mkdir(hooksDir, { recursive: true });
  const file = path.join(hooksDir, SCOPE_FILE);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(scope), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
