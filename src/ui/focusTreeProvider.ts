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
      ? node.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, state);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip && node.tooltipIsMarkdown ? new vscode.MarkdownString(node.tooltip) : node.tooltip;
    item.contextValue = node.contextValue;
    if (node.commandId) {
      item.command = { command: node.commandId, title: 'Show Details', arguments: [node] };
    }
    item.accessibilityInformation = { label: node.ariaLabel ?? [node.label, node.description].filter(Boolean).join(', ') };
    if (node.icon) {
      item.iconPath = new vscode.ThemeIcon(node.icon, node.iconColor ? new vscode.ThemeColor(node.iconColor) : undefined);
    }
    return item;
  }

  getChildren(node?: FocusNode): FocusNode[] {
    return node ? (node.children ?? []) : this.roots;
  }

  /** Needed for TreeView.reveal. */
  getParent(node: FocusNode): FocusNode | undefined {
    const find = (nodes: FocusNode[], parent?: FocusNode): FocusNode | undefined => {
      for (const n of nodes) {
        if (n.id === node.id) {
          return parent;
        }
        const hit = n.children ? find(n.children, n) : undefined;
        if (hit) {
          return hit;
        }
      }
      return undefined;
    };
    return find(this.roots);
  }

  dispose(): void {
    this.changed.dispose();
  }
}
