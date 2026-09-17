import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { VsgitNode } from "../views/RepositoriesProvider";
import { configHtml } from "../webviews/configHtml";
import { resolveRepo, errMsg } from "./shared";
import { makeNonce } from "../util/token";
import { redactRemoteUrl } from "../git/argGuard";

type Scope = "local" | "global" | "system";
type WritableScope = Exclude<Scope, "system">;

const BOOLEAN_EXTENSION_SETTINGS = new Set([
  "autoRefresh",
  "autoFetch.enabled",
  "autoFetch.notify",
  "confirmDestructiveActions",
]);
const PULL_MODES = new Set(["merge", "rebase"]);

/** Opens the git config editor webview for the active repository. */
export function registerConfigCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const openConfig = async (node?: VsgitNode) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) return;
    openConfigEditor(repo, manager);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("vsgit.config.open", openConfig),
    // Phase 9 alias — "openPanel" is the name referenced in the plan
    vscode.commands.registerCommand("vsgit.config.openPanel", openConfig),
  );
}

function openConfigEditor(repo: Repository, manager: RepositoryManager): void {
  const panel = vscode.window.createWebviewPanel(
    "vsgit.config",
    `Git Config: ${repo.name}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
  );
  panel.webview.html = configHtml(makeNonce(), panel.webview.cspSource);

  const load = async (scope: Scope) => {
    const entries = await repo.listConfig(scope);
    panel.webview.postMessage({ type: "entries", scope, entries });
  };

  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    try {
      const m = messageRecord(message);
      if (m.type === "load") {
        const scope = gitScope(m.scope);
        if (scope) await load(scope);
      } else if (m.type === "set") {
        const scope = writableScope(m.scope);
        const key = requiredString(m.key, "config key");
        const value = requiredString(m.value, "config value", true);
        await repo.setConfig(scope, key, value);
        await load(scope);
        await manager.refreshAll();
      } else if (m.type === "unset") {
        const scope = writableScope(m.scope);
        await repo.unsetConfig(scope, requiredString(m.key, "config key"));
        await load(scope);
        await manager.refreshAll();
      } else if (m.type === "loadRemotes") {
        panel.webview.postMessage({ type: "remotes", remotes: displayRemotes(repo) });
      } else if (m.type === "addRemote") {
        await repo.addRemote(
          requiredString(m.name, "remote name"),
          requiredString(m.url, "remote URL"),
        );
        await manager.refreshAll();
        panel.webview.postMessage({ type: "remotes", remotes: displayRemotes(repo) });
      } else if (m.type === "removeRemote") {
        await repo.removeRemote(requiredString(m.name, "remote name"));
        await manager.refreshAll();
        panel.webview.postMessage({ type: "remotes", remotes: displayRemotes(repo) });
      } else if (m.type === "loadExtensionSettings") {
        const cfg = vscode.workspace.getConfiguration("vsgit");
        panel.webview.postMessage({
          type: "extensionSettings",
          settings: {
            "autoRefresh": cfg.get<boolean>("autoRefresh", true),
            "autoFetch.enabled": cfg.get<boolean>("autoFetch.enabled", false),
            "autoFetch.intervalMinutes": cfg.get<number>("autoFetch.intervalMinutes", 3),
            "autoFetch.notify": cfg.get<boolean>("autoFetch.notify", true),
            "confirmDestructiveActions": cfg.get<boolean>("confirmDestructiveActions", true),
            "defaultPullMode": cfg.get<string>("defaultPullMode", "merge"),
          },
        });
      } else if (m.type === "setExtensionSetting") {
        const setting = validatedExtensionSetting(m.key, m.value);
        await vscode.workspace
          .getConfiguration("vsgit")
          .update(setting.key, setting.value, vscode.ConfigurationTarget.Global);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Config update failed: ${errMsg(e)}`);
    }
  });
}

function displayRemotes(repo: Repository): Repository["remotes"] {
  return repo.remotes.map((remote) => ({
    ...remote,
    fetchUrl: remote.fetchUrl ? redactRemoteUrl(remote.fetchUrl) : undefined,
    pushUrl: remote.pushUrl ? redactRemoteUrl(remote.pushUrl) : undefined,
  }));
}

function messageRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid webview message.");
  }
  return value as Record<string, unknown>;
}

function gitScope(value: unknown): Scope | undefined {
  return value === "local" || value === "global" || value === "system"
    ? value
    : undefined;
}

function writableScope(value: unknown): WritableScope {
  if (value !== "local" && value !== "global") {
    throw new Error("Only local and global Git configuration can be modified.");
  }
  return value;
}

function requiredString(
  value: unknown,
  label: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

/**
 * The config webview is an IPC boundary. Keep its writable setting surface
 * explicit so a malformed message cannot update arbitrary extension settings.
 */
function validatedExtensionSetting(
  key: unknown,
  value: unknown,
): { key: string; value: boolean | number | string } {
  if (typeof key !== "string") {
    throw new Error("Invalid extension setting.");
  }
  if (BOOLEAN_EXTENSION_SETTINGS.has(key) && typeof value === "boolean") {
    return { key, value };
  }
  if (
    key === "autoFetch.intervalMinutes" &&
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 60
  ) {
    return { key, value };
  }
  if (key === "defaultPullMode" && typeof value === "string" && PULL_MODES.has(value)) {
    return { key, value };
  }
  throw new Error(`Unsupported value for vsgit.${key}.`);
}
