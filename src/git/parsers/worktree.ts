export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | undefined;
  bare: boolean;
  locked: boolean;
}

/**
 * Parse the porcelain output of `git worktree list --porcelain`.
 *
 * Records are separated by a blank line; each record is a set of `key value`
 * lines led by `worktree <path>`. `bare` and `locked` are valueless attribute
 * lines. Branch refs are shortened (`refs/heads/main` → `main`); a detached
 * worktree has a `HEAD <sha>` but no `branch` line.
 */
export function parseWorktreeList(raw: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> | undefined;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) {
        worktrees.push(finishWorktree(current));
      }
      current = { path: line.slice("worktree ".length).trim(), bare: false, locked: false };
    } else if (current) {
      if (line.startsWith("HEAD ")) {
        current.head = line.slice(5).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice(7).trim();
        // refs/heads/main -> main
        current.branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        current.bare = true;
      } else if (line.startsWith("locked")) {
        current.locked = true;
      }
    }
  }
  if (current) {
    worktrees.push(finishWorktree(current));
  }
  return worktrees;
}

function finishWorktree(partial: Partial<WorktreeInfo>): WorktreeInfo {
  return {
    path: partial.path ?? "",
    head: partial.head ?? "",
    branch: partial.branch,
    bare: partial.bare ?? false,
    locked: partial.locked ?? false,
  };
}
