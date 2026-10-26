import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FocusCenterApi } from '../../extension';
import { runSuite } from '../harness';

export async function run(): Promise<void> {
  await runSuite([
    ['the installed VSIX (not the dev folder) activates and works offline', async () => {
      const ext = vscode.extensions.getExtension<FocusCenterApi>('krunchymonkey.claude-focus-center');
      assert.ok(ext, 'installed extension found');
      const extDir = path.resolve(String(process.env.FOCUS_CENTER_VSIX_EXT_DIR));
      assert.ok(path.resolve(ext.extensionPath).toLowerCase().startsWith(extDir.toLowerCase()), `loaded from ${ext.extensionPath}`);
      console.log(`    loaded from ${ext.extensionPath}`);

      // Packaged contents: compiled code and the hook folder; no sources, tests or fixtures.
      const files = await fs.readdir(ext.extensionPath, { recursive: true });
      assert.ok(files.some((f) => f.replace(/\\/g, '/') === 'out/hook/claude-focus-center-hook.js'));
      assert.ok(!files.some((f) => /^(src|out[\\/]test)([\\/]|$)/.test(f)), 'no src or tests shipped');
      assert.ok(!files.some((f) => f.endsWith('.map') || f.endsWith('.jsonl')), 'no source maps or transcripts shipped');

      const api = await ext.activate();
      const commands = await vscode.commands.getCommands(true);
      for (const id of ['focusCenter.refresh', 'focusCenter.catchMeUp', 'focusCenter.resumeSession', 'focusCenter.deleteData', 'focusCenter.enableHooks']) {
        assert.ok(commands.includes(id), id);
      }
      await api.refresh();
      assert.equal(api.getLastDiscovery()?.sessions.length, 10);
      const text = (await vscode.commands.executeCommand<string[]>('focusCenter.showDiagnostics')).join('\n');
      assert.match(text, /Extension version: 0\.0\.1/);
      assert.match(text, /Network egress:\s+none/);
    }],
  ]);
}
