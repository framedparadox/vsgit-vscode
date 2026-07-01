import * as path from "node:path";
import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { VsgitNode } from "../views/RepositoriesProvider";
import { EditorServer, EditRequest } from "../util/EditorServer";
import { rebaseTodoHtml } from "../webviews/rebaseTodoHtml";
import { editTextHtml } from "../webviews/editTextHtml";
import {
  parseRebaseTodo,
  serializeRebaseTodo,
  RebaseTodoItem,
} from "../git/parsers/rebaseTodo";
import { resolveRepo, withProgress, errMsg } from "./shared";
import { makeNonce } from "../util/token";

/**
 * Interactive rebase: start `git rebase -i <onto>` with our editor shim wired
 * via an EditorServer. The shim routes the todo file to a structured webview
 * and commit messages (reword/edit) to a text webview.
 */
export function registerInteractiveRebase(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const shimPath = path.join(
    context.extensionPath,
    "resources",
    "sequence-editor.js",
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vsgit.rebase.interactive",
      async (node?: VsgitNode) => {
        const repo = await resolveRepo(manager, node as VsgitNode);
        if (!repo) {
          return;
        }
        const onto = await pickOnto(repo, node as VsgitNode);
        if (!onto) {
          return;
        }
        await runInteractiveRebase(manager, repo, onto, shimPath);
      },
    ),
  );
}

async function pickOnto(
  repo: Repository,
  node: VsgitNode,
): Promise<string | undefined> {
  if (node && node.type === "branch") {
    return node.ref.shortName;
  }
  const items = [
    { label: "Rebase last N commits onto HEAD~N…", value: "__count__" },
    ...repo.localBranches.map((b) => ({ label: b.shortName, value: b.shortName })),
    ...repo.remoteBranches.map((b) => ({ label: b.shortName, value: b.shortName })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Rebase onto (base)",
  });
  if (!pick) {
    return undefined;
  }
  if (pick.value === "__count__") {
    const n = await vscode.window.showInputBox({
      prompt: "Number of commits back to rebase",
      validateInput: (v) =>
        /^\d+$/.test(v.trim()) && Number(v) > 0 ? undefined : "Enter a positive integer",
    });
    return n ? `HEAD~${n.trim()}` : undefined;
  }
  return pick.value;
}

async function runInteractiveRebase(
  manager: RepositoryManager,
  repo: Repository,
  onto: string,
  shimPath: string,
): Promise<void> {
  const handler = async (req: EditRequest): Promise<string | undefined> => {
    if (req.kind === "sequence") {
      return editTodo(req.content);
    }
    return editCommitMessage(req.content);
  };

  const server = new EditorServer(handler);
  try {
    await server.ready;
    const ok = await withProgress(manager, `Interactive rebase onto ${onto}`, () =>
      repo.rebase(onto, { interactive: true, env: server.editorEnv(shimPath) }),
    );
    if (ok) {
      const op = await repo.inProgressOperation();
      if (op === "rebase") {
        vscode.window.showInformationMessage(
          "Rebase stopped (edit/conflict). Use Rebase: Continue / Skip / Abort.",
        );
      } else {
        vscode.window.setStatusBarMessage("Interactive rebase complete", 3000);
      }
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Interactive rebase failed: ${errMsg(e)}`);
  } finally {
    server.dispose();
  }
}

/** Show the structured todo webview; resolve to serialized todo text or cancel. */
function editTodo(content: string): Promise<string | undefined> {
  const items = parseRebaseTodo(content);
  return showWebview<string>(
    "vsgit.rebaseTodo",
    "Interactive Rebase",
    (nonce, csp) => rebaseTodoHtml(nonce, csp),
    (panel, resolve) => {
      panel.webview.onDidReceiveMessage((m) => {
        if (m.type === "ready") {
          panel.webview.postMessage({ type: "init", items });
        } else if (m.type === "start") {
          resolve(serializeRebaseTodo(m.items as RebaseTodoItem[]));
          panel.dispose();
        } else if (m.type === "cancel") {
          resolve(undefined);
          panel.dispose();
        }
      });
    },
  );
}

/** Show the text webview for a reword/edit commit message. */
function editCommitMessage(content: string): Promise<string | undefined> {
  return showWebview<string>(
    "vsgit.rebaseMessage",
    "Edit Commit Message",
    (nonce, csp) => editTextHtml(nonce, csp),
    (panel, resolve) => {
      panel.webview.onDidReceiveMessage((m) => {
        if (m.type === "ready") {
          panel.webview.postMessage({ type: "init", text: content });
        } else if (m.type === "save") {
          resolve(m.text as string);
          panel.dispose();
        } else if (m.type === "cancel") {
          resolve(undefined);
          panel.dispose();
        }
      });
    },
  );
}

/**
 * Open a modal-ish webview panel and resolve when the wiring calls resolve().
 * If the user closes the panel without acting, resolve(undefined) (cancel).
 */
function showWebview<T>(
  viewType: string,
  title: string,
  html: (nonce: string, cspSource: string) => string,
  wire: (panel: vscode.WebviewPanel, resolve: (v: T | undefined) => void) => void,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    let settled = false;
    const done = (v: T | undefined) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    panel.webview.html = html(makeNonce(), panel.webview.cspSource);
    wire(panel, done);
    panel.onDidDispose(() => done(undefined));
  });
}
