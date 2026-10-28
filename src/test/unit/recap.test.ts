import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { triage } from '../../domain/attention/triage';
import type { NormalizedEvent } from '../../domain/events/types';
import { buildRecap, markCaughtUp } from '../../domain/recap/recap';
import { applyEvents, MAX_JOURNAL } from '../../domain/state/reducer';
import { emptyState, FocusState } from '../../domain/state/types';
import { JsonFileStore } from '../../storage/jsonStore';
import { recapMarkdown } from '../../ui/recap';
import { SCENARIO_NOW, scenarios } from '../fixtures/scenarios';
import { makeTempRoot } from '../fixtures/sessions';

const now = SCENARIO_NOW;
const later = (min: number) => new Date(now.getTime() + min * 60_000);

function scenarioState(): { state: FocusState; events: NormalizedEvent[] } {
  const state = emptyState();
  const events = scenarios().flatMap((s) => s.events);
  applyEvents(state, events, now);
  return { state, events };
}

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

test('a fresh state has an empty recap', () => {
  const recap = buildRecap(emptyState(), now);
  assert.equal(recap.empty, true);
  assert.match(recapMarkdown(recap, emptyState(), now), /Nothing has changed since your last check\./);
});

test('first recap groups changes by current status, with new sessions', () => {
  const { state } = scenarioState();
  const recap = buildRecap(state, now);
  assert.equal(recap.needsYou.length, 7);
  assert.equal(recap.needsYou[0].title.startsWith('Permission needed'), true, 'P0 first');
  assert.ok(recap.resolved.length >= 3);
  assert.ok(recap.newSessions.length >= 15);
  assert.equal(recap.empty, false);
  const md = recapMarkdown(recap, state, now);
  assert.match(md, /## Needs you now \(7\)/);
  assert.match(md, /## Resolved since your last check/);
  assert.match(md, /## New sessions/);
});

test('after Mark Caught Up, no new events means no invented changes — even after a full replay', () => {
  const { state, events } = scenarioState();
  markCaughtUp(state, later(1));
  assert.equal(buildRecap(state, later(2)).empty, true);
  applyEvents(state, events, later(3)); // duplicate replay
  const recap = buildRecap(state, later(4));
  assert.equal(recap.empty, true);
  assert.equal(recap.yourActions, 1, 'the "caught up" action is counted, not listed');
  assert.match(recapMarkdown(recap, state, later(4)), /Nothing has changed since your last check\. \(1 of your own action/);
});

test('only changes after the checkpoint appear; your own triage actions are counted, not listed', () => {
  const { state } = scenarioState();
  markCaughtUp(state, later(1));
  const perm = Object.values(state.items).find((i) => i.kind === 'permission' && i.status === 'needs-you')!;
  triage(state, perm.id, 'acknowledge', later(2));
  applyEvents(state, [{ schema: 1, id: 'hook:s08:new', source: 'hook', sessionId: 's08', sourceEventId: 'new', kind: 'prompt-submitted', timestamp: later(3).toISOString() }], later(3));
  const recap = buildRecap(state, later(4));
  assert.deepEqual(recap.resolved.map((r) => r.title), ['Claude stopped: rate_limit']);
  assert.match(recap.resolved[0].changes[0].summary, /Answered: you replied/);
  assert.deepEqual([recap.needsYou.length, recap.other.length, recap.newSessions.length, recap.yourActions], [0, 0, 0, 2]);
});

test('changes that arrive while the recap is open stay for the next one', () => {
  const { state } = scenarioState();
  const shown = buildRecap(state, now);
  applyEvents(state, [{ schema: 1, id: 'hook:new:1', source: 'hook', sessionId: 'new', sourceEventId: '1', kind: 'permission-request', toolName: 'Bash', timestamp: later(1).toISOString() }], later(1));
  markCaughtUp(state, later(2), shown.toSeq);
  const next = buildRecap(state, later(3));
  assert.deepEqual(next.needsYou.map((r) => r.title), ['Permission needed: Bash']);
  assert.deepEqual(next.newSessions, ['new']);
});

test('the recap and checkpoint survive a restart', async () => {
  const dir = await makeTempRoot('focus-center-recap-');
  roots.push(dir);
  const { state } = scenarioState();
  const before = buildRecap(state, now);
  const store = new JsonFileStore(path.join(dir, 'state.json'));
  await store.save(state);
  const reloaded = (await store.load()).state;
  assert.deepEqual(buildRecap(reloaded, now), before);
  markCaughtUp(reloaded, later(1));
  await store.save(reloaded);
  const again = (await store.load()).state;
  assert.equal(again.checkpointAt, later(1).toISOString());
  assert.equal(buildRecap(again, later(2)).empty, true);
});

test('a trimmed journal is disclosed instead of silently missing changes', () => {
  const { state } = scenarioState();
  markCaughtUp(state, later(1));
  for (let i = 0; i < MAX_JOURNAL + 5; i++) {
    applyEvents(state, [{ schema: 1, id: `hook:bulk${i}:1`, source: 'hook', sessionId: `bulk${i}`, sourceEventId: '1', kind: 'stop', timestamp: later(2).toISOString() }], later(2));
  }
  const recap = buildRecap(state, later(3));
  assert.equal(recap.truncated, true);
  assert.match(recapMarkdown(recap, state, later(3)), /trimmed from the local journal/);
});
