// Gold-path acceptance: two Extension Development Host launches on the same VS Code profile and
// synthetic Claude folder, so state is tested across a real restart.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { goldPathLayout, writeGoldPath } from './acceptance/fixture';
import { makeTempRoot, SYNTHETIC_SETTINGS } from './fixtures/sessions';

async function main(): Promise<void> {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const root = await makeTempRoot('focus-center-acceptance-');
  const g = goldPathLayout(root);
  await writeGoldPath(g);
  await fs.writeFile(path.join(g.claudeConfigDir, 'settings.json'), SYNTHETIC_SETTINGS);
  const userData = path.join(root, 'vscode-user-data');
  const executable = process.env.FOCUS_CENTER_VSCODE_EXE;
  try {
    for (const phase of ['phase1', 'phase2']) {
      console.log(`\n=== Acceptance ${phase} ===`);
      await runTests({
        extensionDevelopmentPath: path.resolve(__dirname, '../..'),
        extensionTestsPath: path.resolve(__dirname, 'acceptance', phase),
        extensionTestsEnv: { CLAUDE_CONFIG_DIR: g.claudeConfigDir, FOCUS_CENTER_ACCEPTANCE_ROOT: root },
        ...(executable ? { vscodeExecutablePath: executable } : { version: process.env.FOCUS_CENTER_VSCODE_VERSION ?? '1.100.0' }),
        launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${userData}`],
      });
    }
  } catch (err) {
    console.error('Acceptance run failed:', err);
    process.exitCode = 1;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

void main();
