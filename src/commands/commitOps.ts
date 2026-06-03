import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { VsgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, withProgress, errMsg } from "./shared";
import { confirmDestructiveAction } from "../util/confirmation";
import { Credentials } from "../util/credentials";

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
        { placeHolder: "Select commit to cherry-pick" },
      );
      if (!pick) return;
      sha = pick.sha;
    }

    await withProgress(manager, `Cherry-pick ${sha.slice(0, 8)}`, async () => {
      await repo.cherryPick(sha!);
    });
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

    await withProgress(manager, `Revert ${pick.sha.slice(0, 8)}`, async () => {
      await repo.revert(pick.sha);
    });
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

    const picks = await vscode.window.showQuickPick(
      commits.slice(1).map((c) => ({
        label: `$(git-commit) ${c.shortSha}`,
        description: c.subject,
        detail: `${c.authorName}  ${new Date(c.authorDate * 1000).toLocaleDateString()}`,
        sha: c.sha,
        picked: false,
      })),
      {
        placeHolder: "Select the base commit to squash into HEAD (all commits above it will be squashed)",
        canPickMany: false,
      },
    );
    if (!picks) return;

    const confirmed = await confirmDestructiveAction({
      operation: "squashCommits",
      message: `Squash all commits since ${picks.sha.slice(0, 8)} into HEAD?\nThis rewrites history — only do this on unpublished commits.`,
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

    await withProgress(manager, `Fetching GitHub PRs from ${remoteName}`, async () => {
      await creds.withAskpass((env) =>
        repo.fetchRefspec(remoteName, prTarget, env),
      );
    });

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
      ...repo.remoteBranches.map((b) => ({
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
      const localName = pick.branchName.replace(/^[^/]+\//, "");
      const proposedName = await vscode.window.showInputBox({
        prompt: "Local branch name",
        value: localName,
        validateInput: (v) => (v.trim() === "" ? "Required" : undefined),
      });
      if (!proposedName) return;
      await withProgress(manager, `Checkout ${pick.branchName} → ${proposedName}`, async () => {
        await repo.checkoutRemoteBranch(pick.branchName, proposedName.trim());
      });
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
    const n = node as VsgitNode | undefined;
    const repo = n && "repo" in n ? n.repo : await resolveRepo(manager, undefined);
    if (!repo) return;

    const conflicted = repo.conflictedPaths;
    if (conflicted.length === 0) {
      vscode.window.showInformationMessage("No conflicts to resolve.");
      return;
    }

    const picks = await vscode.window.showQuickPick(
      conflicted.map((p) => ({ label: `$(warning) ${p}`, path: p })),
      { placeHolder: "Select file to open in merge tool", canPickMany: false },
    );
    if (!picks) return;

    const absPath = `${repo.root}/${picks.path}`;
    const uri = vscode.Uri.file(absPath);

    // Use VS Code built-in merge editor if available, otherwise open file
    try {
      await vscode.commands.executeCommand(
        "mergeEditor.acceptAllCurrentAndGoNext",
        uri,
      );
    } catch {
      // Fall back: open the conflicted file, let the user resolve manually
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(
        `Resolve conflicts in ${picks.path}, then run "Mark Resolved" (vsgit.conflicts.markResolved).`,
      );
    }
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

    const actions: string[] = [];
    if (op === "rebase" || op === "cherry-pick") {
      actions.push("Continue", "Skip", "Abort");
    } else if (op === "merge") {
      actions.push("Abort");
    } else if (op === "revert") {
      actions.push("Continue", "Abort");
    }

    const choice = await vscode.window.showInformationMessage(
      `${op.charAt(0).toUpperCase() + op.slice(1)} in progress. What would you like to do?`,
      ...actions,
    );

    if (!choice) return;

    const action = choice.toLowerCase() as "continue" | "skip" | "abort";
    if (op === "rebase" || op === "merge" || op === "cherry-pick" || op === "revert") {
      await withProgress(manager, `${op} --${action}`, async () => {
        await repo.sequencerAction(op, action);
      });
    }
  });
}
