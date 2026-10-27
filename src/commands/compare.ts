import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { GitContentProvider, INDEX_STAGE } from "../git/GitContentProvider";
import { VsgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, withProgress, errMsg } from "./shared";
import { CompareProvider, CompareTreeNode, fileStatusIcon } from "../views/CompareProvider";
import { RefPickerView } from "../webviews/RefPickerView";
import { confirmDestructiveAction } from "../util/confirmation";
import { shortRefLabel } from "../util/revisionDiff";

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
    // Same rich picker as vsgit.compare.withBranchOrTag so both entry points
    // behave identically.
    const ref = await RefPickerView.pick(repo, {
      title: `Compare '${path.basename(fsPath)}' with a Branch, Tag, or Reference`,
      subtitle: "Select a branch, tag, or reference to compare the resource with",
    });
    if (!ref) {
      return;
    }
    const rel = manager.relativePath(repo, uri);
    const left = GitContentProvider.uri(repo.root, rel, ref, fsPath);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      uri,
      `${path.basename(rel)} (${shortRefLabel(ref)} ↔ working tree)`,
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

    // Use git's recorded conflict stages, not merge-base(HEAD, incoming).
    // Cherry-pick/rebase/revert store the correct base in `:1`; merge-base of
    // HEAD and the sequencer ref is often a distant fork point.
    try {
      const op = await target.repo.inProgressOperation();
      const incomingRef =
        op === "cherry-pick" ? "CHERRY_PICK_HEAD"
        : op === "revert" ? "REVERT_HEAD"
        : op === "rebase" ? "REBASE_HEAD"
        : "MERGE_HEAD";

      const currentUri = GitContentProvider.uri(
        target.repo.root,
        target.rel,
        INDEX_STAGE.ours,
        workingUri.fsPath,
      );
      const incomingUri = GitContentProvider.uri(
        target.repo.root,
        target.rel,
        INDEX_STAGE.theirs,
        workingUri.fsPath,
      );
      const baseUri = GitContentProvider.uri(
        target.repo.root,
        target.rel,
        INDEX_STAGE.base,
        workingUri.fsPath,
      );

      await vscode.commands.executeCommand("_open.mergeEditor", {
        base: baseUri,
        input1: { uri: currentUri, title: "Current", description: "HEAD (ours)" },
        input2: { uri: incomingUri, title: "Incoming", description: incomingRef },
        output: workingUri,
      });
      vscode.window.setStatusBarMessage(
        "Save the merge result, then run Mark Resolved to stage it.",
        5000,
      );
    } catch (e) {
      const doc = await vscode.workspace.openTextDocument(workingUri);
      await vscode.window.showTextDocument(doc);
      vscode.window.showWarningMessage(
        `Could not open the merge editor (${errMsg(e)}). Resolve conflict markers in ${target.rel}, then run "Conflict: Mark Resolved".`,
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

      let repo = manager.getActive() ?? repos[0];
      if (repos.length > 1) {
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({
            label: r.name,
            description: r === repo ? "active" : undefined,
            repo: r,
          })),
          { placeHolder: "Select repository" },
        );
        if (!pick) return;
        repo = pick.repo;
      }

      const refs = getAllRefs(repo);
      const ref1Pick = await vscode.window.showQuickPick(refs, {
        placeHolder: "Select first ref (base)",
      });
      if (!ref1Pick) return;

      const ref2Pick = await vscode.window.showQuickPick(
        refs.filter((r) => r.ref !== ref1Pick.ref),
        { placeHolder: `Select second ref (compare with ${ref1Pick.ref})` },
      );
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
      async (repoOrNode, filePath, ref1, ref2, origPath) => {
        // Click uses TreeItem.command args (repo, path, refs). Context menu
        // passes the tree node itself as the first argument.
        if (isCompareFileNode(repoOrNode)) {
          await GitContentProvider.openDiff(
            repoOrNode.repo.root,
            repoOrNode.file,
            repoOrNode.ref1,
            repoOrNode.ref2,
          );
          return;
        }
        const r = repoOrNode as Repository;
        const fp = filePath as string;
        const r1 = ref1 as string;
        const r2 = ref2 as string;
        if (!r?.root || typeof fp !== "string" || typeof r1 !== "string" || typeof r2 !== "string") {
          return;
        }
        await GitContentProvider.openDiff(
          r.root,
          { path: fp, origPath: typeof origPath === "string" ? origPath : undefined },
          r1,
          r2,
        );
      },
    );

    reg("vsgit.showCommitDetails", async (repoOrNode, sha) => {
      let r: Repository | undefined;
      let s: string | undefined;
      if (isCompareCommitNode(repoOrNode)) {
        r = repoOrNode.repo;
        s = repoOrNode.commit.sha;
      } else {
        r = repoOrNode as Repository;
        s = sha as string;
      }
      if (!r?.root || typeof s !== "string") {
        return;
      }
      const files = await r.commitFiles(s);
      // `s` alone (not `s~1..s`) so root commits — which have no parent —
      // resolve instead of throwing.
      const commits = await r.log({ revRange: s, limit: 1 });
      const commit = commits[0];
      if (!commit) {
        vscode.window.showErrorMessage("Commit not found");
        return;
      }

      const header = [
        `$(git-commit) ${s.slice(0, 12)}  ${commit.subject}`,
      ].join("");

      const fileItems = files.map((f) => ({
        label: `$(${fileStatusIcon(f.status)}) ${f.origPath ? `${f.origPath} → ${f.path}` : f.path}`,
        description: f.status,
        filePath: f.path,
        origPath: f.origPath,
      }));

      const metaItem = {
        label: `$(info) Show full commit info`,
        description: `${commit.authorName} · ${new Date(commit.authorDate * 1000).toLocaleString()}`,
        filePath: "",
        origPath: undefined as string | undefined,
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
          ...files.map((f) => `  ${f.status}  ${f.origPath ? `${f.origPath} → ${f.path}` : f.path}`),
        ].join("\n");
        const doc = await vscode.workspace.openTextDocument({ content: details, language: "plaintext" });
        await vscode.window.showTextDocument(doc);
      } else {
        // Diff selected file at this commit vs its parent
        await GitContentProvider.openDiff(
          r.root,
          { path: pick.filePath, origPath: pick.origPath },
          `${s}~1`,
          s,
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
  // During a rebase, git's ours/theirs are inverted from what most users
  // expect: "ours" is the branch being rebased ONTO and "theirs" is the
  // user's own commits being replayed. Confirm before acting on that.
  const op = await target.repo.inProgressOperation().catch(() => undefined);
  if (op === "rebase") {
    const meaning =
      side === "ours"
        ? '"ours" is the branch you are rebasing ONTO (not your own commits)'
        : '"theirs" is your own commits being replayed (not the other branch)';
    const confirmed = await confirmDestructiveAction({
      operation: "resolveConflictDuringRebase",
      message: `A rebase is in progress, so ${meaning}.\nResolve ${target.rel} using ${side}?`,
    });
    if (!confirmed) {
      return;
    }
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

/** Codicon-labelled quick-pick items, matching the pickers elsewhere (e.g. Switch To). */
function getAllRefs(repo: Repository): Array<{ label: string; ref: string }> {
  return [
    { label: "$(target) HEAD", ref: "HEAD" },
    ...repo.localBranches.map((b) => ({
      label: `$(git-branch) ${b.shortName}`,
      ref: b.shortName,
    })),
    ...repo.remoteBranches.map((b) => ({
      label: `$(cloud) ${b.shortName}`,
      ref: b.shortName,
    })),
    ...repo.tags.map((t) => ({ label: `$(tag) ${t.shortName}`, ref: t.shortName })),
  ];
}

function isCompareFileNode(value: unknown): value is Extract<CompareTreeNode, { type: "file" }> {
  return !!value && typeof value === "object" && (value as CompareTreeNode).type === "file";
}

function isCompareCommitNode(
  value: unknown,
): value is Extract<CompareTreeNode, { type: "commit" }> {
  return !!value && typeof value === "object" && (value as CompareTreeNode).type === "commit";
}
