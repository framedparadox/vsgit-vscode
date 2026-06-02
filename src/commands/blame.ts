import * as vscode from "vscode";
import { BlameController } from "../decorations/BlameController";

/** Register the inline-blame toggle command. */
export function registerBlameCommands(
  context: vscode.ExtensionContext,
  blame: BlameController,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("egit.blame.toggle", () => blame.toggle()),
  );
}
