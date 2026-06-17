import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { Commit, CommitFile } from "../git/parsers/log";

export type CompareTreeNode =
  | { type: "comparison"; repo: Repository; ref1: string; ref2: string }
  | { type: "section"; label: string; repo: Repository; ref1: string; ref2: string; section: "left" | "right" | "files" }
  | { type: "commit"; commit: Commit; repo: Repository; side: "left" | "right" }
  | { type: "file"; file: CommitFile; repo: Repository; ref1: string; ref2: string };

interface ComparisonState {
  repo: Repository;
  ref1: string;
  ref2: string;
}

export class CompareProvider implements vscode.TreeDataProvider<CompareTreeNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<CompareTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly subscription: vscode.Disposable;

  private currentComparison: ComparisonState | undefined;
  private cachedLeftCommits: Commit[] = [];
  private cachedRightCommits: Commit[] = [];
  private cachedFiles: CommitFile[] = [];

  constructor(manager: RepositoryManager) {
    this.subscription = manager.onDidChange(() => {
      this.refresh();
    });
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }

  refresh() {
    this.cachedLeftCommits = [];
    this.cachedRightCommits = [];
    this.cachedFiles = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  async startComparison(repo: Repository, ref1: string, ref2: string) {
    this.currentComparison = { repo, ref1, ref2 };
    this.cachedLeftCommits = [];
    this.cachedRightCommits = [];
    this.cachedFiles = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  clearComparison() {
    this.currentComparison = undefined;
    this.cachedLeftCommits = [];
    this.cachedRightCommits = [];
    this.cachedFiles = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  getCurrentComparison(): ComparisonState | undefined {
    return this.currentComparison;
  }

  getTreeItem(node: CompareTreeNode): vscode.TreeItem {
    if (node.type === "comparison") {
      const item = new vscode.TreeItem(
        `${node.ref1} ↔ ${node.ref2}`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("git-compare");
      item.description = node.repo.name;
      item.contextValue = "vsgit.comparison";
      return item;
    }

    if (node.type === "section") {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      if (node.section === "left") {
        item.iconPath = new vscode.ThemeIcon("arrow-left");
        item.contextValue = "vsgit.comparison.section.left";
      } else if (node.section === "right") {
        item.iconPath = new vscode.ThemeIcon("arrow-right");
        item.contextValue = "vsgit.comparison.section.right";
      } else {
        item.iconPath = new vscode.ThemeIcon("files");
        item.contextValue = "vsgit.comparison.section.files";
      }
      return item;
    }

    if (node.type === "commit") {
      const c = node.commit;
      const item = new vscode.TreeItem(c.subject || "(no message)");
      item.description = `${c.sha.slice(0, 8)} • ${c.authorName}`;
      item.tooltip = `${c.sha}\n${c.authorName} • ${new Date(c.authorDate * 1000).toLocaleString()}\n\n${c.subject}`;
      item.iconPath = new vscode.ThemeIcon("git-commit");
      item.contextValue = "vsgit.comparison.commit";
      item.command = {
        command: "vsgit.showCommitDetails",
        title: "Show Commit",
        arguments: [node.repo, c.sha],
      };
      return item;
    }

    // file node
    const f = node.file;
    const item = new vscode.TreeItem(path.basename(f.path));
    item.description = path.dirname(f.path);
    item.tooltip = f.path;
    item.iconPath = vscode.ThemeIcon.File;
    item.contextValue = "vsgit.comparison.file";
    item.command = {
      command: "vsgit.compare.openDiff",
      title: "Open Diff",
      arguments: [node.repo, f.path, node.ref1, node.ref2],
    };
    return item;
  }

  async getChildren(node?: CompareTreeNode): Promise<CompareTreeNode[]> {
    if (!this.currentComparison) {
      return [];
    }

    if (!node) {
      // Root: show the comparison header
      return [
        {
          type: "comparison",
          repo: this.currentComparison.repo,
          ref1: this.currentComparison.ref1,
          ref2: this.currentComparison.ref2,
        },
      ];
    }

    if (node.type === "comparison") {
      // Show three sections: commits unique to ref1, commits unique to ref2, changed files
      return [
        {
          type: "section",
          label: `← Only in ${node.ref1}`,
          repo: node.repo,
          ref1: node.ref1,
          ref2: node.ref2,
          section: "left",
        },
        {
          type: "section",
          label: `Only in ${node.ref2} →`,
          repo: node.repo,
          ref1: node.ref1,
          ref2: node.ref2,
          section: "right",
        },
        {
          type: "section",
          label: "Changed Files",
          repo: node.repo,
          ref1: node.ref1,
          ref2: node.ref2,
          section: "files",
        },
      ];
    }

    if (node.type === "section") {
      if (node.section === "left") {
        // Commits in ref1 but not in ref2: ref2..ref1
        if (this.cachedLeftCommits.length === 0) {
          try {
            this.cachedLeftCommits = await node.repo.log({
              revRange: `${node.ref2}..${node.ref1}`,
              limit: 100,
            });
          } catch {
            this.cachedLeftCommits = [];
          }
        }
        return this.cachedLeftCommits.map((commit) => ({
          type: "commit",
          commit,
          repo: node.repo,
          side: "left",
        }));
      }

      if (node.section === "right") {
        // Commits in ref2 but not in ref1: ref1..ref2
        if (this.cachedRightCommits.length === 0) {
          try {
            this.cachedRightCommits = await node.repo.log({
              revRange: `${node.ref1}..${node.ref2}`,
              limit: 100,
            });
          } catch {
            this.cachedRightCommits = [];
          }
        }
        return this.cachedRightCommits.map((commit) => ({
          type: "commit",
          commit,
          repo: node.repo,
          side: "right",
        }));
      }

      // files section
      if (this.cachedFiles.length === 0) {
        try {
          this.cachedFiles = await node.repo.diffFiles(node.ref1, node.ref2);
        } catch {
          this.cachedFiles = [];
        }
      }
      return this.cachedFiles.map((file) => ({
        type: "file",
        file,
        repo: node.repo,
        ref1: node.ref1,
        ref2: node.ref2,
      }));
    }

    return [];
  }
}
