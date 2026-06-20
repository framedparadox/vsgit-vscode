import * as vscode from "vscode";
import * as path from "node:path";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { FileChange } from "../git/parsers/status";

export type StagingNode =
  | { type: "group"; group: "staged" | "unstaged" | "conflicted" }
  | { type: "file"; group: "staged" | "unstaged" | "conflicted"; repo: Repository; change: FileChange }
  | { type: "info"; label: string };

/**
 * Staging view: two top-level groups (Staged / Unstaged Changes) listing the
 * files in the active repository. Mirrors VsGit's Staging view layout. The
 * "active" repository is the first discovered repo (multi-repo selection comes
 * in a later phase).
 */
export class StagingProvider implements vscode.TreeDataProvider<StagingNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    StagingNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly manager: RepositoryManager) {
    this.subscription = manager.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }

  get activeRepo(): Repository | undefined {
    return this.manager.getAll()[0];
  }

  getTreeItem(node: StagingNode): vscode.TreeItem {
    if (node.type === "group") {
      let label: string;
      let contextValue: string;
      let icon: string;
      
      if (node.group === "conflicted") {
        label = "Conflicted Files";
        contextValue = "vsgit.conflictedGroup";
        icon = "warning";
      } else if (node.group === "staged") {
        label = "Staged Changes";
        contextValue = "vsgit.stagedGroup";
        icon = "check-all";
      } else {
        label = "Unstaged Changes";
        contextValue = "vsgit.unstagedGroup";
        icon = "list-unordered";
      }
      
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = contextValue;
      item.iconPath = new vscode.ThemeIcon(icon);
      return item;
    }
    if (node.type === "info") {
      const item = new vscode.TreeItem(node.label);
      item.description = "—";
      return item;
    }

    const change = node.change;
    const item = new vscode.TreeItem(path.basename(change.path));
    item.description = path.dirname(change.path) === "." ? "" : path.dirname(change.path);
    item.resourceUri = vscode.Uri.file(path.join(node.repo.root, change.path));
    // Use the language-specific file icon from the active icon theme (e.g. a
    // TypeScript glyph for *.ts). The git status is conveyed separately via the
    // colored letter badge from VsgitFileDecorationProvider, matching VS Code's
    // built-in SCM view.
    item.iconPath = vscode.ThemeIcon.File;

    // Context value based on group and conflict status.
    if (node.group === "conflicted" || change.conflicted) {
      item.contextValue = "vsgit.conflictedFile";
      item.tooltip = `${change.path} — CONFLICTED`;
    } else if (node.group === "staged") {
      item.contextValue = "vsgit.stagedFile";
      item.tooltip = `${change.path} — ${describeState(change, node.group)}`;
    } else {
      item.contextValue = "vsgit.unstagedFile";
      item.tooltip = `${change.path} — ${describeState(change, node.group)}`;
    }
    
    // Click opens a diff.
    item.command = {
      command: "vsgit.staging.openDiff",
      title: "Open Diff",
      arguments: [node],
    };
    return item;
  }

  getChildren(node?: StagingNode): StagingNode[] {
    const repo = this.activeRepo;
    if (!node) {
      if (!repo) {
        return [];
      }
      const groups: StagingNode[] = [];
      
      // Show conflicted files group first if there are any
      const conflicted = [...repo.stagedChanges, ...repo.unstagedChanges].filter(c => c.conflicted);
      if (conflicted.length > 0) {
        groups.push({ type: "group", group: "conflicted" });
      }
      
      groups.push({ type: "group", group: "staged" });
      groups.push({ type: "group", group: "unstaged" });
      return groups;
    }
    if (node.type !== "group" || !repo) {
      return [];
    }
    
    let changes: FileChange[];
    if (node.group === "conflicted") {
      changes = [...repo.stagedChanges, ...repo.unstagedChanges].filter(c => c.conflicted);
    } else if (node.group === "staged") {
      changes = repo.stagedChanges.filter(c => !c.conflicted);
    } else {
      changes = repo.unstagedChanges.filter(c => !c.conflicted);
    }
    
    if (changes.length === 0) {
      return [{ type: "info", label: "(no changes)" }];
    }
    return changes.map(
      (change) =>
        ({ type: "file", group: node.group, repo, change }) as StagingNode,
    );
  }
}

function describeState(change: FileChange, group: "staged" | "unstaged"): string {
  if (change.conflicted) {
    return "conflicted";
  }
  return (group === "staged" ? change.indexState : change.worktreeState) ?? "modified";
}
