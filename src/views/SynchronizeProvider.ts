import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { Commit } from "../git/parsers/log";

export type SyncNode =
  | { type: "group"; repo: Repository; direction: "incoming" | "outgoing" }
  | { type: "commit"; repo: Repository; commit: Commit; direction: "incoming" | "outgoing" }
  | { type: "info"; label: string };

/**
 * Synchronize view: incoming (behind upstream) and outgoing (ahead of upstream)
 * changesets for the active repository's current branch.
 */
export class SynchronizeProvider implements vscode.TreeDataProvider<SyncNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SyncNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repo: Repository | undefined;
  private incoming: Commit[] = [];
  private outgoing: Commit[] = [];
  private hasUpstream = false;

  constructor(private readonly manager: RepositoryManager) {
    manager.onDidChange(() => void this.refresh());
  }

  async refresh(): Promise<void> {
    this.repo = this.manager.getAll()[0];
    if (this.repo) {
      const ab = await this.repo.aheadBehind();
      this.hasUpstream = ab !== undefined;
      this.incoming = await this.repo.syncCommits("incoming");
      this.outgoing = await this.repo.syncCommits("outgoing");
    } else {
      this.hasUpstream = false;
      this.incoming = [];
      this.outgoing = [];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: SyncNode): vscode.TreeItem {
    if (node.type === "info") {
      const item = new vscode.TreeItem(node.label);
      item.description = "—";
      return item;
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
      return item;
    }
    const c = node.commit;
    const item = new vscode.TreeItem(c.subject);
    item.description = `${c.shortSha} · ${c.authorName}`;
    item.iconPath = new vscode.ThemeIcon("git-commit");
    item.tooltip = `${c.sha}\n${c.authorName} <${c.authorEmail}>`;
    item.contextValue = "vsgit.syncCommit";
    return item;
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
