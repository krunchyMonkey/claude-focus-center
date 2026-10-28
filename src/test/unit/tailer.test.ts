import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { TranscriptTailer } from '../../adapters/claudeSessions/tailer';
import { defaultLines, makeTempRoot, tenSessions, writeSessions } from '../fixtures/sessions';

const roots: string[] = [];
async function setup(count = 10) {
  const r = await makeTempRoot('focus-center-tailer-');
  roots.push(r);
  const sessions = tenSessions().slice(0, count);
  const paths = await writeSessions(r, sessions);
  return { sessions, targets: sessions.map((s, i) => ({ sessionId: s.sessionId, transcriptPath: paths[i] })) };
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

async function touchLater(p: string): Promise<void> {
  const t = new Date((await fs.stat(p)).mtimeMs + 5000);
  await fs.utimes(p, t, t);
}

test('second poll of unchanged transcripts reads nothing and emits nothing', async () => {
  const { targets } = await setup();
  const tailer = new TranscriptTailer();
  const first = await tailer.poll(targets);
  // Each fixture has a summary (no event), a user prompt and an assistant reply.
  assert.equal(first.events.length, 20);
  assert.equal(first.stats.filesRead, 10);
  const second = await tailer.poll(targets);
  assert.deepEqual(second.events, []);
  assert.equal(second.stats.filesUnchanged, 10);
  assert.equal(second.stats.bytesRead, 0);
});

test('a restarted tailer produces identical event ids (deterministic replay)', async () => {
  const { targets } = await setup(3);
  const a = await new TranscriptTailer().poll(targets);
  const b = await new TranscriptTailer().poll(targets);
  assert.deepEqual(b.events.map((e) => e.id), a.events.map((e) => e.id));
});

test('appends emit only new events; a rewrite with the same content emits none', async () => {
  const { sessions, targets } = await setup(1);
  const [t] = targets;
  const tailer = new TranscriptTailer();
  await tailer.poll(targets);

  await fs.appendFile(t.transcriptPath, JSON.stringify({ type: 'assistant', uuid: 'new-1', message: { content: [{ type: 'text', text: 'Done?' }] } }) + '\n');
  await touchLater(t.transcriptPath);
  const appended = await tailer.poll(targets);
  assert.deepEqual(appended.events.map((e) => e.sourceEventId), ['new-1#text']);

  // Rewrite in a different order (e.g. a tool rewriting the file): everything is re-read, nothing re-emitted.
  await fs.writeFile(t.transcriptPath, [JSON.stringify({ type: 'assistant', uuid: 'new-1', message: { content: [{ type: 'text', text: 'Done?' }] } }), ...defaultLines(sessions[0])].join('\n') + '\nPAD\n');
  await touchLater(t.transcriptPath);
  const rewritten = await tailer.poll(targets);
  assert.equal(rewritten.stats.resets, 1);
  assert.deepEqual(rewritten.events, []);
  assert.equal(rewritten.stats.duplicatesDropped, 3);
  assert.equal(rewritten.stats.invalidLines, 1);
});

test('duplicate uuids in one file emit once; corrupt and partial lines do not crash', async () => {
  const r = await makeTempRoot('focus-center-tailer-');
  roots.push(r);
  const p = path.join(r, 'x.jsonl');
  const rec = JSON.stringify({ type: 'user', uuid: 'dup', message: { content: 'x' } });
  await fs.writeFile(p, `${rec}\n${rec}\nnot json\n{"cut":`);
  const result = await new TranscriptTailer().poll([{ sessionId: 's', transcriptPath: p }]);
  assert.equal(result.events.length, 1);
  assert.equal(result.stats.duplicatesDropped, 1);
  assert.equal(result.stats.invalidLines, 1);
});

test('missing files are reported per path and others still read', async () => {
  const { targets } = await setup(2);
  const result = await new TranscriptTailer().poll([{ sessionId: 'gone', transcriptPath: path.join(path.dirname(targets[0].transcriptPath), 'gone.jsonl') }, ...targets]);
  assert.deepEqual(result.stats.errors.map((e) => e.code), ['ENOENT']);
  assert.equal(result.stats.filesRead, 2);
  assert.equal(result.events.length, 4);
});

test('the per-poll byte budget defers remaining files to the next poll', async () => {
  const { targets } = await setup(4);
  const tailer = new TranscriptTailer({ maxBytesPerPoll: 1 });
  const first = await tailer.poll(targets);
  assert.equal(first.stats.filesRead, 1);
  assert.equal(first.stats.deferred, 3);
  let total = first.events.length;
  for (let i = 0; i < 3; i++) {
    total += (await tailer.poll(targets)).events.length;
  }
  assert.equal(total, 8);
});
