import * as vscode from "vscode";
import { SynchronizeProvider, SyncNode } from "../views/SynchronizeProvider";

/** Registers the Synchronize view refresh and commit-action commands. */
export function registerSyncCommands(
  context: vscode.ExtensionContext,
  provider: SynchronizeProvider,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("vsgit.sync.refresh", () => provider.refresh());

  // Cherry-pick a commit from the Synchronize view
  reg("vsgit.sync.cherryPick", async (node) => {
    const n = node as SyncNode;
    if (!n || n.type !== "commit") return;
    try {
      await n.repo.cherryPick(n.commit.sha);
      await n.repo.refresh();
      vscode.window.setStatusBarMessage(`Cherry-picked ${n.commit.shortSha}`, 3000);
    } catch (e) {
      vscode.window.showErrorMessage(`Cherry-pick failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // Checkout (detached) a commit from the Synchronize view
  reg("vsgit.sync.checkoutCommit", async (node) => {
    const n = node as SyncNode;
    if (!n || n.type !== "commit") return;
    try {
      await n.repo.checkoutDetached(n.commit.sha);
      await n.repo.refresh();
      vscode.window.setStatusBarMessage(`Checked out ${n.commit.shortSha}`, 3000);
    } catch (e) {
      vscode.window.showErrorMessage(`Checkout failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // Show commit details from the Synchronize view
  reg("vsgit.sync.showCommitDetails", (node) => {
    const n = node as SyncNode;
    if (!n || n.type !== "commit") return;
    return vscode.commands.executeCommand("vsgit.showCommitDetails", n.repo, n.commit.sha);
  });
}
