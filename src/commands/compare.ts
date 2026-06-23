import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { GitContentProvider } from "../git/GitContentProvider";
import { VsgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, withProgress, errMsg } from "./shared";
import { CompareProvider } from "../views/CompareProvider";

/**
 * Compare commands: compare the active file against a chosen ref, and 3-way
 * conflict resolution (use ours/theirs, open merge editor, mark resolved).
 * Also includes Compare View tree commands.
 */
export function registerCompareCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
  compareProvider?: CompareProvider,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // Compare the active editor's file against a ref the user picks.
  reg("vsgit.compare.withRef", async (uriArg) => {
    const uri = uriArg instanceof vscode.Uri ? uriArg : vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== "file") {
      vscode.window.showWarningMessage("Open a file to compare.");
      return;
    }
    const fsPath = uri.fsPath;
    const repo = manager.findByUri(uri);
    if (!repo) {
      vscode.window.showWarningMessage("File is not in a known repository.");
      return;
    }
    const ref = await pickRef(repo);
    if (!ref) {
      return;
    }
    const rel = manager.relativePath(repo, uri);
    const left = GitContentProvider.uri(repo.root, rel, ref, fsPath);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      uri,
      `${path.basename(rel)} (${ref} ↔ working tree)`,
    );
  });

  // Conflict resolution entry points (work on conflicted files).
  reg("vsgit.conflict.useOurs", (node) =>
    resolveConflict(manager, node, "ours"),
  );
  reg("vsgit.conflict.useTheirs", (node) =>
    resolveConflict(manager, node, "theirs"),
  );
  reg("vsgit.conflict.markResolved", async (node) => {
    const target = await resolveConflictTarget(manager, node);
    if (!target) {
      return;
    }
    await withProgress(manager, `Mark resolved: ${target.rel}`, () =>
      target.repo.markResolved(target.rel),
    );
  });
  reg("vsgit.conflict.openMergeEditor", async (node) => {
    const target = await resolveConflictTarget(manager, node);
    if (!target) {
      return;
    }
    const workingUri = vscode.Uri.file(path.join(target.repo.root, target.rel));

    // Try the VS Code built-in merge editor (1.79+).
    // It accepts { base, input1, input2, output } or just a plain URI for
    // single-file conflict resolution view.
    try {
      // ours = MERGE_HEAD side, theirs = HEAD side; base is the common ancestor
      const oursUri  = GitContentProvider.uri(target.repo.root, target.rel, "MERGE_HEAD", workingUri.fsPath);
      const theirsUri = GitContentProvider.uri(target.repo.root, target.rel, "HEAD", workingUri.fsPath);
      const baseUri  = GitContentProvider.uri(target.repo.root, target.rel, "MERGE_BASE", workingUri.fsPath);

      await vscode.commands.executeCommand(
        "vscode.openWith",
        workingUri,
        "mergeEditor.Input",
        {
          base: baseUri,
          input1: { uri: theirsUri, title: "Current (HEAD)", description: "HEAD" },
          input2: { uri: oursUri,   title: "Incoming (MERGE_HEAD)", description: "MERGE_HEAD" },
          output: workingUri,
        },
      );
    } catch {
      // Fallback: open the conflicted file in the standard text editor so the
      // user can resolve conflict markers manually, then use "Mark Resolved".
      const doc = await vscode.workspace.openTextDocument(workingUri);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(
        `Resolve conflict markers in ${target.rel}, then run "Conflict: Mark Resolved".`,
      );
    }
  });

  // Compare View tree commands
  if (compareProvider) {
    reg("vsgit.compare.start", async () => {
      const repos = manager.getAll();
      if (repos.length === 0) {
        vscode.window.showErrorMessage("No repositories found");
        return;
      }

      let repo = repos[0];
      if (repos.length > 1) {
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({ label: r.name, repo: r })),
          { placeHolder: "Select repository" },
        );
        if (!pick) return;
        repo = pick.repo;
      }

      const refs = await getAllRefs(repo);
      const ref1Pick = await vscode.window.showQuickPick(refs, {
        placeHolder: "Select first ref (base)",
      });
      if (!ref1Pick) return;

      const ref2Pick = await vscode.window.showQuickPick(refs, {
        placeHolder: "Select second ref (compare)",
      });
      if (!ref2Pick) return;

      await compareProvider.startComparison(repo, ref1Pick.ref, ref2Pick.ref);
      await vscode.commands.executeCommand("vsgit.compare.focus");
      vscode.window.showInformationMessage(
        `Comparing ${ref1Pick.ref} ↔ ${ref2Pick.ref}`,
      );
    });

    reg("vsgit.compare.clear", () => {
      compareProvider.clearComparison();
      vscode.window.showInformationMessage("Comparison cleared");
    });

    reg("vsgit.compare.switchSides", async () => {
      const current = compareProvider.getCurrentComparison();
      if (!current) {
        vscode.window.showWarningMessage("No active comparison");
        return;
      }
      await compareProvider.startComparison(current.repo, current.ref2, current.ref1);
      vscode.window.showInformationMessage(`Switched to ${current.ref2} ↔ ${current.ref1}`);
    });

    reg(
      "vsgit.compare.openDiff",
      async (repo, filePath, ref1, ref2) => {
        const r = repo as Repository;
        const fp = filePath as string;
        const r1 = ref1 as string;
        const r2 = ref2 as string;
        const abs = path.join(r.root, fp);
        const left = GitContentProvider.uri(r.root, fp, r1, abs);
        const right = GitContentProvider.uri(r.root, fp, r2, abs);
        await vscode.commands.executeCommand(
          "vscode.diff",
          left,
          right,
          `${path.basename(fp)} (${r1} ↔ ${r2})`,
        );
      },
    );

    reg("vsgit.showCommitDetails", async (repo, sha) => {
      const r = repo as Repository;
      const s = sha as string;
      const files = await r.commitFiles(s);
      const commits = await r.log({ revRange: `${s}~1..${s}`, limit: 1 });
      const commit = commits[0];
      if (!commit) {
        vscode.window.showErrorMessage("Commit not found");
        return;
      }

      const header = [
        `$(git-commit) ${s.slice(0, 12)}  ${commit.subject}`,
      ].join("");

      const fileItems = files.map((f: { status: string; path: string }) => ({
        label: `$(${fileStatusIcon(f.status)}) ${f.path}`,
        description: f.status,
        filePath: f.path,
      }));

      const metaItem = {
        label: `$(info) Show full commit info`,
        description: `${commit.authorName} · ${new Date(commit.authorDate * 1000).toLocaleString()}`,
        filePath: "",
      };

      const pick = await vscode.window.showQuickPick(
        [metaItem, ...fileItems],
        { placeHolder: header },
      );
      if (!pick) return;

      if (pick.filePath === "") {
        // Show metadata document
        const body = commit.body ? `\n\n${commit.body}` : "";
        const details = [
          `Commit: ${s}`,
          `Author: ${commit.authorName} <${commit.authorEmail}>`,
          `Date:   ${new Date(commit.authorDate * 1000).toLocaleString()}`,
          ``,
          `${commit.subject}${body}`,
          ``,
          `Changed files (${files.length}):`,
          ...files.map((f: { status: string; path: string }) => `  ${f.status}  ${f.path}`),
        ].join("\n");
        const doc = await vscode.workspace.openTextDocument({ content: details, language: "plaintext" });
        await vscode.window.showTextDocument(doc);
      } else {
        // Diff selected file at this commit vs its parent
        const rel = pick.filePath;
        const abs = path.join(r.root, rel);
        const left = GitContentProvider.uri(r.root, rel, `${s}~1`, abs);
        const right = GitContentProvider.uri(r.root, rel, s, abs);
        await vscode.commands.executeCommand(
          "vscode.diff",
          left,
          right,
          `${path.basename(rel)} @ ${s.slice(0, 8)}`,
        );
      }
    });
  }
}

