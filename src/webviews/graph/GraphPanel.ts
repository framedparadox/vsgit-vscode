import * as vscode from "vscode";
import * as path from "node:path";
import { Repository } from "../../git/Repository";
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
  parents: string[];
  refs: WebviewRef[];
  kind?: "commit" | "uncommitted";
}

/**
 * Git Graph webview panel. A clean-room, like-for-like reimplementation of the
 * vscode-git-graph view: coloured DAG, ref badges, uncommitted-changes / stash
 * rows, find widget, docked commit details with a changed-file list, and commit
 * / ref context menus driving the full set of git operations.
 */
export class GraphPanel {
  public static currentPanel: GraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private repository: Repository;

  private branchFilter = "";

  private constructor(panel: vscode.WebviewPanel, repository: Repository, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.repository = repository;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );
  }

  public static createOrShow(repository: Repository, extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GraphPanel.currentPanel) {
      GraphPanel.currentPanel.repository = repository;
      GraphPanel.currentPanel.panel.reveal(column);
      void GraphPanel.currentPanel.sendConfig();
      void GraphPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "egit.graph",
      `Git Graph - ${path.basename(repository.root)}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "resources")],
      },
    );

    GraphPanel.currentPanel = new GraphPanel(panel, repository, extensionUri);
  }

  // ─── config ──────────────────────────────────────────────────────────────
  private get cfg() {
    return vscode.workspace.getConfiguration("egit");
  }

  private async sendConfig(): Promise<void> {
    const c = this.cfg;
    await this.panel.webview.postMessage({
      type: "config",
      data: {
        palette: c.get<string[]>("graph.colours"),
        style: c.get<string>("graph.style", "rounded"),
        dateFormat: c.get<string>("graph.dateFormat", "relative"),
        showRemoteBranches: c.get<boolean>("graph.showRemoteBranches", true),
        columns: {
          refs: c.get<boolean>("graph.showRefsColumn", true),
          date: c.get<boolean>("graph.showDateColumn", true),
          author: c.get<boolean>("graph.showAuthorColumn", true),
          commit: c.get<boolean>("graph.showCommitColumn", true),
        },
      },
    });
  }

  // ─── data ────────────────────────────────────────────────────────────────
  private async refresh(): Promise<void> {
    try {
      const limit = this.cfg.get<number>("graph.maxCommits", 500);
      const showRemote = this.cfg.get<boolean>("graph.showRemoteBranches", true);

      const options = this.branchFilter
        ? { limit, branches: [this.branchFilter] }
        : { limit, all: true };
      const data = await this.repository.graphLog(options);

      // Classify each commit's flattened ref strings into typed refs.
      const localSet = new Set(this.repository.localBranches.map((b) => b.shortName));
      const remoteSet = new Set(this.repository.remoteBranches.map((b) => b.shortName));
      const tagSet = new Set(this.repository.tags.map((t) => t.shortName));
      const headName = this.repository.headName;

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
      for (const stash of this.repository.stashes) {
        const target = commits.find((c) => c.sha === stash.ref) ?? commits[0];
        if (target) target.refs.push({ name: stash.ref, type: "stash" });
      }

      // Synthetic "uncommitted changes" row pinned at the top.
      if (this.repository.status.changes.length > 0 && commits.length > 0) {
        const head = commits[0];
        commits.unshift({
          sha: "*uncommitted*",
          shortSha: "*",
          message: `Uncommitted Changes (${this.repository.status.changes.length})`,
          author: "",
          date: "",
          parents: [head.sha],
          refs: [],
          kind: "uncommitted",
        });
      }

      await this.panel.webview.postMessage({
        type: "graphData",
        data: {
          commits,
          branches: data.branches,
          tags: data.tags,
        },
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load graph: ${error}`);
    }
  }

  // ─── message routing ───────────────────────────────────────────────────────
  private async handleMessage(message: { type: string; data?: unknown }): Promise<void> {
    const repo = this.repository;
    try {
      switch (message.type) {
        case "ready":
          await this.sendConfig();
          await this.refresh();
          return;

        case "refresh":
          await this.refresh();
          return;

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
          this.branchFilter = (message.data as string) || "";
          await this.refresh();
          return;

        case "requestFiles": {
          const sha = message.data as string;
          const files = await repo.commitFiles(sha);
          await this.panel.webview.postMessage({ type: "files", data: { sha, files } });
          return;
        }

        case "openFileDiff": {
          const { sha, path: filePath } = message.data as { sha: string; path: string };
          await this.openCommitFileDiff(sha, filePath);
          return;
        }

        case "checkout":
          await repo.checkoutRef(message.data as string);
          this.notify(`Checked out ${message.data}`);
          await this.refresh();
          return;

        case "createBranch":
          await this.createBranch((message.data as { sha: string }).sha);
          return;

        case "createTag":
          await this.createTag((message.data as { sha: string }).sha);
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

  // ─── operations ────────────────────────────────────────────────────────────
  private async createBranch(sha: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Enter branch name",
      placeHolder: "feature/new-branch",
    });
    if (!name) return;
    await this.repository.createBranchAt(name, sha, false);
    this.notify(`Branch '${name}' created`);
    await this.refresh();
  }

  private async createTag(sha: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Enter tag name",
      placeHolder: "v1.0.0",
    });
    if (!name) return;
    const msg = await vscode.window.showInputBox({
      prompt: "Enter tag message (optional)",
      placeHolder: "Release version 1.0.0",
    });
    await this.repository.createTagAt(name, sha, msg, false);
    this.notify(`Tag '${name}' created`);
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
    await this.repository.merge(ref, pick.opts);
    this.notify(`Merged ${ref}`);
    await this.refresh();
  }

  private async rebaseOnto(ref: string): Promise<void> {
    const confirm = await this.confirm(
      `Rebase the current branch onto ${ref.slice(0, 12)}?`,
      "Rebase",
    );
    if (!confirm) return;
    await this.repository.rebase(ref);
    this.notify(`Rebased onto ${ref.slice(0, 8)}`);
    await this.refresh();
  }

  private async dropCommit(sha: string): Promise<void> {
    const confirm = await this.confirm(
      `Drop commit ${sha.slice(0, 8)}? This rewrites history on the current branch.`,
      "Drop Commit",
    );
    if (!confirm) return;
    await this.repository.dropCommit(sha);
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
    await this.repository.reset(data.sha, data.mode);
    this.notify(`Reset (${data.mode}) to ${data.sha.slice(0, 8)}`);
    await this.refresh();
  }

  private async renameBranch(name: string): Promise<void> {
    const newName = await vscode.window.showInputBox({
      prompt: `Rename branch '${name}' to`,
      value: name,
    });
    if (!newName || newName === name) return;
    await this.repository.renameBranch(name, newName);
    this.notify(`Renamed '${name}' → '${newName}'`);
    await this.refresh();
  }

  private async deleteBranch(name: string): Promise<void> {
    const confirm = await this.confirm(`Delete local branch '${name}'?`, "Delete");
    if (!confirm) return;
    try {
      await this.repository.deleteBranch(name, false);
    } catch {
      const force = await this.confirm(
        `Branch '${name}' is not fully merged. Force delete?`,
        "Force Delete",
      );
      if (!force) return;
      await this.repository.deleteBranch(name, true);
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
    await this.repository.deleteRemoteBranch(remote, branch);
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
    await this.repository.push({ remote, refspec: name, ...pick.opts });
    this.notify(`Pushed '${name}' to ${remote}`);
    await this.refresh();
  }

  private async deleteTag(name: string): Promise<void> {
    const confirm = await this.confirm(`Delete tag '${name}'?`, "Delete");
    if (!confirm) return;
    await this.repository.deleteTag(name);
    this.notify(`Deleted tag '${name}'`);
    await this.refresh();
  }

  private async pushTag(name: string): Promise<void> {
    const remote = await this.pickRemote();
    if (!remote) return;
    await this.repository.pushTag(remote, name);
    this.notify(`Pushed tag '${name}' to ${remote}`);
    await this.refresh();
  }

  private async stashDrop(ref: string): Promise<void> {
    const confirm = await this.confirm(`Drop stash ${ref}?`, "Drop Stash");
    if (!confirm) return;
    await this.repository.stashDrop(ref);
    this.notify(`Dropped ${ref}`);
    await this.refresh();
  }

  private async stashBranch(ref: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: `Create branch from ${ref}`,
      placeHolder: "feature/from-stash",
    });
    if (!name) return;
    await this.repository.stashBranch(name, ref);
    this.notify(`Created branch '${name}' from ${ref}`);
    await this.refresh();
  }

  // ─── diff / compare ──────────────────────────────────────────────────────────
  private async openCommitFileDiff(sha: string, filePath: string): Promise<void> {
    const abs = path.join(this.repository.root, filePath);
    const left = GitContentProvider.uri(this.repository.root, filePath, `${sha}^`, abs);
    const right = GitContentProvider.uri(this.repository.root, filePath, sha, abs);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(filePath)} (${sha.slice(0, 8)})`,
    );
  }

  private async compare(sha: string, targetRef: string): Promise<void> {
    const files = await this.repository.commitFiles(sha);
    if (files.length === 0) {
      vscode.window.showInformationMessage("No file changes in this commit.");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      files.map((f) => ({ label: f.path, description: f.status, filePath: f.path })),
      { placeHolder: `Select file to compare ${sha.slice(0, 8)} ↔ ${targetRef}` },
    );
    if (!pick) return;
    const abs = path.join(this.repository.root, pick.filePath);
    const left = GitContentProvider.uri(this.repository.root, pick.filePath, sha, abs);
    const right = GitContentProvider.uri(this.repository.root, pick.filePath, targetRef, abs);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(pick.filePath)} (${sha.slice(0, 8)} ↔ ${targetRef.slice(0, 8)})`,
    );
  }

  // ─── shared helpers ──────────────────────────────────────────────────────────
  private async pickRemote(): Promise<string | undefined> {
    const remotes = this.repository.remotes;
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
  <title>Git Graph</title>
</head>
<body>
  <div id="controls">
    <button id="refresh-btn" class="ctl-btn" title="Refresh (Ctrl/Cmd+R)">↺ Refresh</button>
    <select id="branch-filter" title="Filter by branch"><option value="">All branches</option></select>
    <label class="toggle-label"><input type="checkbox" id="toggle-remote" checked> Remote branches</label>
    <button id="find-btn" class="ctl-btn" title="Find (Ctrl/Cmd+F)">🔍 Find</button>
    <span class="spacer"></span>
    <span id="commit-count"></span>
  </div>

  <div id="find-widget">
    <input type="text" id="find-input" placeholder="Find commit, author, hash, ref…">
    <span id="find-count"></span>
    <button id="find-prev" title="Previous (Shift+Enter)">▲</button>
    <button id="find-next" title="Next (Enter)">▼</button>
    <button id="find-close" title="Close (Esc)">✕</button>
  </div>

  <div id="container">
    <div id="graph-scroll">
      <div id="loading">Loading graph…</div>
      <table id="graph-table">
        <colgroup>
          <col id="col-graph">
          <col id="col-refs" class="col-refs">
          <col id="col-desc">
          <col id="col-date" class="col-date">
          <col id="col-author" class="col-author">
          <col id="col-commit" class="col-commit">
        </colgroup>
        <thead>
          <tr>
            <th>Graph</th>
            <th class="col-refs">Branches / Tags<span class="col-resizer" data-col="refs"></span></th>
            <th>Description<span class="col-resizer" data-col="desc"></span></th>
            <th class="col-date">Date<span class="col-resizer" data-col="date"></span></th>
            <th class="col-author">Author<span class="col-resizer" data-col="author"></span></th>
            <th class="col-commit">Commit<span class="col-resizer" data-col="commit"></span></th>
          </tr>
        </thead>
        <tbody id="graph-body"></tbody>
      </table>
    </div>
    <div id="details-panel"><div id="details-inner"></div></div>
  </div>

  <div id="context-menu" class="context-menu"></div>

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
