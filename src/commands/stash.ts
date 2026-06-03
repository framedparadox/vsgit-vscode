import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { VsgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, withProgress } from "./shared";
import { GitContentProvider } from "../git/GitContentProvider";

/** Stash operations: create, apply, pop, drop, view contents. */
export function registerStashCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("vsgit.stash.create", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    const message = await vscode.window.showInputBox({
      prompt: "Stash message (optional)",
    });
    if (message === undefined) {
      return;
    }
    const untracked = await vscode.window.showQuickPick(
      ["Tracked changes only", "Include untracked files"],
      { placeHolder: "What to stash" },
    );
    if (!untracked) {
      return;
    }
    await withProgress(manager, "Stash", () =>
      repo.stashPush(message || undefined, untracked === "Include untracked files"),
    );
  });

  reg("vsgit.stash.apply", (node) => stashOp(manager, node, "apply"));
  reg("vsgit.stash.pop", (node) => stashOp(manager, node, "pop"));

  reg("vsgit.stash.drop", async (node) => {
    const n = node as VsgitNode;
    if (!n || n.type !== "stash") {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Drop ${n.ref}? This cannot be undone.`,
      { modal: true },
      "Drop",
    );
    if (confirm !== "Drop") {
      return;
    }
    await withProgress(manager, `Drop ${n.ref}`, () => n.repo.stashDrop(n.ref));
  });

  reg("vsgit.stash.view", async (node) => {
    const n = node as VsgitNode;
    if (!n || n.type !== "stash") {
      return;
    }
    const files = await n.repo.stashFiles(n.ref);
    if (files.length === 0) {
      vscode.window.showInformationMessage(`${n.ref}: no file changes.`);
      return;
    }
    const pick = await vscode.window.showQuickPick(
      files.map((f) => ({
        label: `$(${statusIcon(f.status)}) ${f.path}`,
        description: f.status,
        filePath: f.path,
      })),
      { placeHolder: `${n.ref} — ${n.message} · select file to diff` },
    );
    if (!pick) return;
    // Show stash version (stash@{N}) vs the pre-stash parent (stash@{N}^)
    const rel = pick.filePath;
    const abs = path.join(n.repo.root, rel);
    const left = GitContentProvider.uri(n.repo.root, rel, `${n.ref}^`, abs);
    const right = GitContentProvider.uri(n.repo.root, rel, n.ref, abs);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(rel)} (${n.ref})`,
    );
  });

  reg("vsgit.stash.clearAll", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    if (repo.stashes.length === 0) {
      vscode.window.showInformationMessage("No stashes to clear.");
      return;
    }
    const count = repo.stashes.length;
    const confirm = await vscode.window.showWarningMessage(
      `Drop all ${count} stash ${count === 1 ? "entry" : "entries"}? This cannot be undone.`,
      { modal: true },
      "Clear All",
    );
    if (confirm !== "Clear All") {
      return;
    }
    await withProgress(manager, "Clear all stashes", () => repo.stashClear());
  });

  reg("vsgit.stash.branch", async (node) => {
    const n = node as VsgitNode;
    if (!n || n.type !== "stash") {
      return;
    }
    const branchName = await vscode.window.showInputBox({
      prompt: "New branch name to create from stash",
      validateInput: (v) => (v.trim() === "" ? "Required" : undefined),
    });
    if (!branchName) return;
    await withProgress(manager, `Stash branch ${branchName}`, () =>
      n.repo.stashBranch(branchName.trim(), n.ref),
    );
  });
}

function statusIcon(status: string): string {
  switch (status.toUpperCase()) {
    case "A": return "diff-added";
    case "D": return "diff-removed";
    case "M": return "diff-modified";
    default:  return "circle-outline";
  }
}

async function stashOp(
  manager: RepositoryManager,
  node: unknown,
  op: "apply" | "pop",
): Promise<void> {
  const n = node as VsgitNode;
  if (!n || n.type !== "stash") {
    return;
  }
  await withProgress(manager, `Stash ${op}: ${n.ref}`, () =>
    op === "apply" ? n.repo.stashApply(n.ref) : n.repo.stashPop(n.ref),
  );
}
