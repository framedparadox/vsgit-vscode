import * as vscode from "vscode";
import * as path from "node:path";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { StagingNode, StagingProvider } from "../views/StagingProvider";
import { GitContentProvider } from "../git/GitContentProvider";
import { FileChange } from "../git/parsers/status";
import { parseUnifiedDiff, buildHunkPatch } from "../git/parsers/diff";

/**
 * Staging view commands: stage/unstage (file + all + hunk), discard, open diff,
 * add to .gitignore, and commit.
 */
export function registerStagingCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
  staging: StagingProvider,
): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  const repoOf = (node?: StagingNode): Repository | undefined => {
    if (node && node.type === "file") {
      return node.repo;
    }
    return staging.activeRepo;
  };

  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const guard = async (fn: () => Promise<void>, label: string) => {
    try {
      await fn();
      await manager.refreshAll();
    } catch (e) {
      vscode.window.showErrorMessage(`${label} failed: ${errMsg(e)}`);
    }
  };

  reg("vsgit.staging.stage", (node) =>
    guard(async () => {
      const repo = repoOf(node as StagingNode);
      const change = (node as StagingNode)?.type === "file" ? (node as { change: FileChange }).change : undefined;
      if (!repo || !change) {
        return;
      }
      await repo.stage([change.path]);
    }, "Stage"),
  );

  reg("vsgit.staging.unstage", (node) =>
    guard(async () => {
      const repo = repoOf(node as StagingNode);
      const change = (node as StagingNode)?.type === "file" ? (node as { change: FileChange }).change : undefined;
      if (!repo || !change) {
        return;
      }
      await repo.unstage([change.path]);
    }, "Unstage"),
  );

  reg("vsgit.staging.stageAll", () =>
    guard(async () => {
      const repo = staging.activeRepo;
      if (!repo) {
        vscode.window.showWarningMessage("No active repository");
        return;
      }
      await repo.stageAll();
    }, "Stage all"),
  );

  reg("vsgit.staging.unstageAll", () =>
    guard(async () => {
      const repo = staging.activeRepo;
      if (!repo) {
        vscode.window.showWarningMessage("No active repository");
        return;
      }
      await repo.unstageAll();
    }, "Unstage all"),
  );

  reg("vsgit.staging.discard", (node) =>
    guard(async () => {
      const n = node as StagingNode;
      if (n?.type !== "file") {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Discard changes in ${n.change.path}? This cannot be undone.`,
        { modal: true },
        "Discard",
      );
      if (confirm !== "Discard") {
        return;
      }
      const isUntracked = n.change.worktreeState === "untracked";
      await n.repo.discard(
        isUntracked ? [] : [n.change.path],
        isUntracked ? [n.change.path] : [],
      );
    }, "Discard"),
  );

  reg("vsgit.staging.addToGitignore", (node) =>
    guard(async () => {
      const n = node as StagingNode;
      if (n?.type !== "file") {
        return;
      }
      await n.repo.addToGitignore([n.change.path]);
    }, "Add to .gitignore"),
  );

  reg("vsgit.staging.openDiff", async (node) => {
    const n = node as StagingNode;
    if (n?.type !== "file") {
      return;
    }
    await openDiff(n);
  });

  // Stage / unstage an individual hunk by letting the user pick from the file's hunks.
  reg("vsgit.staging.stageHunk", (node) =>
    guard(() => stageHunk(node as StagingNode, false), "Stage hunk"),
  );
  reg("vsgit.staging.unstageHunk", (node) =>
    guard(() => stageHunk(node as StagingNode, true), "Unstage hunk"),
  );

  reg("vsgit.staging.commit", () => commitFlow(staging, manager, false));
  reg("vsgit.staging.commitAmend", () => commitFlow(staging, manager, true));
  reg("vsgit.staging.refresh", () => manager.refreshAll());
}

async function openDiff(node: Extract<StagingNode, { type: "file" }>): Promise<void> {
  const repo = node.repo;
  const abs = path.join(repo.root, node.change.path);
  const title = `${path.basename(node.change.path)} (${node.group})`;

  if (node.group === "staged") {
    // HEAD vs index
    const left = GitContentProvider.uri(repo.root, node.change.path, "HEAD", abs);
    const right = GitContentProvider.uri(repo.root, node.change.path, "~index", abs);
    await vscode.commands.executeCommand("vscode.diff", left, right, title);
  } else {
    // index vs working tree (real file on disk)
    const left = GitContentProvider.uri(repo.root, node.change.path, "~index", abs);
    const right = vscode.Uri.file(abs);
    await vscode.commands.executeCommand("vscode.diff", left, right, title);
  }
}

async function stageHunk(node: StagingNode, reverse: boolean): Promise<void> {
  if (node?.type !== "file") {
    return;
  }
  const repo = node.repo;
  const cached = reverse; // unstage reads the staged diff
  const raw = await repo.diffFile(node.change.path, cached);
  const file = parseUnifiedDiff(raw);
  if (file.hunks.length === 0) {
    vscode.window.showInformationMessage("No hunks to apply.");
    return;
  }
  const picks = file.hunks.map((h, i) => ({
    label: h.header,
    detail: h.lines.slice(0, 4).join("\n"),
    index: i,
  }));
  const chosen = await vscode.window.showQuickPick(picks, {
    placeHolder: reverse ? "Select hunk to unstage" : "Select hunk to stage",
    canPickMany: true,
  });
  if (!chosen || chosen.length === 0) {
    return;
  }
  // Apply each selected hunk as its own patch (simplest robust approach).
  for (const c of chosen) {
    const patch = buildHunkPatch(file, file.hunks[c.index]);
    await repo.applyToIndex(patch, reverse);
  }
}

async function commitFlow(
  staging: StagingProvider,
  manager: RepositoryManager,
  amend: boolean,
): Promise<void> {
  const repo = staging.activeRepo;
  if (!repo) {
    vscode.window.showWarningMessage("No active repository.");
    return;
  }
  if (!amend && repo.stagedChanges.length === 0) {
    const stageAll = await vscode.window.showWarningMessage(
      "No staged changes. Stage all changes and commit?",
      "Stage All & Commit",
      "Cancel",
    );
    if (stageAll !== "Stage All & Commit") {
      return;
    }
    await repo.stageAll();
    await repo.refresh();
  }

  const prefill = amend ? await repo.headCommitMessage() : "";
  const message = await vscode.window.showInputBox({
    prompt: amend ? "Amend commit message" : "Commit message",
    value: prefill,
    validateInput: (v) =>
      v.trim() === "" ? "Commit message cannot be empty" : undefined,
  });
  if (message === undefined) {
    return;
  }

  const extras = await vscode.window.showQuickPick(
    [
      { label: "Sign off (DCO)", picked: false, key: "signoff" },
      { label: "GPG sign", picked: false, key: "signoff_gpg" },
    ],
    { canPickMany: true, placeHolder: "Optional commit options (Esc to skip)" },
  );
  const opts: { amend?: boolean; signoff?: boolean; signoff_gpg?: boolean } = {
    amend,
  };
  for (const e of extras ?? []) {
    (opts as Record<string, boolean>)[e.key] = true;
  }

  try {
    await repo.commit(message, opts);
    await manager.refreshAll();
    vscode.window.setStatusBarMessage(
      amend ? "Amended commit" : "Committed",
      3000,
    );
  } catch (e) {
    vscode.window.showErrorMessage(
      `Commit failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
