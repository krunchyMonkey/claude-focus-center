import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { test } from 'node:test';

const script = path.resolve(__dirname, '../../hook/claude-focus-center-hook.js');

test('hook script exits 0 quickly and prints nothing', () => {
  const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 'synthetic', last_assistant_message: 'x' });
  const started = Date.now();
  const r = spawnSync(process.execPath, [script, 'Stop'], { input, encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(Date.now() - started < 3000);
});
