import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { HistoryView } from "../webviews/HistoryView";
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
        // The History view is a linear commit log (distinct from the Git Graph
        // DAG). Supports both a tree-view node and a file-scoped invocation.
        if (node && "repoRoot" in node) {
          const repo = manager.getAll().find((r) => r.root === node.repoRoot);
          return view.show(repo, node.file);
        }
        const repo = node && "repo" in node ? node.repo : undefined;
        return view.show(repo);
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
