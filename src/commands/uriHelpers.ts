import * as path from "node:path";
import * as vscode from "vscode";
import { Repository } from "../git/Repository";
import { RepositoryManager } from "../git/RepositoryManager";

/**
 * Shared URI plumbing for commands invoked from the Explorer, editor title,
 * or command palette. Previously duplicated across fileContext.ts, replace.ts
 * and scm.ts.
 */

/** The explicit URI argument, or the active editor's document as fallback. */
export function resolveUri(uriArg: unknown): vscode.Uri | undefined {
  if (uriArg instanceof vscode.Uri) return uriArg;
  return vscode.window.activeTextEditor?.document.uri;
}

/**
 * Explorer multi-select passes (clickedUri, allSelectedUris); other menu
 * surfaces pass a single URI or nothing. Normalize to a non-empty list.
 */
export function resolveUris(uriArg: unknown, allUris: unknown): vscode.Uri[] {
  if (Array.isArray(allUris) && allUris.length > 0 && allUris[0] instanceof vscode.Uri) {
    return allUris as vscode.Uri[];
  }
  const single = resolveUri(uriArg);
  return single ? [single] : [];
}

/** Repository containing the URI; warns the user when there is none. */
export function repoForUri(
  manager: RepositoryManager,
  uri: vscode.Uri,
): Repository | undefined {
  const repo = manager.findByUri(uri);
  if (!repo) {
    vscode.window.showWarningMessage("File is not in a known Git repository.");
  }
  return repo;
}

/**
 * The URIs that belong to `repo` and their repo-relative paths (index-aligned).
 * Warns once about any selected files that live in a different repository.
 */
export function filesInRepo(
  manager: RepositoryManager,
  repo: Repository,
  uris: vscode.Uri[],
): { uris: vscode.Uri[]; rels: string[] } {
  const inRepo = uris.filter((uri) => manager.uriBelongsTo(repo, uri));
  const dropped = uris.length - inRepo.length;
  if (dropped > 0) {
    vscode.window.showWarningMessage(
      `${dropped} selected file(s) are in a different repository and were skipped.`,
    );
  }
  return { uris: inRepo, rels: inRepo.map((uri) => manager.relativePath(repo, uri)) };
}

/** Repo-relative paths for the URIs that belong to `repo` (others dropped). */
export function relativePaths(
  manager: RepositoryManager,
  repo: Repository,
  uris: vscode.Uri[],
): string[] {
  return filesInRepo(manager, repo, uris).rels;
}

/** `uris` minus those whose aligned path in `rels` is listed in `failed`. */
export function withoutFailed(
  uris: vscode.Uri[],
  rels: string[],
  failed: string[],
): vscode.Uri[] {
  if (failed.length === 0) {
    return uris;
  }
  const skip = new Set(failed);
  return uris.filter((_, i) => !skip.has(rels[i]));
}

/**
 * After a git checkout/discard, dirty editors still hold the old buffer and
 * a later Save would overwrite the restored file. Revert those documents.
 * Only pass URIs whose on-disk content git actually changed.
 */
export async function revertDirtyTargets(uris: vscode.Uri[]): Promise<void> {
  const targets = new Set(uris.map((u) => u.fsPath));
  const dirty = vscode.workspace.textDocuments.filter(
    (d) => d.isDirty && d.uri.scheme === "file" && targets.has(d.uri.fsPath),
  );
  if (dirty.length === 0) {
    return;
  }
  // `workbench.action.files.revert` ignores any URI argument and reverts the
  // *active* editor, so each target must be focused first — otherwise an
  // unrelated editor would silently lose its unsaved changes.
  const previous = vscode.window.activeTextEditor;
  for (const doc of dirty) {
    try {
      // Discarded untracked files are gone from disk; nothing to reload.
      await vscode.workspace.fs.stat(doc.uri);
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
      if (vscode.window.activeTextEditor?.document.uri.toString() !== doc.uri.toString()) {
        continue;
      }
      await vscode.commands.executeCommand("workbench.action.files.revert");
    } catch {
      // Leave this buffer untouched; the confirmation already warned about it.
    }
  }
  if (previous && !previous.document.isClosed) {
    try {
      await vscode.window.showTextDocument(previous.document, previous.viewColumn);
    } catch {
      // The previous editor's group may be gone; staying on the last target is fine.
    }
  }
}

/**
 * Names of the target files that are open in an editor with unsaved changes.
 * Callers warn about these before checkout/discard; {@link revertDirtyTargets}
 * then reloads the restored on-disk content into those editors.
 */
export function dirtyTargetNames(uris: vscode.Uri[]): string[] {
  const dirty = new Set(
    vscode.workspace.textDocuments
      .filter((d) => d.isDirty && d.uri.scheme === "file")
      .map((d) => d.uri.fsPath),
  );
  return uris
    .filter((u) => dirty.has(u.fsPath))
    .map((u) => path.basename(u.fsPath));
}

/** Extra confirmation-message paragraph when replace targets have dirty editors. */
export function dirtyTargetsWarning(uris: vscode.Uri[]): string {
  const dirty = dirtyTargetNames(uris);
  if (dirty.length === 0) {
    return "";
  }
  return (
    `\n\nWarning: ${dirty.length} file(s) have unsaved editor changes` +
    ` (${dirty.slice(0, 3).join(", ")}${dirty.length > 3 ? ", …" : ""}).` +
    ` Those editors will be reverted after restore so they pick up the on-disk content.`
  );
}
