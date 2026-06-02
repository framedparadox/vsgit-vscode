import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { GraphPanel } from "../webviews/graph/GraphPanel";

/**
 * Commands for Git Graph visualization.
 */
export function registerGraphCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  // Show git graph
  context.subscriptions.push(
    vscode.commands.registerCommand("egit.graph.show", async (node: unknown) => {
      const repos = manager.getAll();
      if (repos.length === 0) {
        vscode.window.showWarningMessage("No Git repositories found.");
        return;
      }

      let repo = repos[0];

      // If called from tree view node, use that repo
      if (node && typeof node === "object" && "repo_root" in node) {
        const nodeRepo = repos.find((r) => r.root === (node as { repo_root: string }).repo_root);
        if (nodeRepo) {
          repo = nodeRepo;
        }
      } else if (repos.length > 1) {
        // If multiple repos, show picker
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({ label: r.name, description: r.root, repo: r })),
          { placeHolder: "Select repository to show graph" }
        );
        if (!pick) return;
        repo = pick.repo;
      }

      GraphPanel.createOrShow(repo, context.extensionUri);
    })
  );
}
