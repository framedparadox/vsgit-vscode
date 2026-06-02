import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { EgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, errMsg, withProgress } from "./shared";

/** Git subtree operations: add, pull, push, split subtrees. */
export function registerSubtreeCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (cmd: string, handler: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));

  // Add subtree
  reg("egit.subtree.add", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const prefix = await vscode.window.showInputBox({
      prompt: "Enter local directory prefix for the subtree",
      placeHolder: "lib/external-project",
    });
    if (!prefix) return;

    const repository = await vscode.window.showInputBox({
      prompt: "Enter remote repository URL or path",
      placeHolder: "https://github.com/user/repo.git",
    });
    if (!repository) return;

    const ref = await vscode.window.showInputBox({
      prompt: "Enter branch/tag to add (leave empty for master)",
      placeHolder: "master",
    });

    try {
      await withProgress(
        manager,
        `Adding subtree from ${repository}`,
        () => repo.subtreeAdd(prefix, repository, ref || undefined)
      );
      vscode.window.showInformationMessage(
        `Subtree added at ${prefix} from ${repository}.`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to add subtree: ${errMsg(e)}`);
    }
  });

  // Pull subtree updates
  reg("egit.subtree.pull", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const prefix = await vscode.window.showInputBox({
      prompt: "Enter subtree prefix",
      placeHolder: "lib/external-project",
    });
    if (!prefix) return;

    const repository = await vscode.window.showInputBox({
      prompt: "Enter remote repository URL or path",
      placeHolder: "https://github.com/user/repo.git",
    });
    if (!repository) return;

    const ref = await vscode.window.showInputBox({
      prompt: "Enter branch/tag to pull (leave empty for master)",
      placeHolder: "master",
    });

    try {
      await withProgress(
        manager,
        `Pulling subtree updates from ${repository}`,
        () => repo.subtreePull(prefix, repository, ref || undefined)
      );
      vscode.window.showInformationMessage(
        `Subtree ${prefix} updated from ${repository}.`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to pull subtree: ${errMsg(e)}`);
    }
  });

  // Push subtree changes
  reg("egit.subtree.push", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const prefix = await vscode.window.showInputBox({
      prompt: "Enter subtree prefix",
      placeHolder: "lib/external-project",
    });
    if (!prefix) return;

    const repository = await vscode.window.showInputBox({
      prompt: "Enter remote repository URL or path",
      placeHolder: "https://github.com/user/repo.git",
    });
    if (!repository) return;

    const ref = await vscode.window.showInputBox({
      prompt: "Enter branch to push to (leave empty for master)",
      placeHolder: "master",
    });

    const confirm = await vscode.window.showWarningMessage(
      `Push subtree changes from ${prefix} to ${repository}?`,
      { modal: true },
      "Push"
    );
    if (confirm !== "Push") return;

    try {
      await withProgress(
        manager,
        `Pushing subtree to ${repository}`,
        () => repo.subtreePush(prefix, repository, ref || undefined)
      );
      vscode.window.showInformationMessage(
        `Subtree ${prefix} pushed to ${repository}.`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to push subtree: ${errMsg(e)}`);
    }
  });

  // Split subtree
  reg("egit.subtree.split", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const prefix = await vscode.window.showInputBox({
      prompt: "Enter subtree prefix to split",
      placeHolder: "lib/external-project",
    });
    if (!prefix) return;

    try {
      const sha = await repo.subtreeSplit(prefix);
      
      const action = await vscode.window.showInformationMessage(
        `Subtree split into commit: ${sha.substring(0, 7)}`,
        "Copy SHA",
        "Create Branch"
      );

      if (action === "Copy SHA") {
        await vscode.env.clipboard.writeText(sha);
        vscode.window.showInformationMessage("SHA copied to clipboard.");
      } else if (action === "Create Branch") {
        const branchName = await vscode.window.showInputBox({
          prompt: "Enter branch name for the split subtree",
          placeHolder: `${prefix.replace(/\//g, "-")}-split`,
        });
        if (branchName) {
          await repo.createBranchAt(branchName, sha, false);
          vscode.window.showInformationMessage(`Branch '${branchName}' created at ${sha.substring(0, 7)}.`);
        }
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to split subtree: ${errMsg(e)}`);
    }
  });
}
