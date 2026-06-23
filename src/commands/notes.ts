import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { VsgitNode } from "../views/RepositoriesProvider";
import { resolveRepo, errMsg, withProgress } from "./shared";
import { confirmDestructiveAction, DestructiveOperations } from "../util/confirmation";

/** Git notes operations: add, edit, remove, show notes on commits. */
export function registerNotesCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (cmd: string, handler: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));

  // Add note to commit
  reg("vsgit.notes.add", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) return;

    const ref = await vscode.window.showInputBox({
      prompt: "Enter commit SHA or ref to add note to",
      placeHolder: "HEAD",
      value: "HEAD",
    });
    if (!ref) return;

    const message = await vscode.window.showInputBox({
      prompt: "Enter note message",
      placeHolder: "Note text...",
    });
    if (!message) return;

    try {
      await withProgress(manager, `Adding note to ${ref}`, () =>
        repo.notesAdd(ref, message)
      );
      vscode.window.showInformationMessage(`Note added to ${ref}.`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to add note: ${errMsg(e)}`);
    }
  });

  // Edit existing note
  reg("vsgit.notes.edit", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) return;

    const ref = await vscode.window.showInputBox({
      prompt: "Enter commit SHA or ref to edit note",
      placeHolder: "HEAD",
      value: "HEAD",
    });
    if (!ref) return;

    // Try to show existing note
    const existing = await repo.notesShow(ref);
    const message = await vscode.window.showInputBox({
      prompt: "Enter new note message (replaces existing)",
      placeHolder: "Note text...",
      value: existing,
    });
    if (!message) return;

    try {
      await withProgress(manager, `Editing note for ${ref}`, () =>
        repo.notesEdit(ref, message)
      );
      vscode.window.showInformationMessage(`Note updated for ${ref}.`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to edit note: ${errMsg(e)}`);
    }
  });

  // Remove note
  reg("vsgit.notes.remove", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) return;

    const ref = await vscode.window.showInputBox({
      prompt: "Enter commit SHA or ref to remove note from",
      placeHolder: "HEAD",
      value: "HEAD",
    });
    if (!ref) return;

    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.DISCARD_CHANGES,
      message: `Remove note from ${ref}?`,
    });
    if (!confirmed) return;

    try {
      await withProgress(manager, `Removing note from ${ref}`, () =>
        repo.notesRemove(ref)
      );
      vscode.window.showInformationMessage(`Note removed from ${ref}.`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to remove note: ${errMsg(e)}`);
    }
  });

  // Show note
  reg("vsgit.notes.show", async (node: unknown) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) return;

    const ref = await vscode.window.showInputBox({
      prompt: "Enter commit SHA or ref to show note",
      placeHolder: "HEAD",
      value: "HEAD",
    });
    if (!ref) return;

    try {
      const note = await repo.notesShow(ref);
      if (!note) {
        vscode.window.showInformationMessage(`No note found for ${ref}.`);
        return;
      }

      // Show in untitled document
      const doc = await vscode.workspace.openTextDocument({
        content: note,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to show note: ${errMsg(e)}`);
    }
  });
}
