import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { toSpoolRecord } from '../../hook/spoolRecord';

const now = new Date('2026-01-01T00:00:00.000Z');
const common = { session_id: 'sess-1', transcript_path: '/synthetic/t.jsonl', cwd: '/synthetic/repo', permission_mode: 'default' };
const rec = (payload: object, arg?: string) => toSpoolRecord(JSON.stringify(payload), arg, now);

test('PermissionRequest keeps the tool name but never the tool input', () => {
  const raw = JSON.stringify({ ...common, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'SYNTHETIC-SECRET-ARG' }, permission_suggestions: [{ rules: ['SYNTHETIC-RULE'] }] });
  const r = toSpoolRecord(raw, 'PermissionRequest', now);
  assert.deepEqual(r, {
    v: 1, id: createHash('sha256').update(raw).digest('hex'), event: 'PermissionRequest', sessionId: 'sess-1',
    receivedAt: '2026-01-01T00:00:00.000Z', cwd: '/synthetic/repo', transcriptPath: '/synthetic/t.jsonl', toolName: 'Bash',
  });
  assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC-SECRET-ARG|SYNTHETIC-RULE/);
});

test('UserPromptSubmit never keeps the prompt', () => {
  const r = rec({ ...common, hook_event_name: 'UserPromptSubmit', prompt: 'SYNTHETIC-PROMPT' });
  assert.equal(r?.event, 'UserPromptSubmit');
  assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC-PROMPT/);
});

test('Notification, failure, task, stop and lifecycle fields are kept minimal and redacted', () => {
  assert.deepEqual(
    (({ notificationType, excerpt }) => ({ notificationType, excerpt }))(rec({ ...common, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })!),
    { notificationType: 'permission_prompt', excerpt: 'Claude needs your permission to use Bash' },
  );
  const failure = rec({ ...common, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' }, error: 'Exit code 1\nSYNTHETIC-OUTPUT token=abcd1234efgh', is_interrupt: false });
  assert.equal(failure?.excerpt, 'Exit code 1');
  assert.equal(failure?.isInterrupt, undefined);
  const task = rec({ ...common, hook_event_name: 'TaskCompleted', task_id: 'task-7', task_subject: 'Ship it password=hunter2hunter2', task_description: 'SYNTHETIC-DESCRIPTION' });
  assert.equal(task?.taskId, 'task-7');
  assert.equal(task?.excerpt, 'Ship it password=[redacted]');
  assert.doesNotMatch(JSON.stringify(task), /SYNTHETIC-DESCRIPTION/);
  const stop = rec({ ...common, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: `${'x '.repeat(400)}Should I merge it?` });
  assert.match(stop?.excerpt ?? '', /^….*Should I merge it\?$/);
  assert.ok((stop?.excerpt ?? '').length <= 400);
  assert.equal(rec({ ...common, hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'API Error' })?.reason, 'rate_limit');
  assert.equal(rec({ ...common, hook_event_name: 'SessionStart', source: 'resume' })?.reason, 'resume');
  assert.equal(rec({ ...common, hook_event_name: 'SessionEnd', reason: 'logout' })?.reason, 'logout');
});

test('event name falls back to the argument; unusable payloads are dropped', () => {
  assert.equal(rec({ ...common }, 'Stop')?.event, 'Stop');
  assert.equal(toSpoolRecord('not json', 'Stop', now), undefined);
  assert.equal(toSpoolRecord('[1]', 'Stop', now), undefined);
  assert.equal(rec({ hook_event_name: 'Stop' }), undefined, 'missing session id');
  assert.equal(rec({ ...common, session_id: '../../etc' }, 'Stop'), undefined, 'unsafe session id');
  assert.equal(rec({ ...common, hook_event_name: 'Stop; rm -rf /' }), undefined, 'unsafe event name');
});

test('identical payloads get identical ids; different payloads differ', () => {
  const a = rec({ ...common, hook_event_name: 'Stop', last_assistant_message: 'a' });
  const b = rec({ ...common, hook_event_name: 'Stop', last_assistant_message: 'a' });
  const c = rec({ ...common, hook_event_name: 'Stop', last_assistant_message: 'b' });
  assert.equal(a?.id, b?.id);
  assert.notEqual(a?.id, c?.id);
});

test('over-long or unsafe fields are dropped, not truncated into something misleading', () => {
  const r = rec({ ...common, cwd: '/x'.repeat(600), hook_event_name: 'Notification', notification_type: 'bad type!' });
  assert.equal(r?.cwd, undefined);
  assert.equal(r?.notificationType, undefined);
});
