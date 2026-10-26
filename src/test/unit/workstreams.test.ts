import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { findRepoRoot } from '../../adapters/git/repoRoot';
import type { NormalizedEvent } from '../../domain/events/types';
import { applyEvents } from '../../domain/state/reducer';
import { emptyState, FocusState } from '../../domain/state/types';
import { linkSession, linkToNewWorkstream, regroup, repoKeyOf, unlinkSession } from '../../domain/workstreams/group';
import { refsFromBranch, refsFromText } from '../../domain/workstreams/refs';
import { makeTempRoot } from '../fixtures/sessions';

const now = new Date('2026-06-01T12:00:00.000Z');
let n = 0;

function session(state: FocusState, id: string, cwd: string, gitBranch?: string, repoRoot?: string): void {
  state.sessions[id] = { source: 'claude-local', sessionId: id, cwd, lastSeenAt: now.toISOString(), ...(gitBranch ? { gitBranch } : {}), ...(repoRoot ? { repoRoot } : {}) };
}

function hookEvent(sessionId: string, kind: NormalizedEvent['kind'], extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const id = `e${n++}`;
  return { schema: 1, id: `hook:${sessionId}:${id}`, source: 'hook', sessionId, sourceEventId: id, kind, timestamp: new Date(now.getTime() - 60_000 + n).toISOString(), ...extra };
}

function groups(state: FocusState): string[][] {
  return Object.values(state.workstreams).map((w) => [...w.sessionIds].sort()).sort((a, b) => a[0].localeCompare(b[0]));
}

test('work-item refs are exact and namespaced', () => {
  assert.deepEqual(refsFromBranch('feature/PROJ-123-login', '/r').map((r) => r.key), ['jira:PROJ-123']);
  assert.deepEqual(refsFromBranch('users/me/AB#4567-fix', '/r').map((r) => r.key), ['ado:4567']);
  assert.deepEqual(refsFromBranch('fix/123-header', '/r/a').map((r) => r.key), ['github:/r/a#123']);
  assert.deepEqual(refsFromBranch('123-header', '/r/a').map((r) => r.key), ['github:/r/a#123']);
  assert.deepEqual(refsFromBranch('fix/123-header', undefined), [], 'bare numbers need a repo');
  for (const branch of ['main', 'feat/login', 'release/2.0', 'chore/deps', 'feat/proj-123-lowercase', 'v2-hotfix']) {
    assert.deepEqual(refsFromBranch(branch, '/r'), [], branch);
  }
  assert.deepEqual(refsFromText('Implement AB#12 and see #34 (PROJ-9)', '/r').map((r) => r.key), ['ado:12', 'jira:PROJ-9', 'github:/r#34']);
  assert.deepEqual(refsFromText('Use UTF-8, ISO-8601, SHA-256 and RFC-7231; fix CVE-2024-1234', '/r'), [], 'standards are not tickets');
  assert.deepEqual(refsFromBranch('feat/SHA-256-hashing', '/r'), []);
});

test('same ticket merges sessions across repositories', () => {
  const s = emptyState();
  session(s, 'a', '/w/api', 'feature/PROJ-12-auth');
  session(s, 'b', '/w/web', 'feature/PROJ-12-auth-ui');
  session(s, 'c', '/w/web', 'main');
  regroup(s, 'linux');
  assert.deepEqual(groups(s), [['a', 'b'], ['c']]);
  const ws = Object.values(s.workstreams).find((w) => w.sessionIds.includes('a'))!;
  assert.deepEqual([ws.id, ws.basis, ws.title], ['ref:jira:PROJ-12', 'work-item', 'PROJ-12 · api']);
});

test('a task subject reference links a session without a matching branch', () => {
  const s = emptyState();
  session(s, 'a', '/w/api', 'feature/PROJ-12-auth');
  session(s, 'b', '/w/docs', 'main');
  applyEvents(s, [hookEvent('b', 'task-created', { taskId: 't', excerpt: 'Document the PROJ-12 endpoints' })], now);
  regroup(s, 'linux');
  assert.deepEqual(groups(s), [['a', 'b']]);
  assert.deepEqual(s.sessions.b.workItemHints, ['PROJ-12'], 'only the token is kept, not the subject');
});

test('similar names in different repositories stay separate', () => {
  const s = emptyState();
  session(s, 'a', '/home/dev/work/api', 'main');
  session(s, 'b', '/home/dev/personal/api', 'main');
  session(s, 'c', '/home/dev/work/api', 'fix/123-x');
  session(s, 'd', '/home/dev/personal/api', 'fix/123-x');
  regroup(s, 'linux');
  assert.deepEqual(groups(s), [['a'], ['b'], ['c'], ['d']]);
});

test('same repo root and branch group; worktrees and other branches do not', () => {
  const s = emptyState();
  session(s, 'a', '/w/api', 'main', '/w/api');
  session(s, 'b', '/w/api/packages/core', 'main', '/w/api');
  session(s, 'c', '/w/api', 'feat/x', '/w/api');
  session(s, 'd', '/w/api-wt', 'main', '/w/api-wt');
  session(s, 'e', '/w/scratch');
  regroup(s, 'linux');
  assert.deepEqual(groups(s), [['a', 'b'], ['c'], ['d'], ['e']]);
  assert.equal(s.workstreams['session:e'].basis, 'session');
});

