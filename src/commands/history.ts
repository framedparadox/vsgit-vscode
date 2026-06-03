import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { HistoryView } from "../webviews/HistoryView";
import { GraphPanel } from "../webviews/graph/GraphPanel";
import { VsgitNode } from "../views/RepositoriesProvider";

/** Registers the command that opens the History webview. */
export function registerHistoryCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): HistoryView {
  const view = new HistoryView(manager, context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vsgit.history.show",
      async (node?: VsgitNode | { repoRoot: string; file?: string }) => {
        // File-scoped history keeps the dedicated single-file history webview.
        if (node && "repoRoot" in node && node.file) {
          const repo = manager.getAll().find((r) => r.root === node.repoRoot);
          return view.show(repo, node.file);
        }
        // Repo-level history opens the detailed Git graph (vscode-git-graph style).
        let repo;
        if (node && "repo" in node) {
          repo = node.repo;
        } else if (node && "repoRoot" in node) {
          repo = manager.getAll().find((r) => r.root === node.repoRoot);
        }
        GraphPanel.createOrShow(manager, context.extensionUri, repo);
      },
    ),

    vscode.commands.registerCommand(
      "vsgit.history.compareBranches",
      async () => {
        const repos = manager.getAll();
        if (repos.length === 0) {
          vscode.window.showWarningMessage("No Git repositories found.");
          return;
        }
        const repo = repos[0];
        const allRefs = [
          ...repo.localBranches.map((b) => b.shortName),
          ...repo.remoteBranches.map((b) => b.shortName),
          ...repo.tags.map((t) => t.shortName),
        ];
        const ref1 = await vscode.window.showQuickPick(allRefs, {
          placeHolder: "Select first ref (base)",
        });
        if (!ref1) return;
        const ref2 = await vscode.window.showQuickPick(
          allRefs.filter((r) => r !== ref1),
          { placeHolder: "Select second ref (compare)" },
        );
        if (!ref2) return;
        await view.show(repo);
        await view.startCompare(ref1, ref2);
      },
    ),

    vscode.commands.registerCommand(
      "vsgit.history.filterByBranch",
      async () => {
        const repos = manager.getAll();
        if (repos.length === 0) {
          vscode.window.showWarningMessage("No Git repositories found.");
          return;
        }
        const repo = repos[0];
        const branches = [
          "All branches",
          ...repo.localBranches.map((b) => b.shortName),
          ...repo.remoteBranches.map((b) => b.shortName),
        ];
        const branch = await vscode.window.showQuickPick(branches, {
          placeHolder: "Filter history by branch",
        });
        if (!branch) return;
        await view.show(repo);
        await view.filterByBranch(branch === "All branches" ? "all" : branch);
      },
    ),
  );

  return view;
}
