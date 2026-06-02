import * as vscode from "vscode";

/**
 * Shows an icon-only ($(git-branch)) button in the status bar (footer) that opens
 * the Git Graph. Visibility is gated on the `egit.graph.showStatusBarItem` setting.
 */
export class GraphStatusBarService implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly configListener: vscode.Disposable;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99,
    );
    this.statusBarItem.command = "egit.graph.show";
    this.statusBarItem.text = "$(git-branch)";
    this.statusBarItem.tooltip = "Open Git Graph";

    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("egit.graph.showStatusBarItem")) {
        this.update();
      }
    });

    this.update();
  }

  private update(): void {
    const enabled = vscode.workspace
      .getConfiguration("egit")
      .get<boolean>("graph.showStatusBarItem", true);
    if (enabled) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.configListener.dispose();
  }
}
