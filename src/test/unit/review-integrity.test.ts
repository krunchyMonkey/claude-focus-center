// Regression tests for the Copilot review of PR #17 — data integrity findings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSpoolRecord } from '../../domain/events/hook';
import { effectiveStatus } from '../../domain/attention/effective';
import { triage } from '../../domain/attention/triage';
import { applyEvents } from '../../domain/state/reducer';
import { emptyState } from '../../domain/state/types';
import { toSpoolRecord } from '../../hook/spoolRecord';

const later = (base: Date, min: number) => new Date(base.getTime() + min * 60_000);

function hookEvent(raw: string, at: Date) {
  const result = normalizeSpoolRecord(toSpoolRecord(raw, undefined, at));
  assert.ok(result.ok);
  return result.event;
}

test('a repeated identical permission request after the first was resolved is not discarded', () => {
  const raw = JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 's1', cwd: '/synthetic/repo', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const t0 = new Date('2026-10-01T10:00:00Z');
  const state = emptyState();
  applyEvents(state, [hookEvent(raw, t0)], t0);
  const item = Object.values(state.items)[0];
  triage(state, item.id, 'resolve', later(t0, 1));
  assert.equal(effectiveStatus(item, later(t0, 2)), 'resolved');

  // Claude asks for exactly the same thing again: byte-identical hook stdin.
  const again = hookEvent(raw, later(t0, 5));
  const result = applyEvents(state, [again], later(t0, 5));
  assert.equal(result.applied.length, 1, 'not treated as a replay');
  assert.equal(Object.keys(state.items).length, 1, 'merged into the same pending item');
  assert.equal(effectiveStatus(item, later(t0, 6)), 'needs-you');
});

test('a second identical delivery (duplicate hook registration) merges into the existing item instead of duplicating it', () => {
  const raw = JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 's2', cwd: '/synthetic/repo', tool_name: 'Bash' });
  const t0 = new Date('2026-10-01T10:00:00Z');
  const state = emptyState();
  applyEvents(state, [hookEvent(raw, t0), hookEvent(raw, t0)], t0);
  assert.equal(Object.keys(state.items).length, 1);
  assert.equal(Object.values(state.items)[0].status, 'needs-you');
});

// ---- Finding 11: nested validation ------------------------------------------------------------
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after } from 'node:test';
import { JsonFileStore } from '../../storage/jsonStore';
import { validateState } from '../../storage/validate';
import { makeTempRoot } from '../fixtures/sessions';
import type { FocusState } from '../../domain/state/types';

const cleanup: string[] = [];
after(async () => {
  await Promise.all(cleanup.map((r) => fs.rm(r, { recursive: true, force: true })));
});

