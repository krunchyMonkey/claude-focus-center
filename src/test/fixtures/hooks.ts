// Installs a real copy of the compiled hook (as "Enable Claude Hooks" does) with an explicit scope.
import * as path from 'node:path';
import { copyHookScripts } from '../../adapters/claudeHooks/installer';
import { writeScopeFile } from '../../adapters/claudeHooks/scopeFile';
import type { MonitoringScope } from '../../hook/scope';

export const OPEN_SCOPE: MonitoringScope = { excludedPaths: [], includedPaths: [], paused: false };

/** Returns the installed script path; the compiled hook folder is `out/hook`. */
export async function installHookForTest(storageDir: string, scope: MonitoringScope = OPEN_SCOPE): Promise<string> {
  const script = await copyHookScripts(path.resolve(__dirname, '..', '..', 'hook'), storageDir);
  await writeScopeFile(path.dirname(script), scope);
  return script;
}
