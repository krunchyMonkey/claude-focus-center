// Gold-path acceptance, launch 2: a fresh VS Code process on the same profile and Claude folder.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { installNetworkTrap, runSuite } from '../harness';
import { activate, dashboard, fireHook, layout, log } from './common';
import { goldPathHooks, permissionHook } from './fixture';

const networkCalls = installNetworkTrap(path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..'));
const g = layout();

export async function run(): Promise<void> {
  const phase1 = JSON.parse(await fs.readFile(path.join(g.root, 'phase1-dashboard.json'), 'utf8')) as {
    dashboard: Record<string, number>; permissionItemId: string; checkpointSeq: number;
  };
  await runSuite([
    ['after restart: dashboard, acknowledgement, snooze and checkpoint are restored', async () => {
      const api = await activate();
      assert.equal(api.getState().items[phase1.permissionItemId]?.acknowledgedAt !== undefined, true, 'acknowledgement persisted');
      assert.equal(api.getState().checkpointSeq, phase1.checkpointSeq);
      await api.refresh();
      assert.deepEqual(dashboard(api), phase1.dashboard);
      log(`restored dashboard: ${JSON.stringify(dashboard(api))}`);
    }],
    ['unchanged transcripts are not reread after restart', async () => {
      const api = await activate();
      await api.refresh();
      const poll = api.getIngestion().lastPoll;
      assert.equal(poll?.bytesRead, 0);
      assert.equal(poll?.filesUnchanged, 10);
    }],
    ['replaying the same hook events creates no duplicate items', async () => {
      const api = await activate();
      const before = Object.keys(api.getState().items).length;
      for (const hook of [...goldPathHooks(g), permissionHook(g)]) {
        await fireHook(api, hook);
      }
      await api.scanHookSpool();
      await api.refresh();
      assert.equal(Object.keys(api.getState().items).length, before);
      assert.deepEqual(dashboard(api), phase1.dashboard);
    }],
    ['Catch Me Up after restart: nothing invented; a new event shows up alone', async () => {
      const api = await activate();
      assert.equal((await vscode.commands.executeCommand<{ empty: boolean }>('focusCenter.catchMeUp')).empty, true);
      await fireHook(api, { event: 'StopFailure', payload: { hook_event_name: 'StopFailure', session_id: g.sessions.taskBeta.id, cwd: g.sessions.taskBeta.cwd, error: 'rate_limit' } });
      await api.scanHookSpool();
      const recap = await vscode.commands.executeCommand<{ empty: boolean }>('focusCenter.catchMeUp');
      assert.equal(recap.empty, false);
      const text = vscode.window.activeTextEditor?.document.getText() ?? '';
      assert.match(text, /## Needs you now \(1\)\n\n- \*\*Claude stopped: rate\\_limit\*\*/);
      assert.doesNotMatch(text, /Permission needed/);
    }],
    ['no network calls from the extension', async () => {
      assert.deepEqual(networkCalls, []);
    }],
  ]);
}
