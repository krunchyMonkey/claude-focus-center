// Pure diagnostics formatting: no VS Code or filesystem access, so it is unit-testable.
import type { DiscoveryResult } from '../adapters/claudeSessions/discovery';
import type { HookStatus } from '../adapters/claudeHooks/installer';
import { HOOK_EVENTS } from '../adapters/claudeHooks/settings';
import type { SpoolScanStats } from '../adapters/claudeHooks/spool';
import type { PollStats } from '../adapters/claudeSessions/tailer';
import type { FocusState } from '../domain/state/types';
import type { MonitoringScope } from '../hook/scope';
import type { LoadResult } from '../storage/jsonStore';
import { formatAge } from '../ui/nodes';

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

export interface HookIngestion {
  totalEvents: number;
  /** Events dropped because their project is out of scope. */
  outOfScope: number;
  byKind: Record<string, number>;
  lastEventAt?: string;
  lastScan?: SpoolScanStats;
}

/** Hook coverage: active only when every supported event is installed and the spool is readable. */
export function hookCoverage(status: HookStatus, ingestion: HookIngestion): CoverageEntry {
  const source = 'Claude hooks';
  if (status.error) {
    return { source, state: 'unavailable', detail: status.error };
  }
  if (status.events.length === 0) {
    return { source, state: 'unavailable', detail: 'not enabled (run "Focus Center: Enable Claude Hooks")' };
  }
  const missing = HOOK_EVENTS.filter((e) => !status.events.includes(e));
  const received = `${ingestion.totalEvents} event(s) received this run`;
  if (missing.length > 0) {
    return { source, state: 'partial', detail: `installed for ${status.events.length} event(s), missing ${missing.join(', ')}; ${received}` };
  }
  return { source, state: 'active', detail: `installed for all ${HOOK_EVENTS.length} events; ${received}` };
}

/** Spool health: counts, last event age and watcher mode. No event content. */
export function hookSection(spoolDir: string, watching: boolean, ingestion: HookIngestion, now: Date): DiagnosticsSection {
  const scan = ingestion.lastScan;
  const kinds = Object.entries(ingestion.byKind).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ');
  return {
    title: 'Hook events',
    lines: [
      `Spool: ${spoolDir} (${scan ? (scan.dirFound ? 'found' : 'not created yet') : 'not scanned yet'}; ${watching ? 'file watcher + 2.5 s rescan' : 'rescan every 2.5 s'})`,
      `Received this run: ${ingestion.totalEvents}${kinds ? ` (${kinds})` : ''}${ingestion.outOfScope ? `; ${ingestion.outOfScope} dropped as out of scope` : ''}`,
      `Last hook event: ${ingestion.lastEventAt ? `${ingestion.lastEventAt} (${formatAge(new Date(ingestion.lastEventAt), now)})` : 'none'}`,
      ...(scan && (scan.invalid || scan.unknownEvents || scan.duplicatesDropped)
        ? [`Last scan skipped: ${scan.invalid} invalid, ${scan.unknownEvents} unknown event, ${scan.duplicatesDropped} duplicate`]
        : []),
    ],
  };
}

/** Persisted state health: where it lives, how it loaded, sizes and last save. */
export function stateSection(
  file: string,
  service: { state: FocusState; loaded: LoadResult; lastSavedAt?: string; lastSaveError?: string },
): DiagnosticsSection {
  const { state, loaded } = service;
  return {
    title: 'Saved state',
    lines: [
      `File: ${file} (schema ${state.schemaVersion}, loaded from ${loaded.source})`,
      ...(loaded.recovery
        ? [`Recovered: ${loaded.recovery.problem}${loaded.recovery.movedTo ? `; original kept at ${loaded.recovery.movedTo}` : ''}`]
        : []),
      `Sessions: ${Object.keys(state.sessions).length}; items: ${Object.keys(state.items).length} (${itemCounts(state)}); workstreams: ${Object.keys(state.workstreams).length}`,
      `Events applied (dedupe window): ${state.processedEventIds.length}; journal entries: ${state.journal.length}; transcript cursors: ${Object.keys(state.cursors).length}`,
      `Last saved: ${service.lastSavedAt ?? 'not this run'}${service.lastSaveError ? `; LAST SAVE FAILED: ${service.lastSaveError}` : ''}`,
    ],
  };
}

function itemCounts(state: FocusState): string {
  const counts: Record<string, number> = {};
  for (const item of Object.values(state.items)) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  const order = ['needs-you', 'in-progress', 'waiting', 'uncertain', 'resolved'];
  return order.map((s) => `${s} ${counts[s] ?? 0}`).join(', ');
}

/** What is monitored: scope settings and the projects Focus Center currently holds data for. */
export function scopeSection(scope: MonitoringScope, state: FocusState): DiagnosticsSection {
  const projects = new Map<string, number>();
  for (const s of Object.values(state.sessions)) {
    const key = s.repoRoot ?? s.cwd ?? '(unknown project)';
    projects.set(key, (projects.get(key) ?? 0) + 1);
  }
  return {
    title: 'Monitoring scope',
    lines: [
      `Monitoring: ${scope.paused ? 'PAUSED (nothing is read or recorded)' : 'on'}`,
      `Excluded paths: ${scope.excludedPaths.length ? scope.excludedPaths.join('; ') : 'none'}`,
      `Allow-list: ${scope.includedPaths.length ? scope.includedPaths.join('; ') : 'none (all projects)'}`,
      `Projects with stored data: ${projects.size}`,
      ...[...projects].sort(([a], [b]) => a.localeCompare(b)).map(([p, n]) => `- ${p} (${n} session${n === 1 ? '' : 's'})`),
    ],
  };
}
