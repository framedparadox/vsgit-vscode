import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { VsgitNode } from "../views/RepositoriesProvider";
import { GitCommandCancelled } from "../git/GitExecutor";
import { GitError } from "../git/GitError";

export function errMsg(err: unknown): string {
  if (err instanceof GitCommandCancelled) {
    return "Cancelled.";
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Returns a human-readable message for common git failure patterns.
 * Falls back to the first line of stderr, then the generic error message.
 */
export function humanizeGitError(err: unknown): string {
  if (!(err instanceof GitError)) {
    if (err instanceof GitCommandCancelled) {
      return "Cancelled.";
    }
    return errMsg(err);
  }
  const stderr = err.stderr ?? "";
  const firstLine = stderr.split("\n").find((l) => l.trim().length > 0) ?? "";

  if (/Authentication failed|could not read Username|Invalid username or password/i.test(stderr)) {
    return "Authentication failed. Check your credential helper or remote URL.";
  }
  if (/not a git repository/i.test(stderr)) {
    return "Not a git repository.";
  }
  if (/could not resolve host|network is unreachable|connection refused|timed out/i.test(stderr)) {
    return `Network error — check connectivity. (${firstLine})`;
  }
  if (/non-fast-forward|Updates were rejected/i.test(stderr)) {
    return "Push rejected (non-fast-forward). Pull first or use force push.";
  }
  if (/CONFLICT/i.test(stderr)) {
    return "Merge conflict — resolve conflicts and commit.";
  }
  if (/Please tell me who you are/i.test(stderr)) {
    return "Git user identity not configured. Run: git config --global user.email and user.name";
  }

  return firstLine || errMsg(err);
}

/**
 * Resolve the repository for a command invocation.
 *
 * Handles two argument sources:
 * - VsGit tree nodes and webview payloads (carry a `.repo`).
 * - The command palette (no usable target): single repo, the active editor's
 *   repo, otherwise a quick-pick.
 */
export async function resolveRepo(
  manager: RepositoryManager,
  node?: VsgitNode | unknown,
): Promise<Repository | undefined> {
  if (node && typeof node === "object" && "repo" in node) {
    return (node as { repo: Repository }).repo;
  }

  const repos = manager.getAll();
  if (repos.length === 0) {
    vscode.window.showWarningMessage("No Git repositories found.");
    return undefined;
  }
  if (repos.length === 1) {
    return repos[0];
  }

  // No explicit target (the palette): in a multi-repo workspace, prefer the
  // repo for the active editor before asking.
  const activeDoc = vscode.window.activeTextEditor?.document.uri;
  const byActiveDoc = activeDoc ? manager.findByUri(activeDoc) : undefined;
  if (byActiveDoc) {
    return byActiveDoc;
  }

  const pick = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: r.name, repo: r })),
    { placeHolder: "Select a repository" },
  );
  return pick?.repo;
}

/**
 * Show progress for a git operation in VsGit's own surfaces: a spinner with
 * the title in the status bar, plus the busy indicator on the Repositories
 * view (and the VsGit activity-bar icon). VsGit deliberately stays out of the
 * native Source Control view.
 */
export function showGitProgress<T>(title: string, fn: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title },
    () =>
      vscode.window.withProgress(
        { location: { viewId: "vsgit.repositoriesList" } },
        fn,
      ),
  );
}

/** Run an operation, refresh views, and surface errors uniformly. */
export async function withProgress(
  manager: RepositoryManager,
  title: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await showGitProgress(title, fn);
    await manager.refreshAll();
    return true;
  } catch (e) {
    if (e instanceof GitCommandCancelled) {
      await manager.refreshAll();
      return false;
    }
    vscode.window.showErrorMessage(`${title} failed: ${humanizeGitError(e)}`);
    await manager.refreshAll();
    return false;
  }
}

/**
 * Cherry-picking or reverting a merge commit needs a mainline parent (git's
 * `-m <n>`). Returns undefined for an ordinary commit, the chosen 1-based
 * parent number for a merge, or null when the user cancels the choice.
 */
export async function pickMainline(
  repo: Repository,
  sha: string,
  action: string,
): Promise<number | undefined | null> {
  const parents = await repo.commitParents(sha);
  if (parents.length < 2) {
    return undefined;
  }
  const subjects = await Promise.all(
    parents.map((parent) => repo.commitSubject(parent).catch(() => "")),
  );
  const pick = await vscode.window.showQuickPick(
    parents.map((parent, i) => ({
      label: `Parent ${i + 1}: ${parent.slice(0, 8)}`,
      description: subjects[i],
      detail: i === 0 ? "The branch that was merged into — the usual choice" : undefined,
      mainline: i + 1,
    })),
    { placeHolder: `${sha.slice(0, 8)} is a merge commit. ${action} relative to which parent?` },
  );
  return pick ? pick.mainline : null;
}

/**
 * Check out a remote-tracking branch as a local branch. Reuses a local branch
 * that already tracks it (a second `checkout -b` would fail with "already
 * exists"), otherwise asks for the new branch's name.
 */
export async function checkoutRemoteBranchInteractive(
  manager: RepositoryManager,
  repo: Repository,
  remoteBranch: string,
): Promise<void> {
  const tracking = repo.localBranches.find((b) => b.upstream === remoteBranch);
  if (tracking) {
    await withProgress(manager, `Checkout ${tracking.shortName}`, () =>
      repo.checkoutRef(tracking.shortName),
    );
    return;
  }
  const suggested = repo.splitRemoteBranch(remoteBranch)?.branch ?? remoteBranch;
  const localName = await vscode.window.showInputBox({
    prompt: `Local branch name (will track ${remoteBranch})`,
    value: suggested,
    validateInput: (v) =>
      v.trim() === ""
        ? "Required"
        : repo.localBranches.some((b) => b.shortName === v.trim())
          ? `A local branch named '${v.trim()}' already exists`
          : undefined,
  });
  if (!localName) return;
  await withProgress(manager, `Checkout ${remoteBranch} → ${localName.trim()}`, () =>
    repo.checkoutRemoteBranch(remoteBranch, localName.trim()),
  );
}
