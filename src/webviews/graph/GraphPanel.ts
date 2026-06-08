import * as vscode from "vscode";
import * as path from "node:path";
import { Repository } from "../../git/Repository";
import { RepositoryManager } from "../../git/RepositoryManager";
import { GitContentProvider } from "../../git/GitContentProvider";

type RefType = "head" | "localBranch" | "remoteBranch" | "tag" | "stash";

interface WebviewRef {
  name: string;
  type: RefType;
}

interface WebviewCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  committer: string;
  committerDate: string;
  parents: string[];
  refs: WebviewRef[];
  kind?: "commit" | "uncommitted";
}

interface CreateTagRequest {
  sha: string;
  name: string;
  message?: string;
  annotate?: boolean;
  sign?: boolean;
  force?: boolean;
  push?: boolean;
  remote?: string;
}

/**
 * Git Graph webview panel (vscode-git-graph style) on top of the existing git
 * plumbing: an icon-only action toolbar (Pull / Push / Fetch / Commit / Branch /
 * Merge / Stash) with ahead/behind badges and an in-progress operation banner, a
 * coloured DAG drawn by one overlay SVG, inline ref-label pills in the commit
 * rows, and an expand-at-selection commit-details row (changed files left, commit
 * metadata right). All actions are backed by `Repository` and the existing
 * `vsgit.*` commands; live refresh is driven by `RepositoryManager.onDidChange`.
 */
export class GraphPanel {
  public static currentPanel: GraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly manager: RepositoryManager;
  private disposables: vscode.Disposable[] = [];
  private activeRepo: Repository | undefined;

  private branchFilters: string[] = [];
  /** A refresh requested while the panel was hidden; replayed when it reveals. */
  private pendingRefresh = false;

