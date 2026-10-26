import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { defaultSettingsPath, hookStatus, spoolDirFor } from './adapters/claudeHooks/installer';
import { SpoolConsumer } from './adapters/claudeHooks/spool';
import { SpoolWatcher } from './adapters/claudeHooks/spoolWatcher';
import { discoverSessions, DiscoveryResult } from './adapters/claudeSessions/discovery';
import { defaultProjectsRoot } from './adapters/claudeSessions/paths';
import { PollStats, TranscriptTailer } from './adapters/claudeSessions/tailer';
import {
  buildDiagnosticsReport,
  discoveryCoverage,
  discoverySection,
  hookCoverage,
  HookIngestion,
  hookSection,
  ingestionSection,
  scopeSection,
  stateSection,
} from './diagnostics/report';
import type { NormalizedEvent } from './domain/events/types';
import { applyEvents, recordDiscoveredSession } from './domain/state/reducer';
import type { FocusState } from './domain/state/types';
import { RepoRootCache } from './adapters/git/repoRoot';
import { regroup } from './domain/workstreams/group';
import { JsonFileStore } from './storage/jsonStore';
import { StateService } from './storage/stateService';
import { FocusTreeProvider } from './ui/focusTreeProvider';
import { registerHookCommands } from './ui/hookCommands';
import { DETAILS_SCHEME, DetailsProvider, registerSessionCommands } from './ui/sessionCommands';
import { promises as fs } from 'node:fs';
import { installedScriptPath } from './adapters/claudeHooks/installer';
import { purgeOutOfScope } from './domain/privacy/purge';
import { inScope, MonitoringScope, SCOPE_FILE } from './hook/scope';
import { registerPrivacyCommands } from './ui/privacyCommands';
import { registerRecapCommands } from './ui/recapCommands';
import { registerTriageCommands } from './ui/triageCommands';
import { registerWorkstreamCommands } from './ui/workstreamCommands';
import { nextSnoozeExpiry } from './domain/attention/triage';
import { buildAttentionNodes, FocusNode, needsYouCount } from './ui/nodes';

export const VIEW_ID = 'focusCenter.queue';

/** Surface returned from activate(); used by extension-host tests. */
export interface FocusCenterApi {
  getRootNodes(): FocusNode[];
  getBadge(): number | undefined;
  getLastDiscovery(): DiscoveryResult | undefined;
  getIngestion(): { totalEvents: number; totalInvalidLines: number; lastPoll?: PollStats };
  getHookIngestion(): HookIngestion;
  getState(): FocusState;
  /** Writes pending state now. */
  flushState(): Promise<void>;
  statePath: string;
  /** Directory hooks write to; tests drive the real hook script against it. */
  spoolDir: string;
  /** Scans the hook spool now; resolves when done. */
  scanHookSpool(): Promise<void>;
  refresh(): Promise<void>;
}

