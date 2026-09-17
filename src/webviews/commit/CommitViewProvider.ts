import * as vscode from "vscode";
import * as path from "node:path";
import { RepositoryManager } from "../../git/RepositoryManager";
import { Repository } from "../../git/Repository";
import { StagingProvider, StagingNode } from "../../views/StagingProvider";
import { FileChange } from "../../git/parsers/status";
import { makeNonce } from "../../util/token";

/**
 * Commit view: a webview replacing the transient commit input box with a proper
 * Source-Control-like panel. Shows Conflicted / Staged / Changes groups with
 * stage/unstage/discard/open-diff actions, a multi-line commit message editor,
 * and a Commit button with amend / sign-off / GPG toggles.
 *
 * Staging and commit all flow through existing `Repository` methods and the
 * registered `vsgit.staging.*` commands — this view only owns the UI.
 */
export class CommitViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "vsgit.commit";

  private view?: vscode.WebviewView;
  private message = "";
  // Subscriptions tied to the provider's lifetime (disposed on dispose()).
  private readonly disposables: vscode.Disposable[] = [];
  // Subscriptions tied to the currently-resolved webview; replaced whenever the
  // view is (re)resolved so per-view listeners don't accumulate.
  private viewDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: RepositoryManager,
    private readonly staging: StagingProvider,
  ) {
    // Re-push file lists whenever any repository's status changes.
    this.disposables.push(manager.onDidChange(() => this.refresh()));
  }

  dispose(): void {
    for (const d of this.viewDisposables) d.dispose();
    this.viewDisposables = [];
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private get repo(): Repository | undefined {
    return this.staging.activeRepo;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    // A view can be resolved more than once (e.g. moved between panels); drop
    // any listeners from a previous resolution before wiring the new view.
    for (const d of this.viewDisposables) d.dispose();
    this.viewDisposables = [];

    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources")],
    };
    view.webview.html = this.getHtml(view.webview);
    this.viewDisposables.push(
      view.webview.onDidReceiveMessage((m) => this.handleMessage(m)),
      view.onDidChangeVisibility(() => {
        if (view.visible) this.refresh();
      }),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
      }),
    );
    this.refresh();
  }

  /** Push the current repo's file groups + branch name to the webview. */
  private refresh(): void {
    if (!this.view) return;
    const repo = this.repo;
    if (!repo) {
      this.view.webview.postMessage({ type: "state", data: { active: false } });
      return;
    }
    const conflicted = [...repo.stagedChanges, ...repo.unstagedChanges].filter(
      (c) => c.conflicted,
    );
    const staged = repo.stagedChanges.filter((c) => !c.conflicted);
    const unstaged = repo.unstagedChanges.filter((c) => !c.conflicted);
    this.view.webview.postMessage({
      type: "state",
      data: {
        active: true,
        branch: repo.headName ?? "(detached)",
        message: this.message,
        conflicted: conflicted.map(toFileDto),
        staged: staged.map(toFileDto),
        unstaged: unstaged.map(toFileDto),
      },
    });
  }

  private async handleMessage(msg: {
    type: string;
    data?: unknown;
  }): Promise<void> {
    const repo = this.repo;
    switch (msg.type) {
      case "ready":
        this.refresh();
        return;
      case "messageChanged":
        this.message = String(msg.data ?? "");
        return;
      case "stage":
        await vscode.commands.executeCommand(
          "vsgit.staging.stage",
          this.fileNode(msg.data, "unstaged"),
        );
        return;
      case "unstage":
        await vscode.commands.executeCommand(
          "vsgit.staging.unstage",
          this.fileNode(msg.data, "staged"),
        );
        return;
      case "discard":
        await vscode.commands.executeCommand(
          "vsgit.staging.discard",
          this.fileNode(msg.data, "unstaged"),
        );
        return;
      case "stageAll":
        await vscode.commands.executeCommand("vsgit.staging.stageAll");
        return;
      case "unstageAll":
        await vscode.commands.executeCommand("vsgit.staging.unstageAll");
        return;
      case "openDiff": {
        const data = msg.data as { group?: unknown } | undefined;
        const group = isStagingGroup(data?.group) ? data.group : "unstaged";
        await vscode.commands.executeCommand(
          "vsgit.staging.openDiff",
          this.fileNode(msg.data, group),
        );
        return;
      }
      case "amendToggled": {
        const data = msg.data as Partial<{ amend: boolean }> | undefined;
        if (data?.amend === true && repo) {
          const message = await repo.headCommitMessage();
          this.view?.webview.postMessage({ type: "amendMessage", data: { message } });
        }
        return;
      }
      case "commit": {
        const data = msg.data as Partial<{
          message: string;
          amend: boolean;
          signoff: boolean;
          gpg: boolean;
          mode: CommitMode;
        }> | undefined;
        await this.commit(repo, {
          message: typeof data?.message === "string" ? data.message : "",
          amend: data?.amend === true,
          signoff: data?.signoff === true,
          gpg: data?.gpg === true,
          mode: isCommitMode(data?.mode) ? data.mode : "commit",
        });
        return;
      }
      default:
        console.warn(`CommitViewProvider: unhandled message type "${msg.type}"`);
        return;
    }
  }

  /** Re-hydrate a webview file reference into a StagingNode for the commands. */
  private fileNode(data: unknown, group: StagingGroup): StagingNode | undefined {
    const repo = this.repo;
    const d = data as { path?: string; group?: unknown } | undefined;
    if (!repo || typeof d?.path !== "string") return undefined;
    const g = isStagingGroup(d.group) ? d.group : group;
    const pool =
      g === "staged"
        ? repo.stagedChanges
        : g === "conflicted"
          ? [...repo.stagedChanges, ...repo.unstagedChanges]
          : repo.unstagedChanges;
    const change = pool.find((c) => c.path === d.path);
    if (!change) return undefined;
    return { type: "file", group: g, repo, change };
  }

  private async commit(
    repo: Repository | undefined,
    opts: {
      message: string;
      amend: boolean;
      signoff: boolean;
      gpg: boolean;
      mode: CommitMode;
    },
  ): Promise<void> {
    if (!repo) {
      vscode.window.showWarningMessage("No active repository.");
      return;
    }
    const message = (opts.message ?? "").trim();
    if (!message) {
      vscode.window.showWarningMessage("Commit message cannot be empty.");
      return;
    }
    if (!opts.amend && repo.stagedChanges.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        "No staged changes. Stage all changes and commit?",
        "Stage All & Commit",
        "Cancel",
      );
      if (choice !== "Stage All & Commit") return;
      await repo.stageAll();
      await repo.refresh();
    }
    try {
      await repo.commit(message, {
        amend: opts.amend,
        signoff: opts.signoff,
        signoff_gpg: opts.gpg,
      });
      this.message = "";
      this.view?.webview.postMessage({ type: "committed" });
      await this.manager.refreshAll();
      vscode.window.setStatusBarMessage(
        opts.amend ? "Amended commit" : "Committed",
        3000,
      );
      // After-commit transport, mirroring VS Code's "Commit & Push/Sync". These
      // reuse the existing commands so credentials, progress and remote-picking
      // behave identically to the standalone Push/Pull buttons.
      if (opts.mode === "push") {
        await vscode.commands.executeCommand("vsgit.push", { repo });
      } else if (opts.mode === "sync") {
        await vscode.commands.executeCommand("vsgit.pull", { repo });
        await vscode.commands.executeCommand("vsgit.push", { repo });
      }
    } catch (e) {
      vscode.window.showErrorMessage(
        `Commit failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "commit.css"),
    );
    const codiconCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "codicon.css"),
    );
    const setiCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "seti.css"),
    );
    const setiJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "setiIcons.js"),
    );
    const helpersUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "commitView.js"),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "commit.js"),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${codiconCssUri}">
  <link rel="stylesheet" href="${setiCssUri}">
  <link rel="stylesheet" href="${cssUri}">
  <title>Commit</title>
</head>
<body>
  <div id="aria-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="empty" class="empty">No Git repository is active.</div>
  <div id="root" style="display:none">
    <div id="message-box">
      <div id="commit-header">
        <div id="commit-title">
          <span id="branch-name"></span>
        </div>
        <div id="commit-actions">
          <button id="advanced-toggle" class="header-btn advanced-toggle" type="button"
                  title="More commit options" aria-label="More commit options"
                  aria-expanded="false" aria-controls="commit-bar">
            <i class="codicon codicon-ellipsis header-icon" aria-hidden="true"></i>
            <span id="advanced-badge" class="advanced-badge" hidden title="Advanced options are active"></span>
          </button>
          <button id="view-tree" class="header-btn" title="Tree View" aria-label="Tree View">
            <i class="codicon codicon-list-tree header-icon" aria-hidden="true"></i>
          </button>
          <button id="view-list" class="header-btn" title="List View" aria-label="List View">
            <i class="codicon codicon-list-flat header-icon" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div id="commit-bar" hidden>
        <label class="opt"><input type="checkbox" id="opt-amend"> Amend</label>
        <label class="opt"><input type="checkbox" id="opt-signoff"> Sign off</label>
        <label class="opt"><input type="checkbox" id="opt-gpg"> GPG</label>
      </div>
      <textarea id="message" placeholder="Message (commit on this branch)"></textarea>
      <!-- Split button: primary action + dropdown of commit modes, like the
           Source Control panel's Commit button. -->
      <div id="commit-split" class="split-button">
        <button id="commit-btn" class="primary" title="Commit staged changes">
          <i class="codicon codicon-check" aria-hidden="true"></i>
          <span id="commit-btn-label">Commit</span>
        </button>
        <button id="commit-more" class="primary split-caret" type="button"
                title="More commit actions" aria-label="More commit actions"
                aria-haspopup="menu" aria-expanded="false">
          <i class="codicon codicon-chevron-down" aria-hidden="true"></i>
        </button>
        <div id="commit-menu" class="commit-menu" role="menu" hidden>
          <button class="commit-menu-item" role="menuitem" data-mode="commit">Commit</button>
          <button class="commit-menu-item" role="menuitem" data-mode="push">Commit &amp; Push</button>
          <button class="commit-menu-item" role="menuitem" data-mode="sync">Commit &amp; Sync</button>
          <div class="commit-menu-sep"></div>
          <button class="commit-menu-item" role="menuitem" data-toggle="amend">Commit (Amend)</button>
          <button class="commit-menu-item" role="menuitem" data-toggle="signoff">Commit (Signed Off)</button>
        </div>
      </div>
    </div>
    <div id="groups"></div>
  </div>
  <script nonce="${nonce}" src="${setiJsUri}"></script>
  <script nonce="${nonce}" src="${helpersUri}"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

type StagingGroup = "staged" | "unstaged" | "conflicted";

/** What to do after a successful commit, mirroring VS Code's commit dropdown. */
type CommitMode = "commit" | "push" | "sync";

function isCommitMode(value: unknown): value is CommitMode {
  return value === "commit" || value === "push" || value === "sync";
}

function isStagingGroup(value: unknown): value is StagingGroup {
  return value === "staged" || value === "unstaged" || value === "conflicted";
}

interface FileDto {
  path: string;
  name: string;
  dir: string;
  state: string;
  conflicted: boolean;
}

function toFileDto(change: FileChange): FileDto {
  const dir = path.dirname(change.path);
  return {
    path: change.path,
    name: path.basename(change.path),
    dir: dir === "." ? "" : dir,
    state: change.conflicted
      ? "conflicted"
      : (change.indexState ?? change.worktreeState ?? "modified"),
    conflicted: change.conflicted,
  };
}
