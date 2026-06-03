import * as path from "node:path";
import * as vscode from "vscode";
import { GitExecutor } from "../git/GitExecutor";
import { RepositoryManager } from "../git/RepositoryManager";
import { AskpassServer } from "../util/AskpassServer";
import { safeRef, safeRemoteUrl } from "../git/argGuard";
import { errMsg } from "./shared";

/**
 * Clone wizard: prompt for URL, destination, optional branch and recursive,
 * then run `git clone` with the askpass shim so credentials are handled in-UI.
 * Also exposes init.
 */
export function registerCloneCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const git = new GitExecutor();
  const shimPath = path.join(context.extensionPath, "resources", "askpass.js");

  context.subscriptions.push(
    vscode.commands.registerCommand("vsgit.clone", async () => {
      const url = await vscode.window.showInputBox({
        prompt: "Repository URL to clone",
        placeHolder: "https://github.com/owner/repo.git",
        validateInput: (v) => (v.trim() === "" ? "URL required" : undefined),
      });
      if (!url) {
        return;
      }
      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select Clone Destination",
      });
      if (!folder || folder.length === 0) {
        return;
      }
      const dest = folder[0].fsPath;
      const branch = await vscode.window.showInputBox({
        prompt: "Branch to checkout (leave empty for default)",
      });
      if (branch === undefined) {
        return;
      }
      const recursive = await vscode.window.showQuickPick(["No", "Yes"], {
        placeHolder: "Clone submodules recursively?",
      });
      if (!recursive) {
        return;
      }

      // The URL and branch flow straight to `git clone`; guard the URL against
      // ext::/fd:: remote-helper transports (arbitrary command execution) and
      // reject option-like values so neither can be parsed by git as a flag.
      let safeUrl: string;
      let safeBranch: string | undefined;
      try {
        safeUrl = safeRemoteUrl(url.trim());
        safeBranch = branch.trim() ? safeRef(branch.trim(), "branch") : undefined;
      } catch (e) {
        vscode.window.showErrorMessage(`Clone failed: ${errMsg(e)}`);
        return;
      }

      const args = ["clone", "--progress"];
      if (safeBranch) {
        args.push("--branch", safeBranch);
      }
      if (recursive === "Yes") {
        args.push("--recurse-submodules");
      }
      args.push("--", safeUrl);

      const askpass = new AskpassServer();
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Cloning ${url}`, cancellable: false },
          () => git.run(args, { cwd: dest, env: askpass.env(shimPath) }),
        );
        await manager.scan();
        const open = await vscode.window.showInformationMessage(
          "Clone complete.",
          "Open Folder",
        );
        if (open === "Open Folder") {
          const name = url.replace(/\.git$/, "").split(/[\\/]/).pop() || "repo";
          const target = vscode.Uri.file(path.join(dest, name));
          await vscode.commands.executeCommand("vscode.openFolder", target, {
            forceNewWindow: false,
          });
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Clone failed: ${errMsg(e)}`);
      } finally {
        askpass.dispose();
      }
    }),

    vscode.commands.registerCommand("vsgit.init", async () => {
      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Initialize Git Repository Here",
      });
      if (!folder || folder.length === 0) {
        return;
      }
      try {
        await git.run(["init"], { cwd: folder[0].fsPath });
        await manager.scan();
        vscode.window.setStatusBarMessage("Initialized repository", 3000);
      } catch (e) {
        vscode.window.showErrorMessage(`Init failed: ${errMsg(e)}`);
      }
    }),
  );
}
