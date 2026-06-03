import * as path from "node:path";
import * as vscode from "vscode";
import { AskpassServer } from "./AskpassServer";

/**
 * Runs a transport operation with an askpass server wired up so HTTPS
 * credential prompts surface as VS Code input boxes. The server lives only for
 * the duration of the operation. SSH/credential-helper auth is unaffected.
 */
export class Credentials {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private get shimPath(): string {
    return path.join(this.context.extensionPath, "resources", "askpass.js");
  }

  /** Provide askpass env to `fn`, disposing the server afterward. */
  async withAskpass<T>(
    fn: (env: NodeJS.ProcessEnv) => Promise<T>,
  ): Promise<T> {
    const server = new AskpassServer();
    try {
      return await fn(server.env(this.shimPath));
    } finally {
      server.dispose();
    }
  }
}
