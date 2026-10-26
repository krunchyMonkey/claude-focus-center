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
import { registerWorkstreamCommands } from './ui/workstreamCommands';
import { buildAttentionNodes, FocusNode, needsYouCount } from './ui/nodes';

export const VIEW_ID = 'focusCenter.queue';

/** Surface returned from activate(); used by extension-host tests. */
export interface FocusCenterApi {
  getRootNodes(): FocusNode[];
  getBadge(): number | undefined;
  getLastDiscovery(): DiscoveryResult | undefined;
  getIngestion(): { totalEvents: number; lastPoll?: PollStats };
  getHookIngestion(): HookIngestion;
  getState(): FocusState;
  /** Writes pending state now. */
  flushState(): Promise<void>;
  statePath: string;
  /** Directory hooks write to; tests drive the real hook script against it. */
  spoolDir: string;
  /** Scans the hook spool now; resolves when done. */
  scanHookSpool(): Promise<void>;
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
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });
  let lastDiscovery: DiscoveryResult | undefined;
  const tailer = new TranscriptTailer({}, stateService.state.cursors);
  const repoRoots = new RepoRootCache();
  const ingestion: { totalEvents: number; lastPoll?: PollStats } = { totalEvents: 0 };
  const spoolDir = spoolDirFor(storageDir);
  const hookIngestion: HookIngestion = { totalEvents: 0, byKind: {} };
  let hookRefreshTimer: NodeJS.Timeout | undefined;

  /** Rebuilds the tree from current state; cheap enough to run after every change. */
  const render = (): void => {
    const now = new Date();
    tree.setRoots(buildAttentionNodes(stateService.state, lastDiscovery, now));
    const count = needsYouCount(stateService.state, now);
    view.badge = count > 0 ? { value: count, tooltip: `${count} item${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} you` } : undefined;
    view.description = count > 0 ? `${count} need${count === 1 ? 's' : ''} you` : undefined;
    view.message = lastDiscovery ? viewMessage(lastDiscovery) : undefined;
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
      const applied = ingest(events);
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
    try {
      const discovery = await discoverSessions({ root: defaultProjectsRoot(), excludedPaths: excludedPaths() });
      lastDiscovery = discovery;
      const roots = new Map<string, string | undefined>();
      for (const s of discovery.sessions) {
        if (s.cwd) {
          roots.set(s.sessionId, await repoRoots.get(s.cwd));
        }
      }
      const poll = await tailer.poll(discovery.sessions);
      ingestion.lastPoll = poll.stats;
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
          ingestionSection(ingestion.totalEvents, ingestion.lastPoll),
          hookSection(spoolDir, spool.watching, hookIngestion, new Date()),
        ],
      });
      output.replace(lines.join('\n') + '\n');
      output.show(true);
      return lines;
    }),
    ...registerHookCommands(context, () => void refresh()),
    ...registerWorkstreamCommands(stateService, () => void refresh()),
    // Transcripts are also re-read periodically, so sessions without hooks still update.
    disposableInterval(() => void refresh(), 60_000),
    { dispose: () => clearTimeout(hookRefreshTimer) },
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('focusCenter.excludedPaths')) {
        void refresh();
      }
    }),
  );

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
  };
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

function excludedPaths(): string[] {
  const configured = vscode.workspace.getConfiguration('focusCenter').get<unknown>('excludedPaths');
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