  private constructor(
    panel: vscode.WebviewPanel,
    manager: RepositoryManager,
    extensionUri: vscode.Uri,
    initialRepo: Repository | undefined,
  ) {
    this.panel = panel;
    this.manager = manager;
    this.extensionUri = extensionUri;
    this.activeRepo = initialRepo ?? manager.getAll()[0];
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );
    // Live refresh: any git mutation (ours or external) routes through
    // RepositoryManager.refreshAll → onDidChange. Skip work while hidden and
    // replay once the panel becomes visible again.
    this.disposables.push(
      manager.onDidChange(() => {
        if (this.panel.visible) {
          void this.refresh();
        } else {
          this.pendingRefresh = true;
        }
      }),
    );
    this.disposables.push(
      this.panel.onDidChangeViewState(() => {
        if (this.panel.visible && this.pendingRefresh) {
          this.pendingRefresh = false;
          void this.refresh();
        }
      }),
    );
  }

  public static createOrShow(
    manager: RepositoryManager,
    extensionUri: vscode.Uri,
    initialRepo?: Repository,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GraphPanel.currentPanel) {
      if (initialRepo) GraphPanel.currentPanel.activeRepo = initialRepo;
      GraphPanel.currentPanel.panel.reveal(column);
      void GraphPanel.currentPanel.sendConfig();
      void GraphPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "vsgit.graph",
      "VsGit Graph",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "resources")],
      },
    );

    GraphPanel.currentPanel = new GraphPanel(panel, manager, extensionUri, initialRepo);
  }

  // ─── config ──────────────────────────────────────────────────────────────
  private get cfg() {
    return vscode.workspace.getConfiguration("vsgit");
  }

  /** Re-resolve the active repo against the manager; fall back if it vanished. */
  private resolveActiveRepo(): Repository | undefined {
    if (this.activeRepo) {
      const live = this.manager.get(this.activeRepo.root);
      if (live) {
        this.activeRepo = live;
        return live;
      }
    }
    this.activeRepo = this.manager.getAll()[0];
    return this.activeRepo;
  }

  private async sendConfig(): Promise<void> {
    const c = this.cfg;
    await this.panel.webview.postMessage({
      type: "config",
      data: {
        palette: c.get<string[]>("graph.colours"),
        style: c.get<string>("graph.style", "rounded"),
        dateFormat: c.get<string>("graph.dateFormat", "standard"),
        showRemoteBranches: c.get<boolean>("graph.showRemoteBranches", true),
        showSidebar: c.get<boolean>("graph.showSidebar", true),
        columns: {
          id: c.get<boolean>("graph.showIdColumn", true),
          author: c.get<boolean>("graph.showAuthorColumn", true),
          committedDate: c.get<boolean>("graph.showCommittedDateColumn", true),
        },
      },
    });
  }

  // ─── data ────────────────────────────────────────────────────────────────
  private async refresh(): Promise<void> {
    const repo = this.resolveActiveRepo();
    if (!repo) {
      await this.panel.webview.postMessage({ type: "empty" });
      return;
    }
    try {
      const limit = this.cfg.get<number>("graph.maxCommits", 500);
      const showRemote = this.cfg.get<boolean>("graph.showRemoteBranches", true);

      const options = this.branchFilters.length > 0
        ? { limit, branches: this.branchFilters }
        : { limit, all: true };
      const data = await repo.graphLog(options);

      // Classify each commit's flattened ref strings into typed refs.
      const localSet = new Set(repo.localBranches.map((b) => b.shortName));
      const remoteSet = new Set(repo.remoteBranches.map((b) => b.shortName));
      const tagSet = new Set(repo.tags.map((t) => t.shortName));
      const headName = repo.headName;

      const commits: WebviewCommit[] = data.commits.map((c) => {
        const refs: WebviewRef[] = [];
        for (const raw of c.refs) {
          if (!raw) continue;
          if (tagSet.has(raw)) {
            refs.push({ name: raw, type: "tag" });
          } else if (remoteSet.has(raw)) {
            if (showRemote) refs.push({ name: raw, type: "remoteBranch" });
          } else if (localSet.has(raw)) {
            refs.push({ name: raw, type: raw === headName ? "head" : "localBranch" });
          } else {
            refs.push({ name: raw, type: "localBranch" });
          }
        }
        return { ...c, refs, kind: "commit" as const };
      });

      // Attach stash badges to their base commit (first cut of stash topology).
      for (const stash of repo.stashes) {
        const target = commits.find((c) => c.sha === stash.ref) ?? commits[0];
        if (target) target.refs.push({ name: stash.ref, type: "stash" });
      }

      // Synthetic "uncommitted changes" row pinned at the top.
      const uncommittedCount = repo.status.changes.length;
      if (uncommittedCount > 0 && commits.length > 0) {
        const head = commits[0];
        commits.unshift({
          sha: "*uncommitted*",
          shortSha: "*",
          message: `Uncommitted Changes (${uncommittedCount})`,
          author: "",
          date: "",
          committer: "",
          committerDate: "",
          parents: [head.sha],
          refs: [],
          kind: "uncommitted",
        });
      }

      const [aheadBehind, inProgress] = await Promise.all([
        repo.aheadBehind().catch(() => undefined),
        repo.inProgressOperation().catch(() => undefined),
      ]);

      await this.panel.webview.postMessage({
        type: "graphData",
        data: {
          commits,
          head: headName,
          branches: repo.localBranches.map((b) => b.shortName),
          showRemoteBranches: showRemote,
          repos: this.manager.getAll().map((r) => ({
            root: r.root,
            name: r.name,
            active: r.root === repo.root,
          })),
          aheadBehind: aheadBehind ?? null,
          inProgress: inProgress ?? null,
        },
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load graph: ${error}`);
    }
  }

  // ─── message routing ───────────────────────────────────────────────────────
  private async handleMessage(message: { type: string; data?: unknown }): Promise<void> {
    const repo = this.resolveActiveRepo();
    try {
      switch (message.type) {
        case "ready":
          await this.sendConfig();
          await this.refresh();
          return;

        case "refresh":
          await this.refresh();
          return;

        case "switchRepo": {
          const root = (message.data as { root: string }).root;
          const next = this.manager.get(root);
          if (next) {
            this.activeRepo = next;
            this.branchFilters = [];
            await this.refresh();
          }
          return;
        }

        case "setShowRemoteBranches":
          await this.cfg.update(
            "graph.showRemoteBranches",
            !!message.data,
            vscode.ConfigurationTarget.Global,
          );
          await this.sendConfig();
          await this.refresh();
          return;

        case "setBranchFilter":
          this.branchFilters = ((message.data as { branches?: string[] }).branches || []).filter(
            (b) => b && b.length > 0,
          );
          await this.refresh();
          return;
      }

      // Everything past this point needs a live repository.
      if (!repo) {
        vscode.window.showWarningMessage("No Git repository is active.");
        return;
      }

      switch (message.type) {
        // ── toolbar transport: reuse existing vsgit.* commands (askpass + progress) ──
        case "pull":
          await vscode.commands.executeCommand("vsgit.pull", { repo });
          return;
        case "push":
          await vscode.commands.executeCommand("vsgit.push", { repo });
          return;
        case "fetch":
          await vscode.commands.executeCommand("vsgit.fetch", { repo });
          return;
        case "toolbarMerge":
          await vscode.commands.executeCommand("vsgit.merge", { repo });
          return;
        case "toolbarRebase":
          await vscode.commands.executeCommand("vsgit.rebase", { repo });
          return;
        case "commitOpen":
          // vsgit.commit is a WebviewView; VS Code auto-registers a <viewId>.focus
          // command to reveal it.
          await vscode.commands.executeCommand("vsgit.commit.focus");
          return;
        case "createBranchInteractive":
          await this.createBranch("HEAD", true);
          return;
        case "toolbarStash":
          await this.stashPush(repo);
          return;

        // ── sequencer (continue / skip / abort) ──
        // Driven directly through Repository.sequencerAction, which supports all
        // four kinds (rebase / merge / cherry-pick / revert); only rebase exposes
        // continue/skip/abort as standalone vsgit.* commands.
        case "seqContinue":
          await this.runSequencer(repo, message.data, "continue");
          return;
        case "seqSkip":
          await this.runSequencer(repo, message.data, "skip");
          return;
        case "seqAbort":
          await this.runSequencer(repo, message.data, "abort");
          return;

        case "requestFiles": {
          const sha = message.data as string;
          const files = await repo.commitFiles(sha);
          await this.panel.webview.postMessage({ type: "files", data: { sha, files } });
          return;
        }

        case "openFileDiff": {
          const { sha, path: filePath } = message.data as { sha: string; path: string };
          await this.openCommitFileDiff(repo, sha, filePath);
          return;
        }

        case "requestComparison": {
          const { from, to } = message.data as { from: string; to: string };
          const files = await repo.diffFiles(from, to);
          await this.panel.webview.postMessage({
            type: "comparisonFiles",
            data: { from, to, files },
          });
          return;
        }

        case "openComparisonDiff": {
          const { from, to, path: filePath } = message.data as {
            from: string;
            to: string;
            path: string;
          };
          await this.openComparisonFileDiff(repo, from, to, filePath);
          return;
        }

        case "checkout":
          await repo.checkoutRef(message.data as string);
          this.notify(`Checked out ${message.data}`);
          await this.refresh();
          return;

        case "createBranch":
          await this.createBranch((message.data as { sha: string }).sha, false);
          return;

        case "createTag":
          await this.createTag(message.data as CreateTagRequest);
          return;

        case "merge":
          await this.mergeInto(message.data as string);
          return;

        case "rebase":
          await this.rebaseOnto(message.data as string);
          return;

        case "cherryPick":
          await repo.cherryPick(message.data as string);
          this.notify(`Cherry-picked ${(message.data as string).slice(0, 8)}`);
          await this.refresh();
          return;

        case "revert":
          await repo.revert(message.data as string);
          this.notify(`Reverted ${(message.data as string).slice(0, 8)}`);
          await this.refresh();
          return;

        case "dropCommit":
          await this.dropCommit(message.data as string);
          return;

        case "reset":
          await this.reset(message.data as { sha: string; mode: "soft" | "mixed" | "hard" });
          return;

        case "compareWithHead":
          await this.compare(message.data as string, "HEAD");
          return;

        case "compareWithAnother": {
          const target = await vscode.window.showInputBox({
            prompt: "Enter commit SHA or ref to compare with",
            placeHolder: "HEAD, branch name, or SHA",
          });
          if (target) await this.compare(message.data as string, target);
          return;
        }

        case "renameBranch":
          await this.renameBranch((message.data as { name: string }).name);
          return;

        case "deleteBranch":
          await this.deleteBranch((message.data as { name: string }).name);
          return;

        case "deleteRemoteBranch":
          await this.deleteRemoteBranch((message.data as { name: string }).name);
          return;

        case "pushBranch":
          await this.pushBranch((message.data as { name: string }).name);
          return;

        case "deleteTag":
          await this.deleteTag((message.data as { name: string }).name);
          return;

        case "pushTag":
          await this.pushTag((message.data as { name: string }).name);
          return;

        case "stashApply":
          await repo.stashApply((message.data as { ref: string }).ref);
          this.notify("Stash applied");
          await this.refresh();
          return;

        case "stashPop":
          await repo.stashPop((message.data as { ref: string }).ref);
          this.notify("Stash popped");
          await this.refresh();
          return;

        case "stashDrop":
          await this.stashDrop((message.data as { ref: string }).ref);
          return;

        case "stashBranch":
          await this.stashBranch((message.data as { ref: string }).ref);
          return;

        case "copyCommitSha":
          await vscode.env.clipboard.writeText(message.data as string);
          this.notify("Commit SHA copied to clipboard");
          return;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`${message.type} failed: ${error}`);
    }
  }

  private get repo(): Repository {
    const r = this.resolveActiveRepo();
    if (!r) throw new Error("No active repository");
    return r;
  }

  // ─── operations ────────────────────────────────────────────────────────────
  private async createBranch(sha: string, checkout: boolean): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: checkout ? "Create and checkout branch" : "Enter branch name",
      placeHolder: "feature/new-branch",
    });
    if (!name) return;
    await this.repo.createBranchAt(name, sha, checkout);
    this.notify(`Branch '${name}' created`);
    await this.refresh();
  }

  private async createTag(request: CreateTagRequest): Promise<void> {
    const name = request.name.trim();
    if (!name) return;
    let remote: string | undefined;
    if (request.push) {
      remote = request.remote?.trim() || (await this.pickRemote());
      if (!remote) return;
    }
    const message = request.message?.trim() || undefined;
    await this.repo.createTagAt(
      name,
      request.sha,
      request.sign === true || request.annotate === true ? message ?? name : undefined,
      request.sign === true,
      request.force === true,
    );
    if (remote) {
      await this.repo.pushTag(remote, name, request.force === true);
    }
    this.notify(request.push ? `Tag '${name}' created and pushed` : `Tag '${name}' created`);
    await this.refresh();
  }

  private async mergeInto(ref: string): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "Default", detail: "Fast-forward when possible", opts: {} },
        { label: "Create merge commit", detail: "--no-ff", opts: { noFf: true } },
        { label: "Squash", detail: "--squash", opts: { squash: true } },
      ],
      { placeHolder: `Merge ${ref} into current branch` },
    );
    if (!pick) return;
    await this.repo.merge(ref, pick.opts);
    this.notify(`Merged ${ref}`);
    await this.refresh();
  }

  private async runSequencer(
    repo: Repository,
    data: unknown,
    action: "continue" | "skip" | "abort",
  ): Promise<void> {
    const kind = (data as { kind?: string } | undefined)?.kind as
      | "rebase"
      | "merge"
      | "cherry-pick"
      | "revert"
      | undefined;
    if (!kind) return;
    if (action === "abort") {
      const confirm = await this.confirm(`Abort the ${kind} in progress?`, "Abort");
      if (!confirm) return;
    }
    await repo.sequencerAction(kind, action);
    this.notify(`${kind} ${action}`);
    await this.refresh();
  }

  private async rebaseOnto(ref: string): Promise<void> {
    const confirm = await this.confirm(
      `Rebase the current branch onto ${ref.slice(0, 12)}?`,
      "Rebase",
    );
    if (!confirm) return;
    await this.repo.rebase(ref);
    this.notify(`Rebased onto ${ref.slice(0, 8)}`);
    await this.refresh();
  }

  private async dropCommit(sha: string): Promise<void> {
    const confirm = await this.confirm(
      `Drop commit ${sha.slice(0, 8)}? This rewrites history on the current branch.`,
      "Drop Commit",
    );
    if (!confirm) return;
    await this.repo.dropCommit(sha);
    this.notify(`Dropped ${sha.slice(0, 8)}`);
    await this.refresh();
  }

  private async reset(data: { sha: string; mode: "soft" | "mixed" | "hard" }): Promise<void> {
    if (data.mode === "hard") {
      const confirm = await this.confirm(
        `Hard reset to ${data.sha.slice(0, 8)}? Working tree changes will be lost.`,
        "Reset Hard",
      );
      if (!confirm) return;
    }
    await this.repo.reset(data.sha, data.mode);
    this.notify(`Reset (${data.mode}) to ${data.sha.slice(0, 8)}`);
    await this.refresh();
  }

  private async renameBranch(name: string): Promise<void> {
    const newName = await vscode.window.showInputBox({
      prompt: `Rename branch '${name}' to`,
      value: name,
    });
    if (!newName || newName === name) return;
    await this.repo.renameBranch(name, newName);
    this.notify(`Renamed '${name}' → '${newName}'`);
    await this.refresh();
  }

  private async deleteBranch(name: string): Promise<void> {
    const confirm = await this.confirm(`Delete local branch '${name}'?`, "Delete");
    if (!confirm) return;
    try {
      await this.repo.deleteBranch(name, false);
    } catch {
      const force = await this.confirm(
        `Branch '${name}' is not fully merged. Force delete?`,
        "Force Delete",
      );
      if (!force) return;
      await this.repo.deleteBranch(name, true);
    }
    this.notify(`Deleted branch '${name}'`);
    await this.refresh();
  }

  private async deleteRemoteBranch(fullName: string): Promise<void> {
    // fullName is like "origin/feature"; split into remote + branch.
    const slash = fullName.indexOf("/");
    if (slash === -1) return;
    const remote = fullName.slice(0, slash);
    const branch = fullName.slice(slash + 1);
    const confirm = await this.confirm(
      `Delete remote branch '${fullName}'? This affects the remote.`,
      "Delete Remote Branch",
    );
    if (!confirm) return;
    await this.repo.deleteRemoteBranch(remote, branch);
    this.notify(`Deleted remote branch '${fullName}'`);
    await this.refresh();
  }

  private async pushBranch(name: string): Promise<void> {
    const remote = await this.pickRemote();
    if (!remote) return;
    const pick = await vscode.window.showQuickPick(
      [
        { label: "Push", opts: { setUpstream: true } },
        { label: "Push (force with lease)", opts: { setUpstream: true, forceWithLease: true } },
      ],
      { placeHolder: `Push '${name}' to ${remote}` },
    );
    if (!pick) return;
    if (pick.opts.forceWithLease) {
      const confirm = await this.confirm(
        `Force-push '${name}' to ${remote} (with lease)?`,
        "Force Push",
      );
      if (!confirm) return;
    }
    await this.repo.push({ remote, refspec: name, ...pick.opts });
    this.notify(`Pushed '${name}' to ${remote}`);
    await this.refresh();
  }

  private async deleteTag(name: string): Promise<void> {
    const confirm = await this.confirm(`Delete tag '${name}'?`, "Delete");
    if (!confirm) return;
    await this.repo.deleteTag(name);
    this.notify(`Deleted tag '${name}'`);
    await this.refresh();
  }

  private async pushTag(name: string): Promise<void> {
    const remote = await this.pickRemote();
    if (!remote) return;
    await this.repo.pushTag(remote, name);
    this.notify(`Pushed tag '${name}' to ${remote}`);
    await this.refresh();
  }

  private async stashPush(repo: Repository): Promise<void> {
    const message = await vscode.window.showInputBox({
      prompt: "Stash message (optional)",
      placeHolder: "WIP on current branch",
    });
    if (message === undefined) return;
    const untrackedPick = await vscode.window.showQuickPick(
      [
        { label: "Stash tracked changes", untracked: false },
        { label: "Include untracked files", untracked: true },
      ],
      { placeHolder: "What to stash?" },
    );
    if (!untrackedPick) return;
    await repo.stashPush(message || undefined, untrackedPick.untracked);
    this.notify("Changes stashed");
    await this.refresh();
  }

  private async stashDrop(ref: string): Promise<void> {
    const confirm = await this.confirm(`Drop stash ${ref}?`, "Drop Stash");
    if (!confirm) return;
    await this.repo.stashDrop(ref);
    this.notify(`Dropped ${ref}`);
    await this.refresh();
  }

  private async stashBranch(ref: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: `Create branch from ${ref}`,
      placeHolder: "feature/from-stash",
    });
    if (!name) return;
    await this.repo.stashBranch(name, ref);
    this.notify(`Created branch '${name}' from ${ref}`);
    await this.refresh();
  }

  // ─── diff / compare ──────────────────────────────────────────────────────────
  private async openCommitFileDiff(
    repo: Repository,
    sha: string,
    filePath: string,
  ): Promise<void> {
    const abs = path.join(repo.root, filePath);
    const left = GitContentProvider.uri(repo.root, filePath, `${sha}^`, abs);
    const right = GitContentProvider.uri(repo.root, filePath, sha, abs);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(filePath)} (${sha.slice(0, 8)})`,
    );
  }

  /** Diff a file between two arbitrary commits (CTRL/CMD-click comparison). */
  private async openComparisonFileDiff(
    repo: Repository,
    fromSha: string,
    toSha: string,
    filePath: string,
  ): Promise<void> {
    const abs = path.join(repo.root, filePath);
    const left = GitContentProvider.uri(repo.root, filePath, fromSha, abs);
    const right = GitContentProvider.uri(repo.root, filePath, toSha, abs);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(filePath)} (${fromSha.slice(0, 8)} ↔ ${toSha.slice(0, 8)})`,
    );
  }

  private async compare(sha: string, targetRef: string): Promise<void> {
    const repo = this.repo;
    const files = await repo.commitFiles(sha);
    if (files.length === 0) {
      vscode.window.showInformationMessage("No file changes in this commit.");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      files.map((f) => ({ label: f.path, description: f.status, filePath: f.path })),
      { placeHolder: `Select file to compare ${sha.slice(0, 8)} ↔ ${targetRef}` },
    );
    if (!pick) return;
    const abs = path.join(repo.root, pick.filePath);
    const left = GitContentProvider.uri(repo.root, pick.filePath, sha, abs);
    const right = GitContentProvider.uri(repo.root, pick.filePath, targetRef, abs);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(pick.filePath)} (${sha.slice(0, 8)} ↔ ${targetRef.slice(0, 8)})`,
    );
  }

  // ─── shared helpers ──────────────────────────────────────────────────────────
  private async pickRemote(): Promise<string | undefined> {
    const remotes = this.repo.remotes;
    if (remotes.length === 0) {
      vscode.window.showWarningMessage("No remotes configured.");
      return undefined;
    }
    if (remotes.length === 1) return remotes[0].name;
    const pick = await vscode.window.showQuickPick(
      remotes.map((r) => r.name),
      { placeHolder: "Select remote" },
    );
    return pick;
  }

  private async confirm(message: string, action: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, action);
    return choice === action;
  }

  private notify(message: string): void {
    vscode.window.setStatusBarMessage(message, 3000);
  }

  // ─── html ────────────────────────────────────────────────────────────────────
  private getHtmlForWebview(): string {
    const nonce = getNonce();
    const webview = this.panel.webview;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "graph.css"),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "graph.js"),
    );
    const layoutUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "graphLayout.js"),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>VsGit Graph</title>
