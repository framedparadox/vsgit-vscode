import * as vscode from "vscode";
import * as path from "node:path";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { historyHtml } from "./historyHtml";
import { GitContentProvider } from "../git/GitContentProvider";
import { Commit } from "../git/parsers/log";

/**
 * Manages the History webview panel: a commit graph for the active repository
 * with a details pane and commit-level operations.
 */
interface HistoryState {
  loadedCommits: Commit[];
  hasMore: boolean;
  currentBranch: string | "all";
  filePath?: string;
  compareMode: { ref1: string; ref2: string } | null;
  filters: {
    search: string;
    searchBy: "message" | "author";
    since?: string;
    until?: string;
  };
}

export class HistoryView {
  private panel: vscode.WebviewPanel | undefined;
  private repo: Repository | undefined;
  private commitsBySha = new Map<string, Commit>();
  private state: HistoryState = {
    loadedCommits: [],
    hasMore: true,
    currentBranch: "all",
    compareMode: null,
    filters: { search: "", searchBy: "message" },
  };

  constructor(
    private readonly manager: RepositoryManager,
    private readonly extensionUri: vscode.Uri,
  ) {
    manager.onDidChange(() => {
      if (this.panel) {
        void this.reload();
      }
    });
  }

  async show(repo?: Repository, file?: string): Promise<void> {
    this.repo = repo ?? this.manager.getAll()[0];
    if (!this.repo) {
      vscode.window.showWarningMessage("No Git repository to show history for.");
      return;
    }
    if (file) {
      this.state.filePath = file;
    } else {
      this.state.filePath = undefined;
    }
    if (this.panel) {
      this.panel.reveal();
      await this.reload();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "vsgit.history",
      `History: ${this.repo.name}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources")],
      },
    );
    const nonce = makeNonce();
    this.panel.webview.html = historyHtml(nonce, this.panel.webview.cspSource);
    this.panel.onDidDispose(() => (this.panel = undefined));
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    await this.reload();
  }

  async startCompare(ref1: string, ref2: string): Promise<void> {
    this.state.compareMode = { ref1, ref2 };
    await this.reload();
  }

  async filterByBranch(branch: string): Promise<void> {
    this.state.currentBranch = branch;
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.state.loadedCommits = [];
    this.state.hasMore = true;
    await this.handleQuery({
      reset: true,
      branch: this.state.currentBranch,
      search: this.state.filters.search,
      searchBy: this.state.filters.searchBy,
      since: this.state.filters.since,
      until: this.state.filters.until,
    });
  }

  private post(message: unknown): void {
    this.panel?.webview.postMessage(message);
  }

  private async onMessage(m: {
    type: string;
    sha?: string;
    path?: string;
    search?: string;
    searchBy?: "message" | "author";
    branch?: string;
    since?: string;
    until?: string;
    ref1?: string;
    ref2?: string;
  }): Promise<void> {
    if (!this.repo) {
      return;
    }
    switch (m.type) {
      case "query":
        await this.handleQuery({
          reset: true,
          branch: m.branch ?? "all",
          search: m.search ?? "",
          searchBy: m.searchBy ?? "message",
          since: m.since,
          until: m.until,
        });
        break;
      case "loadMore":
        await this.handleLoadMore();
        break;
      case "selectBranch":
        await this.handleBranchFilter(m.branch ?? "all");
        break;
      case "compareMode":
        await this.handleCompareMode(m.ref1, m.ref2);
        break;
      case "clearCompare":
        this.state.compareMode = null;
        await this.reload();
        break;
      case "select":
        if (m.sha) {
          await this.handleSelect(m.sha);
        }
        break;
      case "openFile":
        if (m.sha && m.path) {
          await this.openFileDiff(m.sha, m.path);
        }
        break;
      case "context":
        if (m.sha) {
          await this.showCommitMenu(m.sha);
        }
        break;
      case "compareBranches":
        await vscode.commands.executeCommand("vsgit.history.compareBranches");
        break;
      case "filterByBranch":
        await vscode.commands.executeCommand("vsgit.history.filterByBranch");
        break;
    }
  }

  private async handleQuery(opts: {
    reset: boolean;
    branch: string;
    search: string;
    searchBy: "message" | "author";
    since?: string;
    until?: string;
  }): Promise<void> {
    if (!this.repo) {
      return;
    }
    if (opts.reset) {
      this.state.loadedCommits = [];
      this.state.hasMore = true;
      this.state.currentBranch = opts.branch;
      this.state.filters.search = opts.search;
      this.state.filters.searchBy = opts.searchBy;
      this.state.filters.since = opts.since;
      this.state.filters.until = opts.until;
    }
    try {
      const config = vscode.workspace.getConfiguration("vsgit");
      const pageSize = Math.max(1, config.get<number>("graph.pageSize", 200));
      const maxCommits = Math.max(1, config.get<number>("history.maxCommits", 500));
      const remaining = maxCommits - this.state.loadedCommits.length;
      if (remaining <= 0) {
        this.state.hasMore = false;
        this.post({
          type: "commits",
          commits: this.state.loadedCommits,
          hasMore: false,
          currentBranch: this.state.currentBranch,
          filePath: this.state.filePath,
          compareMode: this.state.compareMode,
        });
        return;
      }
      const limit = Math.min(pageSize, remaining);
      
      let revRange: string | undefined;
      if (this.state.compareMode) {
        revRange = `${this.state.compareMode.ref1}...${this.state.compareMode.ref2}`;
      } else if (opts.branch !== "all") {
        revRange = opts.branch;
      }

      const commits = await this.repo.log({
        all: opts.branch === "all" && !this.state.compareMode,
        limit,
        skip: this.state.loadedCommits.length,
        revRange,
        search: opts.search || undefined,
        searchBy: opts.searchBy,
        file: this.state.filePath,
        since: opts.since,
        until: opts.until,
        // The history graph lays out lanes from this ordering, so a child must
        // always precede its parents.
        order: "topo",
      });
      
      this.state.loadedCommits.push(...commits);
      this.state.hasMore =
        this.state.loadedCommits.length < maxCommits && commits.length === limit;
      
      for (const c of this.state.loadedCommits) {
        this.commitsBySha.set(c.sha, c);
      }
      
      this.post({
        type: "commits",
        commits: this.state.loadedCommits,
        hasMore: this.state.hasMore,
        currentBranch: this.state.currentBranch,
        filePath: this.state.filePath,
        compareMode: this.state.compareMode,
      });
    } catch (e) {
      vscode.window.showErrorMessage(
        `History query failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async handleLoadMore(): Promise<void> {
    if (!this.state.hasMore) {
      return;
    }
    await this.handleQuery({
      reset: false,
      branch: this.state.currentBranch,
      search: this.state.filters.search,
      searchBy: this.state.filters.searchBy,
      since: this.state.filters.since,
      until: this.state.filters.until,
    });
  }

  private async handleBranchFilter(branch: string): Promise<void> {
    this.state.currentBranch = branch;
    this.state.loadedCommits = [];
    this.state.hasMore = true;
    await this.handleQuery({
      reset: true,
      branch,
      search: this.state.filters.search,
      searchBy: this.state.filters.searchBy,
      since: this.state.filters.since,
      until: this.state.filters.until,
    });
  }

  private async handleCompareMode(ref1?: string, ref2?: string): Promise<void> {
    if (!this.repo || !ref1 || !ref2) {
      return;
    }
    this.state.compareMode = { ref1, ref2 };
    this.state.loadedCommits = [];
    this.state.hasMore = true;
    await this.handleQuery({
      reset: true,
      branch: "all",
      search: this.state.filters.search,
      searchBy: this.state.filters.searchBy,
      since: this.state.filters.since,
      until: this.state.filters.until,
    });
  }

  private async handleSelect(sha: string): Promise<void> {
    if (!this.repo) {
      return;
    }
    const commit = this.commitsBySha.get(sha);
    const files = await this.repo.commitFiles(sha);
    this.post({ type: "details", commit, files });
  }

  /** Diff a file at a commit against its first parent. */
  private async openFileDiff(sha: string, relPath: string): Promise<void> {
    if (!this.repo) {
      return;
    }
    const abs = path.join(this.repo.root, relPath);
    const left = GitContentProvider.uri(this.repo.root, relPath, `${sha}~1`, abs);
    const right = GitContentProvider.uri(this.repo.root, relPath, sha, abs);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(relPath)} @ ${sha.slice(0, 8)}`,
    );
  }

  private async showCommitMenu(sha: string): Promise<void> {
    const commit = this.commitsBySha.get(sha);
    const label = commit ? `${sha.slice(0, 8)} ${commit.subject}` : sha.slice(0, 8);
    const pick = await vscode.window.showQuickPick(
      [
        "Checkout (detached)",
        "Create Branch from Commit…",
        "Create Tag from Commit…",
        "Cherry-pick",
        "Revert",
        "Reset → soft",
        "Reset → mixed",
        "Reset → hard",
        "Compare with HEAD",
        "Compare with Another Commit…",
        "Show Commit Details",
        "Copy SHA",
        "Copy SHA (full)",
      ],
      { placeHolder: label },
    );
    if (!pick || !this.repo) {
      return;
    }
    await this.runCommitOp(pick, sha);
  }

  private async runCommitOp(op: string, sha: string): Promise<void> {
    const repo = this.repo!;
    const wrap = async (fn: () => Promise<void>, msg: string) => {
      try {
        await fn();
        await this.manager.refreshAll();
        vscode.window.setStatusBarMessage(msg, 3000);
      } catch (e) {
        vscode.window.showErrorMessage(
          `${op} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    };

    switch (op) {
      case "Checkout (detached)":
        await wrap(() => repo.checkoutDetached(sha), `Checked out ${sha.slice(0, 8)}`);
        break;
      case "Cherry-pick":
        await wrap(() => repo.cherryPick(sha), "Cherry-picked");
        break;
      case "Revert":
        await wrap(() => repo.revert(sha), "Reverted");
        break;
      case "Reset → soft":
        await wrap(() => repo.reset(sha, "soft"), "Reset (soft)");
        break;
      case "Reset → mixed":
        await wrap(() => repo.reset(sha, "mixed"), "Reset (mixed)");
        break;
      case "Reset → hard": {
        const confirm = await vscode.window.showWarningMessage(
          `Hard reset to ${sha.slice(0, 8)}? Working tree changes will be lost.`,
          { modal: true },
          "Reset Hard",
        );
        if (confirm === "Reset Hard") {
          await wrap(() => repo.reset(sha, "hard"), "Reset (hard)");
        }
        break;
      }
      case "Create Branch from Commit…": {
        const name = await vscode.window.showInputBox({ prompt: "New branch name" });
        if (name) {
          const co = await vscode.window.showQuickPick(["Checkout", "Create only"], {
            placeHolder: `Create branch ${name}`,
          });
          if (co) {
            await wrap(
              () => repo.createBranchAt(name, sha, co === "Checkout"),
              `Created branch ${name}`,
            );
          }
        }
        break;
      }
      case "Create Tag from Commit…": {
        const name = await vscode.window.showInputBox({ prompt: "Tag name" });
        if (name) {
          const message = await vscode.window.showInputBox({
            prompt: "Tag message (leave empty for lightweight tag)",
          });
          await wrap(
            () => repo.createTagAt(name, sha, message || undefined),
            `Created tag ${name}`,
          );
        }
        break;
      }
      case "Copy SHA":
        await vscode.env.clipboard.writeText(sha);
        vscode.window.setStatusBarMessage("Copied SHA", 2000);
        break;
      case "Copy SHA (full)":
        await vscode.env.clipboard.writeText(sha);
        vscode.window.setStatusBarMessage("Copied full SHA", 2000);
        break;
      case "Compare with HEAD": {
        const files = await repo.commitFiles(sha);
        if (files.length === 0) {
          vscode.window.showInformationMessage("No file changes in this commit.");
          return;
        }
        const file = await vscode.window.showQuickPick(
          files.map((f) => ({ label: f.path, file: f })),
          { placeHolder: "Select file to compare" },
        );
        if (file) {
          const rel = file.file.path;
          const abs = path.join(repo.root, rel);
          const left = GitContentProvider.uri(repo.root, rel, sha, abs);
          const right = GitContentProvider.uri(repo.root, rel, "HEAD", abs);
          await vscode.commands.executeCommand(
            "vscode.diff",
            left,
            right,
            `${path.basename(rel)} (${sha.slice(0, 8)} ↔ HEAD)`,
          );
        }
        break;
      }
      case "Compare with Another Commit…": {
        const targetSha = await vscode.window.showInputBox({
          prompt: "Enter commit SHA or ref to compare with",
          placeHolder: "HEAD, branch name, or SHA",
        });
        if (!targetSha) return;
        const files = await repo.commitFiles(sha);
        if (files.length === 0) {
          vscode.window.showInformationMessage("No file changes in this commit.");
          return;
        }
        const file = await vscode.window.showQuickPick(
          files.map((f) => ({ label: f.path, file: f })),
          { placeHolder: "Select file to compare" },
        );
        if (file) {
          const rel = file.file.path;
          const abs = path.join(repo.root, rel);
          const left = GitContentProvider.uri(repo.root, rel, sha, abs);
          const right = GitContentProvider.uri(repo.root, rel, targetSha, abs);
          await vscode.commands.executeCommand(
            "vscode.diff",
            left,
            right,
            `${path.basename(rel)} (${sha.slice(0, 8)} ↔ ${targetSha.slice(0, 8)})`,
          );
        }
        break;
      }
      case "Show Commit Details": {
        const commit = this.commitsBySha.get(sha);
        const files = await repo.commitFiles(sha);
        const details = [
          `Commit: ${sha}`,
          `Author: ${commit?.authorName} <${commit?.authorEmail}>`,
          `Date: ${commit?.authorDate ? new Date(commit.authorDate * 1000).toLocaleString() : "unknown"}`,
          ``,
          commit?.subject || "",
          commit?.body || "",
          ``,
          `Changed files: ${files.length}`,
          ...files.map((f) => `  ${f.status}  ${f.path}`),
        ].join("\n");
        const doc = await vscode.workspace.openTextDocument({
          content: details,
          language: "plaintext",
        });
        await vscode.window.showTextDocument(doc);
        break;
      }
    }
  }
}

function makeNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
