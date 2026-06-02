import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as vscode from "vscode";

/**
 * IPC server the askpass shim connects back to. For each prompt git issues
 * (username / password / passphrase) it asks the user via an input box and
 * returns the answer. Passwords are masked.
 */
export class AskpassServer implements vscode.Disposable {
  readonly sockPath: string;
  private readonly server: net.Server;

  constructor() {
    this.sockPath = AskpassServer.makeSocketPath();
    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.listen(this.sockPath);
  }

  /** Env vars that route git credential prompts back here via the shim. */
  env(shimPath: string): NodeJS.ProcessEnv {
    return {
      EGIT_ASKPASS_SOCK: this.sockPath,
      GIT_ASKPASS: `"${process.execPath}" "${shimPath}"`,
      // Never fall back to a blocking terminal prompt.
      GIT_TERMINAL_PROMPT: "0",
    };
  }

  private onConnection(socket: net.Socket): void {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) {
        return;
      }
      void this.respond(socket, buf.slice(0, nl));
    });
    socket.on("error", () => socket.destroy());
  }

  private async respond(socket: net.Socket, line: string): Promise<void> {
    let value: string | undefined;
    try {
      const { prompt } = JSON.parse(line) as { prompt: string };
      const isSecret = /password|passphrase/i.test(prompt);
      value = await vscode.window.showInputBox({
        prompt: prompt.trim() || "Git credentials",
        password: isSecret,
        ignoreFocusOut: true,
      });
    } catch {
      value = undefined;
    }
    const resp =
      value === undefined ? { ok: false } : { ok: true, value };
    socket.write(JSON.stringify(resp) + "\n");
  }

  private static makeSocketPath(): string {
    const id = crypto.randomBytes(8).toString("hex");
    if (process.platform === "win32") {
      return `\\\\.\\pipe\\egit-askpass-${id}`;
    }
    return path.join(os.tmpdir(), `egit-askpass-${id}.sock`);
  }

  dispose(): void {
    this.server.close();
    if (process.platform !== "win32") {
      try {
        require("node:fs").unlinkSync(this.sockPath);
      } catch {
        // already gone
      }
    }
  }
}
