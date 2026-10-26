import * as vscode from 'vscode';
import type { FocusNode } from './nodes';

export class FocusTreeProvider implements vscode.TreeDataProvider<FocusNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<FocusNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private roots: FocusNode[] = [];

  setRoots(roots: FocusNode[]): void {
    this.roots = roots;
    this.changed.fire(undefined);
  }

  getTreeItem(node: FocusNode): vscode.TreeItem {
    const state = node.children?.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, state);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    if (node.icon) {
      item.iconPath = new vscode.ThemeIcon(node.icon);
    }
    return item;
  }

  getChildren(node?: FocusNode): FocusNode[] {
    return node ? (node.children ?? []) : this.roots;
  }

  dispose(): void {
    this.changed.dispose();
  }
}
