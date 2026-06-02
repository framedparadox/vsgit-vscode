import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { FileChange, FileChangeState } from "../git/parsers/status";

/**
 * Explorer file decorations (VsGit "label decorations"): a status letter badge
 * and color on files that are modified/added/deleted/untracked/ignored/
 * conflicted, derived from each repository's status snapshot.
 */
export class VsgitFileDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly _onDidChange = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  /** path -> effective state, rebuilt on each manager change. */
  private states = new Map<string, FileChangeState | "conflicted">();
  private readonly sub: vscode.Disposable;

  constructor(private readonly manager: RepositoryManager) {
    this.sub = manager.onDidChange(() => this.rebuild());
    this.rebuild();
  }

  private rebuild(): void {
    const next = new Map<string, FileChangeState | "conflicted">();
    for (const repo of this.manager.getAll()) {
      for (const change of repo.status.changes) {
        const abs = vscode.Uri.joinPath(
          vscode.Uri.file(repo.root),
          change.path,
        ).fsPath;
        next.set(abs, effectiveState(change));
      }
    }
    // Fire for the union of old and new keys so cleared files refresh too.
    const changed = new Set<string>([...this.states.keys(), ...next.keys()]);
    this.states = next;
    this._onDidChange.fire([...changed].map((p) => vscode.Uri.file(p)));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const state = this.states.get(uri.fsPath);
    if (!state) {
      return undefined;
    }
    return DECORATIONS[state];
  }

  dispose(): void {
    this.sub.dispose();
    this._onDidChange.dispose();
  }
}

function effectiveState(change: FileChange): FileChangeState | "conflicted" {
  if (change.conflicted) {
    return "conflicted";
  }
  // Prefer the working-tree state, fall back to the index state.
  return (change.worktreeState ?? change.indexState ?? "modified") as
    | FileChangeState
    | "conflicted";
}

const DECORATIONS: Record<
  FileChangeState | "conflicted",
  vscode.FileDecoration
> = {
  modified: deco("M", "gitDecoration.modifiedResourceForeground"),
  added: deco("A", "gitDecoration.addedResourceForeground"),
  deleted: deco("D", "gitDecoration.deletedResourceForeground"),
  renamed: deco("R", "gitDecoration.renamedResourceForeground"),
  copied: deco("C", "gitDecoration.renamedResourceForeground"),
  untracked: deco("U", "gitDecoration.untrackedResourceForeground"),
  ignored: deco("I", "gitDecoration.ignoredResourceForeground"),
  conflicted: deco("!", "gitDecoration.conflictingResourceForeground"),
};

function deco(badge: string, colorId: string): vscode.FileDecoration {
  const d = new vscode.FileDecoration(badge, undefined, new vscode.ThemeColor(colorId));
  d.propagate = true;
  return d;
}
