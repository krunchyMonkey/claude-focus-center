// Drives the compiled hook script the way Claude Code does: exec form, JSON on stdin.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { SpoolConsumer } from '../../adapters/claudeHooks/spool';
import { installHookForTest } from '../fixtures/hooks';
import { makeTempRoot } from '../fixtures/sessions';

const roots: string[] = [];
/** Installs a real hook copy with an open scope under <root>/storage; returns its spool folder. */
async function spoolDir(): Promise<string> {
  const r = await makeTempRoot('focus-center-hookrun-');
  roots.push(r);
  await installHookForTest(path.join(r, 'storage'));
  return path.join(r, 'storage', 'spool');
}
/** The installed copy that belongs to a spool folder from spoolDir(). */
function scriptFor(spool: string): string {
  return path.join(path.dirname(spool), 'hooks', 'claude-focus-center-hook.js');
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

function payload(event: string, extra: object = {}): string {
  return JSON.stringify({ hook_event_name: event, session_id: 'sess-1', cwd: '/synthetic/repo', transcript_path: '/synthetic/t.jsonl', ...extra });
}

function runHook(event: string, dir: string, input: string) {
  return spawnSync(process.execPath, [scriptFor(dir), event, dir], { input, encoding: 'utf8', timeout: 10_000 });
}

function runHookAsync(event: string, dir: string, input: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptFor(dir), event, dir], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('exit', resolve);
    child.stdin.end(input);
  });
}

test('writes one sanitized spool record, exits 0 quickly and prints nothing', async () => {
  const dir = await spoolDir();
  const started = Date.now();
  const r = runHook('PermissionRequest', dir, payload('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'SYNTHETIC-ARG' } }));
  const elapsed = Date.now() - started;
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.ok(elapsed < 3000, `took ${elapsed} ms`);
  const files = await fs.readdir(dir);
  assert.equal(files.length, 1);
  const content = await fs.readFile(path.join(dir, files[0]), 'utf8');
  assert.match(content, /"toolName":"Bash"/);
  assert.doesNotMatch(content, /SYNTHETIC-ARG/);
});

test('concurrent hooks each land intact; a repeat of the same payload is a separate event', async () => {
  const dir = await spoolDir();
  const inputs = Array.from({ length: 12 }, (_, i) => payload('Notification', { notification_type: 'permission_prompt', message: `Synthetic ${i}` }));
  const codes = await Promise.all(inputs.map((input) => runHookAsync('Notification', dir, input)));
  assert.deepEqual(codes, inputs.map(() => 0));
  const consumer = new SpoolConsumer(dir);
  const first = await consumer.scan();
  assert.equal(first.events.length, 12);
  assert.equal(first.stats.invalid, 0);
  assert.equal(new Set(first.events.map((e) => e.id)).size, 12);

  // The same payload again is a new occurrence (e.g. Claude asks for the same permission again).
  assert.equal(runHook('Notification', dir, inputs[0]).status, 0);
  const repeat = await consumer.scan();
  assert.equal(repeat.events.length, 1);
  assert.equal(repeat.stats.duplicatesDropped, 0);
  assert.equal((await consumer.scan()).events.length, 0, 'but each spool file is still processed only once');
});

test('bad input or unusable storage still exits 0 without output', async () => {
  const dir = await spoolDir();
  for (const input of ['', 'not json', '[]', JSON.stringify({ hook_event_name: 'Stop' })]) {
    const r = runHook('Stop', dir, input);
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '');
  }
  await assert.rejects(fs.readdir(dir), { code: 'ENOENT' }, 'nothing written for unusable payloads');

  // Spool path is a file, so the hook cannot write there.
  const blocked = path.join(path.dirname(dir), 'blocked');
  await fs.writeFile(blocked, '');
  const r = runHook('Stop', blocked, payload('Stop'));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('oversized input is ignored', async () => {
  const dir = await spoolDir();
  const r = runHook('Stop', dir, payload('Stop', { last_assistant_message: 'x'.repeat(2 * 1024 * 1024) }));
  assert.equal(r.status, 0);
  await assert.rejects(fs.readdir(dir), { code: 'ENOENT' });
});
