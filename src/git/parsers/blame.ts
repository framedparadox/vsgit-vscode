export interface BlameLine {
  /** 1-based line number in the final file. */
  line: number;
  sha: string;
  shortSha: string;
  authorName: string;
  /** Author time as unix seconds. */
  authorTime: number;
  summary: string;
  /** True for not-yet-committed (working tree) lines. */
  uncommitted: boolean;
}

interface CommitMeta {
  authorName?: string;
  authorTime?: number;
  summary?: string;
}

const ZERO_SHA = "0000000000000000000000000000000000000000";

/**
 * Parse `git blame --porcelain` output. Commit metadata appears once per commit
 * (the first time its sha is seen) and is referenced by later line headers, so
 * we cache it in a map.
 */
export function parseBlamePorcelain(output: string): BlameLine[] {
  const lines = output.split("\n");
  const meta = new Map<string, CommitMeta>();
  const result: BlameLine[] = [];

  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    // Header: "<sha> <origLine> <finalLine> [<numLines>]"
    const m = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(header);
    if (!m) {
      i++;
      continue;
    }
    const sha = m[1];
    const finalLine = Number(m[2]);
    const entry = meta.get(sha) ?? {};
    i++;
    // Consume metadata lines until the content line (starts with a TAB).
    while (i < lines.length && !lines[i].startsWith("\t")) {
      const ln = lines[i];
      if (ln.startsWith("author ")) {
        entry.authorName = ln.slice("author ".length);
      } else if (ln.startsWith("author-time ")) {
        entry.authorTime = Number(ln.slice("author-time ".length));
      } else if (ln.startsWith("summary ")) {
        entry.summary = ln.slice("summary ".length);
      }
      i++;
    }
    meta.set(sha, entry);
    // Skip the content line itself (the TAB-prefixed source).
    if (i < lines.length && lines[i].startsWith("\t")) {
      i++;
    }
    const uncommitted = sha === ZERO_SHA;
    result.push({
      line: finalLine,
      sha,
      shortSha: sha.slice(0, 8),
      authorName: uncommitted ? "You" : entry.authorName ?? "",
      authorTime: entry.authorTime ?? 0,
      summary: uncommitted ? "Uncommitted changes" : entry.summary ?? "",
      uncommitted,
    });
  }

  result.sort((a, b) => a.line - b.line);
  return result;
}
