import * as vscode from 'vscode';
import { buildDiagnosticsReport, CoverageEntry } from './diagnostics/report';
import { FocusNode, FocusTreeProvider } from './ui/focusTreeProvider';

export const VIEW_ID = 'focusCenter.queue';

/** Surface returned from activate(); used by extension-host tests. */
export interface FocusCenterApi {
  getRootNodes(): FocusNode[];
}

export function activate(context: vscode.ExtensionContext): FocusCenterApi {
  const tree = new FocusTreeProvider();
  const output = vscode.window.createOutputChannel('Focus Center');

  context.subscriptions.push(
    tree,
    output,
    vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true }),
    vscode.commands.registerCommand('focusCenter.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('focusCenter.showDiagnostics', () => {
      const lines = buildDiagnosticsReport({
        extensionVersion: String(context.extension.packageJSON.version ?? 'unknown'),
        vscodeVersion: vscode.version,
        platform: `${process.platform} ${process.arch}`,
        nodeVersion: process.version,
        storagePath: context.globalStorageUri.fsPath,
        generatedAt: new Date(),
        coverage: currentCoverage(),
      });
      output.replace(lines.join('\n') + '\n');
      output.show(true);
      return lines;
    }),
  );

  return { getRootNodes: () => tree.getChildren() };
}

export function deactivate(): void {
  // Everything is disposed via context.subscriptions.
}

function currentCoverage(): CoverageEntry[] {
  return [
    { source: 'Claude session files', state: 'not-implemented', detail: 'session discovery is not built yet' },
    { source: 'Claude hooks', state: 'not-implemented', detail: 'optional hooks are not built yet' },
  ];
}
