import * as vscode from "vscode";
import * as path from "node:path";
import { RepositoryManager } from "../git/RepositoryManager";
import { GitContentProvider } from "../git/GitContentProvider";
import { confirmDestructiveAction, DestructiveOperations } from "../util/confirmation";
import { withProgress, errMsg } from "./shared";

/**
 * Commands for VS Code's built-in SCM (Source Control) view.
 * These appear in context menus when right-clicking on files in the SCM panel.
 */
export function registerSCMCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // Stage selected file(s)
  reg("vsgit.scm.stage", async (...resourceStates: unknown[]) => {
    const uris = resourceStates
      .filter((r): r is { resourceUri: vscode.Uri } => 
        typeof r === 'object' && r !== null && 'resourceUri' in r
      )
      .map((r) => r.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    for (const uri of uris) {
      const rel = uri.fsPath.slice(repo.root.length + 1);
      await repo.stage([rel]);
    }
    vscode.window.setStatusBarMessage("Files staged", 2000);
  });

  // Unstage selected file(s)
  reg("vsgit.scm.unstage", async (...resourceStates: unknown[]) => {
    const uris = resourceStates
      .filter((r): r is { resourceUri: vscode.Uri } =>
        typeof r === 'object' && r !== null && 'resourceUri' in r
      )
      .map((r) => r.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    for (const uri of uris) {
      const rel = uri.fsPath.slice(repo.root.length + 1);
      await repo.unstage([rel]);
    }
    vscode.window.setStatusBarMessage("Files unstaged", 2000);
  });

  // Discard changes in selected file(s)
  reg("vsgit.scm.discard", async (...resourceStates: unknown[]) => {
    const uris = resourceStates
      .filter((r): r is { resourceUri: vscode.Uri } => 
        typeof r === 'object' && r !== null && 'resourceUri' in r
      )
      .map((r) => r.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const files = uris.map((u) => u.fsPath.slice(repo.root.length + 1));
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.DISCARD_CHANGES,
      message: `Discard changes in ${files.length} file(s)? This cannot be undone.`,
      items: files,
    });

    if (!confirmed) return;

    try {
      await withProgress(manager, `Discarding ${files.length} file(s)`, async () => {
        await repo.discard(files, []);
      });
      vscode.window.showInformationMessage(`Discarded changes in ${files.length} file(s)`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to discard changes: ${errMsg(e)}`);
    }
  });

  // Open diff for file
  reg("vsgit.scm.openDiff", async (resourceState: unknown) => {
    if (
      typeof resourceState !== 'object' || 
      resourceState === null || 
      !('resourceUri' in resourceState)
    ) return;
    
    const uri = (resourceState as { resourceUri: vscode.Uri }).resourceUri;
    const repo = findRepoForUri(manager, uri);
    if (!repo) return;

    const rel = uri.fsPath.slice(repo.root.length + 1);
    const left = GitContentProvider.uri(repo.root, rel, "HEAD", uri.fsPath);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      uri,
      `${path.basename(rel)} (HEAD ↔ Working Tree)`,
    );
  });

  // Open file
  reg("vsgit.scm.openFile", async (resourceState: unknown) => {
    if (
      typeof resourceState !== 'object' || 
      resourceState === null || 
      !('resourceUri' in resourceState)
    ) return;
    
    const uri = (resourceState as { resourceUri: vscode.Uri }).resourceUri;
    await vscode.commands.executeCommand("vscode.open", uri);
  });

  // Show file history
  reg("vsgit.scm.showHistory", async (resourceState: unknown) => {
    if (
      typeof resourceState !== 'object' || 
      resourceState === null || 
      !('resourceUri' in resourceState)
    ) return;
    
    const uri = (resourceState as { resourceUri: vscode.Uri }).resourceUri;
    const repo = findRepoForUri(manager, uri);
    if (!repo) return;

    const rel = uri.fsPath.slice(repo.root.length + 1);
    await vscode.commands.executeCommand("vsgit.history.show", {
      repoRoot: repo.root,
      file: rel,
    });
  });

  // Blame file
  reg("vsgit.scm.blame", async (resourceState: unknown) => {
    if (
      typeof resourceState !== 'object' || 
      resourceState === null || 
      !('resourceUri' in resourceState)
    ) return;
    
    const uri = (resourceState as { resourceUri: vscode.Uri }).resourceUri;
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("vsgit.blame.toggle");
  });

  // Replace with HEAD
  reg("vsgit.scm.replaceWithHead", async (...resourceStates: unknown[]) => {
    const uris = resourceStates
      .filter((r): r is { resourceUri: vscode.Uri } => 
        typeof r === 'object' && r !== null && 'resourceUri' in r
      )
      .map((r) => r.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const files = uris.map((u) => u.fsPath.slice(repo.root.length + 1));
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.DISCARD_CHANGES,
      message: `Replace ${files.length} file(s) with HEAD version? Local changes will be lost.`,
      items: files,
    });

    if (!confirmed) return;

    try {
      await withProgress(manager, `Replacing ${files.length} file(s)`, async () => {
        for (const file of files) {
          await repo.replaceWithRef(file, "HEAD");
        }
      });
      vscode.window.showInformationMessage(`Replaced ${files.length} file(s) with HEAD`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to replace files: ${errMsg(e)}`);
    }
  });

  // Rename/move a tracked file (git mv)
  reg("vsgit.scm.rename", async (...resourceStates: unknown[]) => {
    const uris = resourceStates
      .filter((r): r is { resourceUri: vscode.Uri } =>
        typeof r === 'object' && r !== null && 'resourceUri' in r
      )
      .map((r) => r.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const rel = uris[0].fsPath.slice(repo.root.length + 1);
    const newRel = await vscode.window.showInputBox({
      prompt: "New path (relative to the repository root)",
      value: rel,
      valueSelection: [rel.lastIndexOf("/") + 1, rel.length],
      validateInput: (v) =>
        v.trim() === "" ? "Path required" : v.trim() === rel ? "Unchanged" : undefined,
    });
    if (!newRel || newRel.trim() === rel) return;

    try {
      await withProgress(
        manager,
        `Rename ${path.basename(rel)} → ${path.basename(newRel.trim())}`,
        () => repo.moveFile(rel, newRel.trim()),
      );
      vscode.window.showInformationMessage(`Renamed to ${newRel.trim()}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Rename failed: ${errMsg(e)}`);
    }
  });

  // Delete tracked file(s) from the working tree and index (git rm)
  reg("vsgit.scm.delete", async (...resourceStates: unknown[]) => {
    const uris = resourceStates
      .filter((r): r is { resourceUri: vscode.Uri } =>
        typeof r === 'object' && r !== null && 'resourceUri' in r
      )
      .map((r) => r.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const files = uris.map((u) => u.fsPath.slice(repo.root.length + 1));
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.DISCARD_CHANGES,
      message: `Delete ${files.length} file(s) from the working tree and index (git rm)? This cannot be undone.`,
      items: files,
    });

    if (!confirmed) return;

    try {
      await withProgress(manager, `Deleting ${files.length} file(s)`, () =>
        repo.removeFiles(files, { force: true }),
      );
      vscode.window.showInformationMessage(`Deleted ${files.length} file(s)`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to delete files: ${errMsg(e)}`);
    }
  });

  // Stage all in group
  reg("vsgit.scm.stageAll", async (group: unknown) => {
    // group.resourceStates contains all files in the group
    if (
      typeof group !== 'object' || 
      group === null || 
      !('resourceStates' in group) ||
      !Array.isArray((group as { resourceStates: unknown }).resourceStates) ||
      (group as { resourceStates: unknown[] }).resourceStates.length === 0
    ) return;
    
    const uris = (group as { resourceStates: { resourceUri: vscode.Uri }[] }).resourceStates
      .map((r) => r.resourceUri);
    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    await withProgress(manager, "Staging all changes", async () => {
      for (const uri of uris) {
        const rel = uri.fsPath.slice(repo.root.length + 1);
        await repo.stage([rel]);
      }
    });
    vscode.window.showInformationMessage("All changes staged");
  });

  // Unstage all in group
  reg("vsgit.scm.unstageAll", async (group: unknown) => {
    if (
      typeof group !== 'object' ||
      group === null ||
      !('resourceStates' in group) ||
      !Array.isArray((group as { resourceStates: unknown }).resourceStates) ||
      (group as { resourceStates: unknown[] }).resourceStates.length === 0
    ) return;

    const uris = (group as { resourceStates: { resourceUri: vscode.Uri }[] }).resourceStates
      .map((r) => r.resourceUri);
    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    await withProgress(manager, "Unstaging all changes", async () => {
      for (const uri of uris) {
        const rel = uri.fsPath.slice(repo.root.length + 1);
        await repo.unstage([rel]);
      }
    });
    vscode.window.showInformationMessage("All changes unstaged");
  });

  // Discard all in group
  reg("vsgit.scm.discardAll", async (group: unknown) => {
    if (
      typeof group !== 'object' || 
      group === null || 
      !('resourceStates' in group) ||
      !Array.isArray((group as { resourceStates: unknown }).resourceStates) ||
      (group as { resourceStates: unknown[] }).resourceStates.length === 0
    ) return;
    
    const uris = (group as { resourceStates: { resourceUri: vscode.Uri }[] }).resourceStates
      .map((r) => r.resourceUri);
    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const files = uris.map((u) => u.fsPath.slice(repo.root.length + 1));
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.DISCARD_ALL,
      message: `Discard all ${files.length} changes? This cannot be undone.`,
      items: files,
    });

    if (!confirmed) return;

    try {
      await withProgress(manager, `Discarding ${files.length} changes`, async () => {
        await repo.discard(files, []);
      });
      vscode.window.showInformationMessage(`Discarded all ${files.length} changes`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to discard changes: ${errMsg(e)}`);
    }
  });
}

function findRepoForUri(manager: RepositoryManager, uri: vscode.Uri): any {
  return manager.getAll().find((r) => uri.fsPath.startsWith(r.root));
}
