import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { GitContentProvider } from "./GitContentProvider";

/**
 * Supplies the "original" (HEAD/index) version of a file so VS Code draws
 * quick-diff gutter indicators (added/changed/removed) for tracked files.
 * Registered as an SCM quick-diff provider.
 */
export class VsgitQuickDiffProvider implements vscode.QuickDiffProvider {
  constructor(private readonly manager: RepositoryManager) {}

  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme !== "file") {
      return undefined;
    }
    const repo = this.manager
      .getAll()
      .find((r) => uri.fsPath.startsWith(r.root));
    if (!repo) {
      return undefined;
    }
    const rel = uri.fsPath.slice(repo.root.length + 1);
    // Compare against the index so staged changes don't show as gutter diff.
    return GitContentProvider.uri(repo.root, rel, "~index", uri.fsPath);
  }
}
