import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { FileChange } from "../git/parsers/status";

export type ConflictNode =
  | { type: "conflictRepo"; repo: Repository }
  | { type: "conflictFile"; repo: Repository; change: FileChange };

/**
 * Conflicts view — shows all files in a conflicted state (merge, rebase,
 * cherry-pick). Automatically updates whenever the repository state changes.
 */
export class ConflictsProvider implements vscode.TreeDataProvider<ConflictNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ConflictNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly manager: RepositoryManager) {
    manager.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(node: ConflictNode): vscode.TreeItem {
    if (node.type === "conflictRepo") {
      const label = node.repo.name;
      const item = new vscode.TreeItem(
        label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("warning");
      item.contextValue = "vsgit.conflictRepo";
      return item;
    }

    const item = new vscode.TreeItem(node.change.path);
    item.description = conflictDescription(node.change);
    item.iconPath = new vscode.ThemeIcon("merge");
    item.contextValue = "vsgit.conflictFile";
    item.command = {
      command: "vsgit.conflict.openMergeEditor",
      title: "Open Merge Editor",
      arguments: [node],
    };
    item.tooltip = node.change.path;
    return item;
  }

  getChildren(node?: ConflictNode): ConflictNode[] {
    if (!node) {
      return this.manager
        .getAll()
        .filter((r) => r.conflictedPaths.length > 0)
        .map((repo) => ({ type: "conflictRepo", repo }));
    }
    if (node.type === "conflictRepo") {
      return node.repo.status.changes
        .filter((c) => c.conflicted)
        .map((change) => ({ type: "conflictFile", repo: node.repo, change }));
    }
    return [];
  }
}

function conflictDescription(change: FileChange): string {
  if (change.indexState && change.worktreeState) {
    return `${change.indexState}/${change.worktreeState}`;
  }
  if (change.indexState) return change.indexState;
  if (change.worktreeState) return change.worktreeState;
  return "conflict";
}
