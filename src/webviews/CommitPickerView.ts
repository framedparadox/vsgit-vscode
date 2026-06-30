import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { Repository } from "../git/Repository";
import type { Commit } from "../git/parsers/log";
import { commitPickerHtml } from "./commitPickerHtml";

/**
 * Opens the "Select a Commit" webview panel and resolves with the selected
 * commit SHA, or undefined if the user cancelled.
 *
 * Usage:
 *   const sha = await CommitPickerView.pick(repo, context.extensionUri);
 */
export class CommitPickerView {
  static async pick(
    repo: Repository,
    extensionUri: vscode.Uri,
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        "vsgit.commitPicker",
        "Select a Commit",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, "resources")],
        },
      );

      const nonce = crypto.randomBytes(16).toString("hex");
      const codiconCssUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "resources", "codicon.css"),
      );
      panel.webview.html = commitPickerHtml(
        nonce,
        panel.webview.cspSource,
        codiconCssUri.toString(),
      );

      let resolved = false;

      const finish = (sha: string | undefined) => {
        if (!resolved) {
          resolved = true;
          resolve(sha);
          panel.dispose();
        }
      };

      panel.onDidDispose(() => finish(undefined));

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === "cancel") {
          finish(undefined);
          return;
        }
        if (msg.command === "pick") {
          finish(msg.sha as string);
          return;
        }
      });

      // Load commits and post to webview
      void loadCommits(repo, panel.webview);
    });
  }
}

async function loadCommits(
  repo: Repository,
  webview: vscode.Webview,
): Promise<void> {
  try {
    const commits = await repo.log({ limit: 500 });
    const data = commits.map((c: Commit) => ({
      sha:           c.sha,
      shortSha:      c.shortSha,
      parents:       c.parents,
      subject:       c.subject,
      authorName:    c.authorName,
      authorDate:    c.authorDate,
      committerName: c.committerName ?? c.authorName,
      committerDate: c.committerDate ?? c.authorDate,
      refs:          c.refs,
    }));
    void webview.postMessage({ command: "load", commits: data, repoName: repo.name });
  } catch {
    void webview.postMessage({ command: "load", commits: [], repoName: repo.name });
  }
}
