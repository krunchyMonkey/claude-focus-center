import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { TranscriptTailer } from '../../adapters/claudeSessions/tailer';
import type { NormalizedEvent } from '../../domain/events/types';
import { applyEvents, MAX_JOURNAL, MAX_PROCESSED_IDS, journal, recordDiscoveredSession } from '../../domain/state/reducer';
import { emptyState, FocusState } from '../../domain/state/types';
import { JsonFileStore } from '../../storage/jsonStore';
import { StateService } from '../../storage/stateService';
import { validateState } from '../../storage/validate';
import { makeTempRoot, tenSessions, writeSessions } from '../fixtures/sessions';

const roots: string[] = [];
async function dir(): Promise<string> {
  const r = await makeTempRoot('focus-center-state-');
  roots.push(r);
  return r;
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

const now = new Date('2026-03-01T12:00:00.000Z');

function ev(n: number, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    schema: 1, id: `hook:s${n % 3}:${n}`, source: 'hook', sessionId: `s${n % 3}`, sourceEventId: String(n),
    kind: 'notification', timestamp: new Date(Date.UTC(2026, 2, 1, 0, n)).toISOString(), cwd: `/synthetic/repo${n % 3}`, ...extra,
  };
}

test('applyEvents is idempotent and deterministic', () => {
  const events = Array.from({ length: 9 }, (_, i) => ev(i));
  const a = emptyState();
  const first = applyEvents(a, events, now);
  assert.equal(first.applied.length, 9);
  const replay = applyEvents(a, [...events].reverse(), now);
  assert.deepEqual([replay.applied.length, replay.duplicates], [0, 9]);

  const b = emptyState();
  applyEvents(b, events, now);
  assert.deepEqual(b, a);
  assert.deepEqual(Object.keys(a.sessions), ['s0', 's1', 's2']);
  assert.equal(a.sessions.s2.lastEventAt, '2026-03-01T00:08:00.000Z');
  assert.equal(a.sessions.s2.cwd, '/synthetic/repo2');
});

test('duplicates inside one batch are applied once', () => {
  const s = emptyState();
  assert.deepEqual(applyEvents(s, [ev(1), ev(1), ev(2)], now).applied.map((e) => e.id), ['hook:s1:1', 'hook:s2:2']);
});

test('an out-of-order older event does not move lastEventAt backwards', () => {
  const s = emptyState();
  applyEvents(s, [ev(3)], now);
  applyEvents(s, [ev(0, { sessionId: 's0', id: 'x', timestamp: '2020-01-01T00:00:00.000Z' })], now);
  assert.equal(s.sessions.s0.lastEventAt, '2026-03-01T00:03:00.000Z');
});

test('processed ids and journal stay bounded', () => {
  const s = emptyState();
  s.processedEventIds = Array.from({ length: MAX_PROCESSED_IDS }, (_, i) => `old-${i}`);
  applyEvents(s, [ev(1)], now);
  assert.equal(s.processedEventIds.length, MAX_PROCESSED_IDS);
  assert.equal(s.processedEventIds.at(-1), 'hook:s1:1');
  for (let i = 0; i < MAX_JOURNAL + 10; i++) {
    journal(s, now, { type: 'user-action', summary: 'x' });
  }
  assert.equal(s.journal.length, MAX_JOURNAL);
  assert.equal(s.journal.at(-1)?.seq, s.nextSeq - 1);
});

test('store round-trips state and survives a simulated restart', async () => {
  const d = await dir();
  const store = new JsonFileStore(path.join(d, 'state.json'));
  const s = emptyState();
  applyEvents(s, [ev(1), ev(2)], now);
  recordDiscoveredSession(s, { sessionId: 's9', transcriptPath: '/synthetic/t.jsonl', lastActivityAt: now.toISOString() }, now);
  s.checkpointSeq = 2;
  await store.save(s);
  const loaded = await new JsonFileStore(path.join(d, 'state.json')).load();
  assert.equal(loaded.source, 'primary');
  assert.deepEqual(loaded.state, s);
  // Replaying the same events after "restart" changes nothing.
  assert.equal(applyEvents(loaded.state, [ev(1), ev(2)], now).applied.length, 0);
});

test('entrypoint is recorded by discovery, survives later events, and passes state validation', () => {
  const s = emptyState();
  recordDiscoveredSession(s, { sessionId: 's1', transcriptPath: '/synthetic/t.jsonl', entrypoint: 'cli', lastActivityAt: now.toISOString() }, now);
  applyEvents(s, [ev(1, { sessionId: 's1', id: 'hook:s1:1' })], now);
  assert.equal(s.sessions.s1.entrypoint, 'cli');
  // A later discovery pass that did not see the header keeps what we knew.
  recordDiscoveredSession(s, { sessionId: 's1', transcriptPath: '/synthetic/t.jsonl', lastActivityAt: now.toISOString() }, now);
  assert.equal(s.sessions.s1.entrypoint, 'cli');
  assert.equal(validateState(JSON.parse(JSON.stringify(s))).ok, true);
});

test('a second save keeps the previous good copy as .bak and leaves no temp files', async () => {
  const d = await dir();
  const store = new JsonFileStore(path.join(d, 'state.json'));
  const s1 = emptyState();
  await store.save(s1);
  const s2 = emptyState();
  s2.nextSeq = 6;
  s2.checkpointSeq = 5;
  await store.save(s2);
  assert.deepEqual((await fs.readdir(d)).sort(), ['state.json', 'state.json.bak']);
  assert.equal(JSON.parse(await fs.readFile(store.backupPath, 'utf8')).checkpointSeq, 0);
});

