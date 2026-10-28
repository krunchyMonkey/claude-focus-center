import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HOOK_EVENTS,
  installedEvents,
  installHooks,
  isOwnedHandler,
  removeHooks,
  Settings,
  UnexpectedSettingsError,
} from '../../adapters/claudeHooks/settings';

const cmd = { nodePath: '/synthetic/bin/node', scriptPath: '/synthetic/storage/hooks/claude-focus-center-hook.js', spoolDir: '/synthetic/storage/spool' };

/** Synthetic settings with third-party hooks on events we also use. */
function thirdParty(): Settings {
  return {
    model: 'synthetic-model',
    permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: '/synthetic/other-tool/notify.sh' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/synthetic/guard.sh', timeout: 5 }] }],
      Notification: [{ matcher: 'permission_prompt', hooks: [
        { type: 'command', command: '/synthetic/ding.sh' },
      ] }],
    },
  };
}

test('install adds one async exec-form handler per event and keeps third-party hooks', () => {
  const next = installHooks(thirdParty(), cmd);
  assert.deepEqual(installedEvents(next).sort(), [...HOOK_EVENTS].sort());
  const hooks = next.hooks as Record<string, Array<{ hooks: unknown[] }>>;
  assert.deepEqual(hooks.Stop[0], thirdParty().hooks && (thirdParty().hooks as Record<string, unknown[]>).Stop[0]);
  assert.deepEqual(hooks.Stop[1], { hooks: [{ type: 'command', command: cmd.nodePath, args: [cmd.scriptPath, 'Stop', cmd.spoolDir], async: true }] });
  assert.deepEqual(hooks.PreToolUse, (thirdParty().hooks as Record<string, unknown>).PreToolUse);
  assert.equal(next.model, 'synthetic-model');
});

test('install is idempotent', () => {
  const once = installHooks(thirdParty(), cmd);
  assert.deepEqual(installHooks(once, cmd), once);
});

test('reinstall with a new node path replaces rather than duplicates', () => {
  const once = installHooks({}, cmd);
  const twice = installHooks(once, { ...cmd, nodePath: '/other/node' });
  const stop = (twice.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>).Stop;
  assert.equal(stop.length, 1);
  assert.equal(stop[0].hooks[0].command, '/other/node');
});

test('install then remove restores the original object exactly', () => {
  const originals: Settings[] = [thirdParty(), {}, { other: 1 }];
  for (const original of originals) {
    const { settings, removed } = removeHooks(installHooks(original, cmd));
    assert.equal(removed, HOOK_EVENTS.length);
    assert.deepEqual(settings, original);
  }
});

test('known limitation: pre-existing *empty* hook containers are not restored (same meaning: no hooks)', () => {
  assert.deepEqual(removeHooks(installHooks({ hooks: {} }, cmd)).settings, {});
  assert.deepEqual(removeHooks(installHooks({ hooks: { Stop: [] } }, cmd)).settings, {});
});

test('remove only drops our handler from a shared matcher group', () => {
  const settings: Settings = { hooks: { Stop: [{ hooks: [
    { type: 'command', command: '/synthetic/a.sh' },
    { type: 'command', command: '/n', args: ['/x/claude-focus-center-hook.js', 'Stop'] },
  ] }] } };
  assert.deepEqual(removeHooks(settings), { settings: { hooks: { Stop: [{ hooks: [{ type: 'command', command: '/synthetic/a.sh' }] }] } }, removed: 1 });
});

test('remove without our hooks returns the identical object', () => {
  const s = thirdParty();
  const result = removeHooks(s);
  assert.equal(result.settings, s);
  assert.equal(result.removed, 0);
});

test('ownership requires the exact script file name', () => {
  assert.equal(isOwnedHandler({ type: 'command', command: 'node', args: ['C:\\x\\claude-focus-center-hook.js'] }), true);
  assert.equal(isOwnedHandler({ type: 'command', command: 'node /x/claude-focus-center-hook.js Stop' }), true);
  assert.equal(isOwnedHandler({ type: 'command', command: 'node', args: ['/x/my-claude-focus-center-hook.js.bak'] }), false);
  assert.equal(isOwnedHandler({ type: 'command', command: 'node', args: ['/x/other-hook.js'] }), false);
  assert.equal(isOwnedHandler({ type: 'http', url: 'claude-focus-center-hook.js' }), false);
  assert.equal(isOwnedHandler(null), false);
});

test('install refuses unexpected shapes instead of overwriting them', () => {
  assert.throws(() => installHooks({ hooks: 'oops' }, cmd), UnexpectedSettingsError);
  assert.throws(() => installHooks({ hooks: { Stop: { not: 'an array' } } }, cmd), UnexpectedSettingsError);
});

test('remove tolerates odd shapes and leaves them alone', () => {
  const odd: Settings = { hooks: { Stop: 'x', SessionEnd: [1, null, { hooks: 'no' }] } };
  assert.deepEqual(removeHooks(odd), { settings: odd, removed: 0 });
});
