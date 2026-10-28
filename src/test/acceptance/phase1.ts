// Gold-path acceptance, launch 1: morning triage → daytime event → details → resume → acknowledge
// → Catch Me Up. Launch 2 (phase2.ts) restarts VS Code on the same profile.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { installNetworkTrap, runSuite, waitUntil } from '../harness';
import { activate, dashboard, fireHook, itemNodes, layout, log } from './common';
import { goldPathHooks, permissionHook } from './fixture';

const networkCalls = installNetworkTrap(path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..'));
const g = layout();

export async function run(): Promise<void> {
  await runSuite([
    ['morning: 4 projects / 10 sessions → 2 Needs You, 2 In Progress, 1 Waiting, 1 Uncertain', async () => {
      const api = await activate();
      const started = Date.now();
      await api.refresh();
      log(`initial discovery + ingest of 10 sessions: ${Date.now() - started} ms`);
      for (const hook of goldPathHooks(g)) {
        await fireHook(api, hook);
      }
      await api.scanHookSpool();
      await api.refresh();
      assert.equal(api.getLastDiscovery()?.sessions.length, 10);
      assert.equal(new Set(api.getLastDiscovery()?.sessions.map((s) => s.cwd)).size, 4);
      assert.deepEqual(dashboard(api), { 'needs-you': 3, 'in-progress': 2, uncertain: 1, resolved: 3, sessions: 10 });

      // The user defers one decision: it moves to Waiting.
      const snoozed = itemNodes(api).find((n) => n.sessionId === g.sessions.snoozed.id)!;
      await vscode.commands.executeCommand('focusCenter.snooze', snoozed, new Date(Date.now() + 86_400_000).toISOString());
      assert.deepEqual(dashboard(api), { 'needs-you': 2, 'in-progress': 2, waiting: 1, uncertain: 1, resolved: 3, sessions: 10 });
      log(`dashboard: ${JSON.stringify(dashboard(api))}`);
    }],
    ['every item is explainable; the conflicting workstream is flagged; Stop never resolved anything', async () => {
      const api = await activate();
      const state = api.getState();
      for (const item of Object.values(state.items)) {
        assert.ok(item.evidence.some((e) => e.kind !== 'user-action' && e.eventId && e.timestamp), item.title);
        if (item.status === 'resolved' && item.kind !== 'task') {
          assert.ok(state.journal.some((j) => j.itemId === item.id && /^Answered/.test(j.summary)), `${item.title} resolved by an answer`);
        }
      }
      const ws = Object.values(state.workstreams).find((w) => w.id === 'ref:jira:PROJ-9');
      assert.deepEqual(ws?.sessionIds.sort(), [g.sessions.failed.id, g.sessions.conflict.id].sort());
      assert.ok(ws?.conflicts?.length, 'conflict kept visible');
      assert.equal(Object.values(state.items).filter((i) => i.sourceSessionIds.includes(g.sessions.midTurn.id)).length, 0, 'mid-turn question ignored');
    }],
    ['malformed transcript data is tolerated and reported', async () => {
      await activate();
      const text = (await vscode.commands.executeCommand<string[]>('focusCenter.showDiagnostics')).join('\n');
      assert.match(text, /Claude session files: active — 10 session\(s\)/);
      assert.match(text, /Skipped since start: [1-9]\d* invalid line/);
    }],
    ['daytime: a permission prompt reaches Needs You without a reload, within 5 s', async () => {
      const api = await activate();
      const before = dashboard(api)['needs-you'];
      const started = Date.now();
      await fireHook(api, permissionHook(g));
      const latency = await waitUntil(() => dashboard(api)['needs-you'] === before + 1, 5000);
      log(`permission prompt → sidebar: ${Date.now() - started} ms (wait ${latency} ms)`);
      assert.equal(api.getBadge(), before + 1);
    }],
    ['details explain the item; resume opens the right session in the right folder', async () => {
      const api = await activate();
      const perm = itemNodes(api).find((n) => n.label === 'Permission needed: Bash')!;
      await vscode.commands.executeCommand('focusCenter.showDetails', perm);
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'focus-center' && d.uri.path.includes(encodeURIComponent(perm.itemId!)));
      assert.match(doc?.getText() ?? '', /## Why this is here\n\n- .* — hook event/);
      assert.match(doc?.getText() ?? '', new RegExp(`\\*\\*Session:\\*\\* \`${g.sessions.decision.id}\``));

      const out = path.join(g.root, 'resume-out.txt');
      const fake = path.join(g.root, process.platform === 'win32' ? 'fake claude.cmd' : 'fake-claude.sh');
      await fs.writeFile(fake, process.platform === 'win32'
        ? `@echo off\r\necho %CD%> "${out}"\r\necho %*>> "${out}"\r\n`
        : `#!/bin/sh\npwd > "${out}"\necho "$@" >> "${out}"\n`);
      await fs.chmod(fake, 0o755);
      await vscode.workspace.getConfiguration('focusCenter').update('claudePath', fake, vscode.ConfigurationTarget.Global);
      const outcome = await vscode.commands.executeCommand<{ launched: boolean }>('focusCenter.resumeSession', perm);
      assert.equal(outcome.launched, true);
      await waitUntil(async () => (await fs.readFile(out, 'utf8').catch(() => '')).includes('--resume'), 10_000);
      const [cwd, args] = (await fs.readFile(out, 'utf8')).trim().split(/\r?\n/);
      assert.equal(path.resolve(cwd.trim()).toLowerCase(), path.resolve(g.sessions.decision.cwd).toLowerCase());
      assert.equal(args.trim(), `--resume ${g.sessions.decision.id}`);
      vscode.window.terminals.forEach((t) => t.dispose());
    }],
    ['acknowledge the permission; Catch Me Up; mark caught up; flush for restart', async () => {
      const api = await activate();
      const perm = itemNodes(api).find((n) => n.label === 'Permission needed: Bash')!;
      await vscode.commands.executeCommand('focusCenter.acknowledge', perm);
      const recap = await vscode.commands.executeCommand<{ empty: boolean }>('focusCenter.catchMeUp');
      assert.equal(recap.empty, false);
      await vscode.commands.executeCommand('focusCenter.markCaughtUp');
      await api.flushState();
      await fs.writeFile(path.join(g.root, 'phase1-dashboard.json'), JSON.stringify({ dashboard: dashboard(api), permissionItemId: perm.itemId, checkpointSeq: api.getState().checkpointSeq }));
    }],
    ['no network calls from the extension', async () => {
      assert.deepEqual(networkCalls, []);
    }],
  ]);
}