test('repo identity folds case only on case-insensitive platforms', () => {
  assert.equal(repoKeyOf({ cwd: 'C:\\Work\\Api\\' }, 'win32'), 'c:/work/api');
  assert.equal(repoKeyOf({ cwd: 'c:/work/api' }, 'win32'), 'c:/work/api');
  assert.notEqual(repoKeyOf({ cwd: '/Work/Api' }, 'linux'), repoKeyOf({ cwd: '/work/api' }, 'linux'));
});

test('manual link and split survive re-import and new events; unlink restores automatic grouping', () => {
  const s = emptyState();
  session(s, 'a', '/w/api', 'main');
  session(s, 'b', '/w/api', 'main');
  session(s, 'c', '/w/web', 'main');
  regroup(s, 'linux');
  assert.deepEqual(groups(s), [['a', 'b'], ['c']]);

  linkSession(s, 'b', 'session:b', now, 'linux'); // keep separate
  const target = Object.values(s.workstreams).find((w) => w.sessionIds.includes('c'))!.id;
  linkSession(s, 'a', target, now, 'linux');
  assert.deepEqual(groups(s), [['a', 'c'], ['b']]);

  // Re-import: discovery and events rebuild sessions; manual links still win.
  applyEvents(s, [hookEvent('a', 'permission-request', { toolName: 'Bash' }), hookEvent('b', 'stop')], now);
  session(s, 'b', '/w/api', 'main');
  regroup(s, 'linux');
  assert.deepEqual(groups(s), [['a', 'c'], ['b']]);
  assert.equal(Object.values(s.items)[0].workstreamId, target, 'items follow their session');
  assert.ok(s.journal.some((j) => j.type === 'user-action' && /Linked session a/.test(j.summary)));

  assert.equal(unlinkSession(s, 'b', now, 'linux'), true);
  assert.equal(unlinkSession(s, 'b', now, 'linux'), false);
  assert.deepEqual(groups(s), [['a', 'c'], ['b']].map((g) => g), 'b alone: a is still manually linked away from api@main');
  unlinkSession(s, 'a', now, 'linux');
  assert.deepEqual(groups(s), [['a', 'b'], ['c']]);
});

test('a new named workstream gets a unique id and keeps its title', () => {
  const s = emptyState();
  session(s, 'a', '/w/api', 'main');
  session(s, 'b', '/w/web', 'main');
  const id1 = linkToNewWorkstream(s, 'a', 'Auth rewrite', now, 'linux');
  const id2 = linkToNewWorkstream(s, 'b', 'Auth rewrite', now, 'linux');
  assert.notEqual(id1, id2);
  assert.equal(s.workstreams[id1].title, 'Auth rewrite');
  assert.equal(s.workstreams[id2].basis, 'manual');
  assert.throws(() => linkSession(s, 'missing', id1, now, 'linux'));
});

test('conflicts stay visible: completion in one session vs open items in another; two refs on one session', () => {
  const s = emptyState();
  session(s, 'a', '/w/api', 'feature/PROJ-1');
  session(s, 'b', '/w/web', 'feature/PROJ-1');
  applyEvents(s, [
    hookEvent('a', 'task-completed', { taskId: 't1', excerpt: 'Ship auth' }),
    hookEvent('b', 'permission-request', { toolName: 'Bash' }),
  ], now);
  session(s, 'c', '/w/api', 'feature/PROJ-2');
  applyEvents(s, [hookEvent('c', 'task-created', { taskId: 't2', excerpt: 'Also touches PROJ-3' })], now);
  regroup(s, 'linux');
  assert.deepEqual(s.workstreams['ref:jira:PROJ-1'].conflicts, ['One session reports its task complete while another still has open items.']);
  assert.match(s.workstreams['ref:jira:PROJ-2'].conflicts?.[0] ?? '', /references PROJ-2 and PROJ-3; grouped by PROJ-2/);
  // The permission request is not hidden by the completion.
  assert.ok(Object.values(s.items).some((i) => i.kind === 'permission' && i.status === 'needs-you'));
});

test('regroup is deterministic and idempotent', () => {
  const build = () => {
    const s = emptyState();
    session(s, 'b', '/w/api', 'main');
    session(s, 'a', '/w/api', 'main');
    session(s, 'c', '/w/web', 'PROJ-7-x');
    return s;
  };
  const x = build();
  regroup(x, 'linux');
  const once = JSON.stringify(x.workstreams);
  regroup(x, 'linux');
  assert.equal(JSON.stringify(x.workstreams), once);
  const y = build();
  regroup(y, 'linux');
  assert.equal(JSON.stringify(y.workstreams), once);
});

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

test('repo root detection finds .git folders and worktree .git files without reading them', async () => {
  const r = await makeTempRoot('focus-center-git-');
  roots.push(r);
  await fs.mkdir(path.join(r, 'repo', '.git'), { recursive: true });
  await fs.mkdir(path.join(r, 'repo', 'src', 'deep'), { recursive: true });
  await fs.mkdir(path.join(r, 'wt'), { recursive: true });
  await fs.writeFile(path.join(r, 'wt', '.git'), 'gitdir: elsewhere');
  await fs.mkdir(path.join(r, 'plain'), { recursive: true });
  assert.equal(await findRepoRoot(path.join(r, 'repo', 'src', 'deep')), path.join(r, 'repo'));
  assert.equal(await findRepoRoot(path.join(r, 'wt')), path.join(r, 'wt'));
  const plain = await findRepoRoot(path.join(r, 'plain'));
  assert.ok(plain === undefined || !plain.startsWith(r), 'no repo inside the temp tree');
});
