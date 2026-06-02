export interface CommitRef {
  /** Short name, e.g. main, origin/main, v1, HEAD. */
  name: string;
  kind: "head" | "localBranch" | "remoteBranch" | "tag" | "other";
}

export interface Commit {
  sha: string;
  shortSha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Author date as unix seconds. */
  authorDate: number;
  committerName: string;
  /** Committer date as unix seconds. */
  committerDate: number;
  subject: string;
  body: string;
  refs: CommitRef[];
}

/**
 * Field-separated, record-separated format for `git log`. We use unit (\x1f)
 * and record (\x1e) separators that cannot appear in the textual fields. The
 * body is last so embedded newlines are unambiguous.
 *
 *   %H sha, %P parents, %an %ae author, %at author date,
 *   %cn committer name, %ct committer date,
 *   %D ref names, %s subject, %b body
 */
export const LOG_FORMAT =
  "%H\x1f%P\x1f%an\x1f%ae\x1f%at\x1f%cn\x1f%ct\x1f%D\x1f%s\x1f%b\x1e";

function classifyRef(raw: string): CommitRef | undefined {
  let name = raw.trim();
  if (name === "") {
    return undefined;
  }
  // "HEAD -> main" — the HEAD pointer.
  if (name.startsWith("HEAD -> ")) {
    return { name: name.slice("HEAD -> ".length), kind: "head" };
  }
  if (name === "HEAD") {
    return { name: "HEAD", kind: "head" };
  }
  if (name.startsWith("tag: ")) {
    return { name: name.slice("tag: ".length), kind: "tag" };
  }
  if (name.includes("/")) {
    return { name, kind: "remoteBranch" };
  }
  return { name, kind: "localBranch" };
}

/** Parse `git log --format=LOG_FORMAT`. */
export function parseLog(output: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of output.split("\x1e")) {
    if (record.trim() === "") {
      continue;
    }
    // Leading newline between records from the trailing %b — strip it.
    const clean = record.replace(/^\n/, "");
    const [sha, parents, an, ae, at, cn, ct, refNames, subject, body] =
      clean.split("\x1f");
    if (!sha) {
      continue;
    }
    const refs = (refNames ?? "")
      .split(",")
      .map(classifyRef)
      .filter((r): r is CommitRef => r !== undefined);
    commits.push({
      sha,
      shortSha: sha.slice(0, 8),
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      authorName: an ?? "",
      authorEmail: ae ?? "",
      authorDate: Number(at ?? 0),
      committerName: cn ?? "",
      committerDate: Number(ct ?? 0),
      subject: subject ?? "",
      body: (body ?? "").replace(/\n+$/, ""),
      refs,
    });
  }
  return commits;
}

export interface CommitFile {
  status: string;
  path: string;
  origPath?: string;
}

/** Parse `git show --name-status -z --format=` (or diff-tree) output. */
export function parseNameStatus(output: string): CommitFile[] {
  const tokens = output.split("\0").filter((t) => t !== "");
  const files: CommitFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i];
    if (status.startsWith("R") || status.startsWith("C")) {
      const origPath = tokens[++i];
      const path = tokens[++i];
      files.push({ status: status[0], path, origPath });
    } else {
      const path = tokens[++i];
      files.push({ status: status[0], path });
    }
  }
  return files;
}
