import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultProjectsRoot,
  encodeProjectDirName,
  isPathExcluded,
  isProjectDirExcluded,
} from '../../adapters/claudeSessions/paths';

test('project folder encoding replaces every non-alphanumeric character', () => {
  assert.equal(encodeProjectDirName('/Users/dev/my_repo.git'), '-Users-dev-my-repo-git');
  assert.equal(encodeProjectDirName('c:\\Developer\\dotnet'), 'c--Developer-dotnet');
});

test('default root honours CLAUDE_CONFIG_DIR', () => {
  assert.match(defaultProjectsRoot({ CLAUDE_CONFIG_DIR: '/synthetic/cfg' }), /synthetic[\\/]cfg[\\/]projects$/);
  assert.match(defaultProjectsRoot({}), /\.claude[\\/]projects$/);
});

test('folder exclusion matches the project and its subfolders, case-insensitively', () => {
  const excluded = ['/work/secret'];
  assert.equal(isProjectDirExcluded('-work-secret', excluded), true);
  assert.equal(isProjectDirExcluded('-WORK-Secret-sub', excluded), true);
  assert.equal(isProjectDirExcluded('-work-secretive', excluded), false);
  assert.equal(isProjectDirExcluded('-work-other', excluded), false);
  assert.equal(isProjectDirExcluded('-work-secret', ['/work/secret/']), true);
  assert.equal(isProjectDirExcluded('anything', ['']), false);
});

test('path exclusion on POSIX is exact-prefix and case-sensitive', () => {
  assert.equal(isPathExcluded('/work/secret', ['/work/secret'], 'linux'), true);
  assert.equal(isPathExcluded('/work/secret/sub', ['/work/secret/'], 'linux'), true);
  assert.equal(isPathExcluded('/work/secretive', ['/work/secret'], 'linux'), false);
  assert.equal(isPathExcluded('/work/Secret', ['/work/secret'], 'linux'), false);
  assert.equal(isPathExcluded('/anything', ['/'], 'linux'), true);
  assert.equal(isPathExcluded('/anything', ['  '], 'linux'), false);
});

test('path exclusion on Windows folds case and separators', () => {
  assert.equal(isPathExcluded('C:\\Work\\Secret\\sub', ['c:/work/secret'], 'win32'), true);
  assert.equal(isPathExcluded('c:\\work\\secretive', ['C:\\Work\\Secret'], 'win32'), false);
  assert.equal(isPathExcluded('D:\\x', ['C:\\'], 'win32'), false);
});
