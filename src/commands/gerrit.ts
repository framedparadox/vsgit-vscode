import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { VsgitNode } from "../views/RepositoriesProvider";
import { Credentials } from "../util/credentials";
import { resolveRepo, withProgress } from "./shared";

/**
 * Gerrit support: push HEAD to refs/for/<branch> for code review. VsGit's
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
      "vsgit.gerrit.pushForReview",
      async (node?: VsgitNode) => {
        const repo = await resolveRepo(manager, node as VsgitNode);
        if (!repo) {
          return;
        }
        const remote = await pickRemote(repo);
        if (!remote) {
          return;
        }
        // Changes are normally reviewed against the branch being tracked
        // (e.g. main), not the local topic branch's own name.
        const head = repo.localBranches.find((b) => b.isHead);
        const tracked = head?.upstream ? repo.splitRemoteBranch(head.upstream) : undefined;
        const target = await vscode.window.showInputBox({
          prompt: "Target branch for review",
          value: tracked && tracked.remote === remote ? tracked.branch : head?.shortName ?? "main",
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
      "vsgit.gerrit.installHook",
      async (node?: VsgitNode) => {
        const repo = await resolveRepo(manager, node as VsgitNode);
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
  // Minimal Change-Id hook: appends a stable Change-Id derived from a random id
  // if one is not already present. (Production setups fetch Gerrit's official
  // hook; this keeps us dependency-free.)
  //
  // The id mixes the message with the committer identity (which carries a
  // timestamp) and random bytes, so two commits with the same message never
  // share a Change-Id, and it is added as a proper trailer so Gerrit finds it
  // in the footer even when Signed-off-by lines are already present.
  const hook = `#!/bin/sh
# VsGit Gerrit Change-Id hook
MSG="$1"
if grep -q '^Change-Id:' "$MSG"; then exit 0; fi
# Leave an empty (aborted) commit message alone.
if [ -z "$(git stripspace --strip-comments < "$MSG")" ]; then exit 0; fi
id=$({ cat "$MSG"; git var GIT_COMMITTER_IDENT; date; head -c 32 /dev/urandom 2>/dev/null; } | git hash-object --stdin)
git interpret-trailers --in-place --trailer "Change-Id: I$id" "$MSG"
`;
  try {
    const hookPath = await repo.gitPath("hooks/commit-msg");
    // Never overwrite or follow an existing hook/symlink. Hooks are executable
    // project security boundaries; replacing one silently can destroy custom
    // policy or write through a malicious symlink.
    try {
      await fs.lstat(hookPath);
      vscode.window.showWarningMessage(
        `A commit-msg hook already exists at ${hookPath}; it was not replaced.`,
      );
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, hook, { mode: 0o755, flag: "wx" });
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
