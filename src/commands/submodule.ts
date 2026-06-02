import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { EgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, withProgress } from "./shared";

/** Submodule operations: add, init, update, sync. */
export function registerSubmoduleCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("egit.submodule.add", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) {
      return;
    }
    const url = await vscode.window.showInputBox({ prompt: "Submodule URL" });
    if (!url) {
      return;
    }
    const path = await vscode.window.showInputBox({
      prompt: "Path to add the submodule at",
    });
    if (!path) {
      return;
    }
    await withProgress(manager, `Add submodule ${path}`, () =>
      repo.submoduleAdd(url, path),
    );
  });

  reg("egit.submodule.update", async (node) => {
    const target = subTarget(node as EgitNode);
    if (!target) {
      const repo = await resolveRepo(manager, node as EgitNode);
      if (!repo) {
        return;
      }
      await withProgress(manager, "Update submodules", () =>
        repo.submoduleUpdate(),
      );
      return;
    }
    await withProgress(manager, `Update submodule ${target.path}`, () =>
      target.repo.submoduleUpdate(target.path),
    );
  });

  reg("egit.submodule.sync", async (node) => {
    const target = subTarget(node as EgitNode);
    const repo = target?.repo ?? (await resolveRepo(manager, node as EgitNode));
    if (!repo) {
      return;
    }
    await withProgress(manager, "Sync submodules", () =>
      repo.submoduleSync(target?.path),
    );
  });

  reg("egit.submodule.init", async (node) => {
    const target = subTarget(node as EgitNode);
    const repo = target?.repo ?? (await resolveRepo(manager, node as EgitNode));
    if (!repo) {
      return;
    }
    await withProgress(manager, "Init submodules", () =>
      repo.submoduleInit(target?.path),
    );
  });
}

function subTarget(node: EgitNode): { repo: import("../git/Repository").Repository; path: string } | undefined {
  if (node && node.type === "submodule") {
    return { repo: node.repo, path: node.path };
  }
  return undefined;
}
