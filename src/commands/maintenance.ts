import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { VsgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, showGitProgress, withProgress } from "./shared";
import { confirmDestructiveAction, DestructiveOperations } from "../util/confirmation";

/** Repository maintenance: garbage collection, integrity check, object prune. */
export function registerMaintenanceCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  let fsckChannel: vscode.OutputChannel | undefined;

  reg("vsgit.maintenance.gc", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    const choice = await vscode.window.showQuickPick(
      [
        { label: "Standard", description: "git gc", aggressive: false },
        {
          label: "Aggressive",
          description: "git gc --aggressive (slower, smaller)",
          aggressive: true,
        },
      ],
      { placeHolder: "Run garbage collection" },
    );
    if (!choice) {
      return;
    }
    const ok = await withProgress(manager, "Garbage collect", () =>
      repo.gc(choice.aggressive),
    );
    if (!ok) return;
    vscode.window.setStatusBarMessage("Repository garbage collected", 3000);
  });

  reg("vsgit.maintenance.fsck", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    let output: string;
    try {
      output = await showGitProgress("Check integrity", () => repo.fsck());
    } catch (e) {
      vscode.window.showErrorMessage(
        `Integrity check failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    // Reuse one channel; creating a new one per run leaks an Output entry each time.
    if (!fsckChannel) {
      fsckChannel = vscode.window.createOutputChannel("VsGit fsck");
      context.subscriptions.push(fsckChannel);
    }
    const channel = fsckChannel;
    channel.clear();
    channel.appendLine(output.trim() || "No issues found — object database is intact.");
    channel.show(true);
    context.subscriptions.push(channel);
  });

  reg("vsgit.maintenance.prune", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.CLEAN_UNTRACKED,
      message: "Prune all unreachable loose objects? Recently deleted commits not yet referenced may become unrecoverable.",
    });
    if (!confirmed) {
      return;
    }
    const ok = await withProgress(manager, "Prune objects", () => repo.pruneObjects());
    if (!ok) return;
    vscode.window.setStatusBarMessage("Unreachable objects pruned", 3000);
  });
}
