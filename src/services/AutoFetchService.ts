import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Credentials } from "../util/credentials";

export class AutoFetchService implements vscode.Disposable {
  private timer: NodeJS.Timeout | undefined;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly creds: Credentials;
  private lastFetchTime: Date | undefined;
  private behindCache = new Map<string, number>();
  private configListener: vscode.Disposable;
  private fetchInFlight: Promise<void> | undefined;
  private disposed = false;

  constructor(
    context: vscode.ExtensionContext,
    private readonly manager: RepositoryManager,
  ) {
    this.creds = new Credentials(context);

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = "vsgit.autoFetch.fetchNow";
    this.statusBarItem.tooltip = "Click to fetch all remotes now";

    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vsgit.autoFetch")) {
        this.restart();
      }
    });

    this.restart();
  }

  private restart(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    const cfg = vscode.workspace.getConfiguration("vsgit");
    const enabled = cfg.get<boolean>("autoFetch.enabled", false);

    if (!enabled) {
      this.statusBarItem.hide();
      return;
    }

    // Mirror the contributed setting range defensively; malformed settings
    // must not overflow setInterval and turn background fetch into a tight loop.
    const intervalMinutes = Math.min(
      60,
      Math.max(1, cfg.get<number>("autoFetch.intervalMinutes", 3)),
    );
    const intervalMs = intervalMinutes * 60 * 1000;

    this.statusBarItem.text = "$(sync) Auto-fetch on";
    this.statusBarItem.show();

    this.timer = setInterval(() => {
      void this.fetchAllNow(false);
    }, intervalMs);
  }

  public fetchAllNow(showProgress = true): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.fetchInFlight) {
      return this.fetchInFlight;
    }
    const fetch = this.performFetch(showProgress).finally(() => {
      if (this.fetchInFlight === fetch) {
        this.fetchInFlight = undefined;
      }
    });
    this.fetchInFlight = fetch;
    return fetch;
  }

  /**
   * Run at most one fetch sweep at a time. Manual and interval triggers share
   * the same promise instead of starting overlapping network/auth operations.
   */
  private async performFetch(showProgress: boolean): Promise<void> {
    const repos = this.manager.getAll();
    if (repos.length === 0) return;
    const liveRoots = new Set(repos.map((repo) => repo.root));
    for (const root of this.behindCache.keys()) {
      if (!liveRoots.has(root)) this.behindCache.delete(root);
    }

    const doFetch = async () => {
      for (const repo of repos) {
        if (this.disposed) return;
        if (await repo.inProgressOperation()) {
          continue;
        }

        try {
          await this.creds.withAskpass((env) =>
            repo.fetch(undefined, { all: true, prune: true, tags: true, env }),
          );

          const ab = await repo.aheadBehind();
          if (ab) {
            const prev = this.behindCache.get(repo.root) ?? 0;
            if (ab.behind > prev && ab.behind > 0 && this.shouldNotifyIncomingCommits()) {
              const action = await vscode.window.showInformationMessage(
                `${repo.name}: ${ab.behind} new commit(s) available from remote`,
                "Pull Now",
              );
              if (action === "Pull Now") {
                await vscode.commands.executeCommand("vsgit.pull", { type: "repo", repo });
              }
            }
            this.behindCache.set(repo.root, ab.behind);
          }
        } catch {
          // Silently ignore per-repo fetch failures (network, auth, etc.)
        }
      }

      if (this.disposed) return;
      this.lastFetchTime = new Date();
      this.updateStatusBar();
      await this.manager.refreshAll();
    };

    if (showProgress) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "Fetching remotes..." },
        doFetch,
      );
    } else {
      await doFetch();
    }
  }

  private updateStatusBar(): void {
    if (!this.lastFetchTime) return;
    const minutesAgo = Math.floor((Date.now() - this.lastFetchTime.getTime()) / 60000);
    const label = minutesAgo === 0 ? "just now" : `${minutesAgo}m ago`;
    this.statusBarItem.text = `$(sync) Fetched: ${label}`;
  }

  private shouldNotifyIncomingCommits(): boolean {
    return vscode.workspace
      .getConfiguration("vsgit")
      .get<boolean>("autoFetch.notify", true);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.statusBarItem.dispose();
    this.configListener.dispose();
    this.behindCache.clear();
  }
}
