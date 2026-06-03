export interface GraphCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  /** Author date, ISO-8601 (`%ai`). */
  date: string;
  committer: string;
  /** Committer date, ISO-8601 (`%ci`). */
  committerDate: string;
  parents: string[];
  /** Flattened ref names (branch/tag/HEAD short names), HEAD-pointer stripped. */
  refs: string[];
}

/**
 * NUL-separated, one-line-per-commit format for the graph log. Fields, in order:
 * full SHA, short SHA, subject, author name, author date (ISO), committer name,
 * committer date (ISO), space-joined parent SHAs, and `%D` ref names. A literal
 * NUL can never appear in any field, so a plain split is unambiguous.
 */
export const GRAPH_LOG_FORMAT = "%H%x00%h%x00%s%x00%an%x00%ai%x00%cn%x00%ci%x00%P%x00%D";

/** Parse `git log --format=GRAPH_LOG_FORMAT` output into commit records. */
export function parseGraphLog(output: string): GraphCommit[] {
  const lines = output.trim().split("\n").filter((l) => l.length > 0);
  return lines.map((line) => {
    const [sha, shortSha, message, author, date, committer, committerDate, parentsStr, refsStr] =
      line.split("\x00");
    const parents = parentsStr ? parentsStr.split(" ").filter(Boolean) : [];
    const refs = refsStr
      ? refsStr
          .split(", ")
          .map((r) => r.trim().replace(/^HEAD -> /, ""))
          .filter((r) => r.length > 0)
      : [];
    return {
      sha: sha ?? "",
      shortSha: shortSha ?? "",
      message: message ?? "",
      author: author ?? "",
      date: date ?? "",
      committer: committer ?? "",
      committerDate: committerDate ?? "",
      parents,
      refs,
    };
  });
}
