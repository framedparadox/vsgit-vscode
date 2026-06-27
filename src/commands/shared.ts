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
 * Pull a `rootUri` out of an argument passed by VS Code's native Git SCM menus.
 * `scm/sourceControl` items receive a `SourceControl` with a `.rootUri`; some
 * native objects nest it under `.provider`. Returns undefined for shapes that
 * carry no root (e.g. a `SourceControlResourceGroup`).
 */
function nativeScmRootUri(arg: unknown): vscode.Uri | undefined {
  if (!arg || typeof arg !== "object") {
    return undefined;
  }
  const candidate =
    (arg as { rootUri?: unknown }).rootUri ??
    (arg as { provider?: { rootUri?: unknown } }).provider?.rootUri;
  return candidate instanceof vscode.Uri ? candidate : undefined;
}

/**
 * Resolve the repository for a command invocation.
 *
 * Handles three argument sources:
 * - VsGit tree nodes (carry a `.repo`).
 * - VS Code native Git SCM menus (carry a `.rootUri`, mapped via the manager).
 * - The command palette / native resource-group menus (no usable target):
 *   single repo, otherwise a quick-pick.
 */
export async function resolveRepo(
  manager: RepositoryManager,
  node?: VsgitNode | unknown,
): Promise<Repository | undefined> {
  if (node && typeof node === "object" && "repo" in node) {
    return (node as { repo: Repository }).repo;
  }

  const rootUri = nativeScmRootUri(node);
  if (rootUri) {
    const byRoot = manager.get(rootUri.fsPath) ?? manager.findByUri(rootUri);
    if (byRoot) {
      return byRoot;
    }
  }

  const repos = manager.getAll();
  if (repos.length === 0) {
    vscode.window.showWarningMessage("No Git repositories found.");
    return undefined;
  }
  if (repos.length === 1) {
    return repos[0];
  }

  // No explicit target (native "Changes" group ellipsis or the palette): in a
  // multi-repo workspace, prefer the repo for the active editor before asking.
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

/** Run an operation, refresh views, and surface errors uniformly. */
export async function withProgress(
  manager: RepositoryManager,
  title: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.SourceControl, title },
      fn,
    );
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
