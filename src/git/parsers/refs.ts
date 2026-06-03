export type RefKind = "localBranch" | "remoteBranch" | "tag";

export interface RefInfo {
  /** Full ref name, e.g. refs/heads/main, refs/remotes/origin/main, refs/tags/v1. */
  fullName: string;
  /** Short display name, e.g. main, origin/main, v1. */
  shortName: string;
  kind: RefKind;
  /** Object id the ref points at. */
  objectId: string;
  /** Upstream short name for local branches, if any (e.g. origin/main). */
  upstream?: string;
  /** Subject line of the commit the ref points at. */
  subject?: string;
  /** True for the currently checked-out branch (HEAD). */
  isHead: boolean;
}

/**
 * Format string for `git for-each-ref`. Fields are separated by \x1f (unit
 * separator) and records by \x00 via the `-z`-less newline approach. We use a
 * field separator that cannot appear in ref names or subjects safely.
 */
export const FOR_EACH_REF_FORMAT =
  "%(refname)\x1f%(objectname)\x1f%(upstream:short)\x1f%(HEAD)\x1f%(contents:subject)";

function shortenRef(fullName: string): { shortName: string; kind: RefKind } | undefined {
  if (fullName.startsWith("refs/heads/")) {
    return { shortName: fullName.slice("refs/heads/".length), kind: "localBranch" };
  }
  if (fullName.startsWith("refs/remotes/")) {
    return { shortName: fullName.slice("refs/remotes/".length), kind: "remoteBranch" };
  }
  if (fullName.startsWith("refs/tags/")) {
    return { shortName: fullName.slice("refs/tags/".length), kind: "tag" };
  }
  return undefined;
}

/** Parse the newline-delimited output of `git for-each-ref --format=FOR_EACH_REF_FORMAT`. */
export function parseForEachRef(output: string): RefInfo[] {
  const refs: RefInfo[] = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const [fullName, objectId, upstream, head, subject] = line.split("\x1f");
    const short = shortenRef(fullName);
    if (!short) {
      continue;
    }
    refs.push({
      fullName,
      shortName: short.shortName,
      kind: short.kind,
      objectId,
      upstream: upstream || undefined,
      subject: subject || undefined,
      isHead: head === "*",
    });
  }
  return refs;
}
