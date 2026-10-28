import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { effectiveStatus, lastEvidenceAt } from '../../domain/attention/effective';
import { availableActions, nextSnoozeExpiry, tomorrowMorning, triage } from '../../domain/attention/triage';
import type { NormalizedEvent } from '../../domain/events/types';
import { applyEvents } from '../../domain/state/reducer';
import { emptyState, FocusState } from '../../domain/state/types';
import { JsonFileStore } from '../../storage/jsonStore';
import { makeTempRoot } from '../fixtures/sessions';

const t0 = new Date('2026-07-01T10:00:00.000Z');
const plus = (min: number) => new Date(t0.getTime() + min * 60_000);
let n = 0;

function ev(kind: NormalizedEvent['kind'], at: Date, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const id = `x${n++}`;
  return { schema: 1, id: `hook:s:${id}`, source: 'hook', sessionId: 's', sourceEventId: id, kind, timestamp: at.toISOString(), cwd: '/synthetic/repo', ...extra };
}

function withPermission(): { state: FocusState; itemId: string } {
  const state = emptyState();
  applyEvents(state, [ev('permission-request', t0, { toolName: 'Bash' })], t0);
  return { state, itemId: Object.keys(state.items)[0] };
}

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

test('acknowledge, snooze, resolve and reopen change only overrides and are journaled with evidence', () => {
  const { state, itemId } = withPermission();
  const item = state.items[itemId];
  const sourceAge = lastEvidenceAt(item);

  assert.deepEqual(triage(state, itemId, 'acknowledge', plus(1)), { ok: true, message: 'Acknowledged' });
  assert.equal(effectiveStatus(item, plus(1)), 'needs-you', 'acknowledging keeps it visible');
  assert.deepEqual(availableActions(item, plus(1)), ['snooze', 'resolve']);

  triage(state, itemId, 'snooze', plus(2), plus(62));
  assert.equal(effectiveStatus(item, plus(3)), 'waiting');
  assert.equal(effectiveStatus(item, plus(63)), 'needs-you', 'snooze expires on its own');
  assert.deepEqual(nextSnoozeExpiry(state, plus(3)), plus(62));
  assert.equal(nextSnoozeExpiry(state, plus(63)), undefined);

  triage(state, itemId, 'resolve', plus(4));
  assert.equal(effectiveStatus(item, plus(5)), 'resolved');
  assert.equal(item.snoozedUntil, undefined, 'resolving clears the snooze');
  assert.equal(item.status, 'needs-you', 'rule status kept underneath');
  assert.deepEqual(availableActions(item, plus(5)), ['reopen']);

  triage(state, itemId, 'reopen', plus(6));
  assert.equal(effectiveStatus(item, plus(6)), 'needs-you');
  assert.equal(item.acknowledgedAt, undefined);

  assert.equal(item.evidence.filter((e) => e.kind === 'user-action').length, 4);
  assert.equal(lastEvidenceAt(item), sourceAge, 'user actions do not change the source age');
  assert.deepEqual(state.journal.filter((j) => j.type === 'user-action').map((j) => j.summary.split(':')[0]), [
    'Acknowledged', `Snoozed until ${plus(62).toISOString()}`, 'Marked resolved by you', 'Reopened by you',
  ].map((s) => s.split(':')[0]));
});

test('invalid triage requests are refused without side effects', () => {
  const { state, itemId } = withPermission();
  const before = JSON.stringify(state);
  assert.equal(triage(state, 'missing', 'resolve', t0).ok, false);
  assert.equal(triage(state, itemId, 'snooze', plus(1), plus(0)).ok, false);
  assert.equal(triage(state, itemId, 'snooze', plus(1)).ok, false);
  assert.equal(JSON.stringify(state), before);
});

test('triage state survives a restart (store round trip)', async () => {
  const dir = await makeTempRoot('focus-center-triage-');
  roots.push(dir);
  const store = new JsonFileStore(path.join(dir, 'state.json'));
  const { state, itemId } = withPermission();
  triage(state, itemId, 'acknowledge', plus(1));
  triage(state, itemId, 'snooze', plus(2), plus(600));
  await store.save(state);
  const loaded = (await new JsonFileStore(path.join(dir, 'state.json')).load()).state;
  const item = loaded.items[itemId];
  assert.equal(item.acknowledgedAt, plus(1).toISOString());
  assert.equal(effectiveStatus(item, plus(3)), 'waiting');
  // Replaying the original event after restart changes nothing.
  applyEvents(loaded, [ev('permission-request', t0, { toolName: 'Bash', id: Object.values(state.items)[0].evidence[0].eventId })], plus(4));
  assert.equal(effectiveStatus(loaded.items[itemId], plus(4)), 'waiting');
});

test('a fresh blocking event supersedes an older acknowledgement, snooze or manual resolution', () => {
  for (const action of ['acknowledge', 'snooze', 'resolve'] as const) {
    const { state, itemId } = withPermission();
    triage(state, itemId, action, plus(1), plus(120));
    // The same prompt re-notified *after* the user's action (e.g. still pending).
    applyEvents(state, [ev('notification', plus(5), { notificationType: 'permission_prompt' })], plus(5));
    const item = state.items[itemId];
    assert.equal(effectiveStatus(item, plus(6)), 'needs-you', action);
    assert.equal(item.acknowledgedAt, undefined, action);
    assert.ok(state.journal.some((j) => /Reopened by new evidence/.test(j.summary)), action);
  }
});

test('evidence older than the user action does not undo it', () => {
  const { state, itemId } = withPermission();
  triage(state, itemId, 'resolve', plus(10));
  applyEvents(state, [ev('notification', plus(5), { notificationType: 'permission_prompt' })], plus(11));
  assert.equal(effectiveStatus(state.items[itemId], plus(11)), 'resolved');
});

test('a fresh permission after an answered one appears as Needs You again', () => {
  const { state, itemId } = withPermission();
  applyEvents(state, [ev('tool-result', plus(1))], plus(1));
  assert.equal(state.items[itemId].status, 'resolved', 'answered by later activity');
  applyEvents(state, [ev('permission-request', plus(10), { toolName: 'Write' })], plus(10));
  const open = Object.values(state.items).filter((i) => effectiveStatus(i, plus(10)) === 'needs-you');
  assert.deepEqual(open.map((i) => i.title), ['Permission needed: Write']);
});

test('reopening an item the rules resolved makes it Needs You until newer activity answers it', () => {
  const { state, itemId } = withPermission();
  applyEvents(state, [ev('tool-result', plus(1))], plus(1));
  triage(state, itemId, 'reopen', plus(30));
  const item = state.items[itemId];
  assert.equal(effectiveStatus(item, plus(30)), 'needs-you');
  // Older activity arriving late does not re-resolve it...
  applyEvents(state, [ev('tool-result', plus(20))], plus(31));
  assert.equal(item.status, 'needs-you');
  // ...newer activity does.
  applyEvents(state, [ev('tool-result', plus(40))], plus(41));
  assert.equal(item.status, 'resolved');
});

test('tomorrowMorning is 09:00 local on the next day', () => {
  const d = tomorrowMorning(new Date(2026, 6, 1, 22, 30));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 6, 2, 9, 0]);
});
