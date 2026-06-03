import * as vscode from "vscode";
import * as path from "node:path";
import { RepositoryManager } from "../git/RepositoryManager";
import { VsgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, errMsg, withProgress } from "./shared";

/** Git archive command: create zip/tar archives from refs. */
export function registerArchiveCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vsgit.archive.create",
      async (node: unknown) => {
        const repo = await resolveRepo(manager, node as VsgitNode);
        if (!repo) return;

        // Pick ref
        const branches = [...repo.localBranches, ...repo.remoteBranches];
        const tags = repo.tags;
        const refs = [
          ...branches.map((b) => ({ label: b.shortName, description: "branch" })),
          ...tags.map((t) => ({ label: t.shortName, description: "tag" })),
          { label: "HEAD", description: "current commit" },
        ];

        const refItem = await vscode.window.showQuickPick(refs, {
          placeHolder: "Select ref to archive",
        });
        if (!refItem) return;

        const ref = refItem.label;

        // Pick format
        const formatItem = await vscode.window.showQuickPick(
          [
            { label: "zip", description: "ZIP archive" },
            { label: "tar", description: "TAR archive (uncompressed)" },
            { label: "tar.gz", description: "TAR.GZ archive (gzip compressed)" },
            { label: "tar.bz2", description: "TAR.BZ2 archive (bzip2 compressed)" },
            { label: "tar.xz", description: "TAR.XZ archive (xz compressed)" },
          ],
          { placeHolder: "Select archive format" }
        );
        if (!formatItem) return;

        const format = formatItem.label;

        // Output location
        const defaultFilename = `${path.basename(repo.root)}-${ref.replace(/\//g, "-")}.${format}`;
        const outputUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(repo.root, defaultFilename)),
          filters: {
            Archives: format === "zip" ? ["zip"] : ["tar", "gz", "bz2", "xz"],
          },
        });
        if (!outputUri) return;

        // Optional prefix
        const prefix = await vscode.window.showInputBox({
          prompt: "Optional: Add directory prefix inside archive (leave empty for none)",
          placeHolder: "project-name/",
        });

        try {
          await withProgress(
            manager,
            `Creating ${format} archive from ${ref}`,
            () => repo.archive(ref, format, outputUri.fsPath, prefix || undefined)
          );
          
          const action = await vscode.window.showInformationMessage(
            `Archive created: ${outputUri.fsPath}`,
            "Reveal in Finder"
          );
          
          if (action === "Reveal in Finder") {
            await vscode.commands.executeCommand("revealFileInOS", outputUri);
          }
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to create archive: ${errMsg(e)}`);
        }
      }
    )
  );
}
