import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { VsgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, withProgress } from "./shared";

/** Tag operations: create (lightweight/annotated/signed), delete, checkout, push. */
export function registerTagCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("vsgit.tag.create", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    const name = await vscode.window.showInputBox({ prompt: "Tag name" });
    if (!name) {
      return;
    }

    // If the tag already exists, offer a force re-tag (otherwise git would fail).
    const exists = repo.tags.some((t) => t.shortName === name);
    let force = false;
    if (exists) {
      const choice = await vscode.window.showWarningMessage(
        `Tag '${name}' already exists. Force re-tag it to point at HEAD?`,
        { modal: true },
        "Force Re-tag",
      );
      if (choice !== "Force Re-tag") {
        return;
      }
      force = true;
    }

    const kind = await vscode.window.showQuickPick(
      ["Lightweight", "Annotated", "Signed (GPG)"],
      { placeHolder: "Tag type" },
    );
    if (!kind) {
      return;
    }
    let message: string | undefined;
    if (kind !== "Lightweight") {
      message = await vscode.window.showInputBox({
        prompt: "Tag message",
        validateInput: (v) =>
          kind === "Signed (GPG)" && v.trim() === ""
            ? "Signed tags need a message"
            : undefined,
      });
      if (message === undefined) {
        return;
      }
    }

    // Optionally push the tag to a remote straight after creating it.
    const pushChoice = await vscode.window.showQuickPick(
      ["Create only", "Create and push"],
      { placeHolder: "Push the tag to a remote?" },
    );
    if (!pushChoice) {
      return;
    }
    let remote: string | undefined;
    if (pushChoice === "Create and push") {
      remote = await pickRemote(repo);
      if (!remote) {
        return;
      }
    }

    await withProgress(manager, `Create tag ${name}`, async () => {
      await repo.createTagAt(
        name,
        "HEAD",
        message || undefined,
        kind === "Signed (GPG)",
        force,
      );
      if (remote) {
        await repo.pushTag(remote, name, force);
      }
    });
  });

  reg("vsgit.tag.delete", async (node) => {
    const n = node as VsgitNode;
    if (!n || n.type !== "tag") {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete tag ${n.ref.shortName}?`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return;
    }
    await withProgress(manager, `Delete tag ${n.ref.shortName}`, () =>
      n.repo.deleteTag(n.ref.shortName),
    );
  });

  reg("vsgit.tag.checkout", async (node) => {
    const n = node as VsgitNode;
    if (!n || n.type !== "tag") {
      return;
    }
    await withProgress(manager, `Checkout ${n.ref.shortName}`, () =>
      n.repo.checkoutRef(n.ref.shortName),
    );
  });

  reg("vsgit.tag.push", async (node) => {
    const n = node as VsgitNode;
    if (!n || n.type !== "tag") {
      return;
    }
    const remote = await pickRemote(n.repo);
    if (!remote) {
      return;
    }
    await withProgress(manager, `Push tag ${n.ref.shortName}`, () =>
      n.repo.pushTag(remote, n.ref.shortName),
    );
  });

  reg("vsgit.tag.forceCreate", async (node) => {
    const n = node as VsgitNode;
    if (!n || n.type !== "tag") {
      return;
    }
    const existing = n.ref.shortName;
    const sha = await vscode.window.showInputBox({
      prompt: `Force-move tag '${existing}' to commit (SHA or ref)`,
      placeHolder: "HEAD",
      value: "HEAD",
      validateInput: (v) => (v.trim() === "" ? "Required" : undefined),
    });
    if (!sha) return;
    const confirm = await vscode.window.showWarningMessage(
      `Force replace tag '${existing}' pointing to '${sha.trim()}'?`,
      { modal: true },
      "Force Replace",
    );
    if (confirm !== "Force Replace") return;
    await withProgress(manager, `Force re-tag ${existing}`, () =>
      n.repo.createTagAt(existing, sha.trim(), undefined, false, true),
    );
  });

  reg("vsgit.tag.deleteRemote", async (node) => {
    const n = node as VsgitNode;
    if (!n || n.type !== "tag") {
      return;
    }
    const remote = await pickRemote(n.repo);
    if (!remote) return;
    const confirm = await vscode.window.showWarningMessage(
      `Delete remote tag '${n.ref.shortName}' from '${remote}'? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") return;
    await withProgress(manager, `Delete remote tag ${n.ref.shortName}`, () =>
      n.repo.deleteRemoteTag(remote, n.ref.shortName),
    );
  });
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
    { placeHolder: "Select remote" },
  );
}
