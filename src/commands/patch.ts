import * as path from "node:path";
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import { RepositoryManager } from "../git/RepositoryManager";
import { GitExecutor } from "../git/GitExecutor";
import { errMsg, resolveRepo, withProgress } from "./shared";
import { VsgitNode } from "../views/RepositoriesProvider";

/**
 * Patch commands: create a patch from staged/committed changes and apply a
 * patch file. Maps to VsGit's Team → Advanced → Create Patch / Apply Patch.
 */
export function registerPatchCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // Create patch from the current staged changes (git diff --cached)
  reg("vsgit.patch.createFromStaged", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) return;
    const git = new GitExecutor();
    let diff: string;
    try {
      diff = await git.stdout(["diff", "--cached"], { cwd: repo.root });
    } catch (e) {
      vscode.window.showErrorMessage(`Create patch failed: ${errMsg(e)}`);
      return;
    }
    if (!diff.trim()) {
      vscode.window.showInformationMessage("No staged changes to create a patch from.");
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(repo.root, "changes.patch")),
      filters: { Patch: ["patch", "diff"] },
      title: "Save Patch File",
    });
    if (!uri) return;
    try {
      await fs.writeFile(uri.fsPath, diff, "utf8");
      vscode.window.showInformationMessage(`Patch saved to ${path.basename(uri.fsPath)}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Save patch failed: ${errMsg(e)}`);
    }
  });

  // Create patch from last N commits (git format-patch)
  reg("vsgit.patch.createFromCommits", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) return;
    const nStr = await vscode.window.showInputBox({
      prompt: "Number of commits to include in patch",
      value: "1",
      validateInput: (v) =>
        /^\d+$/.test(v.trim()) && Number(v) > 0 ? undefined : "Enter a positive integer",
    });
    if (!nStr) return;
    const n = Number(nStr.trim());
    const git = new GitExecutor();
    const folder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(repo.root),
      title: "Select Output Folder for Patch Files",
    });
    if (!folder || folder.length === 0) return;
    try {
      await withProgress(manager, `Create patch (last ${n} commits)`, async () => {
        await git.run(
          ["format-patch", `-${n}`, "--output-directory", folder[0].fsPath],
          { cwd: repo.root },
        );
      });
      vscode.window.showInformationMessage(
        `Patch file(s) written to ${folder[0].fsPath}`,
      );
    } catch (e) {
      vscode.window.showErrorMessage(`format-patch failed: ${errMsg(e)}`);
    }
  });

  // Apply a patch file (git apply)
  reg("vsgit.patch.apply", async (uriArg) => {
    let patchUri: vscode.Uri | undefined;
    if (uriArg instanceof vscode.Uri && uriArg.scheme === "file") {
      patchUri = uriArg;
    } else {
      const picks = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { Patch: ["patch", "diff"], All: ["*"] },
        title: "Select Patch File to Apply",
      });
      if (!picks || picks.length === 0) return;
      patchUri = picks[0];
    }

    const repos = manager.getAll();
    if (repos.length === 0) {
      vscode.window.showWarningMessage("No Git repositories found.");
      return;
    }
    let repo = repos.find((r) => patchUri!.fsPath.startsWith(r.root));
    if (!repo) {
      if (repos.length === 1) {
        repo = repos[0];
      } else {
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({ label: r.name, repo: r })),
          { placeHolder: "Select repository to apply patch in" },
        );
        if (!pick) return;
        repo = pick.repo;
      }
    }

    const mode = await vscode.window.showQuickPick(
      ["Apply (stage changes)", "Apply only (do not stage)"],
      { placeHolder: "Apply mode" },
    );
    if (!mode) return;

    const git = new GitExecutor();
    const args = ["apply"];
    if (mode.startsWith("Apply (stage")) {
      args.push("--index");
    }
    args.push("--", patchUri.fsPath);

    await withProgress(manager, `Apply patch: ${path.basename(patchUri.fsPath)}`, async () => {
      await git.run(args, { cwd: repo!.root });
    });
  });
}
