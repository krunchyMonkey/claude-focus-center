import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDiagnosticsReport, CoverageEntry, discoveryCoverage, discoverySection, ingestionSection, summarizeCoverage } from '../../diagnostics/report';

const base = {
  extensionVersion: '0.0.1',
  vscodeVersion: '1.100.0',
  platform: 'testos x64',
  nodeVersion: 'v22.0.0',
  storagePath: '/synthetic/global-storage',
  generatedAt: new Date('2026-01-02T03:04:05.000Z'),
};

test('report includes environment, storage path and every coverage source', () => {
  const coverage: CoverageEntry[] = [
    { source: 'Claude session files', state: 'not-implemented', detail: 'n/a' },
    { source: 'Claude hooks', state: 'unavailable', detail: 'not installed' },
  ];
  const text = buildDiagnosticsReport({ ...base, coverage }).join('\n');
  assert.match(text, /2026-01-02T03:04:05\.000Z/);
  assert.match(text, /VS Code version:\s+1\.100\.0/);
  assert.match(text, /\/synthetic\/global-storage/);
  assert.match(text, /Claude session files: not-implemented/);
  assert.match(text, /Claude hooks: unavailable — not installed/);
  assert.match(text, /Network egress:\s+none/);
});

test('report never claims full coverage when a source is inactive', () => {
  const coverage: CoverageEntry[] = [
    { source: 'a', state: 'active', detail: '' },
    { source: 'b', state: 'partial', detail: '' },
  ];
  assert.equal(summarizeCoverage(coverage), 'partial coverage (1 of 2 sources active); items may be missing.');
});

test('report with no registered sources is partial, not complete', () => {
  const text = buildDiagnosticsReport({ ...base, coverage: [] }).join('\n');
  assert.match(text, /\(no sources registered\)/);
  assert.match(text, /partial coverage \(0 of 0 sources active\)/);
});

test('summary reports complete coverage only when every source is active', () => {
  assert.equal(summarizeCoverage([{ source: 'a', state: 'active', detail: '' }]), 'all registered sources are active.');
});

test('discovery coverage: unavailable when root missing, partial when files unreadable, else active', () => {
  const ok = { root: '/synthetic/root', rootFound: true, sessions: [], excludedCount: 2, issues: [] };
  assert.equal(discoveryCoverage(undefined).state, 'unavailable');
  assert.equal(discoveryCoverage({ ...ok, rootFound: false }).state, 'unavailable');
  assert.deepEqual(discoveryCoverage(ok), { source: 'Claude session files', state: 'active', detail: '0 session(s), 2 excluded' });
  const partial = discoveryCoverage({ ...ok, issues: [{ code: 'file-unreadable', path: '/synthetic/root/p/x.jsonl' }] });
  assert.equal(partial.state, 'partial');
  // Benign issues do not reduce coverage.
  assert.equal(discoveryCoverage({ ...ok, issues: [{ code: 'no-metadata', path: '/x' }] }).state, 'active');
});

test('discovery section lists issue codes and paths', () => {
  const section = discoverySection({ root: '/r', rootFound: true, sessions: [], excludedCount: 0, issues: [{ code: 'no-metadata', path: '/r/p/s.jsonl', detail: 'no cwd' }] });
  const text = buildDiagnosticsReport({ ...base, coverage: [], sections: [section] }).join('\n');
  assert.match(text, /Session discovery\n {2}Root: \/r \(found\)/);
  assert.match(text, /- no-metadata: \/r\/p\/s\.jsonl \(no cwd\)/);
});

test('ingestion section reports counts without content', () => {
  const section = ingestionSection(5, { filesRead: 1, filesUnchanged: 2, bytesRead: 300, invalidLines: 1, oversizedLines: 0, resets: 0, duplicatesDropped: 0, deferred: 1, errors: [{ path: '/r/x.jsonl', code: 'EACCES' }] });
  assert.deepEqual(section.lines, [
    'Events ingested since start: 5',
    'Skipped since start: 0 invalid line(s)',
    'Last refresh: 1 file(s) read, 2 unchanged (not reread), 300 bytes',
    'Skipped lines: 1 invalid, 0 oversized; duplicates dropped: 0; rewrites detected: 0',
    'Deferred to next refresh (byte budget): 1 file(s)',
    '- unreadable: /r/x.jsonl (EACCES)',
  ]);
  assert.deepEqual(ingestionSection(0, undefined).lines, ['not run yet']);
});
