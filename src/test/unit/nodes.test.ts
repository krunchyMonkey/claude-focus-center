import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiscoveryResult } from '../../adapters/claudeSessions/discovery';
import { buildSessionNodes, formatAge } from '../../ui/nodes';

const now = new Date('2026-01-10T12:00:00.000Z');

function result(sessions: DiscoveryResult['sessions']): DiscoveryResult {
  return { root: '/synthetic/root', rootFound: true, sessions, excludedCount: 0, issues: [] };
}

test('no sessions produce no nodes, so the welcome view shows', () => {
  assert.deepEqual(buildSessionNodes(result([]), now), []);
});

test('sessions render under one group with repo, branch, age and a source tooltip', () => {
  const [group] = buildSessionNodes(result([
    { source: 'claude-local', sessionId: 's1', transcriptPath: '/synthetic/root/p/s1.jsonl', projectDirName: '-synthetic-repos-alpha', cwd: '/synthetic/repos/alpha/', gitBranch: 'main', lastActivityAt: '2026-01-10T11:55:00.000Z', sizeBytes: 1 },
    { source: 'claude-local', sessionId: 's2', transcriptPath: '/synthetic/root/q/s2.jsonl', projectDirName: '-synthetic-q', lastActivityAt: '2026-01-07T12:00:00.000Z', sizeBytes: 1 },
  ]), now);
  assert.equal(group.label, 'Recent sessions (2)');
  const [a, b] = group.children ?? [];
  assert.equal(a.id, 'session:s1');
  assert.equal(a.label, 'alpha');
  assert.equal(a.description, 'main · 5m ago');
  assert.match(a.tooltip ?? '', /Session: s1/);
  assert.match(a.tooltip ?? '', /Transcript: \/synthetic\/root\/p\/s1\.jsonl/);
  // Unknown cwd falls back to the folder name and says so.
  assert.equal(b.label, '-synthetic-q');
  assert.equal(b.description, '3d ago');
  assert.match(b.tooltip ?? '', /Working directory: unknown/);
  assert.equal(b.icon, 'question');
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