test('corrupted state is moved aside and the backup is used', async () => {
  const d = await dir();
  const file = path.join(d, 'state.json');
  const good = emptyState();
  good.nextSeq = 8;
  good.checkpointSeq = 7;
  await fs.writeFile(`${file}.bak`, JSON.stringify(good));
  await fs.writeFile(file, '{"schemaVersion":1,"sessions":{'); // partial write
  const loaded = await new JsonFileStore(file, () => now).load();
  assert.equal(loaded.source, 'backup');
  assert.equal(loaded.state.checkpointSeq, 7);
  assert.match(loaded.recovery?.problem ?? '', /not valid JSON/);
  assert.equal(await fs.readFile(loaded.recovery!.movedTo!, 'utf8'), '{"schemaVersion":1,"sessions":{');
});

test('corrupted state without a usable backup starts empty and keeps both originals', async () => {
  const d = await dir();
  const file = path.join(d, 'state.json');
  await fs.writeFile(file, '[]');
  await fs.writeFile(`${file}.bak`, 'garbage');
  const loaded = await new JsonFileStore(file, () => now).load();
  assert.equal(loaded.source, 'empty');
  assert.deepEqual(loaded.state, emptyState());
  assert.match(loaded.recovery?.problem ?? '', /JSON object.*backup: not valid JSON/);
  const names = await fs.readdir(d);
  assert.equal(names.length, 2);
  assert.ok(names.every((n) => /\.(invalid|corrupt)-/.test(n)), names.join(','));
});

test('missing primary with a backup (crash between renames) restores the backup', async () => {
  const d = await dir();
  const file = path.join(d, 'state.json');
  await fs.writeFile(`${file}.bak`, JSON.stringify(emptyState()));
  const loaded = await new JsonFileStore(file).load();
  assert.equal(loaded.source, 'backup');
});

test('fresh install loads an empty state without recovery noise', async () => {
  const loaded = await new JsonFileStore(path.join(await dir(), 'state.json')).load();
  assert.deepEqual([loaded.source, loaded.recovery], ['empty', undefined]);
});

test('a newer schema version is never overwritten in place', async () => {
  const d = await dir();
  const file = path.join(d, 'state.json');
  await fs.writeFile(file, JSON.stringify({ ...emptyState(), schemaVersion: 99 }));
  const loaded = await new JsonFileStore(file, () => now).load();
  assert.equal(loaded.source, 'empty');
  assert.match(loaded.recovery?.movedTo ?? '', /\.newer-/);
});

test('validator rejects malformed shapes', () => {
  const bad: Array<[unknown, RegExp]> = [
    [null, /JSON object/],
    [{ ...emptyState(), schemaVersion: 0 }, /unsupported/],
    [{ ...emptyState(), sessions: [] }, /sessions is not an object/],
    [{ ...emptyState(), nextSeq: -1 }, /nextSeq/],
    [{ ...emptyState(), processedEventIds: [1] }, /non-strings/],
    [{ ...emptyState(), items: { a: { id: 'b', evidence: [], status: 'x' } } }, /item a is malformed/],
    [{ ...emptyState(), sessions: { a: { sessionId: 'b' } } }, /session a is malformed/],
  ];
  for (const [value, expected] of bad) {
    const r = validateState(value);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.detail, expected);
  }
  assert.equal(validateState(emptyState()).ok, true);
});

test('StateService debounces saves and flush persists immediately', async () => {
  const d = await dir();
  const store = new JsonFileStore(path.join(d, 'state.json'));
  const service = await StateService.open(store, 10_000);
  service.update((s: FocusState) => {
    s.nextSeq = 4;
    s.checkpointSeq = 3;
  });
  await assert.rejects(fs.readFile(store.path), { code: 'ENOENT' }, 'not written before the debounce');
  await service.flush();
  assert.equal((await store.load()).state.checkpointSeq, 3);
  assert.ok(service.lastSavedAt);
});

test('StateService reports save failures and retries on the next flush', async () => {
  let fail = true;
  const saved: FocusState[] = [];
  const store = {
    load: async () => ({ state: emptyState(), source: 'empty' as const }),
    save: async (s: FocusState) => {
      if (fail) {
        throw new Error('disk full');
      }
      saved.push(s);
    },
  };
  const service = await StateService.open(store, 10_000);
  service.update(() => undefined);
  await service.flush();
  assert.equal(service.lastSaveError, 'disk full');
  fail = false;
  await service.flush();
  assert.equal(service.lastSaveError, undefined);
  assert.equal(saved.length, 1);
});

test('persisted transcript cursors mean a restarted tailer reads nothing new', async () => {
  const d = await dir();
  const sessions = tenSessions().slice(0, 3);
  const paths = await writeSessions(d, sessions);
  const targets = sessions.map((s, i) => ({ sessionId: s.sessionId, transcriptPath: paths[i] }));
  const first = new TranscriptTailer();
  assert.equal((await first.poll(targets)).events.length, 6);
  const cursors = JSON.parse(JSON.stringify(first.exportCursors()));
  const restarted = new TranscriptTailer({}, cursors);
  const result = await restarted.poll(targets);
  assert.deepEqual([result.events.length, result.stats.bytesRead, result.stats.filesUnchanged], [0, 0, 3]);
  // Garbage cursors are ignored rather than trusted.
  const fromGarbage = new TranscriptTailer({}, { [paths[0]]: { offset: -1 } as never });
  assert.equal((await fromGarbage.poll(targets.slice(0, 1))).events.length, 2);
});
