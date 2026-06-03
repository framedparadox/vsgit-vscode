import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository, WorktreeInfo } from "../git/Repository";

export type WorktreeTreeNode =
  | { type: "repoWorktrees"; repo: Repository }
  | { type: "worktree"; info: WorktreeInfo; repo: Repository; manager: RepositoryManager };

export class WorktreesProvider implements vscode.TreeDataProvider<WorktreeTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WorktreeTreeNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private worktreeCache = new Map<string, WorktreeInfo[]>();

  constructor(private readonly manager: RepositoryManager) {
    manager.onDidChange(() => {
      this.worktreeCache.clear();
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  getTreeItem(node: WorktreeTreeNode): vscode.TreeItem {
    if (node.type === "repoWorktrees") {
      const item = new vscode.TreeItem(
        node.repo.name,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("repo");
      item.description = node.repo.root;
      item.contextValue = "vsgit.worktreeRepo";
      return item;
    }

    // worktree node
    const wt = node.info;
    const isMain = wt.path === node.repo.root;
    const label = isMain
      ? `${path.basename(wt.path)} (main)`
      : path.basename(wt.path);
    const item = new vscode.TreeItem(label);
    item.description = wt.branch ?? wt.head.slice(0, 8);
    item.tooltip = wt.path;
    item.iconPath = new vscode.ThemeIcon(isMain ? "repo" : "git-branch");
    item.contextValue = isMain ? "vsgit.worktree.main" : "vsgit.worktree";
    if (!isMain) {
      item.command = {
        command: "vsgit.worktree.openHere",
        title: "Open Worktree",
        arguments: [node],
      };
    }
    return item;
  }

  async getChildren(node?: WorktreeTreeNode): Promise<WorktreeTreeNode[]> {
    if (!node) {
      // Root: one node per repo
      return this.manager.getAll().map((repo) => ({
        type: "repoWorktrees",
        repo,
      }));
    }
    if (node.type === "repoWorktrees") {
      let wts = this.worktreeCache.get(node.repo.root);
      if (!wts) {
        try {
          wts = await node.repo.worktreeList();
          this.worktreeCache.set(node.repo.root, wts);
        } catch {
          wts = [];
        }
      }
      return wts.map((info) => ({
        type: "worktree",
        info,
        repo: node.repo,
        manager: this.manager,
      }));
    }
    return [];
  }
}