</head>
<body>
  <div id="shell">
    <!-- ── top control bar (vscode-git-graph layout) ──────────────────
         LEFT: Repo dropdown, Branches (multi-select) dropdown, Show Remote
         Branches checkbox. RIGHT: action icons. Dropdowns are filled by the
         Dropdown component in graph.js; icons are injected as inline SVG. -->
    <div id="toolbar">
      <span id="repoControl"><span class="ctrl-label">Repo: </span><div id="repoDropdown" class="dropdown"></div></span>
      <span id="branchControl"><span class="ctrl-label">Branches: </span><div id="branchDropdown" class="dropdown"></div></span>
      <label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox" tabindex="-1"><span class="customCheckbox"></span>Show Remote Branches</label>
      <span class="tb-spacer"></span>
      <span id="commit-count"></span>
      <span class="tb-sep"></span>
      <button class="tb-btn icon-only" id="tb-pull" title="Pull">
        <span class="tb-ico" data-icon="pull"></span><span class="tb-badge" id="badge-pull"></span>
      </button>
      <button class="tb-btn icon-only" id="tb-push" title="Push">
        <span class="tb-ico" data-icon="push"></span><span class="tb-badge" id="badge-push"></span>
      </button>
      <button class="tb-btn icon-only" id="tb-fetch" title="Fetch"><span class="tb-ico" data-icon="fetch"></span></button>
      <span class="tb-sep"></span>
      <button class="tb-btn icon-only" id="tb-commit" title="Commit"><span class="tb-ico" data-icon="commit"></span></button>
      <button class="tb-btn icon-only" id="tb-branch" title="New Branch"><span class="tb-ico" data-icon="branch"></span></button>
      <button class="tb-btn icon-only" id="tb-merge" title="Merge"><span class="tb-ico" data-icon="merge"></span></button>
      <button class="tb-btn icon-only" id="tb-stash" title="Stash"><span class="tb-ico" data-icon="stash"></span></button>
      <span class="tb-sep"></span>
      <button class="tb-btn icon-only" id="tb-find" title="Find (Ctrl/Cmd+F)"><span class="tb-ico" data-icon="find"></span></button>
      <button class="tb-btn icon-only" id="tb-trace" title="Trace flow: ancestors / descendants / off"><span class="tb-ico" data-icon="trace"></span></button>
      <button class="tb-btn icon-only" id="tb-refresh" title="Refresh (Ctrl/Cmd+R)"><span class="tb-ico" data-icon="refresh"></span></button>
    </div>

    <!-- ── in-progress operation banner ────────────────────────────── -->
    <div id="inprogress-banner">
      <span id="inprogress-text"></span>
      <span class="tb-spacer"></span>
      <button class="tb-btn" id="seq-continue">Continue</button>
      <button class="tb-btn" id="seq-skip">Skip</button>
      <button class="tb-btn" id="seq-abort">Abort</button>
    </div>

    <!-- ── graph (commit details expand inline beneath the selected row) ── -->
    <div id="main">
      <div id="loading">Loading graph…</div>
      <div id="empty-state" style="display:none">No Git repository is active.</div>
      <!-- Column layout mirrors vscode-git-graph:
           Graph | Description | Author | Date | Commit.
           The graph rail is the FIRST column so the overlay SVG keeps a clean,
           uniform coordinate space anchored to the table's left edge; ref pills +
           message text live in the Description column, and the abbreviated commit
           hash (Commit) is the LAST column. -->
      <table id="graph-table">
        <colgroup>
          <col id="col-graph">
          <col id="col-desc">
          <col id="col-author" class="col-author">
          <col id="col-cdate" class="col-cdate">
          <col id="col-id" class="col-id">
        </colgroup>
        <thead>
          <tr>
            <th class="col-graph-head">Graph</th>
            <th>Description<span class="col-resizer" data-col="desc"></span></th>
            <th class="col-author">Author<span class="col-resizer" data-col="author"></span></th>
            <th class="col-cdate">Date<span class="col-resizer" data-col="cdate"></span></th>
            <th class="col-id">Commit<span class="col-resizer" data-col="id"></span></th>
          </tr>
        </thead>
        <tbody id="graph-body"></tbody>
      </table>
    </div>
  </div>

  <div id="find-widget">
    <input type="text" id="find-input" placeholder="Find commit, author, hash, ref…">
    <span id="find-count"></span>
    <button id="find-prev" title="Previous (Shift+Enter)">▲</button>
    <button id="find-next" title="Next (Enter)">▼</button>
    <button id="find-close" title="Close (Esc)">✕</button>
  </div>

  <div id="context-menu" class="context-menu"></div>

  <div id="create-tag-modal" class="modal-backdrop" hidden>
    <form id="create-tag-form" class="modal" autocomplete="off">
      <div class="modal-header">
        <h2>Create Tag</h2>
        <button type="button" class="modal-close" id="create-tag-close" title="Close">x</button>
      </div>
      <div class="modal-body">
        <label class="field">
          <span>Tag Name</span>
          <input id="create-tag-name" type="text" placeholder="v1.0.0" required>
        </label>
        <label class="field">
          <span>Commit</span>
          <input id="create-tag-sha" type="text" readonly>
        </label>
        <label class="check-row">
          <input id="create-tag-annotated" type="checkbox">
          <span>Annotated Tag</span>
        </label>
        <label class="check-row">
          <input id="create-tag-signed" type="checkbox">
          <span>Sign Tag with GPG</span>
        </label>
        <label class="field">
          <span>Message</span>
          <textarea id="create-tag-message" rows="4" placeholder="Release version 1.0.0"></textarea>
        </label>
        <label class="check-row">
          <input id="create-tag-force" type="checkbox">
          <span>Force replace existing tag</span>
        </label>
        <label class="check-row">
          <input id="create-tag-push" type="checkbox">
          <span>Push tag after creation</span>
        </label>
      </div>
      <div class="modal-footer">
        <button type="button" class="tb-btn" id="create-tag-cancel">Cancel</button>
        <button type="submit" class="tb-btn primary">Create Tag</button>
      </div>
    </form>
  </div>

  <script nonce="${nonce}" src="${layoutUri}"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  public dispose() {
    GraphPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
