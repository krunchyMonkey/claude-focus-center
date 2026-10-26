// Pure diagnostics formatting: no VS Code or filesystem access, so it is unit-testable.

export type CoverageState = 'active' | 'partial' | 'unavailable' | 'not-implemented';

export interface CoverageEntry {
  source: string;
  state: CoverageState;
  detail: string;
}

export interface DiagnosticsInput {
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
  nodeVersion: string;
  storagePath: string;
  generatedAt: Date;
  coverage: CoverageEntry[];
}

/**
 * Formats a plain-text health report. It never claims full coverage: every source
 * lists its own state, and the summary states whether collection is complete.
 */
export function buildDiagnosticsReport(input: DiagnosticsInput): string[] {
  const lines = [
    `Claude Focus Center diagnostics — ${input.generatedAt.toISOString()}`,
    '',
    'Environment',
    `  Extension version: ${input.extensionVersion}`,
    `  VS Code version:   ${input.vscodeVersion}`,
    `  Platform:          ${input.platform}`,
    `  Node.js:           ${input.nodeVersion}`,
    '',
    'Local storage',
    `  Focus Center state: ${input.storagePath}`,
    '  Network egress:     none (no telemetry, no model calls)',
    '',
    'Collection coverage',
  ];
  if (input.coverage.length === 0) {
    lines.push('  (no sources registered)');
  }
  for (const entry of input.coverage) {
    lines.push(`  ${entry.source}: ${entry.state} — ${entry.detail}`);
  }
  lines.push('', `Summary: ${summarizeCoverage(input.coverage)}`);
  return lines;
}

export function summarizeCoverage(coverage: CoverageEntry[]): string {
  if (coverage.length > 0 && coverage.every((c) => c.state === 'active')) {
    return 'all registered sources are active.';
  }
  const active = coverage.filter((c) => c.state === 'active').length;
  return `partial coverage (${active} of ${coverage.length} sources active); items may be missing.`;
}
