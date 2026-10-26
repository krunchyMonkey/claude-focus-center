// Launches an Extension Development Host and runs the suite in ./host against synthetic sessions.
// FOCUS_CENTER_VSCODE_EXE: use an already installed VS Code executable instead of downloading.
// FOCUS_CENTER_VSCODE_VERSION: version to download (defaults to the engines floor).
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { makeTempRoot, SYNTHETIC_SETTINGS, tenSessions, writeSessions } from './fixtures/sessions';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './host/index');
  const executable = process.env.FOCUS_CENTER_VSCODE_EXE;
  // Inherited when launched from a VS Code terminal; it would make Code.exe run as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;

  // The extension honours CLAUDE_CONFIG_DIR, so the host only ever sees synthetic sessions.
  const claudeConfigDir = await makeTempRoot('focus-center-host-');
  await writeSessions(path.join(claudeConfigDir, 'projects'), tenSessions());
  // Pre-existing third-party settings: activation must never modify them.
  await fs.writeFile(path.join(claudeConfigDir, 'settings.json'), SYNTHETIC_SETTINGS);
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: { CLAUDE_CONFIG_DIR: claudeConfigDir },
      ...(executable
        ? { vscodeExecutablePath: executable }
        : { version: process.env.FOCUS_CENTER_VSCODE_VERSION ?? '1.100.0' }),
      launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    });
  } catch (err) {
    console.error('Extension host tests failed:', err);
    process.exitCode = 1;
  } finally {
    await fs.rm(claudeConfigDir, { recursive: true, force: true });
  }
}

void main();
