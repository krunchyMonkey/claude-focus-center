// Runs inside the Extension Development Host with CLAUDE_CONFIG_DIR pointing at ten synthetic
// sessions (see runHostTests.ts). A tiny sequential harness keeps test dependencies minimal.
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { FocusCenterApi } from '../../extension';
import { SYNTHETIC_REPOS } from '../fixtures/sessions';

const EXTENSION_ID = 'krunchymonkey.claude-focus-center';

const tests: Array<[string, () => Promise<void>]> = [
  ['contributed commands are registered', async () => {
    await activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['focusCenter.refresh', 'focusCenter.showDiagnostics']) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  }],
  ['Focus Center view can be revealed', async () => {
    await activate();
    await vscode.commands.executeCommand('focusCenter.queue.focus');
  }],
  ['Refresh lists ten synthetic sessions from four repositories', async () => {
    const api = await activate();
    await vscode.commands.executeCommand('focusCenter.refresh');
    const roots = api.getRootNodes();
    assert.equal(roots.length, 1);
    const sessions = roots[0].children ?? [];
    assert.equal(sessions.length, 10);
    assert.equal(new Set(sessions.map((s) => s.id)).size, 10);
    assert.equal(new Set(sessions.map((s) => s.label)).size, 4);
  }],
  ['Diagnostics reports discovery counts and partial (hooks missing) coverage', async () => {
    await activate();
    const text = (await vscode.commands.executeCommand<string[]>('focusCenter.showDiagnostics')).join('\n');
    assert.match(text, /Claude session files: active — 10 session\(s\), 0 excluded/);
    assert.match(text, /Sessions listed: 10/);
    assert.match(text, /partial coverage/);
  }],
  ['Refresh reads transcripts incrementally: unchanged files are not reread', async () => {
    const api = await activate();
    await vscode.commands.executeCommand('focusCenter.refresh');
    const before = api.getIngestion().totalEvents;
    assert.equal(before, 20); // 10 sessions x (prompt + reply)
    await vscode.commands.executeCommand('focusCenter.refresh');
    const { totalEvents, lastPoll } = api.getIngestion();
    assert.equal(totalEvents, before);
    assert.equal(lastPoll?.filesUnchanged, 10);
    assert.equal(lastPoll?.bytesRead, 0);
    const text = (await vscode.commands.executeCommand<string[]>('focusCenter.showDiagnostics')).join('\n');
    assert.match(text, /Events ingested since start: 20/);
    assert.match(text, /0 file\(s\) read, 10 unchanged \(not reread\), 0 bytes/);
  }],
  ['excludedPaths setting removes a repository on refresh', async () => {
    const api = await activate();
    await setExcluded([SYNTHETIC_REPOS.beta]);
    try {
      await vscode.commands.executeCommand('focusCenter.refresh');
      assert.equal(api.getRootNodes()[0]?.children?.length, 7);
      assert.equal(api.getLastDiscovery()?.excludedCount, 1);
    } finally {
      await setExcluded([]);
    }
  }],
  ['Refresh and Diagnostics work when no sessions are visible', async () => {
    const api = await activate();
    await setExcluded(Object.values(SYNTHETIC_REPOS));
    try {
      await vscode.commands.executeCommand('focusCenter.refresh');
      assert.deepEqual(api.getRootNodes(), []);
      const text = (await vscode.commands.executeCommand<string[]>('focusCenter.showDiagnostics')).join('\n');
      assert.match(text, /Sessions listed: 0/);
    } finally {
      await setExcluded([]);
      await vscode.commands.executeCommand('focusCenter.refresh');
    }
  }],
];

async function activate(): Promise<FocusCenterApi> {
  const ext = vscode.extensions.getExtension<FocusCenterApi>(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  return ext.activate();
}

async function setExcluded(paths: string[]): Promise<void> {
  await vscode.workspace.getConfiguration('focusCenter').update('excludedPaths', paths, vscode.ConfigurationTarget.Global);
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
