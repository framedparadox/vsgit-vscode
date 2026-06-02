import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { EgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, errMsg, withProgress } from "./shared";

/** Git LFS operations: track, lock, pull, prune, etc. */
export function registerLfsCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (cmd: string, handler: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));

  // Show LFS info
  reg("egit.lfs.info", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const hasLfs = await repo.hasLfs();
    if (!hasLfs) {
      vscode.window.showInformationMessage(
        "This repository does not appear to use Git LFS (no filter=lfs in .gitattributes).",
      );
      return;
    }

    const files = await repo.lfsFiles();
    if (files.length === 0) {
      vscode.window.showInformationMessage(
        "Git LFS is configured, but no tracked LFS files were found (or git-lfs is not installed).",
      );
      return;
    }

    await vscode.window.showQuickPick(files, {
      placeHolder: `${files.length} LFS-tracked file(s)`,
    });
  });

  // Track new pattern with LFS
  reg("egit.lfs.track", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const pattern = await vscode.window.showInputBox({
      prompt: "Enter file pattern to track with LFS (e.g., *.psd, docs/*.pdf)",
      placeHolder: "*.bin",
    });
    if (!pattern) return;

    try {
      await withProgress(manager, `Tracking ${pattern} with LFS`, () =>
        repo.lfsTrack(pattern)
      );
      vscode.window.showInformationMessage(
        `Pattern '${pattern}' is now tracked by LFS. Remember to commit .gitattributes.`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to track pattern: ${errMsg(e)}`);
    }
  });

  // Untrack pattern from LFS
  reg("egit.lfs.untrack", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const pattern = await vscode.window.showInputBox({
      prompt: "Enter file pattern to untrack from LFS",
      placeHolder: "*.bin",
    });
    if (!pattern) return;

    try {
      await withProgress(manager, `Untracking ${pattern} from LFS`, () =>
        repo.lfsUntrack(pattern)
      );
      vscode.window.showInformationMessage(
        `Pattern '${pattern}' is no longer tracked by LFS. Remember to commit .gitattributes.`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to untrack pattern: ${errMsg(e)}`);
    }
  });

  // Lock file on remote
  reg("egit.lfs.lock", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const files = await repo.lfsFiles();
    if (files.length === 0) {
      vscode.window.showWarningMessage("No LFS files found to lock.");
      return;
    }

    const file = await vscode.window.showQuickPick(files, {
      placeHolder: "Select file to lock on remote",
    });
    if (!file) return;

    try {
      await withProgress(manager, `Locking ${file}`, () =>
        repo.lfsLock(file)
      );
      vscode.window.showInformationMessage(`Locked ${file} on remote.`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to lock file: ${errMsg(e)}`);
    }
  });

  // Unlock file on remote
  reg("egit.lfs.unlock", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const locks = await repo.lfsLocks();
    if (locks.length === 0) {
      vscode.window.showInformationMessage("No locked files found.");
      return;
    }

    const items = locks.map((lock) => ({
      label: lock.path,
      description: `Locked by ${lock.owner.name}`,
      lock,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select file to unlock",
    });
    if (!selected) return;

    const isOwner = selected.lock.owner.name === "you"; // Simplified check
    const force = !isOwner
      ? await vscode.window.showWarningMessage(
          `${selected.lock.path} is locked by ${selected.lock.owner.name}. Force unlock?`,
          { modal: true },
          "Force Unlock"
        ) === "Force Unlock"
      : false;

    try {
      await withProgress(manager, `Unlocking ${selected.lock.path}`, () =>
        repo.lfsUnlock(selected.lock.path, force)
      );
      vscode.window.showInformationMessage(`Unlocked ${selected.lock.path}.`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to unlock: ${errMsg(e)}`);
    }
  });

  // Show all locks
  reg("egit.lfs.locks", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    try {
      const locks = await repo.lfsLocks();
      if (locks.length === 0) {
        vscode.window.showInformationMessage("No locked files found.");
        return;
      }

      const items = locks.map((lock) => ({
        label: lock.path,
        description: `Locked by ${lock.owner.name} on ${new Date(lock.locked_at).toLocaleString()}`,
      }));

      await vscode.window.showQuickPick(items, {
        placeHolder: `${locks.length} locked file(s)`,
      });
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to list locks: ${errMsg(e)}`);
    }
  });

  // Pull LFS objects
  reg("egit.lfs.pull", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    try {
      await withProgress(manager, "Pulling LFS objects", () =>
        repo.lfsPull()
      );
      vscode.window.showInformationMessage("LFS objects pulled successfully.");
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to pull LFS objects: ${errMsg(e)}`);
    }
  });

  // Prune old LFS objects
  reg("egit.lfs.prune", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;

    const confirm = await vscode.window.showWarningMessage(
      "Prune old LFS objects? This will delete local LFS files that are not referenced by any commits.",
      { modal: true },
      "Prune"
    );
    if (confirm !== "Prune") return;

    try {
      await withProgress(manager, "Pruning LFS objects", () =>
        repo.lfsPrune()
      );
      vscode.window.showInformationMessage("LFS objects pruned successfully.");
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to prune LFS objects: ${errMsg(e)}`);
    }
  });
}
