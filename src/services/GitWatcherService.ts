import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";

/**
 * Watches for VS Code-level filesystem events on .git sentinel files.
 * Complements RepositoryManager's node:fs.watch with glob-based detection
 * of branch switches, merge starts, and external commits.
 */
export class GitWatcherService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(
    _context: vscode.ExtensionContext,
    private readonly manager: RepositoryManager,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/.git/{HEAD,MERGE_HEAD,COMMIT_EDITMSG,CHERRY_PICK_HEAD,REVERT_HEAD}",
    );

    watcher.onDidChange(() => this.scheduleRefresh(), this, this.disposables);
    watcher.onDidCreate(() => this.scheduleRefresh(), this, this.disposables);
    watcher.onDidDelete(() => this.scheduleRefresh(), this, this.disposables);

    this.disposables.push(watcher);
  }

  private scheduleRefresh(): void {
    const autoRefresh = vscode.workspace
      .getConfiguration("vsgit")
      .get<boolean>("autoRefresh", true);
    if (!autoRefresh) {
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.manager.refreshAll();
    }, 500);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
