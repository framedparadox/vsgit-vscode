import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { EgitNode } from "../views/RepositoriesProvider";
import { configHtml } from "../webviews/configHtml";
import { resolveRepo, errMsg } from "./shared";

type Scope = "local" | "global" | "system";

/** Opens the git config editor webview for the active repository. */
export function registerConfigCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const openConfig = async (node?: EgitNode) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) return;
    openConfigEditor(repo, manager);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("egit.config.open", openConfig),
    // Phase 9 alias — "openPanel" is the name referenced in the plan
    vscode.commands.registerCommand("egit.config.openPanel", openConfig),
  );
}

function openConfigEditor(repo: Repository, manager: RepositoryManager): void {
  const panel = vscode.window.createWebviewPanel(
    "egit.config",
    `Git Config: ${repo.name}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = configHtml(makeNonce(), panel.webview.cspSource);

  const load = async (scope: Scope) => {
    const entries = await repo.listConfig(scope);
    panel.webview.postMessage({ type: "entries", scope, entries });
  };

  panel.webview.onDidReceiveMessage(async (m) => {
    try {
      if (m.type === "load") {
        await load(m.scope as Scope);
      } else if (m.type === "set") {
        await repo.setConfig(m.scope as "local" | "global", m.key, m.value);
        await load(m.scope as Scope);
        await manager.refreshAll();
      } else if (m.type === "unset") {
        await repo.unsetConfig(m.scope as "local" | "global", m.key);
        await load(m.scope as Scope);
        await manager.refreshAll();
      } else if (m.type === "loadRemotes") {
        panel.webview.postMessage({ type: "remotes", remotes: repo.remotes });
      } else if (m.type === "addRemote") {
        await repo.addRemote(m.name as string, m.url as string);
        await manager.refreshAll();
        panel.webview.postMessage({ type: "remotes", remotes: repo.remotes });
      } else if (m.type === "removeRemote") {
        await repo.removeRemote(m.name as string);
        await manager.refreshAll();
        panel.webview.postMessage({ type: "remotes", remotes: repo.remotes });
      } else if (m.type === "loadExtensionSettings") {
        const cfg = vscode.workspace.getConfiguration("egit");
        panel.webview.postMessage({
          type: "extensionSettings",
          settings: {
            "autoFetch.enabled": cfg.get<boolean>("autoFetch.enabled", false),
            "autoFetch.intervalMinutes": cfg.get<number>("autoFetch.intervalMinutes", 3),
            "confirmDestructiveActions": cfg.get<boolean>("confirmDestructiveActions", true),
            "defaultPullMode": cfg.get<string>("defaultPullMode", "merge"),
          },
        });
      } else if (m.type === "setExtensionSetting") {
        await vscode.workspace
          .getConfiguration("egit")
          .update(m.key as string, m.value, vscode.ConfigurationTarget.Global);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Config update failed: ${errMsg(e)}`);
    }
  });
}

function makeNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
