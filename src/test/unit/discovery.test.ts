import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { discoverSessions, readSessionHeader } from '../../adapters/claudeSessions/discovery';
import { encodeProjectDirName } from '../../adapters/claudeSessions/paths';
import { makeTempRoot, SYNTHETIC_REPOS, syntheticUuid, tenSessions, writeSessions } from '../fixtures/sessions';

const roots: string[] = [];
async function root(): Promise<string> {
  const r = await makeTempRoot();
  roots.push(r);
  return r;
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

test('ten synthetic sessions across four repositories have unique identities and metadata', async () => {
  const r = await root();
  const fixtures = tenSessions();
  await writeSessions(r, fixtures);

  const result = await discoverSessions({ root: r });

  assert.equal(result.rootFound, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.sessions.length, 10);
  assert.equal(new Set(result.sessions.map((s) => s.sessionId)).size, 10);
  assert.equal(new Set(result.sessions.map((s) => s.cwd)).size, 4);
  // Newest first, with id, source path, cwd, branch and timestamp preserved.
  assert.deepEqual(result.sessions.map((s) => s.sessionId), fixtures.map((f) => f.sessionId));
  const first = result.sessions[0];
  assert.equal(first.source, 'claude-local');
  assert.equal(first.cwd, SYNTHETIC_REPOS.alpha);
  assert.equal(first.gitBranch, 'feat/login');
  assert.equal(first.lastActivityAt, new Date(fixtures[0].mtime * 1000).toISOString());
  assert.equal(first.transcriptPath, path.join(r, encodeProjectDirName(SYNTHETIC_REPOS.alpha), `${fixtures[0].sessionId}.jsonl`));
});

test('missing root yields a diagnostic, not an exception', async () => {
  const r = path.join(await root(), 'does-not-exist');
  const result = await discoverSessions({ root: r });
  assert.equal(result.rootFound, false);
  assert.deepEqual(result.sessions, []);
  assert.deepEqual(result.issues.map((i) => i.code), ['root-missing']);
});

test('excluded repository is skipped before its transcripts are read', async () => {
  const r = await root();
  await writeSessions(r, tenSessions());

  const result = await discoverSessions({ root: r, excludedPaths: [SYNTHETIC_REPOS.beta] });

  // One folder-level skip, not three per-session (post-read) skips.
  assert.equal(result.excludedCount, 1);
  assert.equal(result.sessions.length, 7);
  assert.ok(result.sessions.every((s) => s.cwd !== SYNTHETIC_REPOS.beta));
  assert.deepEqual(result.issues, []);
});

test('exclusion by recorded cwd catches projects whose folder name does not match', async () => {
  const r = await root();
  const [s] = tenSessions();
  await writeSessions(r, [s]);
  // Folder renamed so the pre-read check cannot match; the cwd check must still exclude it.
  await fs.rename(path.join(r, encodeProjectDirName(s.cwd)), path.join(r, 'renamed-project'));

  const result = await discoverSessions({ root: r, excludedPaths: [path.dirname(s.cwd)] });

  assert.equal(result.sessions.length, 0);
  assert.equal(result.excludedCount, 1);
});

test('malformed and partial lines are skipped; a file without cwd is reported, not dropped', async () => {
  const r = await root();
  const good = { sessionId: syntheticUuid(1), cwd: SYNTHETIC_REPOS.gamma, mtime: 1_800_000_000 };
  await writeSessions(r, [
    { ...good, lines: ['not json', '{"broken": ', '[1,2]', JSON.stringify({ type: 'user', cwd: good.cwd, gitBranch: 'main' })] },
    { sessionId: syntheticUuid(2), cwd: SYNTHETIC_REPOS.gamma, mtime: 1_799_000_000, lines: ['{"type":"summary"}', '{"partial":'] },
  ]);

  const result = await discoverSessions({ root: r });

  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0].cwd, SYNTHETIC_REPOS.gamma);
  assert.equal(result.sessions[0].gitBranch, 'main');
  assert.equal(result.sessions[1].cwd, undefined);
  assert.deepEqual(result.issues.map((i) => i.code), ['no-metadata']);
});

test('empty transcript is listed with unknown cwd', async () => {
  const r = await root();
  await writeSessions(r, [{ sessionId: syntheticUuid(3), cwd: SYNTHETIC_REPOS.delta, mtime: 1_800_000_000, lines: [] }]);
  const result = await discoverSessions({ root: r });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].cwd, undefined);
});

test('header read respects the byte budget and ignores a cut-off line', async () => {
  const r = await root();
  const file = path.join(r, 'h.jsonl');
  const filler = JSON.stringify({ type: 'summary', summary: 'x'.repeat(200) });
  await fs.writeFile(file, `${filler}\n${JSON.stringify({ cwd: '/synthetic/late' })}\n`);
  assert.deepEqual(await readSessionHeader(file, filler.length + 10), {});
  assert.deepEqual(await readSessionHeader(file, 4096), { cwd: '/synthetic/late' });
});

test('duplicate session ids keep the newest file and report the other', async () => {
  const r = await root();
  const id = syntheticUuid(7);
  await writeSessions(r, [
    { sessionId: id, cwd: SYNTHETIC_REPOS.alpha, mtime: 1_800_000_000 },
    { sessionId: id, cwd: SYNTHETIC_REPOS.beta, mtime: 1_700_000_000 },
  ]);
  const result = await discoverSessions({ root: r });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].cwd, SYNTHETIC_REPOS.alpha);
  assert.deepEqual(result.issues.map((i) => i.code), ['duplicate-session-id']);
});

test('unsafe file names are rejected as session ids', async () => {
  const r = await root();
  const dir = path.join(r, 'project');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, '$(whoami).jsonl'), '{}\n');
  await fs.writeFile(path.join(dir, 'notes.txt'), 'ignored');
  const result = await discoverSessions({ root: r });
  assert.deepEqual(result.sessions, []);
  assert.deepEqual(result.issues.map((i) => i.code), ['invalid-session-id']);
});

test('session count is bounded to the most recent files', async () => {
  const r = await root();
  await writeSessions(r, tenSessions());
  const result = await discoverSessions({ root: r, maxSessions: 3 });
  assert.deepEqual(result.sessions.map((s) => s.sessionId), tenSessions().slice(0, 3).map((s) => s.sessionId));
  assert.deepEqual(result.issues.map((i) => i.code), ['truncated-to-limit']);
});

test('nested subagent folders are not treated as sessions', async () => {
  const r = await root();
  const [s] = tenSessions();
  await writeSessions(r, [s]);
  const nested = path.join(r, encodeProjectDirName(s.cwd), s.sessionId, 'subagents');
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(nested, 'agent-1.jsonl'), '{}\n');
  const result = await discoverSessions({ root: r });
  assert.equal(result.sessions.length, 1);
});
