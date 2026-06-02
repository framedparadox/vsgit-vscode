import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { BlameLine } from "../git/parsers/blame";

/**
 * Inline blame annotations: when enabled, shows author · date · summary at the
 * end of the current line as dimmed text (EGit's "revision annotations").
 * Toggled per-editor; recomputed when the active editor or selection changes.
 */
export class BlameController implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private enabled = false;
  private cache = new Map<string, BlameLine[]>();

  constructor(private readonly manager: RepositoryManager) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        margin: "0 0 0 3em",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeTextEditorSelection((e) =>
        this.renderFor(e.textEditor),
      ),
      vscode.workspace.onDidChangeTextDocument((e) => {
        this.cache.delete(e.document.uri.fsPath);
      }),
    );
  }

  toggle(): void {
    this.enabled = !this.enabled;
    void this.refresh();
    vscode.window.setStatusBarMessage(
      `Inline blame ${this.enabled ? "on" : "off"}`,
      2000,
    );
  }

  private async refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    if (!this.enabled) {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    await this.loadBlame(editor);
    this.renderFor(editor);
  }

  private async loadBlame(editor: vscode.TextEditor): Promise<void> {
    const fsPath = editor.document.uri.fsPath;
    if (this.cache.has(fsPath)) {
      return;
    }
    const repo = this.manager
      .getAll()
      .find((r) => fsPath.startsWith(r.root + "/") || fsPath.startsWith(r.root));
    if (!repo) {
      return;
    }
    const rel = fsPath.slice(repo.root.length + 1);
    try {
      this.cache.set(fsPath, await repo.blame(rel));
    } catch {
      this.cache.set(fsPath, []);
    }
  }

  private renderFor(editor: vscode.TextEditor): void {
    if (!this.enabled) {
      return;
    }
    const blame = this.cache.get(editor.document.uri.fsPath);
    if (!blame) {
      return;
    }
    const lineNo = editor.selection.active.line; // 0-based
    const info = blame.find((b) => b.line === lineNo + 1);
    if (!info) {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    const when = info.uncommitted
      ? ""
      : ` · ${new Date(info.authorTime * 1000).toISOString().slice(0, 10)}`;
    const text = `  ${info.authorName}${when} · ${info.summary}`;
    const range = editor.document.lineAt(lineNo).range;
    editor.setDecorations(this.decorationType, [
      { range, renderOptions: { after: { contentText: text } } },
    ]);
  }

  dispose(): void {
    this.decorationType.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
