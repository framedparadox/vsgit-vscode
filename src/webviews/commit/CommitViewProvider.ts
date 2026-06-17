import * as vscode from "vscode";
import * as path from "node:path";
import { RepositoryManager } from "../../git/RepositoryManager";
import { Repository } from "../../git/Repository";
import { StagingProvider, StagingNode } from "../../views/StagingProvider";
import { FileChange } from "../../git/parsers/status";

/**
 * Commit view: a webview replacing the transient commit input box with a proper
 * Source-Control-like panel. Shows Conflicted / Staged / Changes groups with
 * stage/unstage/discard/open-diff actions, a multi-line commit message editor,
 * and a Commit button with amend / sign-off / GPG toggles.
 *
 * Staging and commit all flow through existing `Repository` methods and the
 * registered `vsgit.staging.*` commands — this view only owns the UI.
 */
export class CommitViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "vsgit.commit";

  private view?: vscode.WebviewView;
  private message = "";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: RepositoryManager,
    private readonly staging: StagingProvider,
  ) {
    // Re-push file lists whenever any repository's status changes.
    manager.onDidChange(() => this.refresh());
  }

  private get repo(): Repository | undefined {
    return this.staging.activeRepo;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources")],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((m) => this.handleMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
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
      case "commit": {
        const data = msg.data as Partial<{
          message: string;
          amend: boolean;
          signoff: boolean;
          gpg: boolean;
        }> | undefined;
        await this.commit(repo, {
          message: typeof data?.message === "string" ? data.message : "",
          amend: data?.amend === true,
          signoff: data?.signoff === true,
          gpg: data?.gpg === true,
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
    opts: { message: string; amend: boolean; signoff: boolean; gpg: boolean },
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
    } catch (e) {
      vscode.window.showErrorMessage(
        `Commit failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "commit.css"),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "commit.js"),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${cssUri}">
  <title>Commit</title>
</head>
<body>
  <div id="empty" class="empty">No Git repository is active.</div>
  <div id="root" style="display:none">
    <div id="message-box">
      <div id="commit-header">
        <div id="commit-title">
          <span class="title">Commit</span>
          <span id="branch-name"></span>
        </div>
        <div id="commit-actions">
          <button id="view-tree" class="header-btn" title="Tree View" aria-label="Tree View">
            <svg class="header-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2h4v3H2V2zm7 0h4v3H9V2zM2 11h4v3H2v-3zm3-5h1v1.5h3V6h1v1.5h3V10h-1V8.5H6V10H5V8.5H3V10H2V7.5h3V6z"/>
            </svg>
          </button>
          <button id="view-list" class="header-btn" title="List View" aria-label="List View">
            <svg class="header-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 3h2v2H2V3zm3.5.25H14v1.5H5.5v-1.5zM2 7h2v2H2V7zm3.5.25H14v1.5H5.5v-1.5zM2 11h2v2H2v-2zm3.5.25H14v1.5H5.5v-1.5z"/>
            </svg>
          </button>
          <button id="commit-btn" class="primary" title="Commit staged changes">Commit</button>
        </div>
      </div>
      <textarea id="message" placeholder="Message (commit on this branch)"></textarea>
      <div id="commit-bar">
        <label class="opt"><input type="checkbox" id="opt-amend"> Amend</label>
        <label class="opt"><input type="checkbox" id="opt-signoff"> Sign off</label>
        <label class="opt"><input type="checkbox" id="opt-gpg"> GPG</label>
      </div>
    </div>
    <div id="groups"></div>
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

type StagingGroup = "staged" | "unstaged" | "conflicted";

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

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
