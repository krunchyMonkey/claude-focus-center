import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDiagnosticsReport, CoverageEntry, summarizeCoverage } from '../../diagnostics/report';

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
