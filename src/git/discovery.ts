import * as fs from "node:fs";
import * as path from "node:path";

/** Directories never worth descending into while looking for checkouts. */
const SCAN_SKIP = new Set(["node_modules", "bower_components", "vendor", "dist", "out", "build"]);
/** Upper bound on directories inspected per workspace folder. */
const SCAN_MAX_DIRECTORIES = 2_000;

/**
 * Subdirectories of `folder` (down to `maxDepth` levels) that contain a `.git`
 * entry — a directory for normal clones, a file for worktrees/submodules.
 */
export async function findGitCheckouts(folder: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || visited >= SCAN_MAX_DIRECTORIES) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SCAN_SKIP.has(entry.name)) {
        continue;
      }
      if (++visited > SCAN_MAX_DIRECTORIES) {
        return;
      }
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, ".git"))) {
        found.push(child);
      } else {
        await walk(child, depth + 1);
      }
    }
  };
  await walk(folder, 1);
  return found.sort();
}

/** True for `…/.git` itself and anything below a `.git` path segment. */
export function isInsideGitDir(fsPath: string): boolean {
  return /(^|[\\/])\.git([\\/]|$)/.test(fsPath);
}
