import * as vscode from "vscode";
import { GitExecutor } from "./GitExecutor";
import { isOptionLike } from "./argGuard";

export const EGIT_SCHEME = "egit";

/**
 * Serves file contents at a given git revision (or the index) so VS Code's
 * native diff editor can render side-by-side comparisons.
 *
 * URI shape: egit:<absolute-path>?repo=<root>&ref=<rev>&path=<repoRelPath>
 * where ref is "~index" for the staged copy, or any revision (HEAD, sha, ...).
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private readonly git = new GitExecutor();

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const repo = params.get("repo") ?? "";
    const ref = params.get("ref") ?? "HEAD";
    const relPath = params.get("path") ?? "";
    const spec = ref === "~index" ? `:${relPath}` : `${ref}:${relPath}`;
    // `git show <spec>` takes no `--` separator for an object spec, so guard
    // against a ref/spec that git would otherwise parse as an option.
    if (isOptionLike(spec)) {
      return "";
    }
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
    return vscode.Uri.parse(
      `${EGIT_SCHEME}:${absPath}?${query.toString()}`,
    );
  }
}
