import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { safeEqual } from "./token";

/**
 * IPC server the askpass shim connects back to. For each prompt git issues
 * (username / password / passphrase) it asks the user via an input box and
 * returns the answer. Passwords are masked.
 */
export class AskpassServer implements vscode.Disposable {
  readonly sockPath: string;
  private readonly server: net.Server;
  /**
   * Per-session secret. The socket/pipe name is enumerable by other local
   * processes, so the name alone is not a credential — the shim must echo this
   * token (passed only via the child's environment) or the connection is
   * rejected, preventing a local process from phishing the user's credentials.
   */
  private readonly token = crypto.randomBytes(32).toString("hex");

  constructor() {
    this.sockPath = AskpassServer.makeSocketPath();
    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.listen(this.sockPath);
  }

  /** Env vars that route git credential prompts back here via the shim. */
  env(shimPath: string): NodeJS.ProcessEnv {
    return {
      VSGIT_ASKPASS_SOCK: this.sockPath,
      VSGIT_ASKPASS_TOKEN: this.token,
      GIT_ASKPASS: `"${process.execPath}" "${shimPath}"`,
      // Never fall back to a blocking terminal prompt.
      GIT_TERMINAL_PROMPT: "0",
    };
  }

  private onConnection(socket: net.Socket): void {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      // Bound the buffer so a peer that never sends a newline can't grow memory.
      if (buf.length > 64 * 1024) {
        socket.destroy();
        return;
      }
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
    let authed = false;
    try {
      const { prompt, token } = JSON.parse(line) as { prompt: string; token?: string };
      // Reject any connection that doesn't present this session's token.
      if (typeof token !== "string" || !safeEqual(token, this.token)) {
        socket.write(JSON.stringify({ ok: false }) + "\n");
        return;
      }
      authed = true;
      // Mask conservatively: treat every prompt as secret UNLESS it clearly asks
      // for a username, so a locale-translated "password" prompt is never echoed
      // back in cleartext.
      const isUsername = /username|user name|\blogin\b/i.test(prompt);
      value = await vscode.window.showInputBox({
        prompt: prompt.trim() || "Git credentials",
        password: !isUsername,
        ignoreFocusOut: true,
      });
    } catch {
      value = undefined;
    }
    if (!authed) {
      return;
    }
    const resp =
      value === undefined ? { ok: false } : { ok: true, value };
    socket.write(JSON.stringify(resp) + "\n");
  }

  private static makeSocketPath(): string {
    const id = crypto.randomBytes(8).toString("hex");
    if (process.platform === "win32") {
      return `\\\\.\\pipe\\vsgit-askpass-${id}`;
    }
    return path.join(os.tmpdir(), `vsgit-askpass-${id}.sock`);
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
