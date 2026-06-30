import * as path from "node:path";
import * as vscode from "vscode";
import { Repository } from "../git/Repository";
import { RepositoryManager } from "../git/RepositoryManager";
import { FileChange } from "../git/parsers/status";
import { errMsg, withProgress } from "../commands/shared";
import { VsgitQuickDiffProvider } from "../git/QuickDiffProvider";

type ScmGroupId = "index" | "workingTree" | "merge";

export interface VsgitScmResourceState extends vscode.SourceControlResourceState {
  readonly vsgitGroup: ScmGroupId;
  readonly vsgitChange: FileChange;
}

interface RepoScm {
  readonly scm: vscode.SourceControl;
  readonly index: vscode.SourceControlResourceGroup;
  readonly workingTree: vscode.SourceControlResourceGroup;
  readonly merge: vscode.SourceControlResourceGroup;
}

/**
 * Bridges VsGit's repository model into VS Code's native Source Control view.
 * Each repository gets real SCM resource groups so quick diff, SCM menus, and
 * the commit input box work from the standard VS Code surface.
 */
export class VsgitScmProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly controls = new Map<string, RepoScm>();

  constructor(private readonly manager: RepositoryManager) {
    this.disposables.push(
      manager.onDidChange(() => this.sync()),
      vscode.commands.registerCommand("vsgit.scm.commitInput", (root: string) =>
        this.commitInput(root),
      ),
    );
    this.sync();
  }

  dispose(): void {
    for (const control of this.controls.values()) {
      control.scm.dispose();
    }
    this.controls.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private sync(): void {
    const repos = this.manager.getAll();
    const liveRoots = new Set(repos.map((repo) => repo.root));

    for (const [root, control] of this.controls) {
      if (!liveRoots.has(root)) {
        control.scm.dispose();
        this.controls.delete(root);
      }
    }

    for (const repo of repos) {
      const control = this.controls.get(repo.root) ?? this.createControl(repo);
      this.updateControl(repo, control);
    }
  }

  private createControl(repo: Repository): RepoScm {
    const scm = vscode.scm.createSourceControl(
      "vsgit",
      `VsGit: ${repo.name}`,
      vscode.Uri.file(repo.root),
    );
    scm.quickDiffProvider = new VsgitQuickDiffProvider(this.manager, repo.root);
    scm.acceptInputCommand = {
      command: "vsgit.scm.commitInput",
      title: "Commit",
      arguments: [repo.root],
    };
    // The Git Graph status-bar button is owned by GraphStatusBarService (a single,
    // settings-gated $(git-branch) item). Don't also publish it as an SCM
    // statusBarCommand, which would show a duplicate Graph button in the footer.

    const index = scm.createResourceGroup("index", "Staged Changes");
    const workingTree = scm.createResourceGroup("workingTree", "Changes");
    const merge = scm.createResourceGroup("merge", "Merge Changes");
    index.hideWhenEmpty = true;
    workingTree.hideWhenEmpty = true;
    merge.hideWhenEmpty = true;

    const control = { scm, index, workingTree, merge };
    this.controls.set(repo.root, control);
    return control;
  }

  private updateControl(repo: Repository, control: RepoScm): void {
    const conflicted = uniqueChanges(
      [...repo.stagedChanges, ...repo.unstagedChanges].filter((change) => change.conflicted),
    );
    const staged = repo.stagedChanges.filter((change) => !change.conflicted);
    const unstaged = repo.unstagedChanges.filter((change) => !change.conflicted);

    control.index.resourceStates = staged.map((change) =>
      this.resourceState(repo, change, "index"),
    );
    control.workingTree.resourceStates = unstaged.map((change) =>
      this.resourceState(repo, change, "workingTree"),
    );
    control.merge.resourceStates = conflicted.map((change) =>
      this.resourceState(repo, change, "merge"),
    );
    control.scm.count = staged.length + unstaged.length + conflicted.length;
  }

  private resourceState(
    repo: Repository,
    change: FileChange,
    group: ScmGroupId,
  ): VsgitScmResourceState {
    const uri = vscode.Uri.file(path.join(repo.root, change.path));
    const state = {
      resourceUri: uri,
      vsgitGroup: group,
      vsgitChange: change,
      decorations: {
        tooltip: `${change.path} - ${describeState(change, group)}`,
        strikeThrough: change.indexState === "deleted" || change.worktreeState === "deleted",
      } as vscode.SourceControlResourceDecorations,
    } as VsgitScmResourceState;
    return {
      ...state,
      command: {
        command: "vsgit.scm.openDiff",
        title: "Open Diff",
        arguments: [state],
      },
    };
  }

  private async commitInput(root: string): Promise<void> {
    const control = this.controls.get(root);
    const repo = this.manager.get(root);
    if (!control || !repo) {
      return;
    }
    const message = control.scm.inputBox.value.trim();
    if (!message) {
      vscode.window.showWarningMessage("Commit message cannot be empty.");
      return;
    }
    if (repo.stagedChanges.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        "No staged changes. Stage all changes and commit?",
        "Stage All & Commit",
        "Cancel",
      );
      if (choice !== "Stage All & Commit") {
        return;
      }
      await repo.stageAll();
      await repo.refresh();
    }
    try {
      const committed = await withProgress(this.manager, "Commit", () =>
        repo.commit(message),
      );
      if (committed) {
        control.scm.inputBox.value = "";
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Commit failed: ${errMsg(e)}`);
    }
  }
}

function uniqueChanges(changes: FileChange[]): FileChange[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    if (seen.has(change.path)) {
      return false;
    }
    seen.add(change.path);
    return true;
  });
}

function describeState(change: FileChange, group: ScmGroupId): string {
  if (change.conflicted || group === "merge") {
    return "conflicted";
  }
  return group === "index"
    ? (change.indexState ?? "modified")
    : (change.worktreeState ?? "modified");
}
