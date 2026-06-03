import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { WorktreeInfo } from "../git/Repository";
import { errMsg, withProgress } from "./shared";

export type WorktreeNode =
  | { type: "worktreeRoot"; repo_root: string; manager: RepositoryManager }
  | { type: "worktree"; info: WorktreeInfo; repo_root: string; manager: RepositoryManager };

/**
 * Worktree operations: list, create, open (in new window), remove.
 */
export function registerWorktreeCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("vsgit.worktree.create", async () => {
    const repos = manager.getAll();
    if (repos.length === 0) {
      vscode.window.showWarningMessage("No Git repositories found.");
      return;
    }
    let repo = repos[0];
    if (repos.length > 1) {
      const pick = await vscode.window.showQuickPick(
        repos.map((r) => ({ label: r.name, description: r.root, repo: r })),
        { placeHolder: "Select repository" },
      );
      if (!pick) return;
      repo = pick.repo;
    }

    const branchMode = await vscode.window.showQuickPick(
      ["Existing branch", "New branch"],
      { placeHolder: "Worktree branch" },
    );
    if (!branchMode) return;

    let branch: string | undefined;
    let createNew = false;
    if (branchMode === "New branch") {
      branch = await vscode.window.showInputBox({
        prompt: "New branch name",
        validateInput: (v) => (v.trim() === "" ? "Required" : undefined),
      });
      if (!branch) return;
      createNew = true;
    } else {
      branch = await vscode.window.showQuickPick(
        repo.localBranches.map((b) => b.shortName),
        { placeHolder: "Select branch" },
      );
      if (!branch) return;
    }

    const targetFolder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select folder for new worktree",
    });
    if (!targetFolder || targetFolder.length === 0) return;
    const worktreePath = path.join(targetFolder[0].fsPath, branch.replace(/\//g, "-"));

    await withProgress(manager, `Create worktree: ${branch}`, () =>
      repo.worktreeAdd(worktreePath, branch!, createNew),
    );

    const open = await vscode.window.showInformationMessage(
      `Worktree created at ${worktreePath}`,
      "Open in New Window",
    );
    if (open === "Open in New Window") {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(worktreePath),
        true,
      );
    }
  });

  reg("vsgit.worktree.open", async (node: unknown) => {
    const n = node as WorktreeNode | undefined;
    if (!n || n.type !== "worktree") return;
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(n.info.path),
      true,
    );
  });

  reg("vsgit.worktree.openHere", async (node: unknown) => {
    const n = node as WorktreeNode | undefined;
    if (!n || n.type !== "worktree") return;
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(n.info.path),
      false,
    );
  });

  reg("vsgit.worktree.remove", async (node: unknown) => {
    const n = node as WorktreeNode | undefined;
    if (!n || n.type !== "worktree") return;
    const confirm = await vscode.window.showWarningMessage(
      `Remove worktree at ${n.info.path}?`,
      { modal: true },
      "Remove",
      "Force Remove",
    );
    if (!confirm) return;
    const force = confirm === "Force Remove";
    const repo = n.manager.getAll().find((r) => r.root === n.repo_root);
    if (!repo) return;
    try {
      await withProgress(n.manager, "Remove worktree", () =>
        repo.worktreeRemove(n.info.path, force),
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Remove worktree failed: ${errMsg(e)}`);
    }
  });

  reg("vsgit.worktree.move", async (node: unknown) => {
    const n = node as WorktreeNode | undefined;
    if (!n || n.type !== "worktree") return;
    const repo = n.manager.getAll().find((r) => r.root === n.repo_root);
    if (!repo) return;

    const target = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select new parent folder for the worktree",
    });
    if (!target || target.length === 0) return;
    const dest = path.join(target[0].fsPath, path.basename(n.info.path));

    try {
      await withProgress(n.manager, `Move worktree → ${dest}`, () =>
        repo.worktreeMove(n.info.path, dest),
      );
      vscode.window.showInformationMessage(`Worktree moved to ${dest}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Move worktree failed: ${errMsg(e)}`);
    }
  });

  reg("vsgit.worktree.prune", async () => {
    const repos = manager.getAll();
    if (repos.length === 0) return;
    await withProgress(manager, "Prune worktrees", async () => {
      for (const repo of repos) {
        await repo.worktreePrune();
      }
    });
  });

  reg("vsgit.worktree.revealInExplorer", async (node: unknown) => {
    const n = node as WorktreeNode | undefined;
    if (!n || n.type !== "worktree") return;
    await vscode.commands.executeCommand(
      "revealFileInOS",
      vscode.Uri.file(n.info.path),
    );
  });

  reg("vsgit.worktree.lock", async (node: unknown) => {
    const n = node as WorktreeNode | undefined;
    if (!n || n.type !== "worktree") return;

    const reason = await vscode.window.showInputBox({
      prompt: "Optional: Enter reason for locking worktree",
      placeHolder: "e.g., In use by CI system",
    });

    const repos = manager.getAll();
    const repo = repos.find((r) => r.root === n.repo_root);
    if (!repo) return;

    try {
      await withProgress(
        manager,
        `Locking worktree ${path.basename(n.info.path)}`,
        () => repo.worktreeLock(n.info.path, reason || undefined)
      );
      vscode.window.showInformationMessage(
        `Worktree locked: ${n.info.path}`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to lock worktree: ${errMsg(e)}`);
    }
  });

  reg("vsgit.worktree.unlock", async (node: unknown) => {
    const n = node as WorktreeNode | undefined;
    if (!n || n.type !== "worktree") return;

    const repos = manager.getAll();
    const repo = repos.find((r) => r.root === n.repo_root);
    if (!repo) return;

    try {
      await withProgress(
        manager,
        `Unlocking worktree ${path.basename(n.info.path)}`,
        () => repo.worktreeUnlock(n.info.path)
      );
      vscode.window.showInformationMessage(
        `Worktree unlocked: ${n.info.path}`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to unlock worktree: ${errMsg(e)}`);
    }
  });
}
