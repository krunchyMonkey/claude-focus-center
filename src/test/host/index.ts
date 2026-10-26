// Runs inside the Extension Development Host. A tiny sequential harness keeps test dependencies minimal.
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { FocusCenterApi } from '../../extension';

const EXTENSION_ID = 'krunchymonkey.claude-focus-center';

const tests: Array<[string, () => Promise<void>]> = [
  ['extension activates and exposes an empty queue', async () => {
    const api = await activate();
    assert.deepEqual(api.getRootNodes(), []);
  }],
  ['contributed commands are registered', async () => {
    await activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['focusCenter.refresh', 'focusCenter.showDiagnostics']) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  }],
  ['Refresh works with no sessions', async () => {
    await activate();
    await vscode.commands.executeCommand('focusCenter.refresh');
  }],
  ['Diagnostics reports partial coverage with no sessions', async () => {
    await activate();
    const lines = await vscode.commands.executeCommand<string[]>('focusCenter.showDiagnostics');
    const text = lines.join('\n');
    assert.match(text, /Collection coverage/);
    assert.match(text, /partial coverage/);
  }],
  ['Focus Center view can be revealed', async () => {
    await activate();
    await vscode.commands.executeCommand('focusCenter.queue.focus');
  }],
];

async function activate(): Promise<FocusCenterApi> {
  const ext = vscode.extensions.getExtension<FocusCenterApi>(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  return ext.activate();
}

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✔ ${name}`);
    } catch (err) {
      failures.push(name);
      console.error(`  ✘ ${name}\n${err instanceof Error ? err.stack : String(err)}`);
    }
  }
  console.log(`${tests.length - failures.length}/${tests.length} host tests passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} host test(s) failed`);
  }
}
