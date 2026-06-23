import * as vscode from "vscode";
import { GitExecutor } from "./GitExecutor";
import { isOptionLike } from "./argGuard";

export const VSGIT_SCHEME = "vsgit";
export const VSGIT_EMPTY_REF = "~empty";

/**
 * Serves file contents at a given git revision (or the index) so VS Code's
 * native diff editor can render side-by-side comparisons.
 *
 * URI shape: vsgit:<encoded-absolute-path>?repo=<root>&ref=<rev>&path=<repoRelPath>
 * where ref is "~index" for the staged copy, or any revision (HEAD, sha, ...).
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
}
