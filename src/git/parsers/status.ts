export type FileChangeState =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "conflicted";

export interface FileChange {
  /** Repo-relative path (the destination path for renames/copies). */
  path: string;
  /** Original path for renames/copies. */
  origPath?: string;
  /** State in the index (staged side). Undefined when unstaged-only. */
  indexState?: FileChangeState;
  /** State in the working tree (unstaged side). Undefined when staged-only. */
  worktreeState?: FileChangeState;
  /** True for unmerged/conflicted entries. */
  conflicted: boolean;
}

export interface StatusResult {
  changes: FileChange[];
}

function xyToState(code: string): FileChangeState | undefined {
  switch (code) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return undefined;
  }
}

/**
 * Parse `git status --porcelain=v2 -z --untracked-files=all`.
 *
 * porcelain v2 record types:
 *   1 <XY> ... <path>                      ordinary changed entry
 *   2 <XY> ... <path>\0<origPath>          renamed/copied (NUL-separated paths)
 *   u <xy> ... <path>                      unmerged (conflict)
 *   ? <path>                               untracked
 *   ! <path>                               ignored
 */
export function parseStatusV2(output: string): StatusResult {
  const tokens = output.split("\0");
  const changes: FileChange[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry === "") {
      continue;
    }
    const type = entry[0];

    if (type === "1") {
      // "1 XY sub mH mI mW hH hI path" — path is the 9th field onward.
      const xy = entry.slice(2, 4);
      const fields = entry.split(" ");
      const filePath = fields.slice(8).join(" ");
      changes.push(makeChange(xy, filePath));
    } else if (type === "2") {
      // "2 XY sub mH mI mW hH hI Xscore path" then NUL then origPath
      const xy = entry.slice(2, 4);
      const fields = entry.split(" ");
      const filePath = fields.slice(9).join(" ");
      const origPath = tokens[++i] ?? "";
      const change = makeChange(xy, filePath);
      change.origPath = origPath;
      changes.push(change);
    } else if (type === "u") {
      const filePath = entry.split(" ").slice(10).join(" ");
      changes.push({
        path: filePath,
        conflicted: true,
        indexState: "conflicted",
        worktreeState: "conflicted",
      });
    } else if (type === "?") {
      changes.push({
        path: entry.slice(2),
        conflicted: false,
        worktreeState: "untracked",
      });
    } else if (type === "!") {
      changes.push({
        path: entry.slice(2),
        conflicted: false,
        worktreeState: "ignored",
      });
    }
  }

  return { changes };
}

function makeChange(xy: string, filePath: string): FileChange {
  const indexState = xyToState(xy[0]);
  const worktreeState = xyToState(xy[1]);
  return {
    path: filePath,
    indexState,
    worktreeState,
    conflicted: false,
  };
}
