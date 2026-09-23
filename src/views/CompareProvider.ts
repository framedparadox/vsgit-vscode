import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { Commit, CommitFile } from "../git/parsers/log";
import { accessibleTreeItem } from "./treeAccessibility";

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
  // undefined = not loaded yet; [] = loaded and genuinely empty. Using length
  // as the "not fetched" sentinel would refetch empty sections on every render.
  private cachedLeftCommits: Commit[] | undefined;
  private cachedRightCommits: Commit[] | undefined;
  private cachedFiles: CommitFile[] | undefined;
  /** Resolved merge-base SHA backing the three-dot file list and its diffs. */
  private cachedMergeBase: string | undefined;
  /** Bumped on every cache invalidation so in-flight fetches cannot clobber a newer comparison. */
  private loadGeneration = 0;

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
    if (!this.currentComparison) {
      return; // nothing displayed — skip the cache flush and tree re-render
    }
    this.invalidateCaches();
    this._onDidChangeTreeData.fire(undefined);
  }

  async startComparison(repo: Repository, ref1: string, ref2: string) {
    this.currentComparison = { repo, ref1, ref2 };
    this.invalidateCaches();
    this._onDidChangeTreeData.fire(undefined);
  }

  clearComparison() {
    this.currentComparison = undefined;
    this.invalidateCaches();
    this._onDidChangeTreeData.fire(undefined);
  }

  private invalidateCaches(): void {
    this.loadGeneration += 1;
    this.cachedLeftCommits = undefined;
    this.cachedRightCommits = undefined;
    this.cachedFiles = undefined;
    this.cachedMergeBase = undefined;
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
      return accessibleTreeItem(
        item,
        `Comparing ${node.ref1} with ${node.ref2}, repository ${node.repo.name}`,
      );
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
      return accessibleTreeItem(item, `${node.label}, comparison section`);
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
      return accessibleTreeItem(
        item,
        `${c.subject || "No message"}, commit ${c.sha.slice(0, 8)}, by ${c.authorName}`,
      );
    }

    // file node
    const f = node.file;
    const item = new vscode.TreeItem(path.basename(f.path));
    const dir = path.dirname(f.path);
    item.description = f.origPath
      ? `${f.origPath} → ${dir === "." ? "./" : dir}`
      : dir === "."
        ? ""
        : dir;
    item.tooltip = f.origPath ? `${f.origPath} → ${f.path}` : f.path;
    item.iconPath = new vscode.ThemeIcon(fileStatusIcon(f.status));
    item.contextValue = "vsgit.comparison.file";
    item.command = {
      command: "vsgit.compare.openDiff",
      title: "Open Diff",
      arguments: [node.repo, f.path, node.ref1, node.ref2, f.origPath],
    };
    return accessibleTreeItem(
      item,
      f.origPath
        ? `${f.origPath} renamed to ${f.path}`
        : `${f.path}, changed file`,
    );
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
          label: `Changed Files in ${node.ref2} (vs merge base)`,
          repo: node.repo,
          ref1: node.ref1,
          ref2: node.ref2,
          section: "files",
        },
      ];
    }

    if (node.type === "section") {
      const gen = this.loadGeneration;
      if (node.section === "left") {
        // Commits in ref1 but not in ref2: ref2..ref1
        if (this.cachedLeftCommits === undefined) {
          try {
            const commits = await node.repo.log({
              revRange: `${node.ref2}..${node.ref1}`,
              limit: 100,
            });
            if (gen !== this.loadGeneration) {
              return [];
            }
            this.cachedLeftCommits = commits;
          } catch (e) {
            if (gen !== this.loadGeneration) {
              return [];
            }
            this.cachedLeftCommits = [];
            vscode.window.showErrorMessage(
              `Could not load commits unique to ${node.ref1}: ${e instanceof Error ? e.message : String(e)}`,
            );
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
        if (this.cachedRightCommits === undefined) {
          try {
            const commits = await node.repo.log({
              revRange: `${node.ref1}..${node.ref2}`,
              limit: 100,
            });
            if (gen !== this.loadGeneration) {
              return [];
            }
            this.cachedRightCommits = commits;
          } catch (e) {
            if (gen !== this.loadGeneration) {
              return [];
            }
            this.cachedRightCommits = [];
            vscode.window.showErrorMessage(
              `Could not load commits unique to ${node.ref2}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        return this.cachedRightCommits.map((commit) => ({
          type: "commit",
          commit,
          repo: node.repo,
          side: "right",
        }));
      }

      // Files section: three-dot (merge-base) diff, GitHub-PR style — what
      // ref2 changes relative to the common ancestor, so changes that only
      // happened on the ref1 side don't show up as noise. "Switch Sides"
      // flips the perspective.
      if (this.cachedFiles === undefined) {
        try {
          // Diff from the resolved SHA (not `ref1...ref2`) so the list and the
          // per-file diffs share one base, and unrelated histories — where a
          // three-dot range errors with "no merge base" — degrade to two-dot.
          const mergeBase = await node.repo.mergeBase(node.ref1, node.ref2);
          const files = await node.repo.diffFiles(mergeBase ?? node.ref1, node.ref2);
          if (gen !== this.loadGeneration) {
            return [];
          }
          this.cachedMergeBase = mergeBase;
          this.cachedFiles = files;
        } catch (e) {
          if (gen !== this.loadGeneration) {
            return [];
          }
          this.cachedFiles = [];
          vscode.window.showErrorMessage(
            `Could not load changed files: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      // Per-file diffs open against the same merge base the list was built
      // from; fall back to plain ref1 when the histories are unrelated.
      const diffBase = this.cachedMergeBase ?? node.ref1;
      return this.cachedFiles.map((file) => ({
        type: "file",
        file,
        repo: node.repo,
        ref1: diffBase,
        ref2: node.ref2,
      }));
    }

    return [];
  }
}

/** Codicon id for a git name-status letter (A/M/D/R/C/U). */
export function fileStatusIcon(status: string): string {
  switch (status.toUpperCase()) {
    case "A": return "diff-added";
    case "C": return "diff-added";
    case "D": return "diff-removed";
    case "M": return "diff-modified";
    case "R": return "diff-renamed";
    case "U": return "warning";
    default:  return "circle-outline";
  }
}
