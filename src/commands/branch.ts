import * as vscode from "vscode";
import { GitExecutor } from "../git/GitExecutor";
import { RepositoryManager } from "../git/RepositoryManager";
import { VsgitNode } from "../views/RepositoriesProvider";
import { Repository } from "../git/Repository";
import { resolveRepo, withProgress, errMsg } from "./shared";
import { safeRef } from "../git/argGuard";
import { confirmDestructiveAction, DestructiveOperations } from "../util/confirmation";

/**
 * Branch operations wired to the Repositories view context menu. These prove
 * the command -> git -> refresh pipeline that later phases build on.
 */
export function registerBranchCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const git = new GitExecutor();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vsgit.branch.checkout",
      async (node?: VsgitNode) => {
        const target = await resolveBranch(manager, node);
        if (!target) {
          return;
        }
        try {
          await git.run(["checkout", safeRef(target.name, "branch")], {
            cwd: target.repo.root,
          });
          await manager.refreshAll();
          vscode.window.setStatusBarMessage(
            `Checked out ${target.name}`,
            3000,
          );
        } catch (err) {
          vscode.window.showErrorMessage(`Checkout failed: ${errMsg(err)}`);
        }
      },
    ),

    vscode.commands.registerCommand(
      "vsgit.branch.create",
      async (node?: VsgitNode) => {
        const repo = await resolveRepo(manager, node);
        if (!repo) {
          return;
        }
        const name = await vscode.window.showInputBox({
          prompt: "New branch name",
          validateInput: (v) =>
            v.trim() === "" ? "Branch name cannot be empty" : undefined,
        });
        if (!name) {
          return;
        }
        const checkout = await vscode.window.showQuickPick(
          ["Create and checkout", "Create only"],
          { placeHolder: `Create branch ${name}` },
        );
        if (!checkout) {
          return;
        }
        const safeName = safeRef(name.trim(), "branch");
        const args =
          checkout === "Create and checkout"
            ? ["checkout", "-b", safeName]
            : ["branch", safeName];
        try {
          await git.run(args, { cwd: repo.root });
          await manager.refreshAll();
        } catch (err) {
          vscode.window.showErrorMessage(
            `Create branch failed: ${errMsg(err)}`,
          );
        }
      },
    ),

    vscode.commands.registerCommand(
      "vsgit.branch.delete",
      async (node?: VsgitNode) => {
        const target = await resolveBranch(manager, node);
        if (!target) {
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Delete branch ${target.name}?`,
          { modal: true },
          "Delete",
          "Force Delete",
        );
        if (!confirm) {
          return;
        }
        const flag = confirm === "Force Delete" ? "-D" : "-d";
        try {
          await git.run(["branch", flag, safeRef(target.name, "branch")], {
            cwd: target.repo.root,
          });
          await manager.refreshAll();
        } catch (err) {
          vscode.window.showErrorMessage(
            `Delete branch failed: ${errMsg(err)}`,
          );
        }
      },
    ),

    vscode.commands.registerCommand(
      "vsgit.branch.rename",
      async (node?: VsgitNode) => {
        const target = await resolveBranch(manager, node);
        if (!target) {
          return;
        }
        const newName = await vscode.window.showInputBox({
          prompt: `Rename branch ${target.name} to`,
          value: target.name,
          validateInput: (v) =>
            v.trim() === "" ? "Branch name cannot be empty" : undefined,
        });
        if (!newName || newName === target.name) {
          return;
        }
        try {
          await target.repo.renameBranch(target.name, newName.trim());
          await manager.refreshAll();
        } catch (err) {
          vscode.window.showErrorMessage(`Rename failed: ${errMsg(err)}`);
        }
      },
    ),

    vscode.commands.registerCommand(
      "vsgit.branch.configureUpstream",
      async (node?: VsgitNode) => {
        const target = await resolveBranch(manager, node);
        if (!target) {
          return;
        }
        const choices = [
          "(unset upstream)",
          ...target.repo.remoteBranches.map((b) => b.shortName),
        ];
        const pick = await vscode.window.showQuickPick(choices, {
          placeHolder: `Set upstream for ${target.name}`,
        });
        if (!pick) {
          return;
        }
        try {
          await target.repo.setUpstream(
            target.name,
            pick === "(unset upstream)" ? undefined : pick,
          );
          await manager.refreshAll();
        } catch (err) {
          vscode.window.showErrorMessage(
            `Configure upstream failed: ${errMsg(err)}`,
          );
        }
      },
    ),
  );
}

type ResetMode = "soft" | "mixed" | "hard" | "keep" | "merge";

/** Reset the current branch HEAD to a chosen ref. */
async function doBranchReset(
  manager: RepositoryManager,
  node: unknown,
): Promise<void> {
  const repo = await resolveRepo(manager, node as VsgitNode);
  if (!repo) return;

  const mode = await vscode.window.showQuickPick(
    [
      { label: "Soft", description: "Move HEAD only; keep index and working tree" },
      { label: "Mixed", description: "Move HEAD and reset index; keep working tree" },
      { label: "Hard", description: "Move HEAD, reset index and working tree" },
      { label: "Keep", description: "Reset index; abort if a touched file has local changes" },
      { label: "Merge", description: "Reset index; keep local changes to untouched files" },
    ],
    { placeHolder: "Reset mode" },
  );
  if (!mode) return;

  await resetToRef(manager, repo, mode.label.toLowerCase() as ResetMode);
}

/** Reset the current branch HEAD using a fixed mode, prompting only for the ref. */
async function doResetWithMode(
  manager: RepositoryManager,
  node: unknown,
  mode: ResetMode,
): Promise<void> {
  const repo = await resolveRepo(manager, node as VsgitNode);
  if (!repo) return;
  await resetToRef(manager, repo, mode);
}

/** Shared ref picker + confirmation + execution for every reset entry point. */
async function resetToRef(
  manager: RepositoryManager,
  repo: Repository,
  mode: ResetMode,
): Promise<void> {
  const refs = [
    "HEAD~1",
    ...repo.localBranches.map((b) => b.shortName),
    ...repo.remoteBranches.map((b) => b.shortName),
    ...repo.tags.map((t) => t.shortName),
  ];
  const ref = await vscode.window.showQuickPick(refs, {
    placeHolder: `Reset --${mode} to ref / SHA`,
  });
  if (!ref) return;

  if (mode === "hard") {
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.HARD_RESET,
      message: `Hard reset to ${ref}? All uncommitted changes will be lost.`,
    });
    if (!confirmed) return;
  }

  await withProgress(manager, `Reset --${mode} to ${ref}`, () =>
    repo.reset(ref, mode),
  );
}

export function registerBranchExtraCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // ── Branch reset ──────────────────────────────────────────────────────

  reg("vsgit.branch.reset", (node) => doBranchReset(manager, node));
  reg("vsgit.repo.reset.soft", (node) => doResetWithMode(manager, node, "soft"));
  reg("vsgit.repo.reset.mixed", (node) => doResetWithMode(manager, node, "mixed"));
  reg("vsgit.repo.reset.hard", (node) => doResetWithMode(manager, node, "hard"));
  reg("vsgit.repo.reset.keep", (node) => doResetWithMode(manager, node, "keep"));
  reg("vsgit.repo.reset.merge", (node) => doResetWithMode(manager, node, "merge"));

  // ── Compare branches ─────────────────────────────────────────────────

  reg("vsgit.branch.compareTo", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    const sourceName =
      n && n.type === "branch" ? n.ref.shortName : repo.headName ?? "HEAD";

    const allBranches = [
      ...repo.localBranches.map((b) => b.shortName),
      ...repo.remoteBranches.map((b) => b.shortName),
    ].filter((b) => b !== sourceName);

    const target = await vscode.window.showQuickPick(allBranches, {
      placeHolder: `Compare ${sourceName} with...`,
    });
    if (!target) return;

    // Show commits on sourceName that are not in target (range A..B)
    const commits = await repo.log({ revRange: `${target}..${sourceName}`, all: false });
    if (commits.length === 0) {
      vscode.window.showInformationMessage(
        `${sourceName} has no commits not in ${target}.`,
      );
      return;
    }
    await vscode.window.showQuickPick(
      commits.map((c) => ({
        label: `$(git-commit) ${c.sha.slice(0, 8)}`,
        description: c.subject,
        detail: `${c.authorName}  ${new Date(c.authorDate * 1000).toLocaleDateString()}`,
      })),
      {
        placeHolder: `${commits.length} commit(s) in ${sourceName} not in ${target}`,
        canPickMany: false,
      },
    );
  });

  // ── Remote branch: checkout with local tracking ───────────────────────

  reg("vsgit.remoteBranch.checkout", async (node) => {
    const n = node as VsgitNode | undefined;
    if (!n || n.type !== "branch" || n.ref.kind !== "remoteBranch") {
      // Fallback: prompt
      const repo = await resolveRepo(manager, undefined);
      if (!repo) return;
      const picked = await vscode.window.showQuickPick(
        repo.remoteBranches.map((b) => b.shortName),
        { placeHolder: "Select remote branch to checkout" },
      );
      if (!picked) return;
      const localName = picked.replace(/^[^/]+\//, ""); // strip remote/
      await withProgress(manager, `Checkout ${picked}`, () =>
        repo.checkoutRemoteBranch(picked, localName),
      );
      return;
    }
    const fullName = n.ref.shortName; // e.g. origin/feature
    const localName = fullName.replace(/^[^/]+\//, "");
    const proposedName = await vscode.window.showInputBox({
      prompt: "Local branch name",
      value: localName,
      validateInput: (v) => (v.trim() === "" ? "Required" : undefined),
    });
    if (!proposedName) return;
    await withProgress(manager, `Checkout ${fullName} → ${proposedName}`, () =>
      n.repo.checkoutRemoteBranch(fullName, proposedName.trim()),
    );
  });

  // ── Remote branch: delete ─────────────────────────────────────────────

  reg("vsgit.remoteBranch.delete", async (node) => {
    const n = node as VsgitNode | undefined;
    if (!n || n.type !== "branch" || n.ref.kind !== "remoteBranch") {
      vscode.window.showWarningMessage("Select a remote branch to delete.");
      return;
    }
    const [remoteName, ...branchParts] = n.ref.shortName.split("/");
    const branchName = branchParts.join("/");
    const confirm = await vscode.window.showWarningMessage(
      `Delete remote branch ${n.ref.shortName}? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") return;
    await withProgress(manager, `Delete remote branch ${n.ref.shortName}`, () =>
      n.repo.deleteRemoteBranch(remoteName, branchName),
    );
  });
}

interface BranchTarget {
  repo: Repository;
  name: string;
}

async function resolveBranch(
  manager: RepositoryManager,
  node?: VsgitNode,
): Promise<BranchTarget | undefined> {
  if (node && node.type === "branch") {
    return { repo: node.repo, name: node.ref.shortName };
  }
  // Fallback: prompt for a repo then a branch (palette invocation).
  const repo = await resolveRepo(manager, node);
  if (!repo) {
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    repo.localBranches.map((b) => b.shortName),
    { placeHolder: "Select a branch" },
  );
  return pick ? { repo, name: pick } : undefined;
}
