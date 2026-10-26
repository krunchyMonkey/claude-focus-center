// Runs inside the Extension Development Host with CLAUDE_CONFIG_DIR pointing at ten synthetic
// sessions (see runHostTests.ts). A tiny sequential harness keeps test dependencies minimal.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FocusCenterApi } from '../../extension';
import { SYNTHETIC_REPOS, SYNTHETIC_SETTINGS, tenSessions } from '../fixtures/sessions';

const EXTENSION_ID = 'krunchymonkey.claude-focus-center';

const tests: Array<[string, () => Promise<void>]> = [
  ['contributed commands are registered', async () => {
    await activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['focusCenter.refresh', 'focusCenter.showDiagnostics', 'focusCenter.enableHooks', 'focusCenter.disableHooks']) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  }],
  ['activation never modifies Claude settings; Diagnostics shows hooks not enabled', async () => {
    await activate();
    await vscode.commands.executeCommand('focusCenter.refresh');
    const settingsPath = path.join(process.env.CLAUDE_CONFIG_DIR ?? '', 'settings.json');
    assert.equal(await fs.readFile(settingsPath, 'utf8'), SYNTHETIC_SETTINGS);
    const text = (await vscode.commands.executeCommand<string[]>('focusCenter.showDiagnostics')).join('\n');
    assert.match(text, /Claude hooks: unavailable — not enabled/);
  }],
  ['Focus Center view can be revealed', async () => {
    await activate();
    await vscode.commands.executeCommand('focusCenter.queue.focus');
  }],
  ['Refresh lists ten synthetic sessions from four repositories', async () => {
    const api = await activate();
    await vscode.commands.executeCommand('focusCenter.refresh');
    const roots = api.getRootNodes();
    // Synthetic fixtures contain no asks: Needs You is explicitly empty, sessions are listed.
    assert.deepEqual(roots.map((r) => r.id), ['group:needs-you', 'group:sessions']);
    assert.equal(roots[0].children?.[0].label, 'Nothing needs you right now');
    assert.equal(api.getBadge(), undefined);
    const sessions = roots[1].children ?? [];
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
  ['a hook event reaches the extension within 5 seconds; replay adds nothing', async () => {
    const api = await activate();
    const script = path.join(__dirname, '..', '..', 'hook', 'claude-focus-center-hook.js');
    const input = JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 'host-sess-1', cwd: '/synthetic/repo', tool_name: 'Bash', tool_input: { command: 'x' } });
    const before = api.getHookIngestion().totalEvents;
    const started = Date.now();
    // The extension host's own executable runs the script as plain Node.
    assert.equal(await runNode([script, 'PermissionRequest', api.spoolDir], input), 0);
    // No manual refresh: the watcher (or its rescan fallback) must pick it up.
    while (api.getHookIngestion().totalEvents === before && Date.now() - started < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const latency = Date.now() - started;
    assert.equal(api.getHookIngestion().totalEvents, before + 1, `no event after ${latency} ms`);
    console.log(`    hook event latency: ${latency} ms`);
    assert.equal(api.getHookIngestion().byKind['permission-request'], 1);

    assert.equal(await runNode([script, 'PermissionRequest', api.spoolDir], input), 0);
    await api.scanHookSpool();
    assert.equal(api.getHookIngestion().totalEvents, before + 1);

    // The permission request is classified as a direct Needs You item with hook evidence.
    const items = Object.values(api.getState().items).filter((i) => i.sourceSessionIds.includes('host-sess-1'));
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].kind, items[0].status, items[0].confidence, items[0].title], ['permission', 'needs-you', 'direct', 'Permission needed: Bash']);
    assert.equal(items[0].evidence[0].kind, 'hook');

    // ...and is already in the sidebar under Needs You, with the badge, without any refresh.
    const needs = api.getRootNodes().find((r) => r.id === 'group:needs-you');
    const shown = needs?.children?.flatMap((ws) => ws.children ?? []).find((n) => n.itemId === items[0].id);
    assert.equal(shown?.label, 'Permission needed: Bash');
    assert.equal(shown?.contextValue, 'item.needs-you');
    assert.equal(api.getBadge(), 1);
    // The view can be revealed and the item selected via the keyboard-accessible native tree.
    await vscode.commands.executeCommand('focusCenter.queue.focus');
    const text = (await vscode.commands.executeCommand<string[]>('focusCenter.showDiagnostics')).join('\n');
    assert.match(text, /Received this run: 1 \(permission-request 1\)/);
  }],
  ['state is persisted to global storage with sessions, cursors and no transcript content', async () => {
    const api = await activate();
    await vscode.commands.executeCommand('focusCenter.refresh');
    await api.flushState();
    const saved = JSON.parse(await fs.readFile(api.statePath, 'utf8'));
    assert.equal(saved.schemaVersion, 1);
    for (const s of tenSessions()) {
      assert.equal(saved.sessions[s.sessionId]?.cwd, s.cwd);
    }
    assert.equal(Object.keys(saved.cursors).length, 10);
    assert.ok(saved.processedEventIds.length >= 20);
    // Fixture prompt/reply text must never reach persisted state.
    assert.doesNotMatch(JSON.stringify(saved), /Synthetic request\.|Synthetic reply\./);
    assert.ok(!api.statePath.startsWith(String(process.env.CLAUDE_CONFIG_DIR)), 'state lives outside Claude folders');
  }],
  ['sessions are grouped by repo + branch and exact refs, never by name alone', async () => {
    const api = await activate();
    await vscode.commands.executeCommand('focusCenter.refresh');
    const [s1, s2, s3, s4] = tenSessions(); // alpha feat/login ×2, alpha main, beta fix/123-header
    const wsOf = (id: string) => Object.values(api.getState().workstreams).find((w) => w.sessionIds.includes(id));
    assert.equal(wsOf(s1.sessionId)?.id, wsOf(s2.sessionId)?.id);
    assert.equal(wsOf(s1.sessionId)?.basis, 'repo-branch');
    assert.notEqual(wsOf(s3.sessionId)?.id, wsOf(s1.sessionId)?.id);
    assert.equal(wsOf(s4.sessionId)?.basis, 'work-item');
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('focusCenter.linkSession') && commands.includes('focusCenter.unlinkSession'));
  }],
  ['excludedPaths setting removes a repository on refresh', async () => {
    const api = await activate();
    await setExcluded([SYNTHETIC_REPOS.beta]);
    try {
      await vscode.commands.executeCommand('focusCenter.refresh');
      assert.equal(api.getRootNodes().find((r) => r.id === 'group:sessions')?.children?.length, 7);
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
      assert.equal(api.getRootNodes().find((r) => r.id === 'group:sessions'), undefined);
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

function runNode(args: string[], input: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('exit', resolve);
    child.stdin.end(input);
  });
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
