import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { findOnPath, planResume } from '../../adapters/claudeCli/resume';
import { applyEvents } from '../../domain/state/reducer';
import { emptyState } from '../../domain/state/types';
import { itemDetailsMarkdown, sessionDetailsMarkdown } from '../../ui/details';
import { SCENARIO_NOW, scenarios } from '../fixtures/scenarios';
import { makeTempRoot } from '../fixtures/sessions';

const roots: string[] = [];
async function setup() {
  const root = await makeTempRoot('focus-center-resume-');
  roots.push(root);
  const project = path.join(root, 'project');
  const bin = path.join(root, 'bin');
  await fs.mkdir(project);
  await fs.mkdir(bin);
  const cli = path.join(bin, process.platform === 'win32' ? 'claude.exe' : 'claude');
  await fs.writeFile(cli, '');
  await fs.chmod(cli, 0o755);
  const transcript = path.join(root, 's.jsonl');
  await fs.writeFile(transcript, '{}\n');
  return { root, project, bin, cli, transcript, env: { PATH: bin } };
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

const ID = '00000000-0000-4000-8000-000000000001';

test('plans `claude --resume <id>` in the original cwd as an argument array (no shell string)', async () => {
  const e = await setup();
  const r = await planResume({ sessionId: ID, cwd: e.project, transcriptPath: e.transcript, env: e.env });
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { cwd: e.project, shellPath: e.cli, shellArgs: ['--resume', ID], displayCommand: `claude --resume ${ID}`, warnings: [] });
});

test('unsafe session ids are refused before anything else, including option injection', async () => {
  const e = await setup();
  for (const id of ['../etc/passwd', '$(whoami)', 'a b', '-rf', '--dangerously-skip-permissions', 'a;b', '', 'x'.repeat(200)]) {
    const r = await planResume({ sessionId: id, cwd: e.project, env: e.env });
    assert.deepEqual([r.ok, r.ok ? '' : r.reason], [false, 'unsafe-session-id'], id);
  }
});

test('unknown or deleted working directory is reported, not guessed', async () => {
  const e = await setup();
  const none = await planResume({ sessionId: ID, env: e.env });
  assert.equal(none.ok ? '' : none.reason, 'no-cwd');
  const gone = await planResume({ sessionId: ID, cwd: path.join(e.root, 'deleted'), env: e.env });
  assert.equal(gone.ok ? '' : gone.reason, 'cwd-missing');
  assert.equal(gone.ok ? '' : gone.displayCommand, `claude --resume ${ID}`, 'still offers a command to copy');
  const file = await planResume({ sessionId: ID, cwd: e.transcript, env: e.env });
  assert.equal(file.ok ? '' : file.reason, 'cwd-missing');
});

test('missing CLI is reported; a configured path wins over PATH', async () => {
  const e = await setup();
  const missing = await planResume({ sessionId: ID, cwd: e.project, env: { PATH: '' } });
  assert.equal(missing.ok ? '' : missing.reason, 'cli-missing');
  const relative = await planResume({ sessionId: ID, cwd: e.project, env: {}, configuredCli: 'claude' });
  assert.equal(relative.ok ? '' : relative.reason, 'cli-missing');
  const notThere = await planResume({ sessionId: ID, cwd: e.project, env: {}, configuredCli: path.join(e.root, 'nope') });
  assert.equal(notThere.ok ? '' : notThere.reason, 'cli-missing');
  const configured = await planResume({ sessionId: ID, cwd: e.project, env: { PATH: '' }, configuredCli: e.cli });
  assert.ok(configured.ok);
});

test('a missing transcript is a warning, not a silent launch', async () => {
  const e = await setup();
  const r = await planResume({ sessionId: ID, cwd: e.project, transcriptPath: path.join(e.root, 'gone.jsonl'), env: e.env });
  assert.ok(r.ok);
  assert.match(r.plan.warnings[0], /transcript was not found/);
});

test('Windows .cmd shims run through cmd.exe with quoted path; unsafe shim paths are refused', async () => {
  const e = await setup();
  const shim = path.join(e.bin, 'claude.cmd');
  await fs.writeFile(shim, '@echo off');
  const r = await planResume({ sessionId: ID, cwd: e.project, env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, configuredCli: shim, platform: 'win32' });
  assert.ok(r.ok);
  assert.equal(r.plan.shellPath, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(r.plan.shellArgs, `/d /s /c ""${shim}" --resume ${ID}"`);
  const evilDir = path.join(e.root, 'a&b');
  await fs.mkdir(evilDir);
  const evil = path.join(evilDir, 'claude.cmd');
  await fs.writeFile(evil, '@echo off');
  const refused = await planResume({ sessionId: ID, cwd: e.project, env: {}, configuredCli: evil, platform: 'win32' });
  assert.equal(refused.ok ? '' : refused.reason, 'unsafe-cli-path');
});

test('PATH search skips relative entries and never runs anything', async () => {
  const e = await setup();
  const sep = process.platform === 'win32' ? ';' : ':';
  assert.equal(await findOnPath('claude', { PATH: ['relative', path.join(e.root, 'empty'), e.bin].join(sep) }, process.platform), e.cli);
  assert.equal(await findOnPath('claude', { PATH: 'relative' }, process.platform), undefined);
  assert.equal(await findOnPath('claude', {}, process.platform), undefined);
});

test('details document explains why, what changed, source session and next step', () => {
  const state = emptyState();
  const scenario = scenarios().find((s) => s.name.startsWith('02'))!; // permission later answered
  applyEvents(state, scenario.events, SCENARIO_NOW);
  const item = Object.values(state.items)[0];
  state.sessions.s02.transcriptPath = '/synthetic/t.jsonl';
  const md = itemDetailsMarkdown(state, item.id, SCENARIO_NOW);
  assert.match(md, /^# Permission needed: Edit$/m);
  assert.match(md, /\*\*Status:\*\* resolved · \*\*Kind:\*\* permission/);
  assert.match(md, /## Why this is here\n\n- 2026-05-04T11:55:00\.000Z \(5m ago\) — hook event/);
  assert.match(md, /## What changed\n\n- .* — Needs you: Permission needed: Edit\n- .* — Answered: session continued: Permission needed: Edit/);
  assert.match(md, /\*\*Session:\*\* `s02`/);
  assert.match(md, /\*\*Transcript:\*\* \/synthetic\/t\.jsonl/);
  assert.match(md, /not proof that Claude is running/);
  assert.match(md, /## Next step\n\nThe session continued after this\./);
  assert.match(itemDetailsMarkdown(state, 'missing', SCENARIO_NOW), /Item not found/);
  assert.match(sessionDetailsMarkdown(state, 's02', SCENARIO_NOW), /- resolved · Permission needed: Edit/);
  assert.match(sessionDetailsMarkdown(state, 'nope', SCENARIO_NOW), /Session not found/);
});
