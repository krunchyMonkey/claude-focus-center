import assert from 'node:assert/strict';
import * as dns from 'node:dns';
import * as path from 'node:path';
import { test } from 'node:test';
import { installNetworkTrap } from '../harness';

test('the network trap records calls from the watched code and ignores the test folder', async () => {
  // Treat this unit-test folder as "extension code" so a local lookup must be recorded.
  const watched = installNetworkTrap(path.resolve(__dirname), path.resolve(__dirname, 'no-such-test-dir'));
  await new Promise<void>((resolve) => (require('node:dns') as typeof dns).lookup('localhost', () => resolve()));
  assert.deepEqual(watched, ['dns.lookup']);
});

test('calls from the excluded test folder are not recorded', async () => {
  const ignored = installNetworkTrap(path.resolve(__dirname), path.resolve(__dirname));
  await new Promise<void>((resolve) => (require('node:dns') as typeof dns).lookup('localhost', () => resolve()));
  assert.deepEqual(ignored, []);
});
