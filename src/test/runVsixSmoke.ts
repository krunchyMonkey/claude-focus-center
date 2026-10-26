// Installs the packaged VSIX into an isolated extensions folder (never the user's profile) and
// starts VS Code with a tiny probe extension that activates the *installed* copy.
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { makeTempRoot, tenSessions, writeSessions } from './fixtures/sessions';

async function main(): Promise<void> {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const repo = path.resolve(__dirname, '../..');
  const vsix = path.join(repo, 'focus-center.vsix');
  await fs.access(vsix).catch(() => {
    throw new Error('focus-center.vsix not found; run `npm run package` first');
  });
  const root = await makeTempRoot('focus-center-vsix-');
  const extDir = path.join(root, 'extensions');
  const userData = path.join(root, 'user-data');
  const claudeDir = path.join(root, 'claude');
  await writeSessions(path.join(claudeDir, 'projects'), tenSessions());

  try {
    const exe = process.env.FOCUS_CENTER_VSCODE_EXE ?? (await downloadAndUnzipVSCode(process.env.FOCUS_CENTER_VSCODE_VERSION ?? '1.100.0'));
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(exe);
    const install = spawnSync(cli, [...cliArgs, '--extensions-dir', extDir, '--user-data-dir', userData, '--install-extension', vsix], {
      encoding: 'utf8',
      shell: process.platform === 'win32', // code.cmd
    });
    console.log(install.stdout.trim());
    if (install.status !== 0) {
      throw new Error(`install failed: ${install.stderr}`);
    }

    // Probe extension: only a package.json; its test module lives in out/test/vsix.
    const probe = path.join(root, 'probe');
    await fs.mkdir(probe);
    await fs.writeFile(path.join(probe, 'package.json'), JSON.stringify({ name: 'focus-center-vsix-probe', publisher: 'test', version: '0.0.0', engines: { vscode: '^1.100.0' } }));

    await runTests({
      vscodeExecutablePath: exe,
      extensionDevelopmentPath: probe,
      extensionTestsPath: path.join(__dirname, 'vsix', 'smoke'),
      extensionTestsEnv: { CLAUDE_CONFIG_DIR: claudeDir, FOCUS_CENTER_VSIX_EXT_DIR: extDir },
      launchArgs: ['--extensions-dir', extDir, `--user-data-dir=${userData}`, '--skip-welcome', '--skip-release-notes'],
    });
  } catch (err) {
    console.error('VSIX smoke test failed:', err);
    process.exitCode = 1;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

void main();
