import * as path from "node:path";
import * as vscode from "vscode";
import { GitExecutor } from "./GitExecutor";
import { isOptionLike } from "./argGuard";
import { diffPathsForFile, shortRefLabel } from "../util/revisionDiff";

export const VSGIT_SCHEME = "vsgit";
export const VSGIT_EMPTY_REF = "~empty";

/** Index stages git records for an unmerged path (`git show :1:path`). */
export const INDEX_STAGE = {
  base: ":1",
  ours: ":2",
  theirs: ":3",
} as const;

/**
 * Serves file contents at a given git revision (or the index) so VS Code's
 * native diff editor can render side-by-side comparisons.
 *
 * URI shape: vsgit:<encoded-absolute-path>?repo=<root>&ref=<rev>&path=<repoRelPath>
 * where ref is "~index" for the staged copy, `:1`/`:2`/`:3` for merge stages,
 * or any revision (HEAD, sha, ...).
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly git: GitExecutor) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const repo = params.get("repo") ?? "";
    const ref = params.get("ref") ?? "HEAD";
    const relPath = params.get("path") ?? "";
    if (ref === VSGIT_EMPTY_REF) {
      return "";
    }
    // `git show <spec>` takes no `--` separator for an object spec, so guard
    // against a ref or path that git would otherwise parse as an option.
    if (isOptionLike(relPath) || (ref !== "~index" && isOptionLike(ref))) {
      return "";
    }
    const spec = ref === "~index" || ref === "" ? `:${relPath}` : `${ref}:${relPath}`;
    try {
      return await this.git.stdout(["show", spec], { cwd: repo });
    } catch {
      // File didn't exist at that revision (added/deleted) → empty side.
      return "";
    }
  }

  static uri(
    repoRoot: string,
    relPath: string,
    ref: string,
    absPath: string,
  ): vscode.Uri {
    const query = new URLSearchParams({ repo: repoRoot, ref, path: relPath });
    return vscode.Uri.from({
      scheme: VSGIT_SCHEME,
      path: absPath,
      query: query.toString(),
    });
  }

  /**
   * Open VS Code's native diff editor between two git revisions. For renames,
   * pass the name-status file so the left side uses `origPath`.
   */
  static async openDiff(
    repoRoot: string,
    file: { path: string; origPath?: string },
    leftRef: string,
    rightRef: string,
    title?: string,
  ): Promise<void> {
    const { leftRel, rightRel } = diffPathsForFile(file);
    const left = GitContentProvider.uri(
      repoRoot,
      leftRel,
      leftRef,
      path.join(repoRoot, leftRel),
    );
    const right = GitContentProvider.uri(
      repoRoot,
      rightRel,
      rightRef,
      path.join(repoRoot, rightRel),
    );
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      title ??
        `${path.basename(rightRel)} (${shortRefLabel(leftRef)} ↔ ${shortRefLabel(rightRef)})`,
    );
  }
}
