// Launches an Extension Development Host and runs the suite in ./host.
// FOCUS_CENTER_VSCODE_EXE: use an already installed VS Code executable instead of downloading.
// FOCUS_CENTER_VSCODE_VERSION: version to download (defaults to the engines floor).
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './host/index');
  const executable = process.env.FOCUS_CENTER_VSCODE_EXE;
  // Inherited when launched from a VS Code terminal; it would make Code.exe run as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      ...(executable
        ? { vscodeExecutablePath: executable }
        : { version: process.env.FOCUS_CENTER_VSCODE_VERSION ?? '1.100.0' }),
      launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    });
  } catch (err) {
    console.error('Extension host tests failed:', err);
    process.exit(1);
  }
}

void main();
