import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectAsk } from '../../domain/attention/text';
import { applyEvents } from '../../domain/state/reducer';
import { emptyState } from '../../domain/state/types';
import { SCENARIO_NOW, scenarios } from '../fixtures/scenarios';

const all = scenarios();

test('at least 12 curated scenarios exist', () => {
  assert.ok(all.length >= 12, `${all.length}`);
});

for (const scenario of all) {
  test(`scenario ${scenario.name}`, () => {
    const state = emptyState();
    applyEvents(state, scenario.events, SCENARIO_NOW);
    const actual = Object.values(state.items).map((i) => `${i.kind}/${i.status}`).sort();
    assert.deepEqual(actual, scenario.expect.map((e) => `${e.kind}/${e.status}`).sort());
    for (const item of Object.values(state.items)) {
      assert.ok(item.evidence.length > 0, 'every item has evidence');
      assert.ok(item.evidence.every((e) => e.sessionId && e.eventId && e.timestamp), 'evidence points at a source event');
    }
  });
}

test('Needs You precision >= 90% across the curated set (and recall reported)', () => {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const scenario of all) {
    const state = emptyState();
    applyEvents(state, scenario.events, SCENARIO_NOW);
    const actual = Object.values(state.items).filter((i) => i.status === 'needs-you').map((i) => i.kind).sort();
    const expected = scenario.expect.filter((e) => e.status === 'needs-you').map((e) => e.kind).sort();
    const remaining = [...expected];
    for (const kind of actual) {
      const idx = remaining.indexOf(kind);
      if (idx >= 0) {
        tp++;
        remaining.splice(idx, 1);
      } else {
        fp++;
      }
    }
    fn += remaining.length;
  }
  const precision = tp / (tp + fp);
  console.log(`  Needs You: precision ${(precision * 100).toFixed(1)}% (${tp}/${tp + fp}), recall ${((tp / (tp + fn)) * 100).toFixed(1)}% (${tp}/${tp + fn})`);
  assert.ok(precision >= 0.9);
});

test('scenario outcomes do not depend on event arrival order', () => {
  for (const scenario of all) {
    const forward = emptyState();
    applyEvents(forward, scenario.events, SCENARIO_NOW);
    const reversed = emptyState();
    applyEvents(reversed, [...scenario.events].reverse(), SCENARIO_NOW);
    const summary = (s: typeof forward) => Object.values(s.items).map((i) => `${i.kind}/${i.status}`).sort();
    // Rules compare source timestamps, so arrival order must not change the outcome,
    // except where "Claude continued" deletes a mid-turn ask (still the same final outcome).
    assert.deepEqual(summary(reversed), summary(forward), scenario.name);
  }
});

test('replaying every scenario event adds no items and changes nothing', () => {
  for (const scenario of all) {
    const state = emptyState();
    applyEvents(state, scenario.events, SCENARIO_NOW);
    const before = JSON.stringify(state);
    applyEvents(state, scenario.events, SCENARIO_NOW);
    assert.equal(JSON.stringify(state), before, scenario.name);
  }
});

test('Stop and SessionEnd never mark anything resolved', () => {
  for (const scenario of all) {
    const state = emptyState();
    applyEvents(state, scenario.events, SCENARIO_NOW);
    for (const item of Object.values(state.items)) {
      if (item.status === 'resolved' && item.kind !== 'task') {
        const resolvedBy = state.journal.filter((j) => j.itemId === item.id && /^Answered/.test(j.summary));
        assert.ok(resolvedBy.length > 0, `${scenario.name}: resolved without an answer signal`);
        assert.ok(resolvedBy.every((j) => !/hook:.*:/.test(j.eventId ?? '') || !scenario.events.find((e) => e.id === j.eventId && (e.kind === 'stop' || e.kind === 'session-end'))));
      }
    }
  }
});

test('manual resolution is kept until newer blocking evidence reopens the item', () => {
  const [perm] = scenarios();
  const state = emptyState();
  applyEvents(state, perm.events, SCENARIO_NOW);
  const item = Object.values(state.items)[0];
  item.manuallyResolvedAt = SCENARIO_NOW.toISOString();
  // A later duplicate-style notification for the *same* open prompt but older than the manual
  // resolution does not reopen it.
  applyEvents(state, [{ ...perm.events[1], id: 'hook:s01:older', sourceEventId: 'older', kind: 'notification', notificationType: 'permission_prompt', timestamp: '2026-05-04T11:59:00.000Z' }], SCENARIO_NOW);
  assert.ok(item.manuallyResolvedAt);
  applyEvents(state, [{ ...perm.events[1], id: 'hook:s01:newer', sourceEventId: 'newer', timestamp: '2026-05-04T12:05:00.000Z' }], SCENARIO_NOW);
  assert.equal(item.manuallyResolvedAt, undefined);
  assert.equal(item.status, 'needs-you');
});

test('detectAsk recognises explicit asks and ignores ordinary prose', () => {
  const asks: Array<[string, 'decision' | 'review']> = [
    ['Should I add tests for this too?', 'decision'],
    ['Would you like me to open a PR?', 'decision'],
    ['Which approach do you prefer?', 'decision'],
    ['Let me know whether to keep the flag.', 'decision'],
    ['I need your approval before deleting the table.', 'decision'],
    ['Please review the migration before I run it.', 'review'],
    ['The PR is ready for review.', 'review'],
  ];
  for (const [text, kind] of asks) {
    assert.equal(detectAsk(text)?.kind, kind, text);
  }
  const notAsks = [
    'Done. Tests pass.',
    'What does this function do? It parses the header and returns a map.',
    'I wonder why this fails? The stack trace points to the parser. Let me look.',
    'Why? Because the cache was stale. I cleared it and reran the build. Everything passes now.',
    '```\nShould I continue?\n```',
    '…tail of a code block\n```\nAll set.',
  ];
  for (const text of notAsks) {
    assert.equal(detectAsk(text), undefined, text);
  }
  assert.equal(detectAsk('…partial code\n```\nShould I keep going with the rest?')?.kind, 'decision');
});
