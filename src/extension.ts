import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { discoverSessions, DiscoveryResult } from './adapters/claudeSessions/discovery';
import { defaultProjectsRoot } from './adapters/claudeSessions/paths';
import { PollStats, TranscriptTailer } from './adapters/claudeSessions/tailer';
import { buildDiagnosticsReport, CoverageEntry, discoveryCoverage, discoverySection, ingestionSection } from './diagnostics/report';
import { FocusTreeProvider } from './ui/focusTreeProvider';
import { buildSessionNodes, FocusNode } from './ui/nodes';

export const VIEW_ID = 'focusCenter.queue';

/** Surface returned from activate(); used by extension-host tests. */
export interface FocusCenterApi {
  getRootNodes(): FocusNode[];
  getLastDiscovery(): DiscoveryResult | undefined;
  getIngestion(): { totalEvents: number; lastPoll?: PollStats };
}

export function activate(context: vscode.ExtensionContext): FocusCenterApi {
  const tree = new FocusTreeProvider();
  const output = vscode.window.createOutputChannel('Focus Center');
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });
  let lastDiscovery: DiscoveryResult | undefined;
  // Cursors and seen-event ids are in memory for now; persistence arrives with the state store (issue 06).
  const tailer = new TranscriptTailer();
  const ingestion: { totalEvents: number; lastPoll?: PollStats } = { totalEvents: 0 };
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
    vscode.commands.registerCommand('focusCenter.refresh', refresh),
    vscode.commands.registerCommand('focusCenter.showDiagnostics', () => {
      const lines = buildDiagnosticsReport({
        extensionVersion: String(context.extension.packageJSON.version ?? 'unknown'),
        vscodeVersion: vscode.version,
        platform: `${process.platform} ${process.arch}`,
        nodeVersion: process.version,
        storagePath: context.globalStorageUri.fsPath,
        generatedAt: new Date(),
        coverage: currentCoverage(lastDiscovery),
        sections: [discoverySection(lastDiscovery), ingestionSection(ingestion.totalEvents, ingestion.lastPoll)],
      });
      output.replace(lines.join('\n') + '\n');
      output.show(true);
      return lines;
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('focusCenter.excludedPaths')) {
        void refresh();
      }
    }),
  );

  void refresh();
  return { getRootNodes: () => tree.getChildren(), getLastDiscovery: () => lastDiscovery, getIngestion: () => ingestion };
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

function currentCoverage(discovery: DiscoveryResult | undefined): CoverageEntry[] {
  return [
    discoveryCoverage(discovery),
    { source: 'Claude hooks', state: 'not-implemented', detail: 'optional hooks are not built yet' },
  ];
}
