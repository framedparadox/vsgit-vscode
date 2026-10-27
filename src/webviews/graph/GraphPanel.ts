import * as vscode from "vscode";
import * as path from "node:path";
import { Repository, SequencerKind } from "../../git/Repository";
import { RepositoryManager } from "../../git/RepositoryManager";
import { GitContentProvider, VSGIT_EMPTY_REF } from "../../git/GitContentProvider";
import { GitError } from "../../git/GitError";
import { confirmDestructiveAction } from "../../util/confirmation";
import { makeNonce } from "../../util/token";
import { classifyGraphRef } from "../../git/parsers/graphLog";
import {
  checkoutRemoteBranchInteractive,
  humanizeGitError,
  pickMainline,
  showGitProgress,
} from "../../commands/shared";
import { runSequencerAction } from "../../commands/interactiveRebase";

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
  isHead: boolean;
  kind?: "commit" | "uncommitted";
}

/** Pseudo-SHA of the synthetic "Uncommitted Changes" row. */
const UNCOMMITTED_SHA = "*uncommitted*";

/** Display order of ref pills within a row. */
const REF_ORDER: Record<RefType, number> = {
  head: 0,
  localBranch: 1,
  tag: 2,
  remoteBranch: 3,
  stash: 4,
};

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
  /** Commits currently requested; grows by a page on "Load more". */
  private commitLimit: number | undefined;
  private refreshGeneration = 0;
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
    this.activeRepo = initialRepo ?? manager.getActive();
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
    // Apply settings edited while the graph is open (colours, curve style,
    // date format, columns, page size, ordering, remote branches).
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("vsgit.graph")) return;
        void this.sendConfig();
        if (
          e.affectsConfiguration("vsgit.graph.maxCommits") ||
          e.affectsConfiguration("vsgit.graph.commitOrdering") ||
          e.affectsConfiguration("vsgit.graph.showRemoteBranches")
        ) {
          this.commitLimit = undefined;
          void this.refresh();
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
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "webview-ui")],
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
    this.activeRepo = this.manager.getActive();
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
        columns: {
          id: c.get<boolean>("graph.showIdColumn", true),
          author: c.get<boolean>("graph.showAuthorColumn", true),
          authoredDate: c.get<boolean>("graph.showAuthoredDateColumn", false),
          committer: c.get<boolean>("graph.showCommitterColumn", false),
          committedDate: c.get<boolean>("graph.showCommittedDateColumn", true),
        },
      },
    });
  }

  // ─── data ────────────────────────────────────────────────────────────────
  /** Commits per page (`vsgit.graph.maxCommits`); "Load more" adds a page. */
  private pageSize(): number {
    return Math.max(1, this.cfg.get<number>("graph.maxCommits", 500));
  }

  private async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const repo = this.resolveActiveRepo();
    if (!repo) {
      if (generation === this.refreshGeneration) {
        await this.panel.webview.postMessage({ type: "empty" });
      }
      return;
    }
    try {
      const limit = Math.max(this.commitLimit ?? 0, this.pageSize());
      this.commitLimit = limit;
      const showRemote = this.cfg.get<boolean>("graph.showRemoteBranches", true);
      const order = this.cfg.get<"date" | "author-date" | "topo">("graph.commitOrdering", "topo");

      const [data, aheadBehind, inProgress] = await Promise.all([
        repo.graphLog({
          limit,
          remotes: showRemote,
          branches: this.branchFilters.length > 0 ? this.branchFilters : undefined,
          order,
        }),
        repo.aheadBehind().catch(() => undefined),
        repo.inProgressOperation().catch(() => undefined),
      ]);

      // Classify each commit's full decorations into typed ref pills.
      const currentBranch = repo.localBranches.find((b) => b.isHead)?.shortName;
      const commits: WebviewCommit[] = data.commits.map((c) => {
        const refs: WebviewRef[] = [];
        for (const raw of c.refs) {
          const ref = classifyGraphRef(raw, currentBranch);
          if (ref && (showRemote || ref.type !== "remoteBranch")) {
            refs.push(ref);
          }
        }
        // Current branch first, then local branches, tags, remotes.
        refs.sort((a, b) => REF_ORDER[a.type] - REF_ORDER[b.type]);
        return { ...c, refs, kind: "commit" as const };
      });

      // Index commits once; repeated Array.find calls made stash decoration
      // O(commits × stashes) on large graphs.
      const commitsBySha = new Map(commits.map((commit) => [commit.sha, commit]));
      for (const stash of repo.stashes) {
        const target =
          (stash.baseObjectId ? commitsBySha.get(stash.baseObjectId) : undefined) ??
          (stash.objectId ? commitsBySha.get(stash.objectId) : undefined);
        if (target) target.refs.push({ name: stash.ref, type: "stash" });
      }

      // Synthetic "uncommitted changes" row pinned at the top, joined to the
      // commit HEAD points at (which, with every branch shown, is often not the
      // newest commit in the list).
      const uncommittedCount = repo.workingChanges.length;
      if (uncommittedCount > 0) {
        commits.unshift({
          sha: UNCOMMITTED_SHA,
          shortSha: "*",
          message: `Uncommitted Changes (${uncommittedCount})`,
          author: "",
          date: "",
          committer: "",
          committerDate: "",
          parents: data.headSha ? [data.headSha] : [],
          refs: [],
          isHead: false,
          kind: "uncommitted",
        });
      }

      // A repo switch or watcher refresh may have completed a newer request.
      // Never let this older result replace the current graph.
      if (
        generation !== this.refreshGeneration ||
        this.activeRepo?.root !== repo.root
      ) {
        return;
      }
      await this.panel.webview.postMessage({
        type: "graphData",
        data: {
          commits,
          head: repo.headName,
          headSha: data.headSha ?? null,
          hasMore: data.hasMore,
          branches: [
            ...repo.localBranches.map((b) => b.shortName),
            ...(showRemote
              ? repo.remoteBranches
                  .map((b) => b.shortName)
                  .filter((name) => !name.endsWith("/HEAD"))
              : []),
          ],
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
      if (generation === this.refreshGeneration) {
        vscode.window.showErrorMessage(`Failed to load graph: ${humanizeGitError(error)}`);
        await this.panel.webview.postMessage({ type: "loadFailed" });
      }
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

        case "loadMore":
          this.commitLimit = (this.commitLimit ?? this.pageSize()) + this.pageSize();
          await this.refresh();
          return;

        case "switchRepo": {
          const root = (message.data as { root: string }).root;
          const next = this.manager.get(root);
          if (next) {
            this.activeRepo = next;
            this.branchFilters = [];
            this.commitLimit = undefined;
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

        case "setColumnVisibility": {
          const { column, visible } = message.data as {
            column?: string;
            visible?: boolean;
          };
          const settingByColumn: Record<string, string> = {
            id: "graph.showIdColumn",
            author: "graph.showAuthorColumn",
            authoredDate: "graph.showAuthoredDateColumn",
            committer: "graph.showCommitterColumn",
            committedDate: "graph.showCommittedDateColumn",
          };
          const setting = column ? settingByColumn[column] : undefined;
          if (!setting) return;
          await this.cfg.update(setting, visible === true, vscode.ConfigurationTarget.Global);
          await this.sendConfig();
          return;
        }

        case "setBranchFilter":
          this.branchFilters = ((message.data as { branches?: string[] }).branches || []).filter(
            (b) => b && b.length > 0,
          );
          this.commitLimit = undefined;
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
        // Driven through runSequencerAction, which supports every paused kind
        // (rebase / merge / cherry-pick / revert / am) and keeps git from
        // waiting on a terminal editor.
        case "seqContinue":
          await this.runSequencer(repo, message.data, "continue");
          return;
        case "seqSkip":
          await this.runSequencer(repo, message.data, "skip");
          return;
        case "seqAbort":
          await this.runSequencer(repo, message.data, "abort");
          return;

        case "requestFiles":
          await this.sendCommitFiles(repo, message.data as string);
          return;

        case "openFileDiff": {
          const { sha, path: filePath, origPath, status } = message.data as {
            sha: string;
            path: string;
            origPath?: string;
            status?: string;
          };
          if (sha === UNCOMMITTED_SHA) {
            await this.openWorkingFileDiff(repo, filePath, origPath, status);
          } else {
            await this.openCommitFileDiff(repo, sha, filePath, origPath);
          }
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
          const { from, to, path: filePath, origPath } = message.data as {
            from: string;
            to: string;
            path: string;
            origPath?: string;
          };
          await this.openComparisonFileDiff(repo, from, to, filePath, origPath);
          return;
        }

        case "checkout":
          await this.checkoutCommit(message.data as string);
          return;

        case "checkoutRef":
          await this.checkoutRef(message.data as { name: string; type: string });
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
          await this.cherryPick(message.data as string);
          return;

        case "revert":
          await this.revert(message.data as string);
          return;

        case "dropCommit":
          await this.dropCommit(message.data as string);
          return;

        case "reset":
          await this.reset(message.data as { sha: string; mode: "soft" | "mixed" | "hard" });
          return;

        case "compareWithAnother":
          await this.compareWithAnother(message.data as string);
          return;

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
          await this.runOp(`Apply ${(message.data as { ref: string }).ref}`, () =>
            repo.stashApply((message.data as { ref: string }).ref),
          );
          return;

        case "stashPop":
          await this.runOp(`Pop ${(message.data as { ref: string }).ref}`, () =>
            repo.stashPop((message.data as { ref: string }).ref),
          );
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

        case "copyText": {
          const { text, label } = message.data as { text: string; label?: string };
          await vscode.env.clipboard.writeText(String(text));
          this.notify(`${label ?? "Text"} copied to clipboard`);
          return;
        }

        case "copyCommitMessage": {
          const details = await repo.commitDetails(message.data as string);
          await vscode.env.clipboard.writeText(details.message);
          this.notify("Commit message copied to clipboard");
          return;
        }

        default:
          console.warn(`GraphPanel: unhandled message type "${message.type}"`);
          return;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`${message.type} failed: ${humanizeGitError(error)}`);
      // A failed merge/rebase/cherry-pick usually leaves conflicts or an
      // in-progress operation behind; refresh so every view shows that state.
      await this.manager.refreshAll();
    }
  }

  private get repo(): Repository {
    const r = this.resolveActiveRepo();
    if (!r) throw new Error("No active repository");
    return r;
  }

  /**
   * Run a mutating git operation with VsGit progress, then refresh every view
   * (the graph refreshes through RepositoryManager.onDidChange). Errors
   * propagate to handleMessage, which reports them and refreshes too.
   */
  private async runOp(title: string, fn: () => Promise<void>, done?: string): Promise<void> {
    await showGitProgress(title, fn);
    if (done) this.notify(done);
    await this.manager.refreshAll();
  }

  // ─── operations ────────────────────────────────────────────────────────────
  private async checkoutCommit(sha: string): Promise<void> {
    await this.runOp(`Checkout ${sha.slice(0, 8)}`, () => this.repo.checkoutDetached(sha),
      `Checked out ${sha.slice(0, 8)} (detached HEAD)`);
  }

  /**
   * Check out a ref from its pill. A remote branch gets a local tracking
   * branch (reusing an existing one that already tracks it) instead of
   * leaving HEAD detached at the remote-tracking ref.
   */
  private async checkoutRef(ref: { name: string; type: string }): Promise<void> {
    const repo = this.repo;
    if (ref.type === "remoteBranch") {
      await checkoutRemoteBranchInteractive(this.manager, repo, ref.name);
      return;
    }
    await this.runOp(`Checkout ${ref.name}`, () => repo.checkoutRef(ref.name), `Checked out ${ref.name}`);
  }

  private async createBranch(sha: string, checkout: boolean): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: checkout ? "Create and checkout branch" : "Enter branch name",
      placeHolder: "feature/new-branch",
      validateInput: (v) => (v.trim() === "" ? "Branch name required" : undefined),
    });
    if (!name) return;
    await this.runOp(`Create branch ${name.trim()}`, () =>
      this.repo.createBranchAt(name.trim(), sha, checkout), `Branch '${name.trim()}' created`);
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
    const repo = this.repo;
    await this.runOp(`Create tag ${name}`, async () => {
      await repo.createTagAt(
        name,
        request.sha,
        request.sign === true || request.annotate === true ? message ?? name : undefined,
        request.sign === true,
        request.force === true,
      );
      if (remote) {
        await repo.pushTag(remote, name, request.force === true);
      }
    }, request.push ? `Tag '${name}' created and pushed` : `Tag '${name}' created`);
  }

  private async mergeInto(ref: string): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "Default", detail: "Fast-forward when possible", opts: {} },
        { label: "Create merge commit", detail: "--no-ff", opts: { noFf: true } },
        { label: "Fast-forward only", detail: "--ff-only", opts: { ffOnly: true } },
        { label: "Squash", detail: "--squash (stage the changes; commit them yourself)", opts: { squash: true } },
      ],
      { placeHolder: `Merge ${shortLabel(ref)} into ${this.repo.headName ?? "HEAD"}` },
    );
    if (!pick) return;
    await this.runOp(`Merge ${shortLabel(ref)}`, () => this.repo.merge(ref, pick.opts),
      "squash" in pick.opts
        ? `Squashed ${shortLabel(ref)} — review and commit the staged changes`
        : `Merged ${shortLabel(ref)}`);
  }

  private async runSequencer(
    repo: Repository,
    data: unknown,
    action: "continue" | "skip" | "abort",
  ): Promise<void> {
    const kind = (data as { kind?: string } | undefined)?.kind;
    if (!isSequencerKind(kind)) return;
    if (action === "abort") {
      const confirm = await this.confirm(`Abort the ${kind} in progress?`, "Abort");
      if (!confirm) return;
    }
    await this.runOp(`${kind} --${action}`, () => runSequencerAction(repo, kind, action),
      `${kind} ${action}`);
  }

  private async rebaseOnto(ref: string): Promise<void> {
    const confirm = await this.confirm(
      `Rebase ${this.repo.headName ?? "HEAD"} onto ${shortLabel(ref)}?`,
      "Rebase",
    );
    if (!confirm) return;
    await this.runOp(`Rebase onto ${shortLabel(ref)}`, () => this.repo.rebase(ref),
      `Rebased onto ${shortLabel(ref)}`);
  }

  private async cherryPick(sha: string): Promise<void> {
    const mainline = await pickMainline(this.repo, sha, "Cherry-pick");
    if (mainline === null) return;
    await this.runOp(`Cherry-pick ${sha.slice(0, 8)}`, () =>
      this.repo.cherryPick(sha, { mainline }), `Cherry-picked ${sha.slice(0, 8)}`);
  }

  private async revert(sha: string): Promise<void> {
    const mainline = await pickMainline(this.repo, sha, "Revert");
    if (mainline === null) return;
    await this.runOp(`Revert ${sha.slice(0, 8)}`, () =>
      this.repo.revert(sha, { mainline }), `Reverted ${sha.slice(0, 8)}`);
  }

  private async dropCommit(sha: string): Promise<void> {
    const repo = this.repo;
    // `rebase --onto <sha>^ <sha>` only makes sense for a single-parent commit
    // that the current branch actually contains.
    const [parents, onBranch] = await Promise.all([
      repo.commitParents(sha),
      repo.isAncestor(sha, "HEAD"),
    ]);
    if (!onBranch) {
      vscode.window.showWarningMessage(
        `${sha.slice(0, 8)} is not on the current branch, so it cannot be dropped from it.`,
      );
      return;
    }
    if (parents.length !== 1) {
      vscode.window.showWarningMessage(
        parents.length === 0
          ? "The root commit cannot be dropped."
          : "Merge commits cannot be dropped this way; use an interactive rebase.",
      );
      return;
    }
    const confirm = await this.confirm(
      `Drop commit ${sha.slice(0, 8)}? This rewrites history on the current branch.`,
      "Drop Commit",
    );
    if (!confirm) return;
    await this.runOp(`Drop ${sha.slice(0, 8)}`, () => repo.dropCommit(sha), `Dropped ${sha.slice(0, 8)}`);
  }

  private async reset(data: { sha: string; mode: "soft" | "mixed" | "hard" }): Promise<void> {
    if (data.mode === "hard") {
      const confirm = await this.confirm(
        `Hard reset to ${data.sha.slice(0, 8)}? Working tree changes will be lost.`,
        "Reset Hard",
      );
      if (!confirm) return;
    }
    await this.runOp(`Reset --${data.mode}`, () => this.repo.reset(data.sha, data.mode),
      `Reset (${data.mode}) to ${data.sha.slice(0, 8)}`);
  }

  private async renameBranch(name: string): Promise<void> {
    const newName = await vscode.window.showInputBox({
      prompt: `Rename branch '${name}' to`,
      value: name,
      validateInput: (v) => (v.trim() === "" ? "Branch name required" : undefined),
    });
    if (!newName || newName.trim() === name) return;
    await this.runOp(`Rename ${name}`, () => this.repo.renameBranch(name, newName.trim()),
      `Renamed '${name}' → '${newName.trim()}'`);
  }

  private async deleteBranch(name: string): Promise<void> {
    const confirm = await this.confirm(`Delete local branch '${name}'?`, "Delete");
    if (!confirm) return;
    try {
      await this.repo.deleteBranch(name, false);
    } catch (error) {
      // Only an unmerged branch is worth forcing; surface anything else
      // (e.g. deleting the checked-out branch) as the real error.
      if (!(error instanceof GitError) || !/not fully merged/i.test(error.stderr)) {
        throw error;
      }
      const force = await this.confirm(
        `Branch '${name}' is not fully merged. Force delete?`,
        "Force Delete",
      );
      if (!force) return;
      await this.repo.deleteBranch(name, true);
    }
    this.notify(`Deleted branch '${name}'`);
    await this.manager.refreshAll();
  }

  private async deleteRemoteBranch(fullName: string): Promise<void> {
    const target = this.repo.splitRemoteBranch(fullName);
    if (!target) return;
    const confirm = await this.confirm(
      `Delete remote branch '${fullName}'? This affects the remote.`,
      "Delete Remote Branch",
    );
    if (!confirm) return;
    await this.runOp(`Delete ${fullName}`, () =>
      this.repo.deleteRemoteBranch(target.remote, target.branch), `Deleted remote branch '${fullName}'`);
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
    await this.runOp(`Push ${name}`, () =>
      this.repo.push({ remote, refspec: this.repo.pushRefspec(name, remote), ...pick.opts }),
      `Pushed '${name}' to ${remote}`);
  }

  private async deleteTag(name: string): Promise<void> {
    const confirm = await this.confirm(`Delete tag '${name}'?`, "Delete");
    if (!confirm) return;
    await this.runOp(`Delete tag ${name}`, () => this.repo.deleteTag(name), `Deleted tag '${name}'`);
  }

  private async pushTag(name: string): Promise<void> {
    const remote = await this.pickRemote();
    if (!remote) return;
    await this.runOp(`Push tag ${name}`, () => this.repo.pushTag(remote, name),
      `Pushed tag '${name}' to ${remote}`);
  }

  private async stashPush(repo: Repository): Promise<void> {
    const message = await vscode.window.showInputBox({
      prompt: "Stash message (optional)",
      placeHolder: "WIP on current branch",
    });
    if (message === undefined) return;
    const pick = await vscode.window.showQuickPick(
      [
        { label: "Stash tracked changes", opts: {} },
        { label: "Include untracked files", opts: { untracked: true } },
        { label: "Keep staged changes in place", detail: "--keep-index", opts: { keepIndex: true } },
        { label: "Stash staged changes only", detail: "--staged", opts: { staged: true } },
      ],
      { placeHolder: "What to stash?" },
    );
    if (!pick) return;
    const opts = pick.opts as { untracked?: boolean; keepIndex?: boolean; staged?: boolean };
    await this.runOp("Stash", () =>
      repo.stashPush(message || undefined, opts.untracked === true, opts), "Changes stashed");
  }

  private async stashDrop(ref: string): Promise<void> {
    const confirm = await this.confirm(`Drop stash ${ref}?`, "Drop Stash");
    if (!confirm) return;
    await this.runOp(`Drop ${ref}`, () => this.repo.stashDrop(ref), `Dropped ${ref}`);
  }

  private async stashBranch(ref: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: `Create branch from ${ref}`,
      placeHolder: "feature/from-stash",
      validateInput: (v) => (v.trim() === "" ? "Branch name required" : undefined),
    });
    if (!name) return;
    await this.runOp(`Branch from ${ref}`, () => this.repo.stashBranch(name.trim(), ref),
      `Created branch '${name.trim()}' from ${ref}`);
  }

  // ─── diff / compare ──────────────────────────────────────────────────────────
  /**
   * Changed files (and the full message) for the commit-details pane. The
   * synthetic uncommitted row lists the working tree against HEAD.
   */
  private async sendCommitFiles(repo: Repository, sha: string): Promise<void> {
    if (sha === UNCOMMITTED_SHA) {
      await this.panel.webview.postMessage({
        type: "files",
        data: { sha, files: repo.workingChanges },
      });
      return;
    }
    const [files, details, parents] = await Promise.all([
      repo.commitFiles(sha),
      repo.commitDetails(sha).catch(() => undefined),
      repo.commitParents(sha).catch(() => [] as string[]),
    ]);
    await this.panel.webview.postMessage({
      type: "files",
      data: { sha, files, details, isMerge: parents.length > 1 },
    });
  }

  private async openCommitFileDiff(
    repo: Repository,
    sha: string,
    filePath: string,
    origPath?: string,
  ): Promise<void> {
    // A root commit has no parent: diff against an empty file.
    const parents = await repo.commitParents(sha).catch(() => [] as string[]);
    await GitContentProvider.openDiff(
      repo.root,
      { path: filePath, origPath },
      parents.length > 0 ? `${sha}~1` : VSGIT_EMPTY_REF,
      sha,
    );
  }

  /** Diff HEAD ↔ the working-tree file for the uncommitted row. */
  private async openWorkingFileDiff(
    repo: Repository,
    filePath: string,
    origPath: string | undefined,
    status: string | undefined,
  ): Promise<void> {
    if (status === "U") {
      await vscode.commands.executeCommand("vsgit.conflict.openMergeEditor", {
        repo,
        change: { path: filePath },
      });
      return;
    }
    const leftRel = origPath ?? filePath;
    const absolute = path.join(repo.root, filePath);
    const left = GitContentProvider.uri(
      repo.root,
      leftRel,
      status === "?" || status === "A" ? VSGIT_EMPTY_REF : "HEAD",
      path.join(repo.root, leftRel),
    );
    const right =
      status === "D"
        ? GitContentProvider.uri(repo.root, filePath, VSGIT_EMPTY_REF, absolute)
        : vscode.Uri.file(absolute);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(filePath)} (HEAD ↔ Working Tree)`,
    );
  }

  /** Diff a file between two arbitrary commits (CTRL/CMD-click comparison). */
  private async openComparisonFileDiff(
    repo: Repository,
    fromSha: string,
    toSha: string,
    filePath: string,
    origPath?: string,
  ): Promise<void> {
    await GitContentProvider.openDiff(
      repo.root,
      { path: filePath, origPath },
      fromSha,
      toSha,
    );
  }

  /** Ask for a second revision, then show the comparison in the graph. */
  private async compareWithAnother(sha: string): Promise<void> {
    const target = await vscode.window.showInputBox({
      prompt: `Compare ${sha.slice(0, 8)} with…`,
      placeHolder: "HEAD, a branch or tag name, or a commit SHA",
      validateInput: (v) => (v.trim() === "" ? "Enter a revision" : undefined),
    });
    if (!target) return;
    const resolved = await this.repo.resolveRevision(target.trim());
    await this.panel.webview.postMessage({
      type: "startComparison",
      data: { from: sha, to: resolved, label: target.trim() },
    });
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
    return confirmDestructiveAction({
      operation: action,
      message,
    });
  }

  private notify(message: string): void {
    vscode.window.setStatusBarMessage(message, 3000);
  }

  // ─── html ────────────────────────────────────────────────────────────────────
  private getHtmlForWebview(): string {
    const nonce = makeNonce();
    const webview = this.panel.webview;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview-ui", "graph", "graph.css"),
    );
    const codiconCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview-ui", "shared", "codicon.css"),
    );
    const setiCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview-ui", "shared", "seti.css"),
    );
    const setiJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview-ui", "shared", "setiIcons.js"),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview-ui", "graph", "graph.js"),
    );
    const layoutUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview-ui", "graph", "graphLayout.js"),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${codiconCssUri}">
  <link rel="stylesheet" href="${setiCssUri}">
  <link rel="stylesheet" href="${cssUri}">
  <title>VsGit Graph</title>
</head>
<body>
  <div id="aria-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="shell">
    <!-- ── top control bar (vscode-git-graph layout) ──────────────────
         LEFT: Repo dropdown, Branches (multi-select) dropdown, Show Remote
         Branches checkbox. RIGHT: action icons. Dropdowns are filled by the
         Dropdown component in graph.js; icons are injected as inline SVG. -->
    <div id="toolbar">
      <span id="repoControl"><span class="ctrl-label">Repo: </span><div id="repoDropdown" class="dropdown"></div></span>
      <span id="branchControl"><span class="ctrl-label">Branches: </span><div id="branchDropdown" class="dropdown"></div></span>
      <label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox"><span class="customCheckbox" aria-hidden="true"></span>Show Remote Branches</label>
      <button class="tb-btn after-control" id="tb-trace" title="Trace flow: ancestors / descendants / off" aria-label="Trace"><span class="tb-ico" data-icon="trace"></span><span class="tb-label">Trace</span></button>
      <span class="tb-spacer"></span>
      <span id="commit-count"></span>
      <span class="tb-sep"></span>
      <button class="tb-btn icon-only" id="tb-pull" title="Pull" data-label="Pull" aria-label="Pull">
        <span class="tb-ico" data-icon="pull"></span><span class="tb-badge" id="badge-pull"></span>
      </button>
      <button class="tb-btn icon-only" id="tb-push" title="Push" data-label="Push" aria-label="Push">
        <span class="tb-ico" data-icon="push"></span><span class="tb-badge" id="badge-push"></span>
      </button>
      <button class="tb-btn icon-only" id="tb-fetch" title="Fetch" data-label="Fetch" aria-label="Fetch"><span class="tb-ico" data-icon="fetch"></span></button>
      <span class="tb-sep"></span>
      <button class="tb-btn icon-only" id="tb-commit" title="Commit" data-label="Commit" aria-label="Commit"><span class="tb-ico" data-icon="commit"></span></button>
      <button class="tb-btn icon-only" id="tb-branch" title="New Branch" data-label="New Branch" aria-label="New Branch"><span class="tb-ico" data-icon="branch"></span></button>
      <button class="tb-btn icon-only" id="tb-merge" title="Merge" data-label="Merge" aria-label="Merge"><span class="tb-ico" data-icon="merge"></span></button>
      <button class="tb-btn icon-only" id="tb-stash" title="Stash" data-label="Stash" aria-label="Stash"><span class="tb-ico" data-icon="stash"></span></button>
      <span class="tb-sep"></span>
      <button class="tb-btn icon-only" id="tb-find" title="Find (Ctrl/Cmd+F)" data-label="Find" aria-label="Find"><span class="tb-ico" data-icon="find"></span></button>
      <button class="tb-btn icon-only" id="tb-columns" title="Columns" data-label="Columns" aria-label="Columns"><span class="tb-ico" data-icon="columns"></span></button>
      <button class="tb-btn icon-only" id="tb-tracking" title="Tracking: off" data-label="Tracking" aria-label="Tracking"><span class="tb-ico" data-icon="tracking"></span></button>
      <button class="tb-btn icon-only" id="tb-refresh" title="Refresh (Ctrl/Cmd+R)" data-label="Refresh" aria-label="Refresh"><span class="tb-ico" data-icon="refresh"></span></button>
      <div id="columns-menu" class="columns-menu" hidden></div>
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
      <!-- Column layout mirrors VsGit / EGit-style history:
           Graph | Description | Author | Authored Date | Committer | Committed Date | Commit.
           The graph rail is the FIRST column so the overlay SVG keeps a clean,
           uniform coordinate space anchored to the table's left edge; ref pills +
           message text live in the Description column, and the abbreviated commit
           hash (Commit) is the LAST column. -->
      <table id="graph-table" aria-label="Git commit graph">
        <colgroup>
          <col id="col-graph">
          <col id="col-desc">
          <col id="col-author" class="col-author">
          <col id="col-adate" class="col-adate">
          <col id="col-committer" class="col-committer">
          <col id="col-cdate" class="col-cdate">
          <col id="col-id" class="col-id">
        </colgroup>
        <thead>
          <tr>
            <th class="col-graph-head">Graph</th>
            <th>Description<span class="col-resizer" data-col="desc"></span></th>
            <th class="col-author">Author<span class="col-resizer" data-col="author"></span></th>
            <th class="col-adate">Authored Date<span class="col-resizer" data-col="adate"></span></th>
            <th class="col-committer">Committer<span class="col-resizer" data-col="committer"></span></th>
            <th class="col-cdate">Committed Date<span class="col-resizer" data-col="cdate"></span></th>
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

  <div id="context-menu" class="context-menu" role="menu" aria-label="Commit actions"></div>

  <div id="create-tag-modal" class="modal-backdrop" hidden>
    <form id="create-tag-form" class="modal" autocomplete="off" role="dialog" aria-modal="true" aria-labelledby="create-tag-title">
      <div class="modal-header">
        <h2 id="create-tag-title">Create Tag</h2>
        <button type="button" class="modal-close" id="create-tag-close" title="Close" aria-label="Close">&times;</button>
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

  <script nonce="${nonce}" src="${setiJsUri}"></script>
  <script nonce="${nonce}" src="${layoutUri}"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  public dispose() {
    this.refreshGeneration += 1;
    GraphPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

function isSequencerKind(kind: unknown): kind is SequencerKind {
  return (
    kind === "rebase" ||
    kind === "merge" ||
    kind === "cherry-pick" ||
    kind === "revert" ||
    kind === "am"
  );
}

/** A ref name as-is, or an abbreviated SHA. */
function shortLabel(ref: string): string {
  return /^[0-9a-f]{40,64}$/i.test(ref) ? ref.slice(0, 8) : ref;
}