async function resolveConflict(
  manager: RepositoryManager,
  node: unknown,
  side: "ours" | "theirs",
): Promise<void> {
  const target = await resolveConflictTarget(manager, node);
  if (!target) {
    return;
  }
  try {
    await withProgress(manager, `Use ${side}: ${target.rel}`, () =>
      target.repo.resolveWith(target.rel, side),
    );
  } catch (e) {
    vscode.window.showErrorMessage(`Resolve failed: ${errMsg(e)}`);
  }
}

interface ConflictTarget {
  repo: Repository;
  rel: string;
}

async function resolveConflictTarget(
  manager: RepositoryManager,
  node: unknown,
): Promise<ConflictTarget | undefined> {
  // From a staging file node.
  const n = node as { repo?: Repository; change?: { path: string } } | undefined;
  if (n && n.repo && n.change) {
    return { repo: n.repo, rel: n.change.path };
  }
  // Otherwise prompt across all conflicted files.
  const repo = await resolveRepo(manager, node as VsgitNode);
  if (!repo) {
    return undefined;
  }
  const conflicts = repo.conflictedPaths;
  if (conflicts.length === 0) {
    vscode.window.showInformationMessage("No conflicted files.");
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(conflicts, {
    placeHolder: "Select conflicted file",
  });
  return pick ? { repo, rel: pick } : undefined;
}

async function pickRef(repo: Repository): Promise<string | undefined> {
  const items = [
    { label: "HEAD", value: "HEAD" },
    ...repo.localBranches.map((b) => ({ label: b.shortName, value: b.shortName })),
    ...repo.remoteBranches.map((b) => ({ label: b.shortName, value: b.shortName })),
    ...repo.tags.map((t) => ({ label: t.shortName, value: t.shortName })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Compare against ref",
  });
  return pick?.value;
}

async function getAllRefs(repo: Repository): Promise<Array<{ label: string; ref: string }>> {
  const refs: Array<{ label: string; ref: string }> = [];

  // Add HEAD
  refs.push({ label: "HEAD", ref: "HEAD" });

  // Add local branches
  for (const b of repo.localBranches) {
    refs.push({ label: `📌 ${b.shortName}`, ref: b.shortName });
  }

  // Add remote branches
  for (const b of repo.remoteBranches) {
    refs.push({ label: `🌐 ${b.shortName}`, ref: b.shortName });
  }

  // Add tags
  for (const t of repo.tags) {
    refs.push({ label: `🏷️  ${t.shortName}`, ref: t.shortName });
  }

  return refs;
}

function fileStatusIcon(status: string): string {
  switch (status.toUpperCase()) {
    case "A": return "diff-added";
    case "D": return "diff-removed";
    case "M": return "diff-modified";
    case "R": return "diff-renamed";
    default:  return "circle-outline";
  }
}
