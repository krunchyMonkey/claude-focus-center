// Regression tests for the Copilot review of PR #17 — privacy boundary findings.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { purgeSpool, SpoolConsumer } from '../../adapters/claudeHooks/spool';
import { TranscriptTailer } from '../../adapters/claudeSessions/tailer';
import { purgeOutOfScope } from '../../domain/privacy/purge';
import { applyEvents } from '../../domain/state/reducer';
import { emptyState } from '../../domain/state/types';
import { CLOSED_SCOPE, DEFAULT_SCOPE, inScope, MonitoringScope, parseScope } from '../../hook/scope';
import { toSpoolRecord } from '../../hook/spoolRecord';
import { JsonFileStore } from '../../storage/jsonStore';
import { StateService } from '../../storage/stateService';
import { makeTempRoot, tenSessions, writeSessions } from '../fixtures/sessions';

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

test('an unknown location is only collected when no exclusion or allow-list is configured', () => {
  assert.equal(inScope(undefined, DEFAULT_SCOPE, 'linux'), true);
  assert.equal(inScope(undefined, { excludedPaths: ['/w/secret'], includedPaths: [], paused: false }, 'linux'), false);
  assert.equal(inScope(undefined, { excludedPaths: [], includedPaths: ['/w/api'], paused: false }, 'linux'), false);
  assert.equal(inScope('', { excludedPaths: ['/w/secret'], includedPaths: [], paused: false }, 'linux'), false);
});

test('unreadable or malformed scope files mean "collect nothing", never "collect everything"', () => {
  for (const text of ['not json', '', '[]', 'null', '"x"', '{"excludedPaths":"x"}', '{"includedPaths":[1]}', '{"paused":"yes"}', '{"excludedPaths":["/a",3]}']) {
    assert.deepEqual(parseScope(text), CLOSED_SCOPE, JSON.stringify(text));
  }
  assert.equal(CLOSED_SCOPE.paused, true);
  assert.equal(inScope('/anywhere', CLOSED_SCOPE, 'linux'), false);
  assert.deepEqual(parseScope('{}'), DEFAULT_SCOPE, 'a valid empty object is the explicit default');
  assert.deepEqual(parseScope('{"paused":true,"excludedPaths":["/a"],"includedPaths":[]}'), { excludedPaths: ['/a'], includedPaths: [], paused: true });
});


async function temp(): Promise<string> {
  const r = await makeTempRoot('focus-center-review-');
  roots.push(r);
  return r;
}

let n = 0;
async function putRecord(dir: string, sessionId: string, cwd: string | undefined, excerpt = 'SECRET-EXCERPT'): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const raw = JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId, ...(cwd ? { cwd } : {}), last_assistant_message: excerpt, n: n++ });
  const record = toSpoolRecord(raw, undefined, new Date(), `nonce-${n}`)!;
  const name = `${Date.now()}-${record.id.slice(0, 16)}.json`;
  await fs.writeFile(path.join(dir, name), JSON.stringify(record));
  return name;
}

test('purgeSpool removes out-of-scope, unknown-location and purged-session records, and nothing else', async () => {
  const dir = path.join(await temp(), 'spool');
  const scope: MonitoringScope = { excludedPaths: ['/w/secret'], includedPaths: [], paused: false };
  const secret = await putRecord(dir, 'a', '/w/secret/app');
  const unknown = await putRecord(dir, 'b', undefined);
  const purgedSession = await putRecord(dir, 'gone', '/w/api');
  const keep = await putRecord(dir, 'c', '/w/api');
  await fs.writeFile(path.join(dir, 'notes.txt'), 'not ours');
  await fs.writeFile(path.join(dir, '1700000000000-0123456789abcdef.json'), '{broken');

  const result = await purgeSpool(dir, scope, new Set(['gone']), 'linux');
  assert.equal(result.removed, 3);
  assert.deepEqual((await fs.readdir(dir)).sort(), [keep, 'notes.txt', '1700000000000-0123456789abcdef.json'].sort());
  void secret; void unknown; void purgedSession;

  // Pausing stops collection but must not delete anything on its own.
  const paused = await purgeSpool(dir, { ...DEFAULT_SCOPE, paused: true }, new Set(), 'linux');
  assert.equal(paused.removed, 0);
  assert.deepEqual(await purgeSpool(path.join(dir, 'missing'), scope), { removed: 0 });
});

