import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiscoveryResult } from '../../adapters/claudeSessions/discovery';
import { effectiveStatus } from '../../domain/attention/effective';
import { applyEvents } from '../../domain/state/reducer';
import { AttentionItem, emptyState, FocusState } from '../../domain/state/types';
import { regroup } from '../../domain/workstreams/group';
import { buildAttentionNodes, FocusNode, formatAge, needsYouCount } from '../../ui/nodes';
import { SCENARIO_NOW, scenarios } from '../fixtures/scenarios';

const now = SCENARIO_NOW;

function discovery(sessions: DiscoveryResult['sessions'] = []): DiscoveryResult {
  return { root: '/synthetic/root', rootFound: true, sessions, excludedCount: 0, issues: [] };
}

/** State built from every curated scenario: a realistic mix of statuses. */
function mixedState(): FocusState {
  const state = emptyState();
  for (const s of scenarios()) {
    applyEvents(state, s.events, now);
  }
  regroup(state, 'linux');
  return state;
}

function find(nodes: FocusNode[], pred: (n: FocusNode) => boolean): FocusNode | undefined {
  for (const n of nodes) {
    if (pred(n)) {
      return n;
    }
    const hit = n.children ? find(n.children, pred) : undefined;
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

test('nothing at all yields no nodes, so the welcome view shows', () => {
  assert.deepEqual(buildAttentionNodes(emptyState(), discovery(), now), []);
});

test('groups appear in priority order with counts; Resolved starts collapsed', () => {
  const state = mixedState();
  const roots = buildAttentionNodes(state, discovery(), now);
  assert.deepEqual(roots.map((r) => r.label), ['Needs You', 'Uncertain', 'Resolved']);
  const needs = roots[0];
  assert.equal(needs.description, String(needsYouCount(state, now)));
  assert.equal(needs.description, '7');
  assert.equal(roots.find((r) => r.label === 'Resolved')?.collapsed, true);
  assert.equal(needs.collapsed, undefined);
});

test('items sit under their workstream, permission (P0) first, with explainable tooltips', () => {
  const roots = buildAttentionNodes(mixedState(), discovery(), now);
  const needs = roots[0];
  const firstItem = needs.children?.[0].children?.[0];
  assert.equal(firstItem?.icon, 'shield', 'P0 permission sorts first');
  assert.match(firstItem?.label ?? '', /^Permission needed: /);
  assert.match(firstItem?.description ?? '', /^repo · \d+m ago · direct · \d evidence$/);
  assert.match(firstItem?.tooltip ?? '', /\*\*Why:\*\*\n- Hook event at 2026-05-04T/);
  assert.match(firstItem?.tooltip ?? '', /\*\*Next step:\*\* Approve or deny/);
  assert.match(firstItem?.tooltip ?? '', /\*\*Source session:\*\*\n- `s0\d`/);
  assert.equal(firstItem?.contextValue, 'item.needs-you');
  assert.match(firstItem?.ariaLabel ?? '', /^Needs you permission: Permission needed/);
  assert.ok(firstItem?.itemId && firstItem.sessionId);
});

test('an empty Needs You group says so explicitly', () => {
  const state = emptyState();
  applyEvents(state, scenarios().find((s) => s.name.startsWith('11'))!.events, now);
  const roots = buildAttentionNodes(state, discovery(), now);
  assert.deepEqual(roots.map((r) => `${r.label} ${r.description}`), ['Needs You 0', 'Resolved 1']);
  assert.equal(roots[0].children?.[0].label, 'Nothing needs you right now');
});

test('user overrides drive the displayed group without changing the rule status', () => {
  const state = mixedState();
  const perm = Object.values(state.items).find((i) => i.kind === 'permission' && i.status === 'needs-you')!;
  const decision = Object.values(state.items).find((i) => i.kind === 'decision' && i.status === 'needs-you')!;
  perm.snoozedUntil = new Date(now.getTime() + 3600_000).toISOString();
  decision.manuallyResolvedAt = now.toISOString();
  assert.equal(effectiveStatus(perm, now), 'waiting');
  assert.equal(effectiveStatus(perm, new Date(now.getTime() + 2 * 3600_000)), 'needs-you', 'snooze expires');
  assert.equal(effectiveStatus(decision, now), 'resolved');
  assert.equal(perm.status, 'needs-you');
  const roots = buildAttentionNodes(state, discovery(), now);
  assert.deepEqual(roots.map((r) => r.label), ['Needs You', 'Waiting', 'Uncertain', 'Resolved']);
  const waiting = find(roots, (n) => n.itemId === perm.id);
  assert.match(waiting?.description ?? '', /snoozed until 2026-05-04 13:00 UTC/);
  assert.match(find(roots, (n) => n.itemId === decision.id)?.description ?? '', /resolved by you/);
});

test('workstream nodes flag conflicts', () => {
  const state = emptyState();
  const item = (id: string, sessionId: string, kind: AttentionItem['kind'], status: AttentionItem['status']): AttentionItem => ({
    id, workstreamId: 'ref:jira:PROJ-1', kind, status, title: id, owner: 'you', priority: 1, sourceSessionIds: [sessionId], confidence: 'direct', updatedAt: now.toISOString(),
    evidence: [{ sessionId, eventId: `e-${id}`, kind: 'hook', timestamp: now.toISOString() }],
  });
  state.sessions.a = { source: 'claude-local', sessionId: 'a', cwd: '/w/api', gitBranch: 'PROJ-1-x', lastSeenAt: now.toISOString() };
  state.sessions.b = { source: 'claude-local', sessionId: 'b', cwd: '/w/web', gitBranch: 'PROJ-1-y', lastSeenAt: now.toISOString() };
  state.items.t = item('t', 'a', 'task', 'resolved');
  state.items.p = item('p', 'b', 'permission', 'needs-you');
  regroup(state, 'linux');
  const ws = buildAttentionNodes(state, discovery(), now)[0].children?.[0];
  assert.equal(ws?.icon, 'warning');
  assert.match(ws?.description ?? '', /conflict/);
  assert.match(ws?.tooltip ?? '', /reports its task complete/);
});

test('All sessions group lists discovered sessions, collapsed', () => {
  const roots = buildAttentionNodes(emptyState(), discovery([
    { source: 'claude-local', sessionId: 's1', transcriptPath: '/r/p/s1.jsonl', projectDirName: '-r-p', cwd: '/synthetic/repos/alpha/', gitBranch: 'main', lastActivityAt: '2026-05-04T11:55:00.000Z', sizeBytes: 1 },
  ]), now);
  assert.deepEqual(roots.map((r) => r.label), ['Needs You', 'All sessions']);
  const sessions = roots[1];
  assert.equal(sessions.collapsed, true);
  assert.deepEqual([sessions.children?.[0].label, sessions.children?.[0].description, sessions.children?.[0].contextValue], ['alpha', 'main · 5m ago', 'session']);
});

test('markdown in titles and excerpts is escaped in tooltips', () => {
  const state = emptyState();
  state.sessions.a = { source: 'claude-local', sessionId: 'a', lastSeenAt: now.toISOString() };
  state.items.x = {
    id: 'x', workstreamId: 'session:a', kind: 'decision', status: 'needs-you', title: 'Use [link](http://x) *bold*?', owner: 'you', priority: 1,
    sourceSessionIds: ['a'], confidence: 'inferred', updatedAt: now.toISOString(),
    evidence: [{ sessionId: 'a', eventId: 'e', kind: 'message', timestamp: now.toISOString(), excerpt: '<img src=x> `code`' }],
  };
  const tip = find(buildAttentionNodes(state, discovery(), now), (n) => n.itemId === 'x')?.tooltip ?? '';
  assert.match(tip, /Use \\\[link\\\]\\\(http:\/\/x\\\) \\\*bold\\\*\?/);
  assert.match(tip, /\\<img src=x\\> \\`code\\`/);
});

test('formatAge buckets', () => {
  const ago = (s: number) => formatAge(new Date(now.getTime() - s * 1000), now);
  assert.equal(ago(5), 'just now');
  assert.equal(ago(-30), 'just now');
  assert.equal(ago(120), '2m ago');
  assert.equal(ago(3 * 3600), '3h ago');
  assert.equal(ago(47 * 3600), '47h ago');
  assert.equal(ago(3 * 86400), '3d ago');
  assert.equal(formatAge(new Date('invalid'), now), 'unknown age');
});
