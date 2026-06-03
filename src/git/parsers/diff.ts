export interface DiffHunk {
  /** Index of the @@ header line within the file's diff body lines. */
  headerLine: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The @@ ... @@ header text. */
  header: string;
  /** Body lines including leading ' ', '+', '-' (no newline). */
  lines: string[];
}

export interface FileDiff {
  /** Everything before the first @@ hunk (the "diff --git ... +++ b/..." preamble). */
  headerLines: string[];
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse a single-file unified diff (output of `git diff [--cached] -- <file>`).
 * Used to build partial patches for hunk/line staging.
 */
export function parseUnifiedDiff(diff: string): FileDiff {
  const all = diff.split("\n");
  const headerLines: string[] = [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let seenHunk = false;

  for (let i = 0; i < all.length; i++) {
    const line = all[i];
    const m = HUNK_RE.exec(line);
    if (m) {
      seenHunk = true;
      current = {
        headerLine: i,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        header: line,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!seenHunk) {
      if (line !== "") {
        headerLines.push(line);
      }
      continue;
    }
    if (current) {
      // Stop adding once we hit a trailing empty token after the diff.
      if (line === "" && i === all.length - 1) {
        continue;
      }
      current.lines.push(line);
    }
  }

  return { headerLines, hunks };
}

/**
 * Build a minimal, applyable patch containing a single hunk, suitable for
 * `git apply --cached` (forward) or `git apply --cached --reverse` (unstage).
 */
export function buildHunkPatch(file: FileDiff, hunk: DiffHunk): string {
  const body = [hunk.header, ...hunk.lines].join("\n");
  return file.headerLines.join("\n") + "\n" + body + "\n";
}
