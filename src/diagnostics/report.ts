// Pure diagnostics formatting: no VS Code or filesystem access, so it is unit-testable.
import type { DiscoveryResult } from '../adapters/claudeSessions/discovery';
import type { HookStatus } from '../adapters/claudeHooks/installer';
import { HOOK_EVENTS } from '../adapters/claudeHooks/settings';
import type { PollStats } from '../adapters/claudeSessions/tailer';

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
  sections?: DiagnosticsSection[];
}

export interface DiagnosticsSection {
  title: string;
  lines: string[];
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
  for (const section of input.sections ?? []) {
    lines.push('', section.title, ...section.lines.map((l) => `  ${l}`));
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

/** Coverage for the session-file source; unreadable files or projects make it partial. */
export function discoveryCoverage(result: DiscoveryResult | undefined): CoverageEntry {
  const source = 'Claude session files';
  if (!result) {
    return { source, state: 'unavailable', detail: 'discovery has not run yet' };
  }
  if (!result.rootFound) {
    return { source, state: 'unavailable', detail: `session folder not available: ${result.root}` };
  }
  const blocking = result.issues.filter((i) => i.code === 'project-unreadable' || i.code === 'file-unreadable' || i.code === 'root-unreadable');
  const detail = `${result.sessions.length} session(s), ${result.excludedCount} excluded`;
  return blocking.length > 0
    ? { source, state: 'partial', detail: `${detail}, ${blocking.length} unreadable` }
    : { source, state: 'active', detail };
}

/** Discovery details: counts and issue codes with local paths only, never transcript content. */
export function discoverySection(result: DiscoveryResult | undefined): DiagnosticsSection {
  if (!result) {
    return { title: 'Session discovery', lines: ['not run yet'] };
  }
  const lines = [
    `Root: ${result.root} (${result.rootFound ? 'found' : 'not found'})`,
    `Sessions listed: ${result.sessions.length}`,
    `Excluded: ${result.excludedCount}`,
    `Issues: ${result.issues.length}`,
    ...result.issues.map((i) => `- ${i.code}: ${i.path}${i.detail ? ` (${i.detail})` : ''}`),
  ];
  return { title: 'Session discovery', lines };
}

/** Incremental transcript reading: counts only. */
export function ingestionSection(totalEvents: number, last: PollStats | undefined): DiagnosticsSection {
  if (!last) {
    return { title: 'Transcript ingestion', lines: ['not run yet'] };
  }
  return {
    title: 'Transcript ingestion',
    lines: [
      `Events ingested since start: ${totalEvents}`,
      `Last refresh: ${last.filesRead} file(s) read, ${last.filesUnchanged} unchanged (not reread), ${last.bytesRead} bytes`,
      `Skipped lines: ${last.invalidLines} invalid, ${last.oversizedLines} oversized; duplicates dropped: ${last.duplicatesDropped}; rewrites detected: ${last.resets}`,
      ...(last.deferred > 0 ? [`Deferred to next refresh (byte budget): ${last.deferred} file(s)`] : []),
      ...last.errors.map((e) => `- unreadable: ${e.path} (${e.code})`),
    ],
  };
}

/** Hook coverage. Installed hooks are only partial coverage until their events are consumed (issue 05). */
export function hookCoverage(status: HookStatus): CoverageEntry {
  const source = 'Claude hooks';
  if (status.error) {
    return { source, state: 'unavailable', detail: status.error };
  }
  if (status.events.length === 0) {
    return { source, state: 'unavailable', detail: 'not enabled (run "Focus Center: Enable Claude Hooks")' };
  }
  const missing = HOOK_EVENTS.filter((e) => !status.events.includes(e));
  return {
    source,
    state: 'partial',
    detail: `installed for ${status.events.length} event(s)${missing.length ? `, missing ${missing.join(', ')}` : ''}; hook events are not ingested yet`,
  };
}
