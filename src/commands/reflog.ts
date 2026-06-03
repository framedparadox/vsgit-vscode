import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { ReflogNode, ReflogProvider } from "../views/ReflogProvider";
import { withProgress } from "./shared";

/** Reflog view commands: refresh, checkout an entry, reset HEAD to an entry. */
export function registerReflogCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
  provider: ReflogProvider,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("vsgit.reflog.refresh", () => provider.refresh());

  reg("vsgit.reflog.checkout", async (node) => {
    const n = node as ReflogNode;
    if (!n || n.type !== "entry") {
      return;
    }
    await withProgress(manager, `Checkout ${n.entry.shortSha}`, () =>
      n.repo.checkoutDetached(n.entry.sha),
    );
  });

  reg("vsgit.reflog.reset", async (node) => {
    const n = node as ReflogNode;
    if (!n || n.type !== "entry") {
      return;
    }
    const mode = await vscode.window.showQuickPick(
      ["soft", "mixed", "hard"],
      { placeHolder: `Reset HEAD to ${n.entry.shortSha} (${n.entry.selector})` },
    );
    if (!mode) {
      return;
    }
    if (mode === "hard") {
      const confirm = await vscode.window.showWarningMessage(
        `Hard reset to ${n.entry.shortSha}? Working tree changes will be lost.`,
        { modal: true },
        "Reset Hard",
      );
      if (confirm !== "Reset Hard") {
        return;
      }
    }
    await withProgress(manager, `Reset (${mode}) to ${n.entry.shortSha}`, () =>
      n.repo.reset(n.entry.sha, mode as "soft" | "mixed" | "hard"),
    );
  });
}
