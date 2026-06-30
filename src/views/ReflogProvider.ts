import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { ReflogEntry } from "../git/parsers/reflog";
import { accessibleTreeItem } from "./treeAccessibility";

export type ReflogNode =
  | { type: "entry"; repo: Repository; entry: ReflogEntry }
  | { type: "info"; label: string };

/**
 * Reflog view for the active repository's HEAD. Each entry exposes
 * checkout/reset actions so lost commits can be recovered.
 */
export class ReflogProvider implements vscode.TreeDataProvider<ReflogNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ReflogNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly subscription: vscode.Disposable;

  private entries: ReflogEntry[] = [];
  private repo: Repository | undefined;

  constructor(private readonly manager: RepositoryManager) {
    this.subscription = manager.onDidChange(() => void this.refresh());
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }

  get activeRepo(): Repository | undefined {
    return this.repo;
  }

  async refresh(): Promise<void> {
    this.repo = this.manager.getActive();
    if (this.repo) {
      try {
        this.entries = await this.repo.reflog("HEAD");
      } catch {
        this.entries = [];
      }
    } else {
      this.entries = [];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: ReflogNode): vscode.TreeItem {
    if (node.type === "info") {
      const item = new vscode.TreeItem(node.label);
      item.description = "—";
      return accessibleTreeItem(item, node.label);
    }
    const e = node.entry;
    const item = new vscode.TreeItem(
      `${e.selector}  ${e.action}${e.message ? ": " + e.message : ""}`,
    );
    item.description = e.shortSha;
    item.iconPath = new vscode.ThemeIcon(actionIcon(e.action));
    item.contextValue = "vsgit.reflogEntry";
    item.tooltip = `${e.sha}\n${new Date(e.date * 1000).toLocaleString()}`;
    return accessibleTreeItem(
      item,
      `${e.selector}, ${e.action}${e.message ? `, ${e.message}` : ""}, commit ${e.shortSha}`,
    );
  }

  getChildren(node?: ReflogNode): ReflogNode[] {
    if (node) {
      return [];
    }
    if (!this.repo) {
      return [];
    }
    if (this.entries.length === 0) {
      return [{ type: "info", label: "(no reflog entries)" }];
    }
    return this.entries.map(
      (entry) => ({ type: "entry", repo: this.repo!, entry }) as ReflogNode,
    );
  }
}

function actionIcon(action: string): string {
  if (action.startsWith("commit")) {
    return "git-commit";
  }
  if (action === "checkout") {
    return "arrow-swap";
  }
  if (action === "reset") {
    return "discard";
  }
  if (action === "rebase" || action.startsWith("rebase")) {
    return "git-merge";
  }
  if (action === "merge" || action === "pull") {
    return "git-merge";
  }
  return "circle-small";
}
