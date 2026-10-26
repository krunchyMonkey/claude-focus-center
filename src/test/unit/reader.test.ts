import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { readAppended, ReadCursor } from '../../adapters/claudeSessions/reader';
import { makeTempRoot } from '../fixtures/sessions';

const roots: string[] = [];
async function file(content: string): Promise<string> {
  const r = await makeTempRoot('focus-center-reader-');
  roots.push(r);
  const p = path.join(r, 's.jsonl');
  await fs.writeFile(p, content);
  return p;
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

const texts = (r: { lines: Array<{ text: string }> }) => r.lines.map((l) => l.text);

/** Make the next write observable even on file systems with coarse mtime resolution. */
async function bumpMtime(p: string, cursor: ReadCursor): Promise<void> {
  const t = new Date(cursor.mtimeMs + 5000);
  await fs.utimes(p, t, t);
}

test('reads complete lines, then skips an unchanged file without reading', async () => {
  const p = await file('a\nb\nc\n');
  const first = await readAppended(p, undefined);
  assert.deepEqual(texts(first), ['a', 'b', 'c']);
  assert.equal(first.cursor.offset, 6);
  const second = await readAppended(p, first.cursor);
  assert.equal(second.unchanged, true);
  assert.equal(second.bytesRead, 0);
  assert.deepEqual(second.lines, []);
});

test('a partial final line is held back until it is completed', async () => {
  const p = await file('a\n{"partial":');
  const first = await readAppended(p, undefined);
  assert.deepEqual(texts(first), ['a']);
  assert.equal(first.cursor.offset, 2);
  await fs.appendFile(p, 'true}\nnext\n');
  await bumpMtime(p, first.cursor);
  const second = await readAppended(p, first.cursor);
  assert.deepEqual(texts(second), ['{"partial":true}', 'next']);
  assert.equal(second.reset, false);
});

test('only appended lines are returned', async () => {
  const p = await file('a\n');
  const first = await readAppended(p, undefined);
  await fs.appendFile(p, 'b\nc\n');
  await bumpMtime(p, first.cursor);
  const second = await readAppended(p, first.cursor);
  assert.deepEqual(texts(second), ['b', 'c']);
  assert.equal(second.bytesRead, 4);
});

test('truncation restarts from the beginning', async () => {
  const p = await file('aaaa\nbbbb\n');
  const first = await readAppended(p, undefined);
  await fs.writeFile(p, 'x\n');
  await bumpMtime(p, first.cursor);
  const second = await readAppended(p, first.cursor);
  assert.equal(second.reset, true);
  assert.deepEqual(texts(second), ['x']);
});

test('an in-place rewrite of the same length is detected by fingerprint', async () => {
  const p = await file('aaaa\nbbbb\n');
  const first = await readAppended(p, undefined);
  await fs.writeFile(p, 'cccc\ndddd\neeee\n');
  await bumpMtime(p, first.cursor);
  const second = await readAppended(p, first.cursor);
  assert.equal(second.reset, true);
  assert.deepEqual(texts(second), ['cccc', 'dddd', 'eeee']);
});

test('a line longer than the read budget is skipped without stalling', async () => {
  const p = await file(`short\n${'x'.repeat(200)}\nafter\n`);
  const seen: string[] = [];
  let cursor: ReadCursor | undefined;
  let oversized = 0;
  for (let i = 0; i < 20; i++) {
    const r = await readAppended(p, cursor, { maxBytes: 64 });
    seen.push(...texts(r));
    oversized += r.oversizedLines;
    cursor = r.cursor;
    if (!r.more) {
      break;
    }
  }
  assert.deepEqual(seen, ['short', 'after']);
  assert.equal(oversized, 1);
});

test('cold start of a large file reads only the tail and drops the cut line', async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line-${String(i).padStart(3, '0')}`);
  const p = await file(lines.join('\n') + '\n');
  const r = await readAppended(p, undefined, { initialTailBytes: 50 });
  // 50 bytes = 5 lines of 9 bytes + 5 bytes of a cut line, which is dropped.
  assert.deepEqual(texts(r), lines.slice(-5));
});

test('CRLF line endings are stripped and an empty file yields nothing', async () => {
  const p = await file('a\r\nb\r\n');
  assert.deepEqual(texts(await readAppended(p, undefined)), ['a', 'b']);
  const empty = await file('');
  const r = await readAppended(empty, undefined);
  assert.deepEqual(r.lines, []);
  assert.equal(r.cursor.offset, 0);
});

test('a touched but unchanged file is checked but yields no lines', async () => {
  const p = await file('a\n');
  const first = await readAppended(p, undefined);
  await bumpMtime(p, first.cursor);
  const second = await readAppended(p, first.cursor);
  assert.equal(second.unchanged, false);
  assert.equal(second.reset, false);
  assert.deepEqual(second.lines, []);
});

test('a missing file rejects so the caller can report it', async () => {
  await assert.rejects(readAppended(path.join(await makeTempRoot(), 'gone.jsonl'), undefined), { code: 'ENOENT' });
});

test('a read stopped by the byte budget resumes even though the file did not change', async () => {
  const p = await file('aaaa\nbbbb\ncccc\n');
  const first = await readAppended(p, undefined, { maxBytes: 6 });
  assert.deepEqual(texts(first), ['aaaa']);
  assert.equal(first.more, true);
  const second = await readAppended(p, first.cursor, { maxBytes: 6 });
  assert.equal(second.unchanged, false);
  assert.deepEqual(texts(second), ['bbbb']);
});

test('a partial line at EOF is not re-read while the file is unchanged', async () => {
  const p = await file('a\n{"cut":');
  const first = await readAppended(p, undefined);
  const second = await readAppended(p, first.cursor);
  assert.equal(second.unchanged, true);
  assert.equal(second.bytesRead, 0);
});
