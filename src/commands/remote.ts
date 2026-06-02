import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { EgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, withProgress } from "./shared";

/** Remote management: add, edit (rename/url), delete. */
export function registerRemoteCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("egit.remote.add", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: "Remote name",
      value: "origin",
    });
    if (!name) {
      return;
    }
    const url = await vscode.window.showInputBox({ prompt: "Remote URL" });
    if (!url) {
      return;
    }
    await withProgress(manager, `Add remote ${name}`, () =>
      repo.addRemote(name, url),
    );
  });

  reg("egit.remote.remove", async (node) => {
    const n = node as EgitNode;
    if (!n || n.type !== "remote") {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Remove remote ${n.remoteName}?`,
      { modal: true },
      "Remove",
    );
    if (confirm !== "Remove") {
      return;
    }
    await withProgress(manager, `Remove remote ${n.remoteName}`, () =>
      n.repo.removeRemote(n.remoteName),
    );
  });

  reg("egit.remote.prune", async (node) => {
    const n = node as EgitNode;
    let repo = await resolveRepo(manager, n);
    if (!repo) {
      return;
    }
    // If invoked on a specific remote node, prune that one; otherwise ask.
    let remoteName: string | undefined;
    if (n && n.type === "remote") {
      repo = n.repo;
      remoteName = n.remoteName;
    } else {
      const names = repo.remotes.map((r) => r.name);
      if (names.length === 0) {
        vscode.window.showWarningMessage("No remotes configured.");
        return;
      }
      remoteName =
        names.length === 1
          ? names[0]
          : await vscode.window.showQuickPick(names, {
              placeHolder: "Prune stale tracking refs for which remote?",
            });
    }
    if (!remoteName) {
      return;
    }
    await withProgress(manager, `Prune ${remoteName}`, () =>
      repo.pruneRemote(remoteName as string),
    );
    vscode.window.setStatusBarMessage(`Pruned stale refs for ${remoteName}`, 3000);
  });

  reg("egit.remote.edit", async (node) => {
    const n = node as EgitNode;
    if (!n || n.type !== "remote") {
      return;
    }
    const action = await vscode.window.showQuickPick(
      ["Change URL", "Rename"],
      { placeHolder: `Edit remote ${n.remoteName}` },
    );
    if (action === "Change URL") {
      const current = n.repo.remotes.find((r) => r.name === n.remoteName);
      const url = await vscode.window.showInputBox({
        prompt: "New URL",
        value: current?.fetchUrl ?? "",
      });
      if (url) {
        await withProgress(manager, `Set URL for ${n.remoteName}`, () =>
          n.repo.setRemoteUrl(n.remoteName, url),
        );
      }
    } else if (action === "Rename") {
      const newName = await vscode.window.showInputBox({
        prompt: "New remote name",
        value: n.remoteName,
      });
      if (newName && newName !== n.remoteName) {
        await withProgress(manager, `Rename remote to ${newName}`, () =>
          n.repo.renameRemote(n.remoteName, newName),
        );
      }
    }
  });
}
