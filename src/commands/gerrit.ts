import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { EgitNode } from "../views/RepositoriesProvider";
import { Credentials } from "../util/credentials";
import { resolveRepo, withProgress } from "./shared";

/**
 * Gerrit support: push HEAD to refs/for/<branch> for code review. EGit's
 * Change-Id is normally injected by Gerrit's commit-msg hook; we offer to
 * install that hook and then push for review.
 */
export function registerGerritCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const creds = new Credentials(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "egit.gerrit.pushForReview",
      async (node?: EgitNode) => {
        const repo = await resolveRepo(manager, node as EgitNode);
        if (!repo) {
          return;
        }
        const remote = await pickRemote(repo);
        if (!remote) {
          return;
        }
        const target = await vscode.window.showInputBox({
          prompt: "Target branch for review",
          value: repo.headName?.startsWith("(") ? "main" : repo.headName ?? "main",
        });
        if (!target) {
          return;
        }
        await withProgress(
          manager,
          `Push for review → ${remote} refs/for/${target}`,
          () =>
            creds.withAskpass((env) =>
              repo.pushForReview(remote, target, env),
            ),
        );
      },
    ),

    vscode.commands.registerCommand(
      "egit.gerrit.installHook",
      async (node?: EgitNode) => {
        const repo = await resolveRepo(manager, node as EgitNode);
        if (!repo) {
          return;
        }
        await installCommitMsgHook(repo);
      },
    ),
  );
}

async function installCommitMsgHook(repo: Repository): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hookPath = path.join(repo.root, ".git", "hooks", "commit-msg");
  // Minimal Change-Id hook: appends a stable Change-Id derived from a random id
  // if one is not already present. (Production setups fetch Gerrit's official
  // hook; this keeps us dependency-free.)
  const hook = `#!/bin/sh
# git-vscode Gerrit Change-Id hook
MSG="$1"
if grep -q '^Change-Id:' "$MSG"; then exit 0; fi
id=$(git hash-object "$MSG" 2>/dev/null | cut -c1-40)
printf '\\nChange-Id: I%s\\n' "$id" >> "$MSG"
`;
  try {
    await fs.writeFile(hookPath, hook, { mode: 0o755 });
    vscode.window.showInformationMessage(
      "Installed Gerrit Change-Id commit-msg hook.",
    );
  } catch (e) {
    vscode.window.showErrorMessage(
      `Failed to install hook: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function pickRemote(repo: Repository): Promise<string | undefined> {
  if (repo.remotes.length === 0) {
    vscode.window.showWarningMessage("No remotes configured.");
    return undefined;
  }
  if (repo.remotes.length === 1) {
    return repo.remotes[0].name;
  }
  return vscode.window.showQuickPick(
    repo.remotes.map((r) => r.name),
    { placeHolder: "Select Gerrit remote" },
  );
}
