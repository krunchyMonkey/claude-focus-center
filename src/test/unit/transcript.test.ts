import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTranscriptLine } from '../../domain/events/transcript';

const SID = '00000000-0000-4000-8000-000000000001';
const norm = (record: unknown) => normalizeTranscriptLine(SID, JSON.stringify(record));

test('user prompt yields an event with no prompt text', () => {
  const { events } = norm({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z', cwd: '/synthetic/a', gitBranch: 'main', message: { role: 'user', content: 'SYNTHETIC-PROMPT-TEXT' } });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    schema: 1, source: 'transcript', sessionId: SID, sourceEventId: 'u1', id: `transcript:${SID}:u1`,
    kind: 'user-prompt', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/synthetic/a', gitBranch: 'main', messageUuid: 'u1',
  });
  assert.doesNotMatch(JSON.stringify(events), /SYNTHETIC-PROMPT-TEXT/);
});

test('assistant text and tool calls become separate events; tool arguments are dropped', () => {
  const { events } = norm({
    type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'SYNTHETIC-THOUGHT' },
      { type: 'text', text: 'I updated the parser.\n\nShould I also migrate the old config?' },
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo SYNTHETIC-ARG' } },
    ] },
  });
  assert.deepEqual(events.map((e) => [e.kind, e.sourceEventId]), [['assistant-text', 'a1#text'], ['tool-use', 'a1#tool:toolu_1']]);
  assert.equal(events[0].excerpt, 'I updated the parser. Should I also migrate the old config?');
  assert.equal(events[1].toolName, 'Bash');
  assert.doesNotMatch(JSON.stringify(events), /SYNTHETIC-ARG|SYNTHETIC-THOUGHT/);
});

test('long assistant text keeps the redacted end of the message', () => {
  const text = `${'filler '.repeat(200)} token=SYNTHETICSECRET123 Please review the diff?`;
  const [e] = norm({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text }] } }).events;
  assert.ok((e.excerpt ?? '').length <= 400);
  assert.match(e.excerpt ?? '', /^….*Please review the diff\?$/);
  assert.doesNotMatch(e.excerpt ?? '', /SYNTHETICSECRET123/);
});

test('tool results record errors with a short excerpt and successes without output', () => {
  const { events } = norm({ type: 'user', uuid: 'u2', message: { content: [
    { type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'Exit code 1\nnpm ERR! SYNTHETIC failure' },
    { type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'SYNTHETIC-OUTPUT' }] },
  ] } });
  assert.deepEqual(events.map((e) => [e.sourceEventId, e.isError, e.excerpt]), [
    ['u2#result:toolu_1', true, 'Exit code 1 npm ERR! SYNTHETIC failure'],
    ['u2#result:toolu_2', false, undefined],
  ]);
  assert.doesNotMatch(JSON.stringify(events), /SYNTHETIC-OUTPUT/);
});

test('system errors are flagged; summaries and unknown types yield nothing', () => {
  assert.equal(norm({ type: 'system', uuid: 's1', level: 'error', content: 'x' }).events[0].isError, true);
  assert.deepEqual(norm({ type: 'summary', summary: 'x', leafUuid: 'l' }), { events: [], invalid: false });
  assert.deepEqual(norm({ type: 'some-future-type', uuid: 'f1' }), { events: [], invalid: false });
});

test('invalid input is reported, never thrown', () => {
  for (const line of ['not json', '{"broken":', '[1,2]', 'null', '"str"']) {
    assert.deepEqual(normalizeTranscriptLine(SID, line), { events: [], invalid: true }, line);
  }
  assert.deepEqual(normalizeTranscriptLine(SID, '   '), { events: [], invalid: false });
  assert.deepEqual(norm({ type: 'assistant', uuid: 'a', message: 'weird' }).events, []);
  assert.deepEqual(norm({ type: 'user', uuid: 'u', message: { content: [null, 3, { type: 'tool_result' }] } }).events.map((e) => e.sourceEventId), ['u#result:0']);
});

test('ids are stable: uuid when safe, otherwise a content hash', () => {
  const rec = { type: 'user', message: { content: 'hi' } };
  const a = norm(rec).events[0];
  const b = norm(rec).events[0];
  assert.match(a.sourceEventId, /^h:[0-9a-f]{32}$/);
  assert.equal(a.id, b.id);
  assert.match(norm({ ...rec, uuid: '../../etc/passwd' }).events[0].sourceEventId, /^h:/);
  assert.equal(norm({ ...rec, uuid: 'u1', isSidechain: true }).events[0].sidechain, true);
});

test('invalid timestamps are dropped rather than guessed', () => {
  assert.equal(norm({ type: 'user', uuid: 'u', timestamp: 'yesterday', message: { content: 'x' } }).events[0].timestamp, undefined);
});
