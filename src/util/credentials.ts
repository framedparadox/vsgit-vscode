import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { AskpassHelper, AskpassServer, ASKPASS_LAUNCHER_SCRIPT } from "./AskpassServer";

let helperPromise: Promise<AskpassHelper> | undefined;

/**
 * Materialise the askpass launcher in the extension's global storage (always
 * writable, unlike the installed extension folder) and return the helper
 * paths.
 *
 * Every VS Code window shares that folder, and another window's git may be
 * executing the launcher right now, so it is only replaced when its content
 * changed (an upgrade), and then atomically via rename — never truncated in
 * place.
 */
export function askpassHelper(context: vscode.ExtensionContext): Promise<AskpassHelper> {
  if (!helperPromise) {
    const main = path.join(context.extensionPath, "webview-ui", "shared", "askpass.js");
    const dir = context.globalStorageUri.fsPath;
    const launcher = path.join(dir, "askpass.sh");
    helperPromise = (async () => {
      const current = await fs.readFile(launcher, "utf8").catch(() => undefined);
      if (current !== ASKPASS_LAUNCHER_SCRIPT) {
        await fs.mkdir(dir, { recursive: true });
        const temp = `${launcher}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temp, ASKPASS_LAUNCHER_SCRIPT, { mode: 0o700 });
        await fs.rename(temp, launcher);
      }
      // Make sure it is executable even if an earlier copy lost its mode.
      await fs.chmod(launcher, 0o700);
      return { launcher, main };
    })();
    // Let a failed write be retried by the next caller.
    helperPromise.catch(() => {
      helperPromise = undefined;
    });
  }
  return helperPromise;
}

/**
 * Runs a transport operation with an askpass server wired up so HTTPS
 * credential prompts surface as VS Code input boxes. The server lives only for
 * the duration of the operation. SSH/credential-helper auth is unaffected.
 */
export class Credentials {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Provide askpass env to `fn`, disposing the server afterward. */
  async withAskpass<T>(
    fn: (env: NodeJS.ProcessEnv) => Promise<T>,
  ): Promise<T> {
    const server = new AskpassServer();
    try {
      const [helper] = await Promise.all([askpassHelper(this.context), server.ready]);
      return await fn(server.env(helper));
    } finally {
      server.dispose();
    }
  }
}
