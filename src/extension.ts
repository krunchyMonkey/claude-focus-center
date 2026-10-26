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
import { JsonFileStore } from './storage/jsonStore';
import { StateService } from './storage/stateService';
import { FocusTreeProvider } from './ui/focusTreeProvider';
import { registerHookCommands } from './ui/hookCommands';
import { buildSessionNodes, FocusNode } from './ui/nodes';

export const VIEW_ID = 'focusCenter.queue';

/** Surface returned from activate(); used by extension-host tests. */
export interface FocusCenterApi {
  getRootNodes(): FocusNode[];
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
  const ingestion: { totalEvents: number; lastPoll?: PollStats } = { totalEvents: 0 };
  const spoolDir = spoolDirFor(storageDir);
  const hookIngestion: HookIngestion = { totalEvents: 0, byKind: {} };

  /** Single entry point for new events from any source: deduped against everything already applied. */
  const ingest = (events: NormalizedEvent[]): NormalizedEvent[] => {
    let applied: NormalizedEvent[] = [];
    stateService.update((state) => {
      applied = applyEvents(state, events, new Date()).applied;
    });
    return applied;
  };

  const spool = new SpoolWatcher(
    spoolDir,
    new SpoolConsumer(spoolDir),
    (events, stats) => {
      hookIngestion.lastScan = stats;
      for (const e of ingest(events)) {
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
      const poll = await tailer.poll(discovery.sessions);
      ingestion.lastPoll = poll.stats;
      ingestion.totalEvents += ingest(poll.events).length;
      stateService.update((state) => {
        const now = new Date();
        for (const s of discovery.sessions) {
          recordDiscoveredSession(state, s, now);
        }
        state.cursors = tailer.exportCursors(new Set(discovery.sessions.map((s) => s.transcriptPath)));
      });
      tree.setRoots(buildSessionNodes(discovery, new Date()));
      view.message = viewMessage(discovery);
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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('focusCenter.excludedPaths')) {
        void refresh();
      }
    }),
  );

  void refresh();
  void spool.start().catch((err) => output.appendLine(`Hook spool unavailable: ${err instanceof Error ? err.message : String(err)}`));
  return {
    getRootNodes: () => tree.getChildren(),
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
