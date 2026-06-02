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
