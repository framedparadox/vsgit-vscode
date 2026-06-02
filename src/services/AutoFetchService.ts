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

  constructor(
    context: vscode.ExtensionContext,
    private readonly manager: RepositoryManager,
  ) {
    this.creds = new Credentials(context);

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = "egit.autoFetch.fetchNow";
    this.statusBarItem.tooltip = "Click to fetch all remotes now";

    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("egit.autoFetch")) {
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

    const cfg = vscode.workspace.getConfiguration("egit");
    const enabled = cfg.get<boolean>("autoFetch.enabled", false);

    if (!enabled) {
      this.statusBarItem.hide();
      return;
    }

    const intervalMinutes = cfg.get<number>("autoFetch.intervalMinutes", 3);
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

    this.statusBarItem.text = "$(sync) Auto-fetch on";
    this.statusBarItem.show();

    this.timer = setInterval(() => {
      void this.fetchAllNow(false);
    }, intervalMs);
  }

  public async fetchAllNow(showProgress = true): Promise<void> {
    const repos = this.manager.getAll();
    if (repos.length === 0) return;

    const doFetch = async () => {
      for (const repo of repos) {
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
            if (ab.behind > prev && ab.behind > 0) {
              const action = await vscode.window.showInformationMessage(
                `${repo.name}: ${ab.behind} new commit(s) available from remote`,
                "Pull Now",
              );
              if (action === "Pull Now") {
                await vscode.commands.executeCommand("egit.pull", { type: "repo", repo });
              }
            }
            this.behindCache.set(repo.root, ab.behind);
          }
        } catch {
          // Silently ignore per-repo fetch failures (network, auth, etc.)
        }
      }

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

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.statusBarItem.dispose();
    this.configListener.dispose();
  }
}
