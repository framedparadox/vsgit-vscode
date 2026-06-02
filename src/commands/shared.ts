import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { EgitNode } from "../views/RepositoriesProvider";
import { GitError } from "../git/GitError";

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Returns a human-readable message for common git failure patterns.
 * Falls back to the first line of stderr, then the generic error message.
 */
export function humanizeGitError(err: unknown): string {
  if (!(err instanceof GitError)) {
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

/** Resolve the repository for a node, or prompt when invoked from the palette. */
export async function resolveRepo(
  manager: RepositoryManager,
  node?: EgitNode,
): Promise<Repository | undefined> {
  if (node && "repo" in node) {
    return node.repo;
  }
  const repos = manager.getAll();
  if (repos.length === 0) {
    vscode.window.showWarningMessage("No Git repositories found.");
    return undefined;
  }
  if (repos.length === 1) {
    return repos[0];
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
    vscode.window.showErrorMessage(`${title} failed: ${humanizeGitError(e)}`);
    await manager.refreshAll();
    return false;
  }
}
