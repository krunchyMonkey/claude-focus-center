import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { copyHookScripts } from '../../adapters/claudeHooks/installer';
import { writeScopeFile } from '../../adapters/claudeHooks/scopeFile';
import { installHookForTest } from '../fixtures/hooks';
import { discoverSessions } from '../../adapters/claudeSessions/discovery';
import { purgeOutOfScope } from '../../domain/privacy/purge';
import { applyEvents } from '../../domain/state/reducer';
import { emptyState } from '../../domain/state/types';
import { linkSession, regroup } from '../../domain/workstreams/group';
import { CLOSED_SCOPE, DEFAULT_SCOPE, inScope, isUnder, parseScope } from '../../hook/scope';
import { deleteData, planDeletion } from '../../storage/deleteData';
import { makeTempRoot, SYNTHETIC_REPOS, tenSessions, writeSessions } from '../fixtures/sessions';

const roots: string[] = [];
async function temp(): Promise<string> {
  const r = await makeTempRoot('focus-center-privacy-');
  roots.push(r);
  return r;
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

test('scope: exclusions win, allow-list restricts, pause stops everything', () => {
  const scope = { excludedPaths: ['/w/api/secret'], includedPaths: ['/w/api'], paused: false };
  assert.equal(inScope('/w/api', scope, 'linux'), true);
  assert.equal(inScope('/w/api/sub', scope, 'linux'), true);
  assert.equal(inScope('/w/api/secret/x', scope, 'linux'), false);
  assert.equal(inScope('/w/web', scope, 'linux'), false);
  assert.equal(inScope('/w/apix', scope, 'linux'), false);
  assert.equal(inScope(undefined, scope, 'linux'), false, 'unknown cwd is not on an allow-list');
  assert.equal(inScope(undefined, DEFAULT_SCOPE, 'linux'), true);
  assert.equal(inScope('/w/api', { ...scope, paused: true }, 'linux'), false);
  assert.equal(isUnder('C:\\Work\\Api\\x', ['c:/work/api'], 'win32'), true);
});

test('scope file parsing: valid files are read as written, anything else collects nothing', () => {
  assert.deepEqual(parseScope('{"paused":true}'), { excludedPaths: [], includedPaths: [], paused: true });
  assert.deepEqual(parseScope('{"excludedPaths":["/a","  "],"includedPaths":[],"paused":false}'), { excludedPaths: ['/a'], includedPaths: [], paused: false });
  assert.deepEqual(parseScope('not json'), CLOSED_SCOPE);
});

test('allow-list discovery reads only included projects', async () => {
  const r = await temp();
  await writeSessions(r, tenSessions());
  const result = await discoverSessions({ root: r, includedPaths: [SYNTHETIC_REPOS.gamma] });
  assert.deepEqual([...new Set(result.sessions.map((s) => s.cwd))], [SYNTHETIC_REPOS.gamma]);
  assert.equal(result.excludedCount, 3, 'three other project folders skipped before reading');
  const both = await discoverSessions({ root: r, includedPaths: [SYNTHETIC_REPOS.gamma], excludedPaths: [SYNTHETIC_REPOS.gamma] });
  assert.equal(both.sessions.length, 0, 'exclusion wins over the allow-list');
});

test('purge forgets sessions, items, cursors, links and journal entries for out-of-scope projects', () => {
  const state = emptyState();
  const now = new Date('2026-08-01T00:00:00Z');
  const ev = (sessionId: string, cwd: string, n: number) => ({ schema: 1 as const, id: `hook:${sessionId}:${n}`, source: 'hook' as const, sessionId, sourceEventId: String(n), kind: 'permission-request' as const, toolName: 'Bash', cwd, timestamp: now.toISOString(), excerpt: 'SECRET-PROJECT-TEXT' });
  applyEvents(state, [ev('keep', '/w/api', 1), ev('drop', '/w/secret', 2)], now);
  state.sessions.drop.transcriptPath = '/claude/drop.jsonl';
  state.cursors['/claude/drop.jsonl'] = { offset: 1, size: 1, mtimeMs: 1, readTo: 1, fingerprint: '', fingerprintBytes: 0, discardingLine: false };
  linkSession(state, 'drop', 'session:drop', now, 'linux');
  regroup(state, 'linux');

  assert.deepEqual(purgeOutOfScope(state, { excludedPaths: ['/w/secret'], includedPaths: [], paused: true }, 'linux').sessionIds, ['drop'], 'pause does not prevent purging excluded data');
  assert.deepEqual(Object.keys(state.sessions), ['keep']);
  assert.equal(Object.values(state.items).length, 1);
  assert.deepEqual(state.cursors, {});
  assert.deepEqual(state.manualLinks, {});
  assert.ok(Object.values(state.workstreams).every((w) => !w.sessionIds.includes('drop')));
  assert.ok(state.journal.every((j) => j.sessionId !== 'drop'));
  assert.doesNotMatch(JSON.stringify(state), /\/w\/secret/);
  assert.deepEqual(purgeOutOfScope(state, DEFAULT_SCOPE, 'linux').sessionIds, []);
});

test('pausing alone never deletes data', () => {
  const state = emptyState();
  state.sessions.a = { source: 'claude-local', sessionId: 'a', cwd: '/w/api', lastSeenAt: '2026-01-01T00:00:00Z' };
  assert.deepEqual(purgeOutOfScope(state, { ...DEFAULT_SCOPE, paused: true }, 'linux').sessionIds, []);
  assert.ok(state.sessions.a);
});

test('delete plan covers only Focus Center files and keeps hook scripts while hooks are installed', async () => {
  const storage = await temp();
  for (const f of ['state.json', 'state.json.bak', 'state.json.corrupt-2026.json']) {
    await fs.writeFile(path.join(storage, f), '{}');
  }
  for (const d of ['spool', 'backups', 'hooks', 'unrelated-dir']) {
    await fs.mkdir(path.join(storage, d));
    await fs.writeFile(path.join(storage, d, 'x'), 'x');
  }
  const outside = path.join(path.dirname(storage), `outside-${path.basename(storage)}`);
  await fs.writeFile(outside, 'must survive');
  roots.push(outside);

  const keep = await planDeletion(storage, true);
  assert.deepEqual(keep.paths.map((p) => path.basename(p)), ['backups', 'spool', 'state.json', 'state.json.bak', 'state.json.corrupt-2026.json']);
  const removed = await deleteData({ paths: [...keep.paths, outside] }, storage);
  assert.equal(removed.length, 5, 'a path outside storage is refused');
  assert.deepEqual((await fs.readdir(storage)).sort(), ['hooks', 'unrelated-dir']);
  assert.equal(await fs.readFile(outside, 'utf8'), 'must survive');
  assert.deepEqual((await planDeletion(storage, false)).paths.map((p) => path.basename(p)), ['hooks']);
  assert.deepEqual(await planDeletion(path.join(storage, 'missing'), false), { paths: [] });
});

test('the installed hook writes nothing for excluded projects, outside the allow-list, or while paused', async () => {
  const storage = await temp();
  const script = await copyHookScripts(path.resolve(__dirname, '../../hook'), storage);
  await writeScopeFile(path.dirname(script), DEFAULT_SCOPE);
  const spool = path.join(storage, 'spool');
  const scopeFile = path.join(path.dirname(script), 'scope.json');
  const run = (cwd: string) => spawnSync(process.execPath, [script, 'PermissionRequest', spool], {
    input: JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: `s-${cwd.length}-${Math.random().toString(16).slice(2)}`, cwd, tool_name: 'Bash' }),
    encoding: 'utf8',
  });
  const count = async () => (await fs.readdir(spool).catch(() => [])).length;

  await fs.writeFile(scopeFile, JSON.stringify({ excludedPaths: ['/w/secret'], includedPaths: [], paused: false }));
  assert.equal(run('/w/secret/sub').status, 0);
  assert.equal(await count(), 0);
  assert.equal(run('/w/api').status, 0);
  assert.equal(await count(), 1);

  await fs.writeFile(scopeFile, JSON.stringify({ excludedPaths: [], includedPaths: ['/w/web'], paused: false }));
  run('/w/api');
  assert.equal(await count(), 1);
  run('/w/web/app');
  assert.equal(await count(), 2);

  await fs.writeFile(scopeFile, JSON.stringify({ excludedPaths: [], includedPaths: [], paused: true }));
  assert.equal(run('/w/web').status, 0);
  assert.equal(await count(), 2);

  // Fail closed: an unreadable scope means "collect nothing", not "collect everything".
  await fs.writeFile(scopeFile, '{broken');
  assert.equal(run('/w/any').status, 0);
  assert.equal(await count(), 2, 'a broken scope file records nothing');
  await fs.rm(scopeFile);
  assert.equal(run('/w/any').status, 0);
  assert.equal(await count(), 2, 'a missing scope file records nothing');

  // An open scope records again.
  await fs.writeFile(scopeFile, JSON.stringify(DEFAULT_SCOPE));
  run('/w/any');
  assert.equal(await count(), 3);
});

