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
  /** True when HEAD points at this commit (attached or detached). */
  isHead: boolean;
}

/**
 * NUL-separated, one-line-per-commit format for the graph log. Fields, in order:
 * full SHA, short SHA, subject, author name, author date (ISO), committer name,
 * committer date (ISO), space-joined parent SHAs, and `%D` ref names. A literal
 * NUL can never appear in any field, so a plain split is unambiguous.
 */
export const GRAPH_LOG_FORMAT = "%H%x00%h%x00%s%x00%an%x00%ai%x00%cn%x00%ci%x00%P%x00%D";

/**
 * Internal refs that `git log --all` would otherwise walk. Each must precede
 * `--all` (an `--exclude` applies to the next ref-selecting option).
 */
export const GRAPH_REF_EXCLUDES: readonly string[] = [
  "--exclude=refs/stash",
  "--exclude=refs/notes/*",
  "--exclude=refs/prefetch/*",
  "--exclude=refs/replace/*",
  "--exclude=refs/original/*",
];

/** Parse `git log --format=GRAPH_LOG_FORMAT` output into commit records. */
export function parseGraphLog(output: string): GraphCommit[] {
  const lines = output.trim().split("\n").filter((l) => l.length > 0);
  return lines.map((line) => {
    const [sha, shortSha, message, author, date, committer, committerDate, parentsStr, refsStr] =
      line.split("\x00");
    const parents = parentsStr ? parentsStr.split(" ").filter(Boolean) : [];
    const decorations = refsStr
      ? refsStr.split(", ").map((r) => r.trim()).filter((r) => r.length > 0)
      : [];
    const isHead = decorations.some((r) => r === "HEAD" || r.startsWith("HEAD -> "));
    const refs = decorations
      .map((r) => r.replace(/^HEAD -> /, ""))
      .filter((r) => r.length > 0);
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
      isHead,
    };
  });
}

export type GraphRefType = "head" | "localBranch" | "remoteBranch" | "tag";

/**
 * Classify one `%D` decoration printed with `--decorate=full`. Returns
 * undefined for decorations the graph does not show (remote `HEAD` symrefs,
 * stash, notes, and other internal refs).
 *
 * `currentBranch` is the checked-out branch; its pill is marked as the head.
 */
export function classifyGraphRef(
  raw: string,
  currentBranch: string | undefined,
): { name: string; type: GraphRefType } | undefined {
  if (raw === "HEAD") {
    // Detached HEAD (an attached HEAD arrives as "refs/heads/<branch>").
    return { name: "HEAD", type: "head" };
  }
  if (raw.startsWith("tag: ")) {
    const full = raw.slice("tag: ".length);
    return full.startsWith("refs/tags/")
      ? { name: full.slice("refs/tags/".length), type: "tag" }
      : { name: full, type: "tag" };
  }
  if (raw.startsWith("refs/heads/")) {
    const name = raw.slice("refs/heads/".length);
    return { name, type: name === currentBranch ? "head" : "localBranch" };
  }
  if (raw.startsWith("refs/remotes/")) {
    const name = raw.slice("refs/remotes/".length);
    // `origin/HEAD` is a symbolic pointer to the remote's default branch, not a
    // branch of its own; it would only duplicate that branch's pill.
    if (name.endsWith("/HEAD")) {
      return undefined;
    }
    return { name, type: "remoteBranch" };
  }
  return undefined;
}
