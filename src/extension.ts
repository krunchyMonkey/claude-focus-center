import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { discoverSessions, DiscoveryResult } from './adapters/claudeSessions/discovery';
import { defaultProjectsRoot } from './adapters/claudeSessions/paths';
import { PollStats, TranscriptTailer } from './adapters/claudeSessions/tailer';
import { defaultSettingsPath, hookStatus, spoolDirFor } from './adapters/claudeHooks/installer';
import { SpoolConsumer } from './adapters/claudeHooks/spool';
import { SpoolWatcher } from './adapters/claudeHooks/spoolWatcher';
import {
  buildDiagnosticsReport,
  discoveryCoverage,
  discoverySection,
  hookCoverage,
  HookIngestion,
  hookSection,
  ingestionSection,
} from './diagnostics/report';
import { registerHookCommands } from './ui/hookCommands';
import { FocusTreeProvider } from './ui/focusTreeProvider';
import { buildSessionNodes, FocusNode } from './ui/nodes';

export const VIEW_ID = 'focusCenter.queue';

/** Surface returned from activate(); used by extension-host tests. */
export interface FocusCenterApi {
  getRootNodes(): FocusNode[];
  getLastDiscovery(): DiscoveryResult | undefined;
  getIngestion(): { totalEvents: number; lastPoll?: PollStats };
  getHookIngestion(): HookIngestion;
  /** Directory hooks write to; tests drive the real hook script against it. */
  spoolDir: string;
  /** Scans the hook spool now; resolves when done. */
  scanHookSpool(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): FocusCenterApi {
  const tree = new FocusTreeProvider();
  const output = vscode.window.createOutputChannel('Focus Center');
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });
  let lastDiscovery: DiscoveryResult | undefined;
  // Cursors and seen-event ids are in memory for now; persistence arrives with the state store (issue 06).
  const tailer = new TranscriptTailer();
  const ingestion: { totalEvents: number; lastPoll?: PollStats } = { totalEvents: 0 };
  const spoolDir = spoolDirFor(context.globalStorageUri.fsPath);
  const hookIngestion: HookIngestion = { totalEvents: 0, byKind: {} };
  const spool = new SpoolWatcher(
    spoolDir,
    new SpoolConsumer(spoolDir),
    (events, stats) => {
      hookIngestion.lastScan = stats;
      for (const e of events) {
        hookIngestion.totalEvents++;
        hookIngestion.byKind[e.kind] = (hookIngestion.byKind[e.kind] ?? 0) + 1;
        if (e.timestamp && (!hookIngestion.lastEventAt || e.timestamp > hookIngestion.lastEventAt)) {
          hookIngestion.lastEventAt = e.timestamp;
        }
      }
    },
    (err) => output.appendLine(`Hook spool scan failed: ${err instanceof Error ? err.message : String(err)}`),
  );
  let running: Promise<void> | undefined;
  let queued: Promise<void> | undefined;

  const discover = async (): Promise<void> => {
    try {
      lastDiscovery = await discoverSessions({ root: defaultProjectsRoot(), excludedPaths: excludedPaths() });
      const poll = await tailer.poll(lastDiscovery.sessions);
      ingestion.totalEvents += poll.events.length;
      ingestion.lastPoll = poll.stats;
      tree.setRoots(buildSessionNodes(lastDiscovery, new Date()));
      view.message = viewMessage(lastDiscovery);
    } catch (err) {
      output.appendLine(`Session discovery failed: ${err instanceof Error ? err.message : String(err)}`);
      view.message = 'Session discovery failed — run Show Diagnostics.';
    }
  };
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
        storagePath: context.globalStorageUri.fsPath,
        generatedAt: new Date(),
        coverage: [discoveryCoverage(lastDiscovery), hookCoverage(hooks, hookIngestion)],
        sections: [
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
    spoolDir,
    scanHookSpool: () => spool.scanNow(),
  };
}

export function deactivate(): void {
  // Everything is disposed via context.subscriptions.
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
