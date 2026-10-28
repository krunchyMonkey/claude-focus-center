// Regression tests for the Copilot review of PR #17 — correctness findings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOOK_EVENTS, installedEvents, installHooks, isOwnedHandler, removeHooks, Settings } from '../../adapters/claudeHooks/settings';
import { effectiveStatus } from '../../domain/attention/effective';
import { triage } from '../../domain/attention/triage';
import type { NormalizedEvent } from '../../domain/events/types';
import { buildRecap, markCaughtUp } from '../../domain/recap/recap';
import { applyEvents } from '../../domain/state/reducer';
import { emptyState } from '../../domain/state/types';

const cmd = { nodePath: '/synthetic/bin/node', scriptPath: '/synthetic/storage/hooks/claude-focus-center-hook.js', spoolDir: '/synthetic/storage/spool' };
const t0 = new Date('2026-10-01T10:00:00Z');
const plus = (min: number) => new Date(t0.getTime() + min * 60_000);
let n = 0;

function ev(kind: NormalizedEvent['kind'], at: Date, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const id = `c${n++}`;
  return { schema: 1, id: `hook:s:${id}`, source: 'hook', sessionId: 's', sourceEventId: id, kind, timestamp: at.toISOString(), cwd: '/synthetic/repo', ...extra };
}

// ---- Finding 7: ownership of command-string handlers ------------------------------------------
test('similarly named third-party handlers are never treated as ours', () => {
  const lookalikes = [
    'node /tools/claude-focus-center-hook.js.bak',
    'node /tools/my-claude-focus-center-hook.js',
    'node /tools/claude-focus-center-hook.json',
    '/tools/run.sh --note=claude-focus-center-hook.js-is-great',
    'node /tools/claude-focus-center-hook.js.bak Stop',
  ];
  for (const command of lookalikes) {
    assert.equal(isOwnedHandler({ type: 'command', command }), false, command);
  }
  // A complete script token is ours, with any quoting style or separator.
  assert.equal(isOwnedHandler({ type: 'command', command: 'node /x/claude-focus-center-hook.js Stop /x/spool' }), true);
  const bs = String.fromCharCode(92);
  assert.equal(isOwnedHandler({ type: 'command', command: `node "C:${bs}x y${bs}claude-focus-center-hook.js" Stop` }), true);
  assert.equal(isOwnedHandler({ type: 'command', command: "node 'C:/x/claude-focus-center-hook.js' Stop" }), true);
});

test('install and uninstall leave a lookalike third-party handler untouched', () => {
  const mine: Settings = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node /tools/claude-focus-center-hook.js.bak' }, { type: 'command', command: '/synthetic/other.sh' }] }],
    },
  };
  const installed = installHooks(mine, cmd);
  const stop = (installed.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>).Stop;
  assert.equal(stop[0].hooks[0].command, 'node /tools/claude-focus-center-hook.js.bak', 'lookalike kept by install');
  assert.deepEqual(installedEvents(installed).sort(), [...HOOK_EVENTS].sort());
  const { settings, removed } = removeHooks(installed);
  assert.equal(removed, HOOK_EVENTS.length, 'only our own entries were removed');
  assert.deepEqual(settings, mine, 'uninstall restores the original, lookalike included');
});

// ---- Finding 8: Reopen after both manual and rule resolution ---------------------------------
test('Reopen works when the item was resolved by the user and then also by the rules', () => {
  const state = emptyState();
  applyEvents(state, [ev('permission-request', t0, { toolName: 'Bash' })], t0);
  const item = Object.values(state.items)[0];
  triage(state, item.id, 'resolve', plus(1));
  // A later prompt answers it by the rules too: both overrides now say "resolved".
  applyEvents(state, [ev('prompt-submitted', plus(2))], plus(2));
  assert.equal(item.status, 'resolved');
  assert.ok(item.manuallyResolvedAt);
  assert.equal(effectiveStatus(item, plus(3)), 'resolved');

  const result = triage(state, item.id, 'reopen', plus(4));
  assert.equal(result.ok, true);
  assert.equal(effectiveStatus(item, plus(5)), 'needs-you', 'the reopen is not a silent no-op');
  assert.equal(item.manuallyResolvedAt, undefined);

  // Later activity answers it again, as usual.
  applyEvents(state, [ev('prompt-submitted', plus(10))], plus(10));
  assert.equal(effectiveStatus(item, plus(11)), 'resolved');
});

test('Reopen of a manually resolved item that the rules still consider open just clears the override', () => {
  const state = emptyState();
  applyEvents(state, [ev('permission-request', t0, { toolName: 'Bash' })], t0);
  const item = Object.values(state.items)[0];
  triage(state, item.id, 'resolve', plus(1));
  triage(state, item.id, 'reopen', plus(2));
  assert.equal(item.status, 'needs-you');
  assert.equal(effectiveStatus(item, plus(3)), 'needs-you');
});

test('Reopen of a completed task makes it In Progress again', () => {
  const state = emptyState();
  applyEvents(state, [ev('task-created', t0, { taskId: 't1', excerpt: 'Ship it' }), ev('task-completed', plus(1), { taskId: 't1', excerpt: 'Ship it' })], plus(1));
  const task = Object.values(state.items)[0];
  assert.equal(task.status, 'resolved');
  triage(state, task.id, 'reopen', plus(2));
  assert.equal(effectiveStatus(task, plus(3)), 'in-progress');
});

// ---- Finding 12: a recap is bound to the range that was opened --------------------------------
test('buildRecap can be bound to an explicit range so later events never leak into an open recap', () => {
  const state = emptyState();
  applyEvents(state, [ev('permission-request', t0, { toolName: 'Bash', sessionId: 'a', id: 'hook:a:1' })], t0);
  const shown = buildRecap(state, plus(1));
  assert.equal(shown.needsYou.length, 1);

  applyEvents(state, [ev('permission-request', plus(2), { toolName: 'Edit', sessionId: 'b', id: 'hook:b:1' })], plus(2));
  const frozen = buildRecap(state, plus(3), { fromSeq: shown.fromSeq, toSeq: shown.toSeq });
  assert.deepEqual(frozen.needsYou.map((r) => r.title), ['Permission needed: Bash']);
  assert.equal(frozen.toSeq, shown.toSeq);
  assert.deepEqual(frozen.newSessions, ['a'], 'the new session b is not part of the opened range');

  // Marking caught up with the range that was seen leaves the unseen event for next time.
  markCaughtUp(state, plus(4), shown.toSeq);
  const next = buildRecap(state, plus(5));
  assert.deepEqual(next.needsYou.map((r) => r.title), ['Permission needed: Edit']);
  assert.deepEqual(next.newSessions, ['b']);
});

test('an out-of-range or reversed explicit range is clamped to the journal', () => {
  const state = emptyState();
  applyEvents(state, [ev('permission-request', t0, { toolName: 'Bash' })], t0);
  const all = buildRecap(state, plus(1));
  const beyond = buildRecap(state, plus(1), { fromSeq: 0, toSeq: all.toSeq + 500 });
  assert.equal(beyond.toSeq, all.toSeq);
  assert.equal(buildRecap(state, plus(1), { fromSeq: 50, toSeq: 10 }).empty, true);
});
