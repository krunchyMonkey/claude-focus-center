import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import {
  defaultSettingsPath,
  disableHooks,
  enableHooks,
  findNodeOnPath,
  hookStatus,
  installedScriptPath,
  serialize,
  SettingsUnreadableError,
} from '../../adapters/claudeHooks/installer';
import { HOOK_EVENTS } from '../../adapters/claudeHooks/settings';
import { makeTempRoot } from '../fixtures/sessions';

const roots: string[] = [];
async function env() {
  const root = await makeTempRoot('focus-center-hooks-');
  roots.push(root);
  const hookSourceDir = path.join(root, 'hook-src');
  await fs.mkdir(hookSourceDir);
  await fs.writeFile(path.join(hookSourceDir, 'claude-focus-center-hook.js'), '// synthetic hook\n');
  await fs.writeFile(path.join(hookSourceDir, 'redact.js'), '// synthetic module\n');
  await fs.writeFile(path.join(hookSourceDir, 'redact.js.map'), '{}');
  return {
    root,
    settingsPath: path.join(root, 'claude', 'settings.json'),
    storageDir: path.join(root, 'storage'),
    nodePath: path.join(root, 'bin', 'node'),
    hookSourceDir,
  };
}
after(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
});

const THIRD_PARTY = `{
    "model": "synthetic-model",
    "hooks": {
        "Stop": [
            {
                "hooks": [
                    {
                        "type": "command",
                        "command": "/synthetic/other-tool/notify.sh"
                    }
                ]
            }
        ]
    },
    "permissions": {
        "allow": [
            "Bash(npm test)"
        ]
    }
}
`;

test('enable then disable leaves pre-existing settings byte-identical, with backups', async () => {
  const e = await env();
  await fs.mkdir(path.dirname(e.settingsPath), { recursive: true });
  await fs.writeFile(e.settingsPath, THIRD_PARTY);

  const on = await enableHooks({ ...e, now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(on.changed, true);
  assert.deepEqual(on.events.sort(), [...HOOK_EVENTS].sort());
  assert.equal(await fs.readFile(on.backupPath!, 'utf8'), THIRD_PARTY);
  assert.equal(await fs.readFile(installedScriptPath(e.storageDir), 'utf8'), '// synthetic hook\n');
  assert.deepEqual((await fs.readdir(path.dirname(installedScriptPath(e.storageDir)))).sort(), ['claude-focus-center-hook.js', 'redact.js']);
  const installed = await fs.readFile(e.settingsPath, 'utf8');
  assert.match(installed, /^ {4}"model"/m, 'keeps 4-space indentation');
  assert.match(installed, /\/synthetic\/other-tool\/notify\.sh/);
  assert.match(installed, /"args": \[\s+".*claude-focus-center-hook\.js",\s+"Stop",\s+".*spool"\s+\]/);

  const off = await disableHooks({ ...e, now: new Date('2026-01-01T00:00:01Z') });
  assert.equal(off.removed, HOOK_EVENTS.length);
  assert.equal(await fs.readFile(e.settingsPath, 'utf8'), THIRD_PARTY);
  assert.equal(await fs.readFile(off.backupPath!, 'utf8'), installed);
  // No temp files left beside Claude's settings.
  assert.deepEqual(await fs.readdir(path.dirname(e.settingsPath)), ['settings.json']);
});

test('enable is idempotent and does not rewrite or back up again', async () => {
  const e = await env();
  await enableHooks({ ...e, now: new Date('2026-01-01T00:00:00Z') });
  const second = await enableHooks({ ...e, now: new Date('2026-01-01T00:00:01Z') });
  assert.equal(second.changed, false);
  assert.equal(second.backupPath, undefined);
});

test('enable creates a missing settings file; disable then leaves an empty object', async () => {
  const e = await env();
  const on = await enableHooks(e);
  assert.equal(on.backupPath, undefined);
  assert.deepEqual((await hookStatus(e.settingsPath)).events.sort(), [...HOOK_EVENTS].sort());
  await disableHooks(e);
  assert.equal(await fs.readFile(e.settingsPath, 'utf8'), '{}\n');
});

test('disable with nothing installed does not write', async () => {
  const e = await env();
  await fs.mkdir(path.dirname(e.settingsPath), { recursive: true });
  await fs.writeFile(e.settingsPath, THIRD_PARTY);
  const before = (await fs.stat(e.settingsPath)).mtimeMs;
  const off = await disableHooks(e);
  assert.deepEqual([off.changed, off.removed], [false, 0]);
  assert.equal((await fs.stat(e.settingsPath)).mtimeMs, before);
});

test('invalid JSON is never modified', async () => {
  const e = await env();
  await fs.mkdir(path.dirname(e.settingsPath), { recursive: true });
  const broken = '{ "model": "x", // comment\n}';
  await fs.writeFile(e.settingsPath, broken);
  await assert.rejects(enableHooks(e), SettingsUnreadableError);
  await assert.rejects(disableHooks(e), SettingsUnreadableError);
  assert.equal(await fs.readFile(e.settingsPath, 'utf8'), broken);
  assert.match((await hookStatus(e.settingsPath)).error ?? '', /not valid JSON/);
});

test('CRLF, BOM and missing trailing newline are preserved', () => {
  const original = '﻿{\r\n  "a": 1\r\n}';
  assert.equal(serialize({ a: 1 }, original), original);
  assert.equal(serialize({ a: 1 }, undefined), '{\n  "a": 1\n}\n');
});

test('settings path honours CLAUDE_CONFIG_DIR', () => {
  assert.match(defaultSettingsPath({ CLAUDE_CONFIG_DIR: '/synthetic/cfg' }), /synthetic[\\/]cfg[\\/]settings\.json$/);
});

test('node lookup scans absolute PATH entries only and never runs anything', async () => {
  const e = await env();
  const bin = path.join(e.root, 'bin');
  await fs.mkdir(bin, { recursive: true });
  const exe = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  await fs.writeFile(exe, '');
  await fs.chmod(exe, 0o755);
  const sep = process.platform === 'win32' ? ';' : ':';
  assert.equal(await findNodeOnPath({ PATH: ['relative-dir', path.join(e.root, 'empty'), bin].join(sep) }), exe);
  assert.equal(await findNodeOnPath({ PATH: 'relative-dir' }), undefined);
  assert.equal(await findNodeOnPath({}), undefined);
});
