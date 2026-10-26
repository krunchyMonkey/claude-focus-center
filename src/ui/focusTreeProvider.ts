import * as vscode from 'vscode';

/** A node in the Focus Center tree. Status groups and items arrive in later issues. */
export interface FocusNode {
  id: string;
  label: string;
  children?: FocusNode[];
}

export class FocusTreeProvider implements vscode.TreeDataProvider<FocusNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<FocusNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private roots: FocusNode[] = [];

  setRoots(roots: FocusNode[]): void {
    this.roots = roots;
    this.refresh();
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: FocusNode): vscode.TreeItem {
    const state = node.children?.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, state);
    item.id = node.id;
    return item;
  }

  getChildren(node?: FocusNode): FocusNode[] {
    return node ? (node.children ?? []) : this.roots;
  }

  dispose(): void {
    this.changed.dispose();
  }
}