function validItem(id = 'perm:1') {
  return {
    id, workstreamId: 'session:s1', kind: 'permission', status: 'needs-you', title: 'Permission needed: Bash', owner: 'you', priority: 0,
    evidence: [{ sessionId: 's1', eventId: 'hook:s1:1', kind: 'hook', timestamp: '2026-10-01T10:00:00.000Z' }],
    sourceSessionIds: ['s1'], confidence: 'direct', updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

function populated(): FocusState {
  const state = emptyState();
  const t = new Date('2026-10-01T10:00:00Z');
  applyEvents(state, [{ schema: 1, id: 'hook:s1:1', source: 'hook', sessionId: 's1', sourceEventId: '1', kind: 'permission-request', toolName: 'Bash', cwd: '/synthetic/repo', timestamp: t.toISOString() }], t);
  return JSON.parse(JSON.stringify(state)) as FocusState;
}

test('a fully valid populated state passes', () => {
  assert.equal(validateState(populated()).ok, true);
});

test('malformed nested records are rejected so recovery runs instead of crashing the renderer', () => {
  const mutations: Array<[string, (s: Record<string, any>) => void, RegExp]> = [
    ['item without sourceSessionIds', (s) => { s.items = { a: { id: 'a', status: 'needs-you', evidence: [] } }; }, /item a/],
    ['item with an unknown status', (s) => { s.items = { 'perm:1': { ...validItem(), status: 'maybe' } }; }, /item perm:1/],
    ['item with a non-string title', (s) => { s.items = { 'perm:1': { ...validItem(), title: 7 } }; }, /item perm:1/],
    ['item with malformed evidence', (s) => { s.items = { 'perm:1': { ...validItem(), evidence: [{ eventId: 'x' }] } }; }, /item perm:1/],
    ['item with an out-of-range priority', (s) => { s.items = { 'perm:1': { ...validItem(), priority: 5 } }; }, /item perm:1/],
    ['session without lastSeenAt', (s) => { s.sessions = { s1: { source: 'claude-local', sessionId: 's1' } }; }, /session s1/],
    ['session with malformed markers', (s) => { s.sessions.s1.markers = 'oops'; }, /session s1/],
    ['journal entry without a summary', (s) => { s.journal = [{ seq: 1, at: 'x', type: 'user-action' }]; }, /journal/],
    ['journal entry with an unknown type', (s) => { s.journal = [{ seq: 1, at: 'x', type: 'mystery', summary: 's' }]; }, /journal/],
    ['workstream without sessionIds', (s) => { s.workstreams = { w: { id: 'w', title: 't', basis: 'session' } }; }, /workstream w/],
    ['manual link to a non-string', (s) => { s.manualLinks = { s1: 5 }; }, /manualLinks/],
    ['cursor with garbage numbers', (s) => { s.cursors = { '/t.jsonl': { offset: -1 } }; }, /cursor/],
    ['checkpoint beyond the journal', (s) => { s.checkpointSeq = s.nextSeq + 10; }, /checkpointSeq/],
  ];
  for (const [name, mutate, expected] of mutations) {
    const state = populated() as unknown as Record<string, any>;
    mutate(state);
    const result = validateState(state);
    assert.equal(result.ok, false, name);
    assert.match(result.ok ? '' : result.detail, expected, name);
  }
});

test('a snapshot with a malformed nested record is recovered from the backup, not loaded', async () => {
  const dir = await makeTempRoot('focus-center-validate-');
  cleanup.push(dir);
  const store = new JsonFileStore(path.join(dir, 'state.json'), () => new Date('2026-10-02T00:00:00Z'));
  const good = populated();
  await fs.writeFile(store.backupPath, JSON.stringify(good));
  const bad = populated() as unknown as Record<string, any>;
  bad.items = { a: { id: 'a', status: 'needs-you', evidence: [] } };
  await fs.writeFile(store.path, JSON.stringify(bad));
  const loaded = await store.load();
  assert.equal(loaded.source, 'backup');
  assert.match(loaded.recovery?.problem ?? '', /item a/);
  assert.deepEqual(loaded.state, good);
});

// ---- Finding 6: delete must not race an in-flight save ---------------------------------------
import { StateService } from '../../storage/stateService';
import type { StateStore } from '../../storage/jsonStore';

const tick = () => new Promise((r) => setTimeout(r, 10));

function gatedStore() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls: number[] = [];
  let finished = false;
  const store: StateStore = {
    load: async () => ({ state: emptyState(), source: 'empty' as const }),
    save: async (s) => {
      calls.push(s.checkpointSeq);
      await gate;
      finished = true;
    },
  };
  return { store, release, calls, finished: () => finished };
}

test('exclusive work waits for an in-flight save, drops concurrent changes, and nothing is written afterwards', async () => {
  const g = gatedStore();
  const service = await StateService.open(g.store, 10_000);
  service.update((s) => {
    s.nextSeq = 3;
    s.checkpointSeq = 2;
  });
  const flushing = service.flush(); // the save has serialized the old state and is now blocked
  await tick();

  let savedBeforeTask: boolean | undefined;
  const exclusive = service.exclusive(async () => {
    savedBeforeTask = g.finished();
    service.reset(emptyState());
  });
  service.update((s) => {
    s.checkpointSeq = 99; // arrives mid-deletion: dropped, not applied and not saved
  });
  g.release();
  await Promise.all([flushing, exclusive]);

  assert.equal(savedBeforeTask, true, 'the deletion started only after the in-flight save finished');
  assert.equal(service.state.checkpointSeq, 0);
  await service.flush();
  assert.deepEqual(g.calls, [2], 'no save of the pre-delete state happened after the deletion');

  // Normal operation resumes afterwards.
  service.update((s) => {
    s.nextSeq = 2;
    s.checkpointSeq = 1;
  });
  await service.flush();
  assert.deepEqual(g.calls, [2, 1]);
});

test('exclusive work is released even if it throws', async () => {
  const g = gatedStore();
  g.release();
  const service = await StateService.open(g.store, 10_000);
  await assert.rejects(service.exclusive(async () => { throw new Error('boom'); }), /boom/);
  service.update((s) => {
    s.nextSeq = 2;
    s.checkpointSeq = 1;
  });
  await service.flush();
  assert.deepEqual(g.calls, [1]);
});

// ---- Finding 10: one writer window ------------------------------------------------------------
import { WriterLock } from '../../storage/writerLock';

test('only one window holds the writer lock; a stale lock can be taken over; a lost lock is noticed', async () => {
  const dir = await makeTempRoot('focus-center-lock-');
  cleanup.push(dir);
  const file = path.join(dir, 'state.lock');
  let now = 1_000_000;
  const a = new WriterLock(file, 'window-a', { staleMs: 15_000, now: () => now });
  const b = new WriterLock(file, 'window-b', { staleMs: 15_000, now: () => now });

  assert.equal(await a.tryAcquire(), true);
  assert.equal(await b.tryAcquire(), false, 'second window is read-only');
  assert.deepEqual([a.held, b.held], [true, false]);
  assert.equal(await a.verify(), true);
  assert.equal(await b.verify(), false);

  now += 10_000;
  assert.equal(await a.heartbeat(), true, 'heartbeat keeps the lock fresh');
  now += 10_000; // 20 s since acquire, 10 s since the heartbeat: still fresh
  assert.equal(await b.tryAcquire(), false);

  now += 20_000; // owner stopped heartbeating (crashed or suspended)
  assert.equal(await b.tryAcquire(), true, 'stale lock is taken over');
  assert.equal(await a.verify(), false, 'the previous owner learns it lost the lock before writing');
  assert.equal(await a.heartbeat(), false, 'and does not clobber the new owner');
  assert.equal(a.held, false);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).owner, 'window-b');

  await a.release(); // not the owner: must not remove b's lock
  assert.equal(await b.verify(), true);
  await b.release();
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  assert.equal(await a.tryAcquire(), true);
});

test('a corrupt lock file counts as stale and a live owner reacquires its own lock', async () => {
  const dir = await makeTempRoot('focus-center-lock-');
  cleanup.push(dir);
  const file = path.join(dir, 'state.lock');
  await fs.writeFile(file, 'garbage');
  const a = new WriterLock(file, 'window-a');
  assert.equal(await a.tryAcquire(), true);
  assert.equal(await a.tryAcquire(), true, 'idempotent for the owner');
});

test('a read-only service never writes, even when asked to flush, and reports it', async () => {
  const g = gatedStore();
  g.release();
  let writer = false;
  const service = await StateService.open(g.store, 10_000, { canWrite: async () => writer, isWriter: () => writer });
  assert.equal(service.readOnly, true);
  service.update((s) => {
    s.nextSeq = 2;
    s.checkpointSeq = 1;
  });
  await service.flush();
  await service.flushScrubbed();
  assert.deepEqual(g.calls, [], 'nothing written while another window owns the data');
  assert.ok(service.skippedWrites >= 1);

  writer = true;
  assert.equal(service.readOnly, false);
  service.update((s) => {
    s.nextSeq = 3;
    s.checkpointSeq = 2;
  });
  await service.flush();
  assert.deepEqual(g.calls, [2]);
});
