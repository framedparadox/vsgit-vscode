import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { withProgress } from "./shared";
import { CommitPickerView } from "../webviews/CommitPickerView";
import { RefPickerView } from "../webviews/RefPickerView";

/**
 * "Replace With" operations — restore a file's content from a known ref.
 * Maps to EGit's Team → Replace With submenu.
 */
export function registerReplaceCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("egit.replace.withHead", async (uriArg, allUris) => {
    await replaceWith(manager, resolveUris(uriArg, allUris), "HEAD");
  });

  reg("egit.replace.withIndex", async (uriArg, allUris) => {
    await replaceWithIndex(manager, resolveUris(uriArg, allUris));
  });

  reg("egit.replace.withPrevious", async (uriArg, allUris) => {
    await replaceWith(manager, resolveUris(uriArg, allUris), "HEAD~1");
  });

  // "Branch, Tag, or Reference…" — full EGit-style ref picker
  reg("egit.replace.withBranchOrTag", async (uriArg, allUris) => {
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
  });

  // "Commit…" — rich webview commit picker
  reg("egit.replace.withCommit", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const sha = await CommitPickerView.pick(repo);
    if (!sha) return;
    await replaceWith(manager, uris, sha);
  });

  // Legacy — delegates to the same rich picker
  reg("egit.replace.withRef", async (uriArg, allUris) => {
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
  });

  // "Local History" — delegate to VS Code's built-in timeline/local-history panel
  reg("egit.replace.withLocalHistory", async (uriArg) => {
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

function resolveUri(uriArg: unknown): vscode.Uri | undefined {
  if (uriArg instanceof vscode.Uri) return uriArg;
  return vscode.window.activeTextEditor?.document.uri;
}

function resolveUris(uriArg: unknown, allUris: unknown): vscode.Uri[] {
  if (Array.isArray(allUris) && allUris.length > 0 && allUris[0] instanceof vscode.Uri) {
    return allUris as vscode.Uri[];
  }
  const single = resolveUri(uriArg);
  return single ? [single] : [];
}

function repoForUri(manager: RepositoryManager, uri: vscode.Uri) {
  if (uri.scheme !== "file") return undefined;
  const repo = manager.getAll().find((r) => uri.fsPath.startsWith(r.root));
  if (!repo) {
    vscode.window.showWarningMessage("File is not in a known Git repository.");
  }
  return repo;
}

async function replaceWith(
  manager: RepositoryManager,
  uris: vscode.Uri[],
  ref: string,
): Promise<void> {
  if (uris.length === 0) return;
  const repo = repoForUri(manager, uris[0]);
  if (!repo) return;
  const label = uris.length === 1
    ? `Replace with ${ref}: ${path.basename(uris[0].fsPath)}`
    : `Replace ${uris.length} file(s) with ${ref}`;
  const confirm = await vscode.window.showWarningMessage(
    `${label}? Local changes will be lost.`,
    { modal: true },
    "Replace",
  );
  if (confirm !== "Replace") return;
  await withProgress(manager, label, async () => {
    for (const uri of uris) {
      if (!uri.fsPath.startsWith(repo.root)) continue;
      const rel = path.relative(repo.root, uri.fsPath);
      await repo.replaceWithRef(rel, ref);
    }
  });
}

async function replaceWithIndex(
  manager: RepositoryManager,
  uris: vscode.Uri[],
): Promise<void> {
  if (uris.length === 0) return;
  const repo = repoForUri(manager, uris[0]);
  if (!repo) return;
  const label = uris.length === 1
    ? `Replace with Index: ${path.basename(uris[0].fsPath)}`
    : `Replace ${uris.length} file(s) with Index`;
  const confirm = await vscode.window.showWarningMessage(
    `${label}? Unstaged changes will be lost.`,
    { modal: true },
    "Replace",
  );
  if (confirm !== "Replace") return;
  await withProgress(manager, label, async () => {
    const rels = uris
      .filter((u) => u.fsPath.startsWith(repo.root))
      .map((u) => path.relative(repo.root, u.fsPath));
    await repo.discard(rels, []);
  });
}

