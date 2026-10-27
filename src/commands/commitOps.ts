import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { VsgitNode } from "../views/RepositoriesProvider";
import { checkoutRemoteBranchInteractive, resolveRepo, withProgress, errMsg, pickMainline } from "./shared";
import { confirmDestructiveAction } from "../util/confirmation";
import { Credentials } from "../util/credentials";
import { runSequencerAction } from "./interactiveRebase";

interface BranchItem extends vscode.QuickPickItem {
  branchName: string;
  branchKind: "local" | "remote" | "tag";
}

/**
 * Commit-level operations: cherry-pick, revert, squash, GPG verification,
 * fetch GitHub PRs, and Switch To quick picker.
 */
export function registerCommitOpsCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  const creds = new Credentials(context);

  // ── Cherry-pick ───────────────────────────────────────────────────────────

  reg("vsgit.commit.cherryPick", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    let sha = shaFromNode(n);
    if (!sha) {
      const commits = await repo.log({ limit: 200, all: true });
      const pick = await vscode.window.showQuickPick(
        commits.map((c) => ({
          label: `$(git-commit) ${c.shortSha}`,
          description: c.subject,
          detail: `${c.authorName}  ${new Date(c.authorDate * 1000).toLocaleDateString()}`,
          sha: c.sha,
        })),
        { placeHolder: "Select commit to cherry-pick" },
      );
      if (!pick) return;
      sha = pick.sha;
    }

    const target = sha;
    // Stash entries and merges are merge commits: git needs a mainline parent.
    const mainline = await pickMainline(repo, target, "Cherry-pick");
    if (mainline === null) return;
    await withProgress(manager, `Cherry-pick ${target.slice(0, 8)}`, () =>
      repo.cherryPick(target, { mainline }),
    );
  });

  // ── Revert ───────────────────────────────────────────────────────────────

  reg("vsgit.commit.revert", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    const commits = await repo.log({ limit: 200, all: true });
    const pick = await vscode.window.showQuickPick(
      commits.map((c) => ({
        label: `$(git-commit) ${c.shortSha}`,
        description: c.subject,
        detail: `${c.authorName}  ${new Date(c.authorDate * 1000).toLocaleDateString()}`,
        sha: c.sha,
      })),
      { placeHolder: "Select commit to revert" },
    );
    if (!pick) return;

    const confirmed = await confirmDestructiveAction({
      operation: "revertCommit",
      message: `Revert commit ${pick.sha.slice(0, 8)}?\nThis creates a new commit undoing the changes.`,
    });
    if (!confirmed) return;

    const mainline = await pickMainline(repo, pick.sha, "Revert");
    if (mainline === null) return;
    await withProgress(manager, `Revert ${pick.sha.slice(0, 8)}`, () =>
      repo.revert(pick.sha, { mainline }),
    );
  });

  // ── Squash commits ───────────────────────────────────────────────────────

  reg("vsgit.commit.squash", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    const commits = await repo.log({ limit: 50 });
    if (commits.length < 2) {
      vscode.window.showWarningMessage("Not enough commits to squash.");
      return;
    }

    const squashable = commits.slice(1).filter((c) => c.parents.length > 0);
    if (squashable.length === 0) {
      vscode.window.showWarningMessage(
        "Cannot squash: the remaining history is a root commit with no parent.",
      );
      return;
    }

    const picks = await vscode.window.showQuickPick(
      squashable.map((c) => ({
        label: `$(git-commit) ${c.shortSha}`,
        description: c.subject,
        detail: `${c.authorName}  ${new Date(c.authorDate * 1000).toLocaleDateString()}`,
        sha: c.sha,
        picked: false,
      })),
      {
        placeHolder: "Select the oldest commit to include in the squash (it and every newer commit become one)",
        canPickMany: false,
      },
    );
    if (!picks) return;

    // The squash re-commits whatever is staged; don't silently fold unrelated
    // staged work into the rewritten commit.
    if (repo.stagedChanges.length > 0) {
      vscode.window.showWarningMessage(
        "Commit, unstage, or stash your staged changes before squashing commits.",
      );
      return;
    }

    const confirmed = await confirmDestructiveAction({
      operation: "squashCommits",
      message: `Squash ${picks.sha.slice(0, 8)} and every newer commit into one?\nThis rewrites history — only do this on unpublished commits.`,
    });
    if (!confirmed) return;

    const newMessage = await vscode.window.showInputBox({
      prompt: "Combined commit message",
      value: commits[0].subject,
      validateInput: (v) => (v.trim() === "" ? "Message required" : undefined),
    });
    if (newMessage === undefined) return;

    await withProgress(manager, "Squash commits", async () => {
      // Soft reset to base, then recommit everything as one
      await repo.reset(`${picks.sha}^`, "soft");
      await repo.commit(newMessage);
    });
  });

  // ── GPG signature verification ───────────────────────────────────────────

  reg("vsgit.commit.verifyGpg", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    const commits = await repo.log({ limit: 100 });
    const pick = await vscode.window.showQuickPick(
      commits.map((c) => ({
        label: `$(git-commit) ${c.shortSha}`,
        description: c.subject,
        detail: `${c.authorName}  ${new Date(c.authorDate * 1000).toLocaleDateString()}`,
        sha: c.sha,
      })),
      { placeHolder: "Select commit to verify GPG signature" },
    );
    if (!pick) return;

    try {
      const result = await repo.verifyCommitSignature(pick.sha);
      if (result.valid) {
        vscode.window.showInformationMessage(
          `$(verified) GPG signature valid\nSigned by: ${result.signer}\nKey ID: ${result.keyId}`,
        );
      } else {
        vscode.window.showWarningMessage(
          `$(unverified) GPG signature invalid or missing\n${result.error ?? "No signature found"}`,
        );
      }
    } catch (e) {
      vscode.window.showErrorMessage(`GPG verify failed: ${errMsg(e)}`);
    }
  });

  // ── Fetch GitHub Pull Requests ────────────────────────────────────────────

  reg("vsgit.fetchGithubPrs", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    if (repo.remotes.length === 0) {
      vscode.window.showWarningMessage("No remotes configured.");
      return;
    }

    const remoteName = repo.remotes.length === 1
      ? repo.remotes[0].name
      : await vscode.window.showQuickPick(
          repo.remotes.map((r) => r.name),
          { placeHolder: "Select remote (GitHub)" },
        );
    if (!remoteName) return;

    const prRefspec = `refs/pull/*/head:refs/remotes/${remoteName}/pr/*`;
    const prTarget = `+refs/pull/*/head:refs/remotes/${remoteName}/pr/*`;

    const ok = await withProgress(manager, `Fetching GitHub PRs from ${remoteName}`, async () => {
      await creds.withAskpass((env) =>
        repo.fetchRefspec(remoteName, prTarget, env),
      );
    });
    if (!ok) return;

    vscode.window.showInformationMessage(
      `GitHub PRs fetched. Local refs: refs/remotes/${remoteName}/pr/<number>`,
    );
    void prRefspec; // suppress unused variable lint
  });

  // ── Switch To (quick branch switcher) ────────────────────────────────────

  reg("vsgit.switchTo", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    const items: BranchItem[] = [
      ...repo.localBranches.map((b) => ({
        label: `$(git-branch) ${b.shortName}`,
        description: b.isHead ? "current" : "",
        branchName: b.shortName,
        branchKind: "local" as const,
      })),
      ...repo.remoteBranches.filter((b) => !b.shortName.endsWith("/HEAD")).map((b) => ({
        label: `$(cloud) ${b.shortName}`,
        description: "remote",
        branchName: b.shortName,
        branchKind: "remote" as const,
      })),
      ...repo.tags.map((t) => ({
        label: `$(tag) ${t.shortName}`,
        description: "tag",
        branchName: t.shortName,
        branchKind: "tag" as const,
      })),
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Switch branch (current: ${repo.headName})`,
      matchOnDescription: true,
    });
    if (!pick) return;

    if (pick.branchKind === "remote") {
      await checkoutRemoteBranchInteractive(manager, repo, pick.branchName);
    } else {
      await withProgress(manager, `Switch to ${pick.branchName}`, async () => {
        await repo.checkoutRef(pick.branchName);
      });
    }
  });

  // ── Branches / tags containing a commit ──────────────────────────────────

  reg("vsgit.commit.showContaining", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    let sha: string | undefined;
    if (n && n.type === "stash") {
      sha = n.ref;
    } else {
      const commits = await repo.log({ limit: 200, all: true });
      const pick = await vscode.window.showQuickPick(
        commits.map((c) => ({
          label: `$(git-commit) ${c.shortSha}`,
          description: c.subject,
          detail: `${c.authorName}  ${new Date(c.authorDate * 1000).toLocaleDateString()}`,
          sha: c.sha,
        })),
        { placeHolder: "Select commit to inspect" },
      );
      if (!pick) return;
      sha = pick.sha;
    }

    try {
      const [branches, tags, described] = await Promise.all([
        repo.branchesContaining(sha),
        repo.tagsContaining(sha),
        repo.describe(sha),
      ]);

      const items: vscode.QuickPickItem[] = [
        { label: `$(git-commit) ${described}`, description: "git describe" },
      ];
      if (branches.length > 0) {
        items.push({ label: "Branches", kind: vscode.QuickPickItemKind.Separator });
        items.push(...branches.map((b) => ({ label: `$(git-branch) ${b}` })));
      }
      if (tags.length > 0) {
        items.push({ label: "Tags", kind: vscode.QuickPickItemKind.Separator });
        items.push(...tags.map((t) => ({ label: `$(tag) ${t}` })));
      }
      if (branches.length === 0 && tags.length === 0) {
        items.push({ label: "$(info) Not contained in any branch or tag" });
      }

      await vscode.window.showQuickPick(items, {
        placeHolder: `${sha.slice(0, 8)} — branches & tags containing this commit`,
      });
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to inspect commit: ${errMsg(e)}`);
    }
  });

  // ── Merge Tool (per-file) ─────────────────────────────────────────────────

  reg("vsgit.mergeTool", async (node) => {
    await vscode.commands.executeCommand("vsgit.conflict.openMergeEditor", node);
  });

  // ── Rebase live progress status bar ──────────────────────────────────────

  reg("vsgit.rebase.showProgress", async (node) => {
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    const op = await repo.inProgressOperation();
    if (!op) {
      vscode.window.showInformationMessage("No rebase/merge/cherry-pick in progress.");
      return;
    }

    // Every paused operation can be continued (after resolving conflicts) or
    // aborted; all but a merge can also skip the current step.
    const actions = op === "merge" ? ["Continue", "Abort"] : ["Continue", "Skip", "Abort"];

    const choice = await vscode.window.showInformationMessage(
      `${op.charAt(0).toUpperCase() + op.slice(1)} in progress. What would you like to do?`,
      ...actions,
    );

    if (!choice) return;

    const action = choice.toLowerCase() as "continue" | "skip" | "abort";
    await withProgress(manager, `${op} --${action}`, () =>
      runSequencerAction(repo, op, action),
    );
  });
}

/** SHA from a stash, compare-view commit, or synchronize-view commit node. */
function shaFromNode(node: unknown): string | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }
  const n = node as { type?: string; ref?: string; commit?: { sha?: string } };
  if (n.type === "stash" && typeof n.ref === "string") {
    return n.ref;
  }
  if (typeof n.commit?.sha === "string") {
    return n.commit.sha;
  }
  return undefined;
}
