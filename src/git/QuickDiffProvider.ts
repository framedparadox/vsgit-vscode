import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { GitContentProvider } from "./GitContentProvider";

/**
 * Supplies the "original" (HEAD/index) version of a file so VS Code draws
 * quick-diff gutter indicators (added/changed/removed) for tracked files.
 * Registered as an SCM quick-diff provider.
 */
export class VsgitQuickDiffProvider implements vscode.QuickDiffProvider {
  constructor(
    private readonly manager: RepositoryManager,
    private readonly root?: string,
  ) {}

  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme !== "file") {
      return undefined;
    }
    const repo = this.manager.findByUri(uri);
    if (!repo) {
      return undefined;
    }
    if (this.root && repo.root !== this.root) {
      return undefined;
    }
    const rel = this.manager.relativePath(repo, uri);
    // Compare against the index so staged changes don't show as gutter diff.
    return GitContentProvider.uri(repo.root, rel, "~index", uri.fsPath);
  }
}
