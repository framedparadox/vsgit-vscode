import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { BlameLine } from "../git/parsers/blame";

/**
 * Inline blame annotations: when enabled, shows author · date · summary at the
 * end of the current line as dimmed text (VsGit's "revision annotations").
 * Toggled per-editor; recomputed when the active editor or selection changes.
 */
export class BlameController implements vscode.Disposable {
  private static readonly MAX_CACHE_ENTRIES = 20;

  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private enabled: boolean;
  private cache = new Map<string, BlameLine[]>();

  constructor(private readonly manager: RepositoryManager) {
    this.enabled = vscode.workspace
      .getConfiguration("vsgit")
      .get<boolean>("blame.enabledByDefault", false);
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
    if (!this.enabled) {
      // Blame arrays scale with file length; release them immediately when the
      // feature is disabled instead of retaining every file visited so far.
      this.cache.clear();
    }
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
    const cached = this.cache.get(fsPath);
    if (cached) {
      // Promote on access so the map acts as a small LRU cache.
      this.cache.delete(fsPath);
      this.cache.set(fsPath, cached);
      return;
    }
    const repo = this.manager.findByUri(editor.document.uri);
    if (!repo) {
      return;
    }
    const rel = this.manager.relativePath(repo, editor.document.uri);
    const documentVersion = editor.document.version;
    try {
      const blame = await repo.blame(rel);
      if (this.enabled && editor.document.version === documentVersion) {
        this.cacheBlame(fsPath, blame);
      }
    } catch {
      if (this.enabled && editor.document.version === documentVersion) {
        this.cacheBlame(fsPath, []);
      }
    }
  }

  private cacheBlame(fsPath: string, blame: BlameLine[]): void {
    this.cache.delete(fsPath);
    this.cache.set(fsPath, blame);
    while (this.cache.size > BlameController.MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
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
    this.cache.clear();
    this.decorationType.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
