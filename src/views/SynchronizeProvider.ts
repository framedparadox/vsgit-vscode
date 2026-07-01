import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { Commit } from "../git/parsers/log";
import { accessibleTreeItem } from "./treeAccessibility";

export type SyncNode =
  | { type: "group"; repo: Repository; direction: "incoming" | "outgoing" }
  | { type: "commit"; repo: Repository; commit: Commit; direction: "incoming" | "outgoing" }
  | { type: "info"; label: string };

/**
 * Synchronize view: incoming (behind upstream) and outgoing (ahead of upstream)
 * changesets for the active repository's current branch.
 */
export class SynchronizeProvider implements vscode.TreeDataProvider<SyncNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SyncNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly subscription: vscode.Disposable;

  private repo: Repository | undefined;
  private incoming: Commit[] = [];
  private outgoing: Commit[] = [];
  private hasUpstream = false;
  private refreshGeneration = 0;

  constructor(private readonly manager: RepositoryManager) {
    this.subscription = manager.onDidChange(() => void this.refresh());
  }

  dispose(): void {
    this.refreshGeneration += 1;
    this.incoming = [];
    this.outgoing = [];
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }

  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const repo = this.manager.getActive();
    let ab: { ahead: number; behind: number } | undefined;
    let incoming: Commit[] = [];
    let outgoing: Commit[] = [];
    if (repo) {
      [ab, incoming, outgoing] = await Promise.all([
        repo.aheadBehind(),
        repo.syncCommits("incoming"),
        repo.syncCommits("outgoing"),
      ]);
    }
    if (generation !== this.refreshGeneration) return;
    this.repo = repo;
    this.hasUpstream = ab !== undefined;
    this.incoming = incoming;
    this.outgoing = outgoing;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: SyncNode): vscode.TreeItem {
    if (node.type === "info") {
      const item = new vscode.TreeItem(node.label);
      item.description = "—";
      return accessibleTreeItem(item, node.label);
    }
    if (node.type === "group") {
      const count =
        node.direction === "incoming" ? this.incoming.length : this.outgoing.length;
      const item = new vscode.TreeItem(
        node.direction === "incoming"
          ? `Incoming (${count})`
          : `Outgoing (${count})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        node.direction === "incoming" ? "arrow-down" : "arrow-up",
      );
      return accessibleTreeItem(
        item,
        `${node.direction}, ${count} commit${count === 1 ? "" : "s"}`,
      );
    }
    const c = node.commit;
    const item = new vscode.TreeItem(c.subject);
    item.description = `${c.shortSha} · ${c.authorName}`;
    item.iconPath = new vscode.ThemeIcon("git-commit");
    item.tooltip = `${c.sha}\n${c.authorName} <${c.authorEmail}>`;
    item.contextValue = "vsgit.syncCommit";
    return accessibleTreeItem(
      item,
      `${c.subject}, ${node.direction}, commit ${c.shortSha}, by ${c.authorName}`,
    );
  }

  getChildren(node?: SyncNode): SyncNode[] {
    if (!this.repo) {
      return [];
    }
    if (!node) {
      if (!this.hasUpstream) {
        return [{ type: "info", label: "No upstream configured for HEAD" }];
      }
      return [
        { type: "group", repo: this.repo, direction: "incoming" },
        { type: "group", repo: this.repo, direction: "outgoing" },
      ];
    }
    if (node.type === "group") {
      const commits = node.direction === "incoming" ? this.incoming : this.outgoing;
      if (commits.length === 0) {
        return [{ type: "info", label: "(none)" }];
      }
      return commits.map(
        (commit) =>
          ({
            type: "commit",
            repo: this.repo!,
            commit,
            direction: node.direction,
          }) as SyncNode,
      );
    }
    return [];
  }
}
