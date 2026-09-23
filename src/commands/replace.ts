import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { errMsg, withProgress } from "./shared";
import { CommitPickerView } from "../webviews/CommitPickerView";
import { RefPickerView } from "../webviews/RefPickerView";
import { confirmDestructiveAction, DestructiveOperations } from "../util/confirmation";
import { shortRefLabel } from "../util/revisionDiff";
import {
  dirtyTargetsWarning,
  filesInRepo,
  repoForUri,
  resolveUri,
  resolveUris,
  revertDirtyTargets,
  withoutFailed,
} from "./uriHelpers";

/**
 * "Replace With" operations — restore a file's content from a known ref.
 * Maps to VsGit's Team → Replace With submenu.
 */
export function registerReplaceCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("vsgit.replace.withHead", async (uriArg, allUris) => {
    await replaceWith(manager, resolveUris(uriArg, allUris), "HEAD");
  });

  reg("vsgit.replace.withIndex", async (uriArg, allUris) => {
    await replaceWithIndex(manager, resolveUris(uriArg, allUris));
  });

  reg("vsgit.replace.withPrevious", async (uriArg, allUris) => {
    await replaceWithPrevious(manager, resolveUris(uriArg, allUris));
  });

  // "Branch, Tag, or Reference…" — full VsGit-style ref picker.
  // vsgit.replace.withRef is the legacy id kept for old menu bindings.
  const replaceWithPickedRef = async (uriArg: unknown, allUris: unknown) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const fileName = uris.length === 1 ? path.basename(uris[0].fsPath) : `${uris.length} files`;
    const ref = await RefPickerView.pick(repo, {
      title: `Replace '${fileName}' with a Branch, Tag, or Reference`,
      subtitle: "Select a branch, tag, or reference to restore the resource from",
    });
    if (!ref) return;
    await replaceWith(manager, uris, ref);
  };
  reg("vsgit.replace.withBranchOrTag", replaceWithPickedRef);
  reg("vsgit.replace.withRef", replaceWithPickedRef);

  // "Commit…" — rich webview commit picker
  reg("vsgit.replace.withCommit", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const sha = await CommitPickerView.pick(repo, context.extensionUri);
    if (!sha) return;
    await replaceWith(manager, uris, sha);
  });

  // "Local History" — delegate to VS Code's built-in timeline/local-history panel
  reg("vsgit.replace.withLocalHistory", async (uriArg) => {
    const uri = resolveUri(uriArg);
    if (!uri) return;
    try {
      await vscode.commands.executeCommand("timeline.focus");
      await vscode.window.showTextDocument(uri, { preview: true });
      vscode.window.showInformationMessage(
        "Local History shown in the Timeline panel. Right-click an entry and choose 'Restore Contents' to replace.",
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Local History unavailable: ${(e as Error).message}`);
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function replaceWith(
  manager: RepositoryManager,
  uris: vscode.Uri[],
  ref: string,
): Promise<void> {
  if (uris.length === 0) return;
  const repo = repoForUri(manager, uris[0]);
  if (!repo) return;
  // Filter to this repo up front so the label, the confirmation, and the git
  // call all agree on the same file set (a cross-repo multi-select would
  // otherwise confirm more files than actually get replaced).
  const target = filesInRepo(manager, repo, uris);
  const rels = target.rels;
  if (rels.length === 0) return;
  const refLabel = shortRefLabel(ref);
  const label = rels.length === 1
    ? `Replace with ${refLabel}: ${path.basename(rels[0])}`
    : `Replace ${rels.length} file(s) with ${refLabel}`;
  const confirmed = await confirmDestructiveAction({
    operation: DestructiveOperations.DISCARD_CHANGES,
    message: `${label}? Local changes will be lost.${dirtyTargetsWarning(target.uris)}`,
    items: rels,
  });
  if (!confirmed) return;
  const failed: string[] = [];
  const ok = await withProgress(manager, label, async () => {
    failed.push(...(await repo.replaceWithRef(rels, ref)));
  });
  if (!ok) return;
  // Files that did not exist at `ref` were left alone, so keep their buffers.
  await revertDirtyTargets(withoutFailed(target.uris, rels, failed));
  if (failed.length > 0) {
    vscode.window.showWarningMessage(
      `Restored ${rels.length - failed.length} file(s) from ${refLabel}; ${failed.length} did not exist at that revision.`,
    );
  }
}

async function replaceWithPrevious(
  manager: RepositoryManager,
  uris: vscode.Uri[],
): Promise<void> {
  if (uris.length === 0) return;
  const repo = repoForUri(manager, uris[0]);
  if (!repo) return;
  const target = filesInRepo(manager, repo, uris);
  const bySha = new Map<string, { uris: vscode.Uri[]; rels: string[] }>();
  const skipped: string[] = [];
  for (const [i, uri] of target.uris.entries()) {
    const rel = target.rels[i];
    try {
      const commits = await repo.log({ file: rel, limit: 2 });
      if (commits.length < 2) {
        skipped.push(path.basename(rel));
        continue;
      }
      const sha = commits[1].sha;
      const group = bySha.get(sha) ?? { uris: [], rels: [] };
      group.uris.push(uri);
      group.rels.push(rel);
      bySha.set(sha, group);
    } catch (e) {
      vscode.window.showErrorMessage(
        `Replace with previous failed for ${path.basename(rel)}: ${errMsg(e)}`,
      );
      return;
    }
  }
  if (bySha.size === 0) {
    vscode.window.showInformationMessage(
      skipped.length === 1
        ? `${skipped[0]} has no earlier revision to restore.`
        : "None of the selected files have an earlier revision to restore.",
    );
    return;
  }
  const allRels = [...bySha.values()].flatMap((g) => g.rels);
  const allUris = [...bySha.values()].flatMap((g) => g.uris);
  const label = allRels.length === 1
    ? `Replace with previous: ${path.basename(allRels[0])}`
    : `Replace ${allRels.length} file(s) with previous revision`;
  const confirmed = await confirmDestructiveAction({
    operation: DestructiveOperations.DISCARD_CHANGES,
    message: `${label}? Local changes will be lost.${dirtyTargetsWarning(allUris)}`,
    items: allRels,
  });
  if (!confirmed) return;
  const failed: string[] = [];
  const restored: vscode.Uri[] = [];
  const ok = await withProgress(manager, label, async () => {
    for (const [sha, group] of bySha) {
      const groupFailed = await repo.replaceWithRef(group.rels, sha);
      failed.push(...groupFailed);
      restored.push(...withoutFailed(group.uris, group.rels, groupFailed));
    }
  });
  // Groups restored before a later group threw still changed on disk.
  await revertDirtyTargets(restored);
  if (!ok) return;
  if (skipped.length > 0) {
    vscode.window.showWarningMessage(
      `Skipped ${skipped.length} file(s) with no earlier revision: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? ", …" : ""}`,
    );
  }
  if (failed.length > 0) {
    vscode.window.showWarningMessage(
      `${failed.length} file(s) could not be restored from their previous revision.`,
    );
  }
}

async function replaceWithIndex(
  manager: RepositoryManager,
  uris: vscode.Uri[],
): Promise<void> {
  if (uris.length === 0) return;
  const repo = repoForUri(manager, uris[0]);
  if (!repo) return;
  const target = filesInRepo(manager, repo, uris);
  const rels = target.rels;
  if (rels.length === 0) return;
  const label = rels.length === 1
    ? `Replace with Index: ${path.basename(rels[0])}`
    : `Replace ${rels.length} file(s) with Index`;
  const confirmed = await confirmDestructiveAction({
    operation: DestructiveOperations.DISCARD_CHANGES,
    message: `${label}? Unstaged changes will be lost.${dirtyTargetsWarning(target.uris)}`,
    items: rels,
  });
  if (!confirmed) return;
  if (await withProgress(manager, label, () => repo.discard(rels, []))) {
    await revertDirtyTargets(target.uris);
  }
}
