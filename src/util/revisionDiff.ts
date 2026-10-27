/**
 * Shared helpers for side-by-side git diffs. Rename-aware name-status
 * records the old path separately; the left (older) side must use that path
 * or `git show` yields an empty document and the diff looks like a full add.
 */

/**
 * Abbreviate a full SHA for titles, keeping any parent suffix so `<sha>~1`
 * reads `01234567~1`. Symbolic refs and short SHAs are returned unchanged.
 */
export function shortRefLabel(ref: string): string {
  const m = /^([0-9a-f]{40})((?:[~^]\d*)*)$/i.exec(ref);
  return m ? m[1].slice(0, 8) + m[2] : ref;
}

/** Left/right repo-relative paths for a name-status file row. */
export function diffPathsForFile(file: {
  path: string;
  origPath?: string;
}): { leftRel: string; rightRel: string } {
  return {
    leftRel: file.origPath ?? file.path,
    rightRel: file.path,
  };
}
