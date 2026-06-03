export interface ReflogEntry {
  sha: string;
  shortSha: string;
  /** Reflog selector, e.g. HEAD@{0}. */
  selector: string;
  /** Action keyword, e.g. commit, checkout, reset, rebase, merge, pull. */
  action: string;
  /** Remainder of the reflog subject after "action: ". */
  message: string;
  authorName: string;
  date: number;
}

export const REFLOG_FORMAT = "%H\x1f%gd\x1f%gs\x1f%an\x1f%at";

/** Parse `git reflog --format=REFLOG_FORMAT` output. */
export function parseReflog(output: string): ReflogEntry[] {
  const entries: ReflogEntry[] = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const [sha, selector, subject, an, at] = line.split("\x1f");
    if (!sha) {
      continue;
    }
    // Subject looks like "commit: message" or "checkout: moving from a to b".
    const idx = (subject ?? "").indexOf(": ");
    const action = idx === -1 ? (subject ?? "") : subject.slice(0, idx);
    const message = idx === -1 ? "" : subject.slice(idx + 2);
    entries.push({
      sha,
      shortSha: sha.slice(0, 8),
      selector: selector ?? "",
      action,
      message,
      authorName: an ?? "",
      date: Number(at ?? 0),
    });
  }
  return entries;
}
