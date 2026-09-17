import * as vscode from "vscode";
import {
  buildDocumentationData,
  DocumentationData,
  DocumentationManifest,
} from "./documentationContent";
import { makeNonce } from "../../util/token";

/**
 * Hosts the same documentation library in the bottom sidebar view and in a
 * full editor panel. Operation data comes from package.json, while the webview
 * remains a renderer with a small, validated command bridge.
 */
export class DocumentationProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "vsgit.documentation";

  private readonly data: DocumentationData;
  private readonly allowedCommands: Set<string>;
  private view?: vscode.WebviewView;
  private panel?: vscode.WebviewPanel;
  private viewDisposables: vscode.Disposable[] = [];
  private panelDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    manifest: DocumentationManifest,
  ) {
    this.data = buildDocumentationData(manifest);
    this.allowedCommands = new Set(
      this.data.operationCategories.flatMap((category) =>
        category.operations
          .filter((operation) => operation.runnable)
          .map((operation) => operation.command),
      ),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.disposeViewListeners();
    this.view = view;
    this.configure(view.webview, "sidebar");
    this.viewDisposables.push(
      view.webview.onDidReceiveMessage((message) =>
        this.handleMessage(message, view.webview),
      ),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
        this.disposeViewListeners();
      }),
    );
  }

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "vsgit.documentationPanel",
      "VsGit Documentation",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "resources"),
        ],
      },
    );
    this.configure(this.panel.webview, "panel");
    this.panelDisposables.push(
      this.panel.webview.onDidReceiveMessage((message) =>
        this.handleMessage(message, this.panel!.webview),
      ),
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposePanelListeners();
      }),
    );
  }

  dispose(): void {
    this.disposeViewListeners();
    this.disposePanelListeners();
    this.panel?.dispose();
    this.panel = undefined;
    this.view = undefined;
  }

  private configure(
    webview: vscode.Webview,
    mode: "sidebar" | "panel",
  ): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "resources"),
      ],
    };
    webview.html = this.getHtml(webview, mode);
  }

  private async handleMessage(
    message: { type?: unknown; command?: unknown },
    webview: vscode.Webview,
  ): Promise<void> {
    if (message.type === "ready") {
      await webview.postMessage({ type: "documentationData", data: this.data });
      return;
    }
    if (message.type === "openFull") {
      this.openPanel();
      return;
    }
    if (
      message.type === "runCommand" &&
      typeof message.command === "string" &&
      this.allowedCommands.has(message.command)
    ) {
      await vscode.commands.executeCommand(message.command);
    }
  }

  private getHtml(
    webview: vscode.Webview,
    mode: "sidebar" | "panel",
  ): string {
    const nonce = makeNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "resources",
        "documentation.css",
      ),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "resources",
        "documentation.js",
      ),
    );

    return `<!DOCTYPE html>
<html lang="en" data-mode="${mode}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>VsGit Documentation</title>
</head>
<body>
  <header class="library-header">
    <div class="eyebrow">VsGit reference library</div>
    <div class="heading-row">
      <div>
        <h1>Git, explained where you use it.</h1>
        <p class="intro">Components, terminology, and every operation included in this extension.</p>
      </div>
      ${
        mode === "sidebar"
          ? '<button id="open-full" class="secondary-action" type="button">Open Full Library</button>'
          : ""
      }
    </div>
    <label class="search-box" for="library-search">
      <span aria-hidden="true">⌕</span>
      <input id="library-search" type="search"
             placeholder="Search terms, components, or command IDs"
             autocomplete="off" spellcheck="false">
      <kbd>/</kbd>
    </label>
    <div id="stats" class="stats" aria-live="polite"></div>
  </header>

  <nav class="section-tabs" aria-label="Documentation sections" role="tablist">
    <button type="button" role="tab" data-section="overview" aria-selected="true">Overview</button>
    <button type="button" role="tab" data-section="components" aria-selected="false">Components</button>
    <button type="button" role="tab" data-section="glossary" aria-selected="false">Git glossary</button>
    <button type="button" role="tab" data-section="operations" aria-selected="false">Operations</button>
  </nav>

  <main id="library" aria-busy="true">
    <div class="loading">Loading the VsGit library…</div>
  </main>
  <div id="empty-state" class="empty-state" hidden>
    <strong>No matching documentation</strong>
    <span>Try a Git term, command title, or command ID.</span>
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private disposeViewListeners(): void {
    for (const disposable of this.viewDisposables) disposable.dispose();
    this.viewDisposables = [];
  }

  private disposePanelListeners(): void {
    for (const disposable of this.panelDisposables) disposable.dispose();
    this.panelDisposables = [];
  }
}
