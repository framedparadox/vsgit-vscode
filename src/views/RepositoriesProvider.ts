import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { RefInfo } from "../git/parsers/refs";

/**
 * The kinds of nodes the Repositories tree renders. Each TreeItem carries one
 * of these via the `node` discriminated union so commands can act on them.
 */
export type EgitNode =
  | { type: "repo"; repo: Repository }
  | { type: "group"; repo: Repository; group: GroupKind }
  | { type: "branch"; repo: Repository; ref: RefInfo }
  | { type: "tag"; repo: Repository; ref: RefInfo }
  | { type: "remote"; repo: Repository; remoteName: string }
  | { type: "stash"; repo: Repository; ref: string; message: string }
  | { type: "submodule"; repo: Repository; path: string }
  | { type: "info"; label: string };

type GroupKind =
  | "localBranches"
  | "remoteBranches"
  | "tags"
  | "remotes"
  | "stashes"
  | "submodules";

const GROUP_LABELS: Record<GroupKind, string> = {
  localBranches: "Local Branches",
  remoteBranches: "Remote Branches",
  tags: "Tags",
  remotes: "Remotes",
  stashes: "Stashes",
  submodules: "Submodules",
};

export class RepositoriesProvider
  implements vscode.TreeDataProvider<EgitNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    EgitNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private abCache = new Map<string, { ahead: number; behind: number }>();

  constructor(private readonly manager: RepositoryManager) {
    manager.onDidChange(() => this.refresh());
  }

  private refresh(): void {
    const repos = this.manager.getAll();
    Promise.all(
      repos.map(async (repo) => {
        try {
          const ab = await repo.aheadBehind();
          if (ab) {
            this.abCache.set(repo.root, ab);
          } else {
            this.abCache.delete(repo.root);
          }
        } catch {
          this.abCache.delete(repo.root);
        }
      }),
    ).then(() => {
      this._onDidChangeTreeData.fire(undefined);
    }).catch(() => {
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  getTreeItem(node: EgitNode): vscode.TreeItem {
    switch (node.type) {
      case "repo": {
        const item = new vscode.TreeItem(
          node.repo.name,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        const ab = this.abCache.get(node.repo.root);
        const abParts: string[] = [];
        if (ab?.ahead) abParts.push(`↑${ab.ahead}`);
        if (ab?.behind) abParts.push(`↓${ab.behind}`);
        const abStr = abParts.join(" ");
        item.description = [node.repo.headName, abStr].filter(Boolean).join("  ");
        item.iconPath = new vscode.ThemeIcon("repo");
        item.contextValue = "egit.repo";
        item.tooltip = node.repo.root;
        return item;
      }
      case "group": {
        const item = new vscode.TreeItem(
          GROUP_LABELS[node.group],
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon(groupIcon(node.group));
        item.contextValue =
          node.group === "localBranches" || node.group === "remoteBranches"
            ? "egit.branchesNode"
            : `egit.${node.group}Node`;
        return item;
      }
      case "branch": {
        const item = new vscode.TreeItem(node.ref.shortName);
        item.iconPath = new vscode.ThemeIcon(
          node.ref.isHead ? "target" : "git-branch",
        );
        item.description = [
          node.ref.isHead ? "HEAD" : undefined,
          node.ref.upstream ? `↑ ${node.ref.upstream}` : undefined,
          node.ref.subject,
        ]
          .filter(Boolean)
          .join("  ");
        item.contextValue =
          node.ref.kind === "localBranch"
            ? "egit.branch.local"
            : "egit.branch.remote";
        item.tooltip = node.ref.objectId;
        return item;
      }
      case "tag": {
        const item = new vscode.TreeItem(node.ref.shortName);
        item.iconPath = new vscode.ThemeIcon("tag");
        item.description = node.ref.subject;
        item.contextValue = "egit.tag";
        return item;
      }
      case "remote": {
        const item = new vscode.TreeItem(node.remoteName);
        item.iconPath = new vscode.ThemeIcon("cloud");
        item.contextValue = "egit.remote";
        return item;
      }
      case "stash": {
        const item = new vscode.TreeItem(node.message || node.ref);
        item.iconPath = new vscode.ThemeIcon("archive");
        item.description = node.ref;
        item.contextValue = "egit.stash";
        return item;
      }
      case "submodule": {
        const item = new vscode.TreeItem(node.path);
        item.iconPath = new vscode.ThemeIcon("file-submodule");
        item.contextValue = "egit.submodule";
        return item;
      }
      case "info": {
        const item = new vscode.TreeItem(node.label);
        item.description = "—";
        return item;
      }
    }
  }

  getChildren(node?: EgitNode): EgitNode[] {
    if (!node) {
      const repos = this.manager.getAll();
      if (repos.length === 0) {
        return [];
      }
      return repos.map((repo) => ({ type: "repo", repo }) as EgitNode);
    }

    if (node.type === "repo") {
      const repo = node.repo;
      return (Object.keys(GROUP_LABELS) as GroupKind[]).map(
        (group) => ({ type: "group", repo, group }) as EgitNode,
      );
    }

    if (node.type === "group") {
      return this.groupChildren(node.repo, node.group);
    }

    return [];
  }

  private groupChildren(repo: Repository, group: GroupKind): EgitNode[] {
    switch (group) {
      case "localBranches":
        return emptyOr(
          repo.localBranches.map(
            (ref) => ({ type: "branch", repo, ref }) as EgitNode,
          ),
        );
      case "remoteBranches":
        return emptyOr(
          repo.remoteBranches.map(
            (ref) => ({ type: "branch", repo, ref }) as EgitNode,
          ),
        );
      case "tags":
        return emptyOr(
          repo.tags.map((ref) => ({ type: "tag", repo, ref }) as EgitNode),
        );
      case "remotes":
        return emptyOr(
          repo.remotes.map(
            (r) => ({ type: "remote", repo, remoteName: r.name }) as EgitNode,
          ),
        );
      case "stashes":
        return emptyOr(
          repo.stashes.map(
            (s) =>
              ({
                type: "stash",
                repo,
                ref: s.ref,
                message: s.message,
              }) as EgitNode,
          ),
        );
      case "submodules":
        return emptyOr(
          repo.submodules.map(
            (s) => ({ type: "submodule", repo, path: s.path }) as EgitNode,
          ),
        );
    }
  }
}

function emptyOr(nodes: EgitNode[]): EgitNode[] {
  return nodes.length > 0 ? nodes : [{ type: "info", label: "(none)" }];
}

function groupIcon(group: GroupKind): string {
  switch (group) {
    case "localBranches":
      return "git-branch";
    case "remoteBranches":
      return "cloud";
    case "tags":
      return "tag";
    case "remotes":
      return "broadcast";
    case "stashes":
      return "archive";
    case "submodules":
      return "file-submodule";
  }
}
