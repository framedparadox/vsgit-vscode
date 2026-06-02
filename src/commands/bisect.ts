import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { errMsg, resolveRepo, withProgress } from "./shared";
import { EgitNode } from "../views/RepositoriesProvider";

/** Bisect workflow commands. */
export function registerBisectCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("egit.bisect.start", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;
    try {
      await repo.bisectStart();
      BisectStatusBar.show(repo.name);
      vscode.window.showInformationMessage(
        "Bisect started. Mark commits as good or bad from the Repositories view or command palette.",
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Bisect start failed: ${errMsg(e)}`);
    }
  });

  reg("egit.bisect.good", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;
    const sha = await vscode.window.showInputBox({
      prompt: "Commit SHA to mark as GOOD (leave empty for current HEAD)",
      placeHolder: "HEAD",
    });
    if (sha === undefined) return; // cancelled
    try {
      const out = await repo.bisectMark(true, sha?.trim() || undefined);
      vscode.window.showInformationMessage(out.trim() || "Marked as good.");
      await manager.refreshAll();
    } catch (e) {
      vscode.window.showErrorMessage(`Bisect good failed: ${errMsg(e)}`);
    }
  });

  reg("egit.bisect.bad", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;
    const sha = await vscode.window.showInputBox({
      prompt: "Commit SHA to mark as BAD (leave empty for current HEAD)",
      placeHolder: "HEAD",
    });
    if (sha === undefined) return;
    try {
      const out = await repo.bisectMark(false, sha?.trim() || undefined);
      vscode.window.showInformationMessage(out.trim() || "Marked as bad.");
      await manager.refreshAll();
    } catch (e) {
      vscode.window.showErrorMessage(`Bisect bad failed: ${errMsg(e)}`);
    }
  });

  reg("egit.bisect.reset", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;
    await withProgress(manager, "Bisect reset", () => repo.bisectReset());
    BisectStatusBar.hide();
  });

  reg("egit.bisect.log", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;
    try {
      const log = await repo.bisectLog();
      const doc = await vscode.workspace.openTextDocument({
        content: log,
        language: "shellscript",
      });
      await vscode.window.showTextDocument(doc);
    } catch (e) {
      vscode.window.showErrorMessage(`Bisect log failed: ${errMsg(e)}`);
    }
  });
}

// ── Status bar indicator shown during bisect ──────────────────────────────

class BisectStatusBar {
  private static item: vscode.StatusBarItem | undefined;

  static show(repoName: string) {
    if (!this.item) {
      this.item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100,
      );
      this.item.command = "egit.bisect.reset";
    }
    this.item.text = `$(git-commit) Bisect: ${repoName} (click to reset)`;
    this.item.tooltip = "Git bisect is in progress. Click to reset.";
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
    this.item.show();
  }

  static hide() {
    this.item?.dispose();
    this.item = undefined;
  }
}
