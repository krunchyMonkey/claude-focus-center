// Runs inside the Extension Development Host with CLAUDE_CONFIG_DIR pointing at ten synthetic
// sessions (see runHostTests.ts). A tiny sequential harness keeps test dependencies minimal.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FocusCenterApi } from '../../extension';
import { installNetworkTrap, runNode, runSuite } from '../harness';
import { SYNTHETIC_REPOS, SYNTHETIC_SETTINGS, tenSessions, writeSessions } from '../fixtures/sessions';

const EXTENSION_ID = 'krunchymonkey.claude-focus-center';

// Installed before the extension activates; see harness.ts.
const networkCalls = installNetworkTrap(path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..'));

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
  ['clicking an item opens a read-only details document with evidence and source', async () => {
    const api = await activate();
    const item = Object.values(api.getState().items).find((i) => i.sourceSessionIds.includes('host-sess-1'));
    assert.ok(item, 'permission item from the hook test');
    const node = api.getRootNodes().flatMap((r) => r.children ?? []).flatMap((w) => w.children ?? []).find((n) => n.itemId === item.id);
    assert.equal(node?.commandId, 'focusCenter.showDetails');
    await vscode.commands.executeCommand('focusCenter.showDetails', node);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'focus-center' && d.uri.path.includes(encodeURIComponent(item.id)));
    assert.ok(doc, 'details document opened');
    assert.equal(doc.languageId, 'markdown');
    const text = doc.getText();
    for (const heading of ['# Permission needed: Bash', '## Why this is here', '## What changed', '## Source session', '## Next step']) {
      assert.ok(text.includes(heading), heading);
    }
  }],
  ['triage: acknowledge, snooze (auto-expiry), resolve persist; a fresh permission event reopens', async () => {
    const api = await activate();
    const item = Object.values(api.getState().items).find((i) => i.sourceSessionIds.includes('host-sess-1'))!;
    const groupOf = () => api.getRootNodes().find((g) => g.children?.some((w) => w.children?.some((n) => n.itemId === item.id)))?.id;

    assert.equal((await vscode.commands.executeCommand<{ ok: boolean }>('focusCenter.acknowledge', item.id)).ok, true);
    assert.equal(groupOf(), 'group:needs-you');

    const until = new Date(Date.now() + 2000).toISOString();
    assert.equal((await vscode.commands.executeCommand<{ ok: boolean }>('focusCenter.snooze', { itemId: item.id }, until)).ok, true);
    assert.equal(groupOf(), 'group:waiting');
    assert.equal(api.getBadge(), undefined);
    for (let i = 0; i < 60 && groupOf() !== 'group:needs-you'; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(groupOf(), 'group:needs-you', 'snooze expiry re-renders without a refresh');

    await vscode.commands.executeCommand('focusCenter.resolve', item.id);
    assert.equal(groupOf(), 'group:resolved');
    await api.flushState();
    const saved = JSON.parse(await fs.readFile(api.statePath, 'utf8'));
    assert.ok(saved.items[item.id].manuallyResolvedAt, 'manual resolution persisted');
    assert.ok(saved.items[item.id].acknowledgedAt, 'acknowledgement persisted');

    // The same prompt is raised again later by Claude: the item comes back.
    const script = path.join(__dirname, '..', '..', 'hook', 'claude-focus-center-hook.js');
    const input = JSON.stringify({ hook_event_name: 'Notification', session_id: 'host-sess-1', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    assert.equal(await runNode([script, 'Notification', api.spoolDir], input), 0);
    await api.scanHookSpool();
    assert.equal(groupOf(), 'group:needs-you');
    assert.equal(api.getBadge(), 1);
  }],
  ['Catch Me Up shows changes since the checkpoint; nothing new means an empty recap', async () => {
    const api = await activate();
    const first = await vscode.commands.executeCommand<{ empty: boolean; toSeq: number }>('focusCenter.catchMeUp');
    assert.equal(first.empty, false, 'sessions and the permission item are new since tracking started');
    const doc = vscode.window.activeTextEditor?.document;
    assert.equal(doc?.uri.path, '/recap.md');
    assert.match(doc?.getText() ?? '', /## Needs you now \(1\)[\s\S]*Permission needed: Bash/);
    await vscode.commands.executeCommand('focusCenter.markCaughtUp');
    assert.equal(api.getState().checkpointSeq, first.toSeq);

    await vscode.commands.executeCommand('focusCenter.refresh'); // re-reading unchanged files adds nothing
    const second = await vscode.commands.executeCommand<{ empty: boolean }>('focusCenter.catchMeUp');
    assert.equal(second.empty, true);

    const script = path.join(__dirname, '..', '..', 'hook', 'claude-focus-center-hook.js');
    const input = JSON.stringify({ hook_event_name: 'StopFailure', session_id: 'host-sess-2', cwd: '/synthetic/repo', error: 'rate_limit' });
    assert.equal(await runNode([script, 'StopFailure', api.spoolDir], input), 0);
    await api.scanHookSpool();
    const third = await vscode.commands.executeCommand<{ empty: boolean }>('focusCenter.catchMeUp');
    assert.equal(third.empty, false);
    const text = vscode.window.activeTextEditor?.document.getText() ?? '';
    assert.match(text, /Claude stopped: rate\\_limit/);
    assert.doesNotMatch(text, /Permission needed: Bash/, 'already-seen changes are not repeated');
    await api.flushState();
    assert.equal(JSON.parse(await fs.readFile(api.statePath, 'utf8')).checkpointSeq, first.toSeq, 'checkpoint persisted');
  }],
  ['resume refuses unknown sessions and deleted working directories', async () => {
    await activate();
    const unknown = await vscode.commands.executeCommand<{ launched: boolean; reason?: string }>('focusCenter.resumeSession', 'not-a-known-session');
    assert.deepEqual(unknown, { launched: false, reason: 'unknown-session' });
    // Fixture cwds are synthetic paths that do not exist on disk.
    const missing = await vscode.commands.executeCommand<{ launched: boolean; reason?: string }>('focusCenter.resumeSession', tenSessions()[0].sessionId);
    assert.deepEqual(missing, { launched: false, reason: 'cwd-missing' });
  }],
  ['resume launches the CLI in the session cwd with --resume <id> and no shell string', async () => {
    const api = await activate();
    const root = String(process.env.CLAUDE_CONFIG_DIR);
    const project = path.join(root, 'real-project');
    await fs.mkdir(project, { recursive: true });
    const id = '00000000-0000-4000-8000-0000000000aa';
    await writeSessions(path.join(root, 'projects'), [{ sessionId: id, cwd: project, gitBranch: 'main', mtime: Math.floor(Date.now() / 1000) }]);
    await vscode.commands.executeCommand('focusCenter.refresh');
    assert.equal(api.getState().sessions[id]?.cwd, project);

    // Fake CLI that records where and how it was started.
    const out = path.join(root, 'fake-claude-out.txt');
    const fake = path.join(root, process.platform === 'win32' ? 'fake claude.cmd' : 'fake-claude.sh');
    await fs.writeFile(fake, process.platform === 'win32'
      ? `@echo off\r\necho %CD%> "${out}"\r\necho %*>> "${out}"\r\n`
      : `#!/bin/sh\npwd > "${out}"\necho "$@" >> "${out}"\n`);
    await fs.chmod(fake, 0o755);
    await vscode.workspace.getConfiguration('focusCenter').update('claudePath', fake, vscode.ConfigurationTarget.Global);
    try {
      const outcome = await vscode.commands.executeCommand<{ launched: boolean; cwd?: string }>('focusCenter.resumeSession', id);
      assert.equal(outcome.launched, true);
      assert.equal(outcome.cwd, project);
      let text = '';
      for (let i = 0; i < 100 && !text.includes('--resume'); i++) {
        await new Promise((r) => setTimeout(r, 100));
        text = await fs.readFile(out, 'utf8').catch(() => '');
      }
      const [cwdLine, argsLine] = text.trim().split(/\r?\n/);
      assert.equal(path.resolve(cwdLine.trim()).toLowerCase(), path.resolve(project).toLowerCase());
      assert.equal(argsLine.trim(), `--resume ${id}`);
    } finally {
      await vscode.workspace.getConfiguration('focusCenter').update('claudePath', undefined, vscode.ConfigurationTarget.Global);
      vscode.window.terminals.forEach((t) => t.dispose());
    }
  }],
  ['Refresh and Diagnostics work when no sessions are visible', async () => {
    const api = await activate();
    await setExcluded([...Object.values(SYNTHETIC_REPOS), path.join(String(process.env.CLAUDE_CONFIG_DIR), 'real-project')]);
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
  ['out-of-scope hook events are dropped and newly excluded projects are purged from state', async () => {
    const api = await activate();
    const [, , , beta] = tenSessions(); // beta fix/123-header
    assert.ok(api.getState().sessions[beta.sessionId], 'beta is stored before exclusion');
    await setExcluded([SYNTHETIC_REPOS.beta]);
    try {
      await api.refresh();
      assert.equal(api.getState().sessions[beta.sessionId], undefined, 'stored data for the excluded project is purged');
      const storage = path.dirname(api.statePath);
      const scope = JSON.parse(await fs.readFile(path.join(storage, 'hooks', 'scope.json'), 'utf8'));
      assert.deepEqual(scope.excludedPaths, [SYNTHETIC_REPOS.beta], 'scope shared with the hook script');

      // A hook without the scope file (the compiled copy) still writes; the extension drops it.
      const script = path.join(__dirname, '..', '..', 'hook', 'claude-focus-center-hook.js');
      const before = api.getHookIngestion().outOfScope;
      const input = JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 'beta-hook-1', cwd: path.join(SYNTHETIC_REPOS.beta, 'src'), tool_name: 'Bash' });
      assert.equal(await runNode([script, 'PermissionRequest', api.spoolDir], input), 0);
      await api.scanHookSpool();
      assert.equal(api.getHookIngestion().outOfScope, before + 1);
      assert.equal(api.getState().sessions['beta-hook-1'], undefined);
    } finally {
      await setExcluded([]);
      await api.refresh();
    }
  }],
  ['pause reads and records nothing; resume continues', async () => {
    const api = await activate();
    await vscode.commands.executeCommand('focusCenter.pauseMonitoring');
    try {
      await waitFor(async () => JSON.parse(await fs.readFile(path.join(path.dirname(api.statePath), 'hooks', 'scope.json'), 'utf8')).paused === true);
      const before = api.getLastDiscovery();
      await api.refresh();
      assert.equal(api.getLastDiscovery(), before, 'no discovery while paused');
    } finally {
      await vscode.commands.executeCommand('focusCenter.resumeMonitoring');
      await waitFor(async () => JSON.parse(await fs.readFile(path.join(path.dirname(api.statePath), 'hooks', 'scope.json'), 'utf8')).paused === false);
    }
    const before = api.getLastDiscovery();
    await api.refresh();
    assert.notEqual(api.getLastDiscovery(), before);
  }],
  ['Delete Focus Center Data removes only its own storage; Claude files are untouched', async () => {
    const api = await activate();
    await api.flushState();
    const claudeDir = String(process.env.CLAUDE_CONFIG_DIR);
    const transcriptsBefore = await listFiles(path.join(claudeDir, 'projects'));
    const result = await vscode.commands.executeCommand<{ removed: string[] }>('focusCenter.deleteData', { confirmed: 'delete' });
    assert.ok(result.removed.some((p) => p.endsWith('state.json')));
    assert.ok(result.removed.every((p) => p.startsWith(path.dirname(api.statePath))), 'only inside global storage');
    assert.deepEqual(api.getState().sessions, {});
    assert.equal(api.getBadge(), undefined);
    await assert.rejects(fs.stat(api.statePath));
    assert.equal(await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8'), SYNTHETIC_SETTINGS);
    assert.deepEqual(await listFiles(path.join(claudeDir, 'projects')), transcriptsBefore);
    // Monitoring continues: the view rebuilds from current sessions.
    await api.refresh();
    assert.ok(Object.keys(api.getState().sessions).length >= 10);
  }],
  ['no network calls were made by the extension during the whole run', async () => {
    assert.deepEqual(networkCalls, []);
  }],
];

async function waitFor(check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met in time');
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      out.push(path.join(entry.parentPath ?? (entry as unknown as { path: string }).path, entry.name));
    }
  }
  return out.sort();
}

async function activate(): Promise<FocusCenterApi> {
  const ext = vscode.extensions.getExtension<FocusCenterApi>(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  return ext.activate();
}


async function setExcluded(paths: string[]): Promise<void> {
  await vscode.workspace.getConfiguration('focusCenter').update('excludedPaths', paths, vscode.ConfigurationTarget.Global);
}

export async function run(): Promise<void> {
  await runSuite(tests);
}
