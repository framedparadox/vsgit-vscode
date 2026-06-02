import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { GitExecutor } from "./GitExecutor";
import { Repository } from "./Repository";

/**
 * Discovers git repositories across the workspace, keeps a registry of
 * Repository models, and watches each repo's .git directory so the views
 * refresh after both in-extension and external git operations.
 */
export class RepositoryManager implements vscode.Disposable {
  private readonly repositories = new Map<string, Repository>();
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly git = new GitExecutor();

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires whenever the set of repos or any repo's state may have changed. */
  readonly onDidChange = this._onDidChange.event;

  private refreshTimer: NodeJS.Timeout | undefined;

  getAll(): Repository[] {
    return [...this.repositories.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  get(root: string): Repository | undefined {
    return this.repositories.get(root);
  }

  /** Scan workspace folders for repositories and refresh everything. */
  async scan(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const found = new Set<string>();

    for (const folder of folders) {
      const root = await this.discoverRoot(folder.uri.fsPath);
      if (root) {
        found.add(root);
        if (!this.repositories.has(root)) {
          this.repositories.set(root, new Repository(root, this.git));
          this.watch(root);
        }
      }
    }

    // Drop repositories no longer present.
    for (const root of [...this.repositories.keys()]) {
      if (!found.has(root)) {
        this.repositories.delete(root);
        this.unwatch(root);
      }
    }

    await this.refreshAll();
  }

  async refreshAll(): Promise<void> {
    await Promise.all(
      this.getAll().map((repo) =>
        repo.refresh().catch((err) => {
          console.error(`vsgit: failed to refresh ${repo.root}`, err);
        }),
      ),
    );
    this._onDidChange.fire();
  }

  private async discoverRoot(start: string): Promise<string | undefined> {
    try {
      const out = await this.git.stdout(
        ["rev-parse", "--show-toplevel"],
        { cwd: start },
      );
      const root = out.trim();
      return root === "" ? undefined : root;
    } catch {
      return undefined;
    }
  }

  private watch(root: string): void {
    const gitDir = path.join(root, ".git");
    try {
      const watcher = fs.watch(
        gitDir,
        { recursive: false },
        () => this.scheduleRefresh(),
      );
      this.watchers.set(root, watcher);
    } catch (err) {
      console.error(`vsgit: cannot watch ${gitDir}`, err);
    }
  }

  private unwatch(root: string): void {
    this.watchers.get(root)?.close();
    this.watchers.delete(root);
  }

  /** Debounce bursts of filesystem events into a single refresh. */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshAll();
    }, 300);
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this._onDidChange.dispose();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }
}
