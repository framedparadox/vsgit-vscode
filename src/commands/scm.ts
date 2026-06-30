import * as vscode from "vscode";
import * as path from "node:path";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { GitContentProvider, VSGIT_EMPTY_REF } from "../git/GitContentProvider";
import type { FileChange } from "../git/parsers/status";
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
  reg("vsgit.scm.stage", async (...args: unknown[]) => {
    const states = resourceStates(args);
    const uris = states.map((state) => state.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    await withProgress(manager, `Stage ${uris.length} file(s)`, () =>
      repo.stage(relativePaths(manager, repo, uris)),
    );
    vscode.window.setStatusBarMessage("Files staged", 2000);
  });

  // Unstage selected file(s)
  reg("vsgit.scm.unstage", async (...args: unknown[]) => {
    const states = resourceStates(args);
    const uris = states.map((state) => state.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    await withProgress(manager, `Unstage ${uris.length} file(s)`, () =>
      repo.unstage(relativePaths(manager, repo, uris)),
    );
    vscode.window.setStatusBarMessage("Files unstaged", 2000);
  });

  // Discard changes in selected file(s)
  reg("vsgit.scm.discard", async (...args: unknown[]) => {
    const states = resourceStates(args);
    const uris = states.map((state) => state.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const discard = discardPathSets(manager, repo, states);
    const files = [...discard.tracked, ...discard.untracked];
    if (files.length === 0) return;
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.DISCARD_CHANGES,
      message: `Discard changes in ${files.length} file(s)? This cannot be undone.`,
      items: files,
    });

    if (!confirmed) return;

    try {
      await withProgress(manager, `Discarding ${files.length} file(s)`, async () => {
        await repo.discard(discard.tracked, discard.untracked);
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

    const rel = manager.relativePath(repo, uri);
    const group = resourceGroup(resourceState);
    const change = resourceChange(resourceState);
    const isIndex = group === "index";
    const left = isIndex
      ? GitContentProvider.uri(repo.root, rel, "HEAD", uri.fsPath)
      : GitContentProvider.uri(repo.root, rel, "~index", uri.fsPath);
    const right = isIndex
      ? GitContentProvider.uri(repo.root, rel, "~index", uri.fsPath)
      : change?.worktreeState === "deleted"
        ? GitContentProvider.uri(repo.root, rel, VSGIT_EMPTY_REF, uri.fsPath)
        : uri;
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      isIndex
        ? `${path.basename(rel)} (HEAD ↔ Index)`
        : `${path.basename(rel)} (Index ↔ Working Tree)`,
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

    const rel = manager.relativePath(repo, uri);
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
  reg("vsgit.scm.replaceWithHead", async (...args: unknown[]) => {
    const states = resourceStates(args);
    const uris = states.map((state) => state.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const files = relativePaths(manager, repo, uris);
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
  reg("vsgit.scm.rename", async (...args: unknown[]) => {
    const states = resourceStates(args);
    const uris = states.map((state) => state.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const rel = manager.relativePath(repo, uris[0]);
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
  reg("vsgit.scm.delete", async (...args: unknown[]) => {
    const states = resourceStates(args);
    const uris = states.map((state) => state.resourceUri);
    if (uris.length === 0) return;

    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const files = relativePaths(manager, repo, uris);
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
    
    const states = groupResourceStates(group);
    const uris = states.map((state) => state.resourceUri);
    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    await withProgress(manager, "Staging all changes", async () => {
      await repo.stage(relativePaths(manager, repo, uris));
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

    const states = groupResourceStates(group);
    const uris = states.map((state) => state.resourceUri);
    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    await withProgress(manager, "Unstaging all changes", async () => {
      await repo.unstage(relativePaths(manager, repo, uris));
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
    
    const states = groupResourceStates(group);
    const uris = states.map((state) => state.resourceUri);
    const repo = findRepoForUri(manager, uris[0]);
    if (!repo) return;

    const discard = discardPathSets(manager, repo, states);
    const files = [...discard.tracked, ...discard.untracked];
    if (files.length === 0) return;
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.DISCARD_ALL,
      message: `Discard all ${files.length} changes? This cannot be undone.`,
      items: files,
    });

    if (!confirmed) return;

    try {
      await withProgress(manager, `Discarding ${files.length} changes`, async () => {
        await repo.discard(discard.tracked, discard.untracked);
      });
      vscode.window.showInformationMessage(`Discarded all ${files.length} changes`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to discard changes: ${errMsg(e)}`);
    }
  });
}

function findRepoForUri(manager: RepositoryManager, uri: vscode.Uri): Repository | undefined {
  return manager.findByUri(uri);
}

interface ScmResourceStateLike {
  resourceUri: vscode.Uri;
  vsgitGroup?: string;
  vsgitChange?: FileChange;
}

function resourceStates(args: unknown[]): ScmResourceStateLike[] {
  const states = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return states
    .filter((r): r is ScmResourceStateLike =>
      typeof r === "object" && r !== null && "resourceUri" in r,
    );
}

function groupResourceStates(group: unknown): ScmResourceStateLike[] {
  if (
    typeof group !== "object" ||
    group === null ||
    !("resourceStates" in group) ||
    !Array.isArray((group as { resourceStates: unknown }).resourceStates)
  ) {
    return [];
  }
  return resourceStates((group as { resourceStates: unknown[] }).resourceStates);
}

function relativePaths(
  manager: RepositoryManager,
  repo: Repository,
  uris: vscode.Uri[],
): string[] {
  return uris
    .filter((uri) => manager.uriBelongsTo(repo, uri))
    .map((uri) => manager.relativePath(repo, uri));
}

function resourceGroup(resourceState: unknown): string | undefined {
  if (typeof resourceState !== "object" || resourceState === null) {
    return undefined;
  }
  return (resourceState as { vsgitGroup?: string }).vsgitGroup;
}

function resourceChange(resourceState: unknown): FileChange | undefined {
  if (typeof resourceState !== "object" || resourceState === null) {
    return undefined;
  }
  return (resourceState as { vsgitChange?: FileChange }).vsgitChange;
}

function discardPathSets(
  manager: RepositoryManager,
  repo: Repository,
  states: ScmResourceStateLike[],
): { tracked: string[]; untracked: string[] } {
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const state of states) {
    if (!manager.uriBelongsTo(repo, state.resourceUri)) {
      continue;
    }
    const rel = manager.relativePath(repo, state.resourceUri);
    if (state.vsgitChange?.worktreeState === "untracked") {
      untracked.push(rel);
    } else {
      tracked.push(rel);
    }
  }
  return { tracked, untracked };
}
