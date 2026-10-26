import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { SpoolConsumer } from '../../adapters/claudeHooks/spool';
import { normalizeSpoolRecord } from '../../domain/events/hook';
import { SpoolRecord, toSpoolRecord } from '../../hook/spoolRecord';
import { makeTempRoot } from '../fixtures/sessions';

const roots: string[] = [];
async function spoolDir(): Promise<string> {
  const r = await makeTempRoot('focus-center-spool-');
  roots.push(r);
  return r;
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

function record(event: string, extra: object = {}): SpoolRecord {
  return toSpoolRecord(JSON.stringify({ hook_event_name: event, session_id: 'sess-1', cwd: '/synthetic/repo', ...extra }), undefined, new Date('2026-01-01T00:00:00Z'))!;
}

let counter = 0;
async function put(dir: string, r: SpoolRecord | string, ms = Date.now()): Promise<string> {
  const name = `${ms}-${(counter++).toString(16).padStart(16, '0')}.json`;
  await fs.writeFile(path.join(dir, name), typeof r === 'string' ? r : JSON.stringify(r));
  return name;
}

test('normalizer maps hook events to kinds and keeps evidence fields', () => {
  const result = normalizeSpoolRecord(record('PermissionRequest', { tool_name: 'Bash', transcript_path: '/synthetic/t.jsonl' }));
  assert.ok(result.ok);
  assert.equal(result.event.kind, 'permission-request');
  assert.equal(result.event.source, 'hook');
  assert.equal(result.event.toolName, 'Bash');
  assert.equal(result.event.transcriptPath, '/synthetic/t.jsonl');
  assert.equal(result.event.timestamp, '2026-01-01T00:00:00.000Z');
  assert.match(result.event.id, /^hook:sess-1:[0-9a-f]{64}$/);
  const failure = normalizeSpoolRecord(record('PostToolUseFailure', { tool_name: 'Bash', error: 'Exit code 2', is_interrupt: true }));
  assert.ok(failure.ok);
  assert.deepEqual([failure.event.kind, failure.event.isError, failure.event.reason], ['tool-failure', true, 'interrupt']);
});

test('normalizer rejects tampered or unknown records', () => {
  assert.deepEqual(normalizeSpoolRecord(null), { ok: false, reason: 'invalid' });
  assert.deepEqual(normalizeSpoolRecord({ ...record('Stop'), v: 2 }), { ok: false, reason: 'invalid' });
  assert.deepEqual(normalizeSpoolRecord({ ...record('Stop'), id: 'short' }), { ok: false, reason: 'invalid' });
  assert.deepEqual(normalizeSpoolRecord({ ...record('Stop'), sessionId: '../x' }), { ok: false, reason: 'invalid' });
  assert.deepEqual(normalizeSpoolRecord({ ...record('Stop'), event: 'PreToolUse' }), { ok: false, reason: 'unknown-event' });
  const r = normalizeSpoolRecord({ ...record('Stop'), excerpt: 'token=SYNTHETICSECRET1 ' + 'y'.repeat(1000) });
  assert.ok(r.ok);
  assert.ok((r.event.excerpt ?? '').length <= 400);
});

test('consumer emits each event once across rescans, duplicate files and restarts', async () => {
  const dir = await spoolDir();
  const perm = record('PermissionRequest', { tool_name: 'Bash' });
  await put(dir, perm);
  await put(dir, perm); // same payload delivered twice (e.g. registered twice)
  await put(dir, record('Stop'));
  const consumer = new SpoolConsumer(dir);
  const first = await consumer.scan();
  assert.deepEqual(first.events.map((e) => e.kind), ['permission-request', 'stop']);
  assert.equal(first.stats.duplicatesDropped, 1);
  assert.deepEqual((await consumer.scan()).events, []);
  await put(dir, record('Notification', { notification_type: 'idle_prompt' }));
  const later = await consumer.scan();
  assert.deepEqual(later.events.map((e) => e.kind), ['notification']);
  // A restarted consumer replays the same files and yields the same ids.
  const replay = await new SpoolConsumer(dir).scan();
  assert.deepEqual(replay.events.map((e) => e.id), [...first.events, ...later.events].map((e) => e.id));
});

test('invalid files are counted once and never retried', async () => {
  const dir = await spoolDir();
  await put(dir, '{not json');
  await put(dir, JSON.stringify({ ...record('Stop'), event: 'Unknown' }));
  await put(dir, 'x'.repeat(20 * 1024));
  await fs.writeFile(path.join(dir, 'unrelated.txt'), 'ignored');
  const consumer = new SpoolConsumer(dir);
  const first = await consumer.scan();
  assert.deepEqual([first.stats.invalid, first.stats.unknownEvents, first.stats.filesRead], [2, 1, 3]);
  const second = await consumer.scan();
  assert.equal(second.stats.filesRead, 0);
});

test('temp files are ignored, stale ones and expired records are pruned', async () => {
  const dir = await spoolDir();
  const now = new Date('2026-02-01T00:00:00Z');
  const fresh = await put(dir, record('Stop'), now.getTime() - 1000);
  await put(dir, record('SessionEnd'), now.getTime() - 8 * 24 * 3600 * 1000);
  await fs.writeFile(path.join(dir, '.tmp-1-x.json'), '{');
  const old = new Date(now.getTime() - 3600 * 1000);
  await fs.utimes(path.join(dir, '.tmp-1-x.json'), old, old);
  await fs.writeFile(path.join(dir, '.tmp-2-y.json'), '{');
  await fs.utimes(path.join(dir, '.tmp-2-y.json'), now, now);
  const result = await new SpoolConsumer(dir, { now: () => now }).scan();
  assert.deepEqual(result.events.map((e) => e.kind), ['stop']);
  assert.equal(result.stats.pruned, 2);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['.tmp-2-y.json', fresh].sort());
});

test('missing spool directory is reported, not thrown', async () => {
  const result = await new SpoolConsumer(path.join(await spoolDir(), 'nope')).scan();
  assert.equal(result.stats.dirFound, false);
  assert.deepEqual(result.events, []);
});
