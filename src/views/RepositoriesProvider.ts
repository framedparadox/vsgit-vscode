import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { RefInfo } from "../git/parsers/refs";
import { accessibleTreeItem } from "./treeAccessibility";

/**
 * The kinds of nodes the Repositories tree renders. Each TreeItem carries one
 * of these via the `node` discriminated union so commands can act on them.
 */
export type VsgitNode =
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
  implements vscode.TreeDataProvider<VsgitNode>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    VsgitNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly subscription: vscode.Disposable;

  private abCache = new Map<string, { ahead: number; behind: number }>();

  /**
   * `flat` mode renders only the list of repositories (no expandable Local
   * Branches / Tags / … sub-groups) — used by the top-level "Repositories" view.
   * The default tree mode (the "Git Repositories" view) expands each repo into
   * its branches, tags, remotes, stashes, and submodules.
   */
  constructor(
    private readonly manager: RepositoryManager,
    private readonly flat = false,
  ) {
    this.subscription = manager.onDidChange(() => this.refresh());
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
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

  getTreeItem(node: VsgitNode): vscode.TreeItem {
    switch (node.type) {
      case "repo": {
        const item = new vscode.TreeItem(
          node.repo.name,
          this.flat
            ? vscode.TreeItemCollapsibleState.None
            : vscode.TreeItemCollapsibleState.Expanded,
        );
        const ab = this.abCache.get(node.repo.root);
        const active = this.manager.getActive()?.root === node.repo.root;
        const abParts: string[] = [];
        if (ab?.ahead) abParts.push(`↑${ab.ahead}`);
        if (ab?.behind) abParts.push(`↓${ab.behind}`);
        const abStr = abParts.join(" ");
        item.description = [
          active ? "active" : undefined,
          node.repo.headName,
          abStr,
        ].filter(Boolean).join("  ");
        item.iconPath = new vscode.ThemeIcon(active ? "repo-force-push" : "repo");
        item.contextValue = "vsgit.repo";
        item.tooltip = node.repo.root;
        item.command = {
          command: "vsgit.repositories.setActive",
          title: "Set Active Repository",
          arguments: [node],
        };
        return accessibleTreeItem(
          item,
          `${node.repo.name}, ${active ? "active " : ""}repository${node.repo.headName ? `, branch ${node.repo.headName}` : ""}${ab?.ahead ? `, ${ab.ahead} ahead` : ""}${ab?.behind ? `, ${ab.behind} behind` : ""}`,
        );
      }
      case "group": {
        const item = new vscode.TreeItem(
          GROUP_LABELS[node.group],
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon(groupIcon(node.group));
        item.contextValue =
          node.group === "localBranches" || node.group === "remoteBranches"
            ? "vsgit.branchesNode"
            : `vsgit.${node.group}Node`;
        return accessibleTreeItem(
          item,
          `${GROUP_LABELS[node.group]}, group`,
        );
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
            ? "vsgit.branch.local"
            : "vsgit.branch.remote";
        item.tooltip = node.ref.objectId;
        return accessibleTreeItem(
          item,
          `${node.ref.shortName}, ${node.ref.kind === "localBranch" ? "local" : "remote"} branch${node.ref.isHead ? ", current HEAD" : ""}${node.ref.upstream ? `, tracks ${node.ref.upstream}` : ""}`,
        );
      }
      case "tag": {
        const item = new vscode.TreeItem(node.ref.shortName);
        item.iconPath = new vscode.ThemeIcon("tag");
        item.description = node.ref.subject;
        item.contextValue = "vsgit.tag";
        return accessibleTreeItem(item, `${node.ref.shortName}, tag`);
      }
      case "remote": {
        const item = new vscode.TreeItem(node.remoteName);
        item.iconPath = new vscode.ThemeIcon("cloud");
        item.contextValue = "vsgit.remote";
        return accessibleTreeItem(item, `${node.remoteName}, remote`);
      }
      case "stash": {
        const item = new vscode.TreeItem(node.message || node.ref);
        item.iconPath = new vscode.ThemeIcon("archive");
        item.description = node.ref;
        item.contextValue = "vsgit.stash";
        return accessibleTreeItem(
          item,
          `${node.message || node.ref}, stash ${node.ref}`,
        );
      }
      case "submodule": {
        const item = new vscode.TreeItem(node.path);
        item.iconPath = new vscode.ThemeIcon("file-submodule");
        item.contextValue = "vsgit.submodule";
        return accessibleTreeItem(item, `${node.path}, submodule`);
      }
      case "info": {
        const item = new vscode.TreeItem(node.label);
        item.description = "—";
        return accessibleTreeItem(item, node.label);
      }
    }
  }

  async getChildren(node?: VsgitNode): Promise<VsgitNode[]> {
    if (!node) {
      const repos = this.manager.getAll();
      if (repos.length === 0) {
        return [];
      }
      return repos.map((repo) => ({ type: "repo", repo }) as VsgitNode);
    }

    if (node.type === "repo") {
      // Flat mode: repositories are leaf nodes (no Branches / Tags / … groups).
      if (this.flat) {
        return [];
      }
      const repo = node.repo;
      return (Object.keys(GROUP_LABELS) as GroupKind[]).map(
        (group) => ({ type: "group", repo, group }) as VsgitNode,
      );
    }

    if (node.type === "group") {
      if (node.group === "submodules") {
        try {
          await node.repo.ensureSubmodules();
        } catch {
          return [{ type: "info", label: "(unable to load submodules)" }];
        }
      }
      return this.groupChildren(node.repo, node.group);
    }

    return [];
  }

  private groupChildren(repo: Repository, group: GroupKind): VsgitNode[] {
    switch (group) {
      case "localBranches":
        return emptyOr(
          repo.localBranches.map(
            (ref) => ({ type: "branch", repo, ref }) as VsgitNode,
          ),
        );
      case "remoteBranches":
        return emptyOr(
          repo.remoteBranches.map(
            (ref) => ({ type: "branch", repo, ref }) as VsgitNode,
          ),
        );
      case "tags":
        return emptyOr(
          repo.tags.map((ref) => ({ type: "tag", repo, ref }) as VsgitNode),
        );
      case "remotes":
        return emptyOr(
          repo.remotes.map(
            (r) => ({ type: "remote", repo, remoteName: r.name }) as VsgitNode,
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
              }) as VsgitNode,
          ),
        );
      case "submodules":
        return emptyOr(
          repo.submodules.map(
            (s) => ({ type: "submodule", repo, path: s.path }) as VsgitNode,
          ),
        );
    }
  }
}

function emptyOr(nodes: VsgitNode[]): VsgitNode[] {
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