test('a deeply nested project keeps its exclusion even though the spool record would drop its over-long cwd', async () => {
  const storage = await temp();
  const script = await installHookForTest(storage, { excludedPaths: ['/w/secret'], includedPaths: [], paused: false });
  const spool = path.join(storage, 'spool');
  const deep = '/w/secret/' + 'd/'.repeat(600); // > 1,024 characters
  const input = (cwd: string | undefined) => JSON.stringify({ hook_event_name: 'Stop', session_id: 's-deep', cwd, last_assistant_message: 'SECRET-EXCERPT' });
  const run = (cwd: string | undefined) => spawnSync(process.execPath, [script, 'Stop', spool], { input: input(cwd), encoding: 'utf8' });
  const count = async () => (await fs.readdir(spool).catch(() => [])).length;

  assert.equal(run(deep).status, 0);
  assert.equal(run(undefined).status, 0);
  assert.equal(await count(), 0, 'over-long or missing cwd is rejected while an exclusion exists');

  // Without any restriction the same event is collected (its location is simply unknown).
  await writeScopeFile(path.dirname(script), DEFAULT_SCOPE);
  assert.equal(run(deep).status, 0);
  assert.equal(await count(), 1);
});

test('shipped code has no network, telemetry or process-spawning dependencies', async () => {
  const srcRoot = path.resolve(__dirname, '../../../src');
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test') {
          await walk(p);
        }
      } else if (entry.name.endsWith('.ts')) {
        files.push(p);
      }
    }
  };
  await walk(srcRoot);
  assert.ok(files.length > 20);
  const forbidden = /from ['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads)['"]|\bfetch\(|XMLHttpRequest|WebSocket|require\(/;
  const offenders = [];
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8');
    if (forbidden.test(text)) {
      offenders.push(path.relative(srcRoot, f));
    }
  }
  assert.deepEqual(offenders, []);
  const pkg = JSON.parse(await fs.readFile(path.resolve(srcRoot, '../package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
});