let activeState: StateService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<FocusCenterApi> {
  const storageDir = context.globalStorageUri.fsPath;
  const output = vscode.window.createOutputChannel('Focus Center');
  const store = new JsonFileStore(path.join(storageDir, 'state.json'));
  const stateService = await StateService.open(store);
  activeState = stateService;
  if (stateService.loaded.recovery) {
    const { problem, movedTo } = stateService.loaded.recovery;
    output.appendLine(`State recovered from ${stateService.loaded.source}: ${problem}${movedTo ? ` (original kept at ${movedTo})` : ''}`);
    void vscode.window.showWarningMessage('Focus Center could not read its saved state and recovered what it could. Run "Show Diagnostics" for details.');
  }

  const tree = new FocusTreeProvider();
  const details = new DetailsProvider(stateService);
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });
  let lastDiscovery: DiscoveryResult | undefined;
  const tailer = new TranscriptTailer({}, stateService.state.cursors);
  const repoRoots = new RepoRootCache();
  const ingestion: { totalEvents: number; totalInvalidLines: number; lastPoll?: PollStats } = { totalEvents: 0, totalInvalidLines: 0 };
  const spoolDir = spoolDirFor(storageDir);
  const hookIngestion: HookIngestion = { totalEvents: 0, byKind: {}, outOfScope: 0 };
  let hookRefreshTimer: NodeJS.Timeout | undefined;
  let snoozeTimer: NodeJS.Timeout | undefined;

  /** Rebuilds the tree from current state; cheap enough to run after every change. */
  const render = (): void => {
    const now = new Date();
    tree.setRoots(buildAttentionNodes(stateService.state, lastDiscovery, now));
    details.refresh();
    const count = needsYouCount(stateService.state, now);
    view.badge = count > 0 ? { value: count, tooltip: `${count} item${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} you` } : undefined;
    view.description = count > 0 ? `${count} need${count === 1 ? 's' : ''} you` : undefined;
    view.message = currentScope().paused
      ? 'Monitoring is paused. Run "Focus Center: Resume Monitoring" to continue.'
      : lastDiscovery ? viewMessage(lastDiscovery) : undefined;
    // Re-render exactly when the next snooze ends, so the item returns without a refresh.
    clearTimeout(snoozeTimer);
    const expiry = nextSnoozeExpiry(stateService.state, now);
    if (expiry) {
      snoozeTimer = setTimeout(render, Math.min(Math.max(expiry.getTime() - Date.now() + 50, 50), 2 ** 31 - 1));
    }
  };

  /** Single entry point for new events from any source: deduped against everything already applied. */
  const ingest = (events: NormalizedEvent[]): NormalizedEvent[] => {
    let applied: NormalizedEvent[] = [];
    stateService.update((state) => {
      applied = applyEvents(state, events, new Date()).applied;
      if (applied.length > 0) {
        regroup(state);
      }
    });
    return applied;
  };

  const spool = new SpoolWatcher(
    spoolDir,
    new SpoolConsumer(spoolDir),
    (events, stats) => {
      hookIngestion.lastScan = stats;
      // Defense in depth: the hook already skips out-of-scope projects, but the spool is untrusted.
      const scope = currentScope();
      const allowed = events.filter((e) => inScope(e.cwd ?? stateService.state.sessions[e.sessionId]?.cwd, scope));
      hookIngestion.outOfScope += events.length - allowed.length;
      const applied = ingest(allowed);
      if (applied.length > 0) {
        render();
      }
      if (applied.length > 0) {
        // Hooks are a cue that transcripts changed too: re-read soon so answers resolve items.
        clearTimeout(hookRefreshTimer);
        hookRefreshTimer = setTimeout(() => void refresh(), 1500);
      }
      for (const e of applied) {
        hookIngestion.totalEvents++;
        hookIngestion.byKind[e.kind] = (hookIngestion.byKind[e.kind] ?? 0) + 1;
        if (e.timestamp && (!hookIngestion.lastEventAt || e.timestamp > hookIngestion.lastEventAt)) {
          hookIngestion.lastEventAt = e.timestamp;
        }
      }
    },
    (err) => output.appendLine(`Hook spool scan failed: ${err instanceof Error ? err.message : String(err)}`),
  );

  const discover = async (): Promise<void> => {
    const scope = currentScope();
    if (scope.paused) {
      render();
      return; // Nothing is read while paused.
    }
    try {
      const discovery = await discoverSessions({ root: defaultProjectsRoot(), excludedPaths: scope.excludedPaths, includedPaths: scope.includedPaths });
      lastDiscovery = discovery;
      const roots = new Map<string, string | undefined>();
      for (const s of discovery.sessions) {
        if (s.cwd) {
          roots.set(s.sessionId, await repoRoots.get(s.cwd));
        }
      }
      const poll = await tailer.poll(discovery.sessions);
      ingestion.lastPoll = poll.stats;
      ingestion.totalInvalidLines += poll.stats.invalidLines + poll.stats.oversizedLines;
      ingestion.totalEvents += ingest(poll.events).length;
      stateService.update((state) => {
        const now = new Date();
        for (const s of discovery.sessions) {
          recordDiscoveredSession(state, s, now);
          const root = roots.get(s.sessionId);
          if (root) {
            state.sessions[s.sessionId].repoRoot = root;
          }
        }
        state.cursors = tailer.exportCursors(new Set(discovery.sessions.map((s) => s.transcriptPath)));
        // Forget anything stored earlier for projects that are now out of scope.
        purgeOutOfScope(state, scope);
        regroup(state);
      });
      render();
    } catch (err) {
      output.appendLine(`Session discovery failed: ${err instanceof Error ? err.message : String(err)}`);
      view.message = 'Session discovery failed — run Show Diagnostics.';
    }
  };
  let running: Promise<void> | undefined;
  let queued: Promise<void> | undefined;
  // At most one run at a time; requests made meanwhile share a single follow-up run,
  // so a burst of triggers reads the disk at most twice and never returns stale settings.
  const refresh = (): Promise<void> => {
    if (!running) {
      running = discover().finally(() => (running = undefined));
      return running;
    }
    queued ??= running.then(() => {
      queued = undefined;
      return refresh();
    });
    return queued;
  };

  context.subscriptions.push(
    tree,
    output,
    view,
    spool,
    vscode.commands.registerCommand('focusCenter.refresh', refresh),
    vscode.commands.registerCommand('focusCenter.showDiagnostics', async () => {
      const hooks = await hookStatus(defaultSettingsPath());
      const lines = buildDiagnosticsReport({
        extensionVersion: String(context.extension.packageJSON.version ?? 'unknown'),
        vscodeVersion: vscode.version,
        platform: `${process.platform} ${process.arch}`,
        nodeVersion: process.version,
        storagePath: storageDir,
        generatedAt: new Date(),
        coverage: [discoveryCoverage(lastDiscovery), hookCoverage(hooks, hookIngestion)],
        sections: [
          stateSection(store.path, stateService),
          discoverySection(lastDiscovery),
          ingestionSection(ingestion.totalEvents, ingestion.lastPoll, ingestion.totalInvalidLines),
          hookSection(spoolDir, spool.watching, hookIngestion, new Date()),
          scopeSection(currentScope(), stateService.state),
        ],
      });
      output.replace(lines.join('\n') + '\n');
      output.show(true);
      return lines;
    }),
    ...registerHookCommands(context, () => void refresh()),
    ...registerWorkstreamCommands(stateService, () => void refresh()),
    details,
    vscode.workspace.registerTextDocumentContentProvider(DETAILS_SCHEME, details),
    ...registerSessionCommands(stateService),
    ...registerTriageCommands(stateService, () => render()),
    ...registerRecapCommands(stateService, details, () => render()),
    { dispose: () => clearTimeout(snoozeTimer) },
    // Transcripts are also re-read periodically, so sessions without hooks still update.
    disposableInterval(() => void refresh(), 60_000),
    { dispose: () => clearTimeout(hookRefreshTimer) },
    ...registerPrivacyCommands(stateService, {
      storageDir,
      hooksInstalled: async () => (await hookStatus(defaultSettingsPath())).events.length > 0,
      afterDelete: () => {
        tailer.reset();
        render();
      },
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (['excludedPaths', 'includedPaths', 'paused'].some((k) => e.affectsConfiguration(`focusCenter.${k}`))) {
        await writeScopeFile();
        void vscode.commands.executeCommand('setContext', 'focusCenter.paused', currentScope().paused);
        void refresh();
      }
    }),
  );

  await writeScopeFile();
  void vscode.commands.executeCommand('setContext', 'focusCenter.paused', currentScope().paused);
  render();
  void refresh();
  void spool.start().catch((err) => output.appendLine(`Hook spool unavailable: ${err instanceof Error ? err.message : String(err)}`));
  return {
    getRootNodes: () => tree.getChildren(),
    getBadge: () => view.badge?.value,
    getLastDiscovery: () => lastDiscovery,
    getIngestion: () => ingestion,
    getHookIngestion: () => hookIngestion,
    getState: () => stateService.state,
    flushState: () => stateService.flush(),
    statePath: store.path,
    spoolDir,
    scanHookSpool: () => spool.scanNow(),
    refresh,
  };

  /** Shares the scope with the hook script, which reads it before writing any event. */
  async function writeScopeFile(): Promise<void> {
    const file = path.join(path.dirname(installedScriptPath(storageDir)), SCOPE_FILE);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(currentScope()));
      await fs.rename(tmp, file);
    } catch (err) {
      output.appendLine(`Could not write the monitoring scope for hooks: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function deactivate(): Promise<void> {
  // Subscriptions are disposed by VS Code; pending state must still reach disk.
  await activeState?.flush();
  activeState = undefined;
}

function disposableInterval(fn: () => void, ms: number): vscode.Disposable {
  const handle = setInterval(fn, ms);
  return { dispose: () => clearInterval(handle) };
}

function currentScope(): MonitoringScope {
  const config = vscode.workspace.getConfiguration('focusCenter');
  return { excludedPaths: pathList('excludedPaths'), includedPaths: pathList('includedPaths'), paused: config.get<unknown>('paused') === true };
}

function pathList(key: 'excludedPaths' | 'includedPaths'): string[] {
  const configured = vscode.workspace.getConfiguration('focusCenter').get<unknown>(key);
  if (!Array.isArray(configured)) {
    return [];
  }
  return configured
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => (p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p));
}

function viewMessage(result: DiscoveryResult): string | undefined {
  if (!result.rootFound) {
    return 'Claude session folder not found — run Show Diagnostics.';
  }
  const unreadable = result.issues.filter((i) => i.code.endsWith('-unreadable')).length;
  return unreadable > 0 ? `Partial coverage: ${unreadable} unreadable path(s) — run Show Diagnostics.` : undefined;
}
