import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { isInsideGitDir } from "../git/discovery";

/**
 * VS Code-level change detection that complements RepositoryManager's
 * node:fs watchers on the Git directories:
 *
 * - `.git` sentinel files (HEAD, MERGE_HEAD, …) catch branch switches, merge
 *   starts, and external commits.
 * - Working-tree files: creating, editing, deleting, or saving a file changes
 *   `git status`, but touches nothing inside `.git`, so without this the
 *   Commit/Staging views and file decorations would only update on a manual
 *   refresh.
 *
 * Every event funnels into the manager's single debounced refresh.
 */
export class GitWatcherService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    _context: vscode.ExtensionContext,
    private readonly manager: RepositoryManager,
  ) {
    const sentinels = vscode.workspace.createFileSystemWatcher(
      "**/.git/{HEAD,MERGE_HEAD,COMMIT_EDITMSG,CHERRY_PICK_HEAD,REVERT_HEAD}",
    );
    sentinels.onDidChange(() => this.manager.requestRefresh(), this, this.disposables);
    sentinels.onDidCreate(() => this.manager.requestRefresh(), this, this.disposables);
    sentinels.onDidDelete(() => this.manager.requestRefresh(), this, this.disposables);
    this.disposables.push(sentinels);

    // Honours `files.watcherExclude`, so dependency and build folders the user
    // has excluded never cause a status refresh.
    const workingTree = vscode.workspace.createFileSystemWatcher("**/*");
    const onWorkingTreeEvent = (uri: vscode.Uri) => this.onWorkingTreeEvent(uri);
    workingTree.onDidChange(onWorkingTreeEvent, this, this.disposables);
    workingTree.onDidCreate(onWorkingTreeEvent, this, this.disposables);
    workingTree.onDidDelete(onWorkingTreeEvent, this, this.disposables);
    this.disposables.push(
      workingTree,
      vscode.workspace.onDidSaveTextDocument((doc) => this.onWorkingTreeEvent(doc.uri)),
    );
  }

  private onWorkingTreeEvent(uri: vscode.Uri): void {
    // Changes inside the Git directory are handled (and loop-filtered) by
    // RepositoryManager's own watchers.
    if (uri.scheme !== "file" || isInsideGitDir(uri.fsPath)) {
      return;
    }
    if (this.manager.findByUri(uri)) {
      this.manager.requestRefresh();
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
