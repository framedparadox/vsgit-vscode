import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { AutoFetchService } from "../services/AutoFetchService";

export function registerAutoFetchCommands(
  context: vscode.ExtensionContext,
  _manager: RepositoryManager,
  service: AutoFetchService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("egit.autoFetch.fetchNow", () =>
      service.fetchAllNow(true),
    ),
  );
}