test('a scrubbed save leaves no trace of purged data in state.json or state.json.bak; a normal save keeps the backup', async () => {
  const dir = await temp();
  const store = new JsonFileStore(path.join(dir, 'state.json'));
  const state = emptyState();
  const now = new Date('2026-09-01T00:00:00Z');
  const ev = (sid: string, cwd: string, n2: number) => ({ schema: 1 as const, id: `hook:${sid}:${n2}`, source: 'hook' as const, sessionId: sid, sourceEventId: String(n2), kind: 'permission-request' as const, toolName: 'Bash', cwd, excerpt: `EXCERPT-${sid}`, timestamp: now.toISOString() });
  applyEvents(state, [ev('keep', '/w/api', 1), ev('secretsession', '/w/secret', 2)], now);
  await store.save(state);

  const service = await StateService.open(store, 10_000);
  service.update((st) => {
    purgeOutOfScope(st, { excludedPaths: ['/w/secret'], includedPaths: [], paused: false }, 'linux');
  });
  await service.flush();
  assert.match(await fs.readFile(store.backupPath, 'utf8'), /EXCERPT-secretsession/, 'a normal save keeps the pre-purge snapshot as the backup');

  await service.flushScrubbed();
  for (const file of [store.path, store.backupPath]) {
    const text = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(text, /secretsession|EXCERPT-secret|\/w\/secret/, file);
    assert.match(text, /EXCERPT-keep/, `${file} still holds in-scope data`);
  }
  assert.deepEqual((await fs.readdir(dir)).sort(), ['state.json', 'state.json.bak']);
  assert.equal((await store.load()).source, 'primary');
});

test('re-including a purged project rebuilds its items: dedupe ids and read positions are forgotten', async () => {
  const state = emptyState();
  const now = new Date('2026-09-01T00:00:00Z');
  const ev = { schema: 1 as const, id: 'hook:proj:1', source: 'hook' as const, sessionId: 'proj', sourceEventId: '1', kind: 'permission-request' as const, toolName: 'Bash', cwd: '/w/secret', timestamp: now.toISOString() };
  const keepEv = { ...ev, id: 'hook:other:1', sessionId: 'other', cwd: '/w/api' };
  applyEvents(state, [ev, keepEv], now);
  assert.equal(Object.keys(state.items).length, 2);

  const purged = purgeOutOfScope(state, { excludedPaths: ['/w/secret'], includedPaths: [], paused: false }, 'linux');
  assert.deepEqual(purged.sessionIds, ['proj']);
  assert.equal(state.processedEventIds.some((id) => id.includes(':proj:')), false);
  assert.equal(state.processedEventIds.includes('hook:other:1'), true, 'other sessions keep their dedupe ids');

  // The project is included again: the same event is applied again and the blocker is back.
  const again = applyEvents(state, [ev], now);
  assert.equal(again.applied.length, 1);
  assert.equal(Object.values(state.items).filter((i) => i.status === 'needs-you').length, 2);
});

test('the transcript tailer and spool consumer re-emit a purged session after it is forgotten', async () => {
  const root = await temp();
  const sessions = tenSessions().slice(0, 2);
  const paths = await writeSessions(root, sessions);
  const targets = sessions.map((s, i) => ({ sessionId: s.sessionId, transcriptPath: paths[i] }));
  const tailer = new TranscriptTailer();
  assert.equal((await tailer.poll(targets)).events.length, 4);
  assert.equal((await tailer.poll(targets)).events.length, 0);
  tailer.forget(new Set([sessions[0].sessionId]), [paths[0]]);
  const after = await tailer.poll(targets);
  assert.deepEqual([...new Set(after.events.map((e) => e.sessionId))], [sessions[0].sessionId], 'only the forgotten session is read again');
  assert.equal(after.events.length, 2);

  const spoolDir = path.join(root, 'spool');
  await putRecord(spoolDir, 'proj', '/w/api');
  const consumer = new SpoolConsumer(spoolDir);
  assert.equal((await consumer.scan()).events.length, 1);
  assert.equal((await consumer.scan()).events.length, 0);
  consumer.forgetSessions(new Set(['proj']));
  assert.equal((await consumer.scan()).events.length, 1, 'the surviving spool record is ingested afresh');
});
