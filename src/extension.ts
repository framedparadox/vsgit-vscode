import * as vscode from "vscode";
import { RepositoryManager } from "./git/RepositoryManager";
import { RepositoriesProvider } from "./views/RepositoriesProvider";
import { StagingProvider } from "./views/StagingProvider";
import { CommitViewProvider } from "./webviews/commit/CommitViewProvider";
import { registerBranchCommands } from "./commands/branch";
import { registerStagingCommands } from "./commands/staging";
import { registerHistoryCommands } from "./commands/history";
import { registerRemoteCommands } from "./commands/remote";
import { registerMaintenanceCommands } from "./commands/maintenance";
import { registerTagCommands } from "./commands/tag";
import { registerTransportCommands } from "./commands/transport";
import { registerInteractiveRebase } from "./commands/interactiveRebase";
import { ReflogProvider } from "./views/ReflogProvider";
import { registerReflogCommands } from "./commands/reflog";
import { VsgitFileDecorationProvider } from "./decorations/FileDecorations";
import { BlameController } from "./decorations/BlameController";
import { VsgitQuickDiffProvider } from "./git/QuickDiffProvider";
import { registerCompareCommands } from "./commands/compare";
import { registerBlameCommands } from "./commands/blame";
import { SynchronizeProvider } from "./views/SynchronizeProvider";
import { registerSyncCommands } from "./commands/sync";
import { registerConfigCommands } from "./commands/config";
import { registerStashCommands } from "./commands/stash";
import { registerSubmoduleCommands } from "./commands/submodule";
import { registerCloneCommands } from "./commands/clone";
import { registerGerritCommands } from "./commands/gerrit";
import { registerLfsCommands } from "./commands/lfs";
import { registerSCMCommands } from "./commands/scm";
import { registerNotesCommands } from "./commands/notes";
import { registerArchiveCommands } from "./commands/archive";
import { registerSubtreeCommands } from "./commands/subtree";
import { registerGraphCommands } from "./commands/graph";
import { GitContentProvider, VSGIT_SCHEME } from "./git/GitContentProvider";
import { registerFileContextCommands } from "./commands/fileContext";
import { registerReplaceCommands } from "./commands/replace";
import { registerPatchCommands } from "./commands/patch";
import { registerWorktreeCommands } from "./commands/worktree";
import { registerBisectCommands } from "./commands/bisect";
import { registerBranchExtraCommands } from "./commands/branch";
import { WorktreesProvider } from "./views/WorktreesProvider";
import { ConflictsProvider } from "./views/ConflictsProvider";
import { CompareProvider } from "./views/CompareProvider";
import { clearSessionBypass } from "./util/confirmation";
import { AutoFetchService } from "./services/AutoFetchService";
import { GitWatcherService } from "./services/GitWatcherService";
import { GraphStatusBarService } from "./services/GraphStatusBarService";
import { registerAutoFetchCommands } from "./commands/autoFetch";
import { registerCommitOpsCommands } from "./commands/commitOps";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manager = new RepositoryManager();
  context.subscriptions.push(manager);

  // Gate the advanced sidebar sections (Staging, Reflog, Synchronize, Worktrees,
  // Conflicts, Compare) behind a setting so the panel defaults to just
  // Repositories / Commit / Git Repositories. A `when`-clause context key hides
  // them reliably regardless of any cached view-visibility state.
  const syncAdvancedViewsContext = () => {
    const show = vscode.workspace
      .getConfiguration("vsgit")
      .get<boolean>("showAdvancedViews", false);
    void vscode.commands.executeCommand("setContext", "vsgit.advancedViews", show);
  };
  syncAdvancedViewsContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vsgit.showAdvancedViews")) {
        syncAdvancedViewsContext();
      }
    }),
  );

  // Read-only content provider backing the diff editors.
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      VSGIT_SCHEME,
      new GitContentProvider(),
    ),
  );

  // "Repositories": a flat list of repositories only. The top-level action
  // toolbar (fetch / pull / push / history / clone / refresh / …) lives on this
  // view's title bar.
  const reposListProvider = new RepositoriesProvider(manager, true);
  context.subscriptions.push(
    reposListProvider,
    vscode.window.createTreeView("vsgit.repositoriesList", {
      treeDataProvider: reposListProvider,
    }),
  );

  // "Git Repositories": the full tree — each repo expands into Local Branches,
  // Remote Branches, Tags, Remotes, Stashes, and Submodules.
  const repositoriesProvider = new RepositoriesProvider(manager);
  context.subscriptions.push(
    repositoriesProvider,
    vscode.window.createTreeView("vsgit.repositories", {
      treeDataProvider: repositoriesProvider,
      showCollapseAll: true,
    }),
  );

  const stagingProvider = new StagingProvider(manager);
  context.subscriptions.push(
    stagingProvider,
    vscode.window.createTreeView("vsgit.staging", {
      treeDataProvider: stagingProvider,
      showCollapseAll: true,
    }),
  );

  // Commit webview: Source-Control-like staging + commit message editor.
  const commitProvider = new CommitViewProvider(
    context.extensionUri,
    manager,
    stagingProvider,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CommitViewProvider.viewType,
      commitProvider,
    ),
  );

  const reflogProvider = new ReflogProvider(manager);
  context.subscriptions.push(
    reflogProvider,
    vscode.window.createTreeView("vsgit.reflog", {
      treeDataProvider: reflogProvider,
    }),
  );

  const syncProvider = new SynchronizeProvider(manager);
  context.subscriptions.push(
    syncProvider,
    vscode.window.createTreeView("vsgit.synchronize", {
      treeDataProvider: syncProvider,
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vsgit.repositories.refresh", () =>
      manager.scan(),
    ),
  );

  registerBranchCommands(context, manager);
  registerStagingCommands(context, manager, stagingProvider);
  registerHistoryCommands(context, manager);
  registerRemoteCommands(context, manager);
  registerMaintenanceCommands(context, manager);
  registerTagCommands(context, manager);
  registerTransportCommands(context, manager);
  registerInteractiveRebase(context, manager);
  registerReflogCommands(context, manager, reflogProvider);

  // Decorations, blame, quick-diff, compare/conflicts.
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(
      new VsgitFileDecorationProvider(manager),
    ),
  );
  const blameController = new BlameController(manager);
  context.subscriptions.push(blameController);
  registerBlameCommands(context, blameController);
  
  // Phase 4 — Compare View
  const compareProvider = new CompareProvider(manager);
  const compareView = vscode.window.createTreeView("vsgit.compare", {
    treeDataProvider: compareProvider,
  });
  context.subscriptions.push(compareProvider, compareView);

  // Reveal the Compare view (called internally after starting a comparison)
  context.subscriptions.push(
    vscode.commands.registerCommand("vsgit.compare.focus", () =>
      vscode.commands.executeCommand("vsgit.compare.view.focus"),
    ),
  );

  registerCompareCommands(context, manager, compareProvider);

  const quickDiff = new VsgitQuickDiffProvider(manager);
  const scm = vscode.scm.createSourceControl("vsgit", "VsGit");
  scm.quickDiffProvider = quickDiff;
  context.subscriptions.push(scm);

  registerSyncCommands(context, syncProvider);
  registerConfigCommands(context, manager);
  registerStashCommands(context, manager);
  registerSubmoduleCommands(context, manager);
  registerCloneCommands(context, manager);
  registerGerritCommands(context, manager);
  registerLfsCommands(context, manager);
  
  // Phase 5 — SCM view context menus
  registerSCMCommands(context, manager);

  // Phase 6 — Advanced operations
  registerNotesCommands(context, manager);
  registerArchiveCommands(context, manager);
  registerSubtreeCommands(context, manager);

  // Phase 7 — Git graph visualization
  registerGraphCommands(context, manager);
  context.subscriptions.push(new GraphStatusBarService());

  // Commit-level operations: cherry-pick, revert, squash, GPG verify, fetch PRs, switch to
  registerCommitOpsCommands(context, manager);

  // Phase 8 — Auto-fetch & background operations
  const gitWatcher = new GitWatcherService(context, manager);
  context.subscriptions.push(gitWatcher);

  const autoFetchService = new AutoFetchService(context, manager);
  context.subscriptions.push(autoFetchService);

  registerAutoFetchCommands(context, manager, autoFetchService);

  // Phase 1 — VsGit Team menu + new views
  registerFileContextCommands(context, manager);
  registerReplaceCommands(context, manager);
  registerPatchCommands(context, manager);
  registerWorktreeCommands(context, manager);
  registerBisectCommands(context, manager);
  registerBranchExtraCommands(context, manager);

  const worktreesProvider = new WorktreesProvider(manager);
  context.subscriptions.push(
    worktreesProvider,
    vscode.window.createTreeView("vsgit.worktrees", {
      treeDataProvider: worktreesProvider,
    }),
  );

  const conflictsProvider = new ConflictsProvider(manager);
  context.subscriptions.push(
    conflictsProvider,
    vscode.window.createTreeView("vsgit.conflicts", {
      treeDataProvider: conflictsProvider,
    }),
  );

  // Rescan when the set of workspace folders changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => manager.scan()),
  );

  await manager.scan();
}

export function deactivate(): void {
  // Clear session-level confirmation bypass flags
  clearSessionBypass();
  // Disposables registered in context.subscriptions handle cleanup.
}
