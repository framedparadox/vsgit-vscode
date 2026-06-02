import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { GitContentProvider } from "../git/GitContentProvider";
import { errMsg, withProgress } from "./shared";
import { confirmDestructiveAction, DestructiveOperations } from "../util/confirmation";
import { CommitPickerView } from "../webviews/CommitPickerView";
import { RefPickerView } from "../webviews/RefPickerView";

/**
 * Explorer / editor context menu operations that map to EGit's "Team" menu.
 * Commands receive a `vscode.Uri` (from the explorer) or fall back to the
 * active editor.
 */
export function registerFileContextCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // ── Stage / unstage from explorer ─────────────────────────────────────

  reg("egit.file.stage", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const rels = uris.map((u) => path.relative(repo.root, u.fsPath));
    await withProgress(manager, "Stage", () => repo.stage(rels));
  });

  reg("egit.file.unstage", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const rels = uris.map((u) => path.relative(repo.root, u.fsPath));
    await withProgress(manager, "Unstage", () => repo.unstage(rels));
  });

  reg("egit.file.ignore", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const rels = uris.map((u) => path.relative(repo.root, u.fsPath));
    try {
      await repo.addToGitignore(rels);
      vscode.window.showInformationMessage(`Added ${rels.length} pattern(s) to .gitignore`);
    } catch (e) {
      vscode.window.showErrorMessage(`Add to .gitignore failed: ${errMsg(e)}`);
    }
  });

  // ── Compare With ──────────────────────────────────────────────────────

  reg("egit.compare.withHead", async (uriArg) => {
    await compareFileWith(manager, resolveUri(uriArg), "HEAD");
  });

  reg("egit.compare.withIndex", async (uriArg) => {
    await compareFileWithIndex(manager, resolveUri(uriArg));
  });

  // "Index With HEAD" — diff the staged version against HEAD (no working tree involved)
  reg("egit.compare.indexWithHead", async (uriArg) => {
    await compareIndexWithHead(manager, resolveUri(uriArg));
  });

  reg("egit.compare.withPrevious", async (uriArg) => {
    await compareFileWith(manager, resolveUri(uriArg), "HEAD~1");
  });

  reg("egit.compare.withCommit", async (uriArg) => {
    const uri = resolveUri(uriArg);
    if (!uri) return;
    const repo = repoForUri(manager, uri);
    if (!repo) return;
    const sha = await CommitPickerView.pick(repo);
    if (!sha) return;
    await compareFileWith(manager, uri, sha);
  });

  // "Branch, Tag, or Reference…" — full EGit-style ref picker
  reg("egit.compare.withBranchOrTag", async (uriArg) => {
    const uri = resolveUri(uriArg);
    if (!uri) return;
    const repo = repoForUri(manager, uri);
    if (!repo) return;
    const fileName = path.basename(uri.fsPath);
    const ref = await RefPickerView.pick(repo, {
      title: `Compare '${fileName}' with a Branch, Tag, or Reference`,
      subtitle: "Select a branch, tag, or reference to compare the resource with",
    });
    if (!ref) return;
    await compareFileWith(manager, uri, ref);
  });

  // "Clipboard" — paste text from clipboard into a temp document and diff against it
  reg("egit.compare.withClipboard", async (uriArg) => {
    const uri = resolveUri(uriArg);
    if (!uri) return;
    const clipText = await vscode.env.clipboard.readText();
    if (!clipText) {
      vscode.window.showWarningMessage("Clipboard is empty.");
      return;
    }
    const clipDoc = await vscode.workspace.openTextDocument({
      content: clipText,
      language: guessLanguage(uri.fsPath),
    });
    const label = `${path.basename(uri.fsPath)} (working tree ↔ clipboard)`;
    try {
      await vscode.commands.executeCommand("vscode.diff", clipDoc.uri, uri, label);
    } catch (e) {
      vscode.window.showErrorMessage(`Compare with clipboard failed: ${errMsg(e)}`);
    }
  });

  // "Each Other" — pick two files from the workspace and diff them
  reg("egit.compare.eachOther", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);

    let leftUri: vscode.Uri | undefined;
    let rightUri: vscode.Uri | undefined;

    if (uris.length >= 2) {
      // Two files selected in explorer — diff them directly
      leftUri = uris[0];
      rightUri = uris[1];
    } else if (uris.length === 1) {
      // One file selected — pick the second from open editors or file picker
      leftUri = uris[0];
      rightUri = await pickFileFromEditors(leftUri);
    } else {
      // Nothing selected — pick both files
      const picks = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFolders: false,
        openLabel: "Select two files to compare",
      });
      if (!picks || picks.length < 2) {
        vscode.window.showWarningMessage("Select exactly two files to compare.");
        return;
      }
      leftUri = picks[0];
      rightUri = picks[1];
    }

    if (!leftUri || !rightUri) return;
    const label = `${path.basename(leftUri.fsPath)} ↔ ${path.basename(rightUri.fsPath)}`;
    try {
      await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, label);
    } catch (e) {
      vscode.window.showErrorMessage(`Compare failed: ${errMsg(e)}`);
    }
  });

  // "Local History" — show VS Code's built-in local history timeline for the file
  reg("egit.compare.withLocalHistory", async (uriArg) => {
    const uri = resolveUri(uriArg);
    if (!uri) return;
    try {
      // Reveal the file in the Timeline view (built-in Local History feature in VS Code 1.66+)
      await vscode.commands.executeCommand("timeline.focus");
      await vscode.window.showTextDocument(uri, { preview: true });
      vscode.window.showInformationMessage(
        "Local History shown in the Timeline panel. Select an entry to compare.",
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Local History failed: ${errMsg(e)}`);
    }
  });

  // ── Show file history ─────────────────────────────────────────────────

  reg("egit.file.showHistory", async (uriArg) => {
    const uri = resolveUri(uriArg);
    if (!uri) return;
    const repo = repoForUri(manager, uri);
    if (!repo) return;
    const rel = path.relative(repo.root, uri.fsPath);
    await vscode.commands.executeCommand("egit.history.show", {
      repoRoot: repo.root,
      file: rel,
    });
  });

  // ── Assume unchanged / skip worktree ─────────────────────────────────

  reg("egit.file.assumeUnchanged", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const rels = uris.map((u) => path.relative(repo.root, u.fsPath));
    await withProgress(manager, "Assume unchanged", () =>
      repo.assumeUnchanged(rels, true),
    );
  });

  reg("egit.file.noAssumeUnchanged", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const rels = uris.map((u) => path.relative(repo.root, u.fsPath));
    await withProgress(manager, "No assume unchanged", () =>
      repo.assumeUnchanged(rels, false),
    );
  });

  reg("egit.file.skipWorktree", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const rels = uris.map((u) => path.relative(repo.root, u.fsPath));
    await withProgress(manager, "Skip worktree", () =>
      repo.skipWorktree(rels, true),
    );
  });

  reg("egit.file.noSkipWorktree", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const rels = uris.map((u) => path.relative(repo.root, u.fsPath));
    await withProgress(manager, "No skip worktree", () =>
      repo.skipWorktree(rels, false),
    );
  });

  reg("egit.file.untrack", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    if (uris.length === 0) return;
    const repo = repoForUri(manager, uris[0]);
    if (!repo) return;
    const rels = uris.map((u) => path.relative(repo.root, u.fsPath));
    const confirm = await vscode.window.showWarningMessage(
      `Remove ${rels.length} file(s) from Git tracking (git rm --cached)?`,
      { modal: true },
      "Untrack",
    );
    if (confirm !== "Untrack") return;
    await withProgress(manager, "Untrack", () => repo.untrack(rels));
  });

  // ── Clean untracked ───────────────────────────────────────────────────

  reg("egit.clean", async (uriArg, allUris) => {
    const uris = resolveUris(uriArg, allUris);
    const repo = uris.length > 0
      ? repoForUri(manager, uris[0])
      : manager.getAll()[0];
    if (!repo) return;

    const rels = uris
      .filter((u) => u.fsPath.startsWith(repo.root))
      .map((u) => path.relative(repo.root, u.fsPath));

    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.CLEAN_UNTRACKED,
      message: "Remove all untracked files and directories? This cannot be undone.",
      items: rels.length > 0 ? rels : undefined,
    });
    if (!confirmed) return;

    await withProgress(manager, "Clean untracked files", () =>
      repo.cleanUntracked(rels.length > 0 ? rels : undefined),
    );
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

async function compareFileWith(
  manager: RepositoryManager,
  uri: vscode.Uri | undefined,
  ref: string,
): Promise<void> {
  if (!uri) return;
  const repo = repoForUri(manager, uri);
  if (!repo) return;
  const rel = path.relative(repo.root, uri.fsPath);
  const left = GitContentProvider.uri(repo.root, rel, ref, uri.fsPath);
  const label = `${path.basename(rel)} (${ref} ↔ working tree)`;
  try {
    await vscode.commands.executeCommand("vscode.diff", left, uri, label);
  } catch (e) {
    vscode.window.showErrorMessage(`Compare failed: ${errMsg(e)}`);
  }
}

async function compareFileWithIndex(
  manager: RepositoryManager,
  uri: vscode.Uri | undefined,
): Promise<void> {
  if (!uri) return;
  const repo = repoForUri(manager, uri);
  if (!repo) return;
  const rel = path.relative(repo.root, uri.fsPath);
  // Use "" (empty string) as the ref to mean "index / staged"
  const left = GitContentProvider.uri(repo.root, rel, "", uri.fsPath);
  const label = `${path.basename(rel)} (Index ↔ working tree)`;
  try {
    await vscode.commands.executeCommand("vscode.diff", left, uri, label);
  } catch (e) {
    vscode.window.showErrorMessage(`Compare with index failed: ${errMsg(e)}`);
  }
}

// Diff the staged (index) version of a file against the HEAD version — no working tree.
async function compareIndexWithHead(
  manager: RepositoryManager,
  uri: vscode.Uri | undefined,
): Promise<void> {
  if (!uri) return;
  const repo = repoForUri(manager, uri);
  if (!repo) return;
  const rel = path.relative(repo.root, uri.fsPath);
  const headUri = GitContentProvider.uri(repo.root, rel, "HEAD", uri.fsPath);
  const indexUri = GitContentProvider.uri(repo.root, rel, "", uri.fsPath);
  const label = `${path.basename(rel)} (HEAD ↔ Index)`;
  try {
    await vscode.commands.executeCommand("vscode.diff", headUri, indexUri, label);
  } catch (e) {
    vscode.window.showErrorMessage(`Compare Index with HEAD failed: ${errMsg(e)}`);
  }
}

// Offer currently-open editors as quick-pick targets for "Compare Each Other".
async function pickFileFromEditors(
  exclude: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const openDocs = vscode.workspace.textDocuments
    .filter((d) => d.uri.scheme === "file" && d.uri.fsPath !== exclude.fsPath);

  type FileItem = vscode.QuickPickItem & { uri: vscode.Uri };

  const items: FileItem[] = openDocs.map((d) => ({
    label: `$(file)  ${path.basename(d.uri.fsPath)}`,
    description: vscode.workspace.asRelativePath(d.uri, true),
    uri: d.uri,
  }));

  items.push(
    { label: "", kind: vscode.QuickPickItemKind.Separator, uri: vscode.Uri.parse("") },
    {
      label: "$(folder-opened)  Browse for file…",
      description: "Open file picker",
      uri: vscode.Uri.parse("__browse__"),
    },
  );

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Select a file to compare with ${path.basename(exclude.fsPath)}`,
    matchOnDescription: true,
  });
  if (!pick) return undefined;

  if (pick.uri.toString() === "__browse__") {
    const chosen = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      openLabel: "Compare",
    });
    return chosen?.[0];
  }

  return pick.uri;
}

// Best-effort language-id guess from file extension for clipboard diffs.
function guessLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescriptreact",
    js: "javascript", jsx: "javascriptreact",
    py: "python", rb: "ruby", go: "go", rs: "rust",
    java: "java", kt: "kotlin", cs: "csharp",
    cpp: "cpp", c: "c", h: "c",
    json: "json", yaml: "yaml", yml: "yaml",
    md: "markdown", sh: "shellscript", bash: "shellscript",
    html: "html", css: "css", scss: "scss",
    xml: "xml", sql: "sql",
  };
  return map[ext] ?? "plaintext";
}
