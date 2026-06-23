import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { GitExecutor } from "./GitExecutor";
import { Repository } from "./Repository";
import { shouldRunGitCommand } from "../util/commandPreview";

/**
 * Discovers git repositories across the workspace, keeps a registry of
 * Repository models, and watches each repo's Git administrative directories so
 * the views refresh after both in-extension and external git operations.
 */
export class RepositoryManager implements vscode.Disposable {
  /** Top-level `.git` entries whose changes are pure noise (no state change). */
  private static readonly IGNORED_GIT_FILES = /^(index|.*\.lock)$/i;

  private readonly repositories = new Map<string, Repository>();
  private readonly watchers = new Map<string, fs.FSWatcher[]>();
  private readonly git = new GitExecutor(configuredGitPath(), shouldRunGitCommand);
  private activeRoot: string | undefined;

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

  getGitExecutor(): GitExecutor {
    return this.git;
  }

  getActive(): Repository | undefined {
    if (this.activeRoot) {
      const active = this.repositories.get(this.activeRoot);
      if (active) {
        return active;
      }
    }
    return this.firstRepository();
  }

  setActive(root: string): void {
    if (!this.repositories.has(root) || this.activeRoot === root) {
      return;
    }
    this.activeRoot = root;
    this._onDidChange.fire();
  }

  findByUri(uri: vscode.Uri): Repository | undefined {
    if (uri.scheme !== "file") {
      return undefined;
    }
    const target = path.resolve(uri.fsPath);
    return this.getAll()
      .filter((repo) => containsPath(repo.root, target))
      .sort((a, b) => b.root.length - a.root.length)[0];
  }

  relativePath(repo: Repository, uri: vscode.Uri): string {
    return toGitPath(path.relative(repo.root, uri.fsPath));
  }

  uriBelongsTo(repo: Repository, uri: vscode.Uri): boolean {
    return uri.scheme === "file" && containsPath(repo.root, uri.fsPath);
  }

  updateGitPathFromConfiguration(): void {
    this.git.setGitPath(configuredGitPath());
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
          await this.watch(root);
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

    if (!this.activeRoot || !this.repositories.has(this.activeRoot)) {
      this.activeRoot = this.firstRepository()?.root;
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

  private async watch(root: string): Promise<void> {
    const watchPaths = await this.gitWatchPaths(root);
    const watchers: fs.FSWatcher[] = [];
    for (const watchPath of watchPaths) {
      const watcher = this.watchGitPath(root, watchPath);
      if (watcher) {
        watchers.push(watcher);
      }
    }
    if (watchers.length > 0) {
      this.watchers.set(root, watchers);
    }
  }

  private unwatch(root: string): void {
    for (const watcher of this.watchers.get(root) ?? []) {
      watcher.close();
    }
    this.watchers.delete(root);
  }

  private autoRefreshEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("vsgit")
      .get<boolean>("autoRefresh", true);
  }

  /** Debounce bursts of filesystem events into a single refresh. */
  private scheduleRefresh(): void {
    if (!this.autoRefreshEnabled()) {
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshAll();
    }, 300);
  }

  dispose(): void {
    for (const watchers of this.watchers.values()) {
      for (const watcher of watchers) {
        watcher.close();
      }
    }
    this.watchers.clear();
    this._onDidChange.dispose();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }

  private firstRepository(): Repository | undefined {
    const [first] = this.getAll();
    return first;
  }

  private async gitWatchPaths(root: string): Promise<string[]> {
    const gitDir = await this.git
      .stdout(["rev-parse", "--absolute-git-dir"], { cwd: root })
      .then((out) => out.trim())
      .catch(() => path.join(root, ".git"));
    const commonDir = await this.git
      .stdout(["rev-parse", "--git-common-dir"], { cwd: root })
      .then((out) => resolveGitPath(root, out.trim()))
      .catch(() => gitDir);

    return uniqueExistingPaths([
      gitDir,
      commonDir,
      path.join(commonDir, "refs"),
      path.join(commonDir, "packed-refs"),
    ]);
  }

  private watchGitPath(root: string, watchPath: string): fs.FSWatcher | undefined {
    const onChange = (_event: string, filename: string | Buffer | null) => {
      // Ignore index/lock churn. `git status` (run on every refresh)
      // opportunistically rewrites `.git/index`, and git briefly creates
      // `*.lock` files; reacting to those would bounce straight back into
      // another refresh, producing a continuous refresh loop ("twitching").
      const name =
        typeof filename === "string"
          ? filename
          : filename
            ? Buffer.from(filename).toString()
            : "";
      if (name && RepositoryManager.IGNORED_GIT_FILES.test(path.basename(name))) {
        return;
      }
      this.scheduleRefresh();
    };
    try {
      return fs.watch(watchPath, { recursive: true }, onChange);
    } catch {
      try {
        return fs.watch(watchPath, { recursive: false }, onChange);
      } catch (err) {
        console.error(`vsgit: cannot watch ${watchPath} for ${root}`, err);
        return undefined;
      }
    }
  }
}

function configuredGitPath(): string {
  return vscode.workspace
    .getConfiguration("vsgit")
    .get<string>("git.path", "")
    .trim() || "git";
}

function containsPath(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function toGitPath(value: string): string {
  return value.split(path.sep).join("/");
}

function resolveGitPath(root: string, value: string): string {
  if (value === "") {
    return path.join(root, ".git");
  }
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function uniqueExistingPaths(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value) || !fs.existsSync(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}
