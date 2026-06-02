import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { safeEqual } from "./token";

export interface EditRequest {
  kind: "sequence" | "commit";
  content: string;
}

/** Resolve edited content, or undefined to cancel the git operation. */
export type EditHandler = (req: EditRequest) => Promise<string | undefined>;

/**
 * IPC server the editor shim connects back to. Listens on a unix socket
 * (POSIX) or named pipe (Windows). For each connection it reads one JSON
 * request, invokes the handler (which shows a webview), and writes the result.
 */
export class EditorServer implements vscode.Disposable {
  readonly sockPath: string;
  private readonly server: net.Server;
  /**
   * Per-session secret. The socket/pipe name is enumerable, so the shim must
   * echo this token (handed to it only via the child environment) before we
   * accept rebase-todo / commit-message content — otherwise a local process
   * could inject or read what git is editing.
   */
  private readonly token = crypto.randomBytes(32).toString("hex");

  constructor(private readonly handler: EditHandler) {
    this.sockPath = EditorServer.makeSocketPath();
    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.listen(this.sockPath);
  }

  /** Env vars to inject so `git rebase -i` routes editors back here. */
  editorEnv(shimPath: string): NodeJS.ProcessEnv {
    // Quote the shim path so paths with spaces work in git's editor parsing.
    const cmd = `"${process.execPath}" "${shimPath}"`;
    return {
      VSGIT_IPC_SOCK: this.sockPath,
      VSGIT_IPC_TOKEN: this.token,
      GIT_SEQUENCE_EDITOR: cmd,
      GIT_EDITOR: cmd,
    };
  }

  private onConnection(socket: net.Socket): void {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      // Bound the buffer so a peer that never sends a newline can't grow memory.
      if (buf.length > 8 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      const nl = buf.indexOf("\n");
      if (nl === -1) {
        return;
      }
      const line = buf.slice(0, nl);
      void this.respond(socket, line);
    });
    socket.on("error", () => socket.destroy());
  }

  private async respond(socket: net.Socket, line: string): Promise<void> {
    let edited: string | undefined;
    let authed = false;
    try {
      const req = JSON.parse(line) as {
        kind: EditRequest["kind"];
        content_b64: string;
        token?: string;
      };
      if (typeof req.token !== "string" || !safeEqual(req.token, this.token)) {
        socket.write(JSON.stringify({ ok: false }) + "\n");
        return;
      }
      authed = true;
      const content = Buffer.from(req.content_b64, "base64").toString("utf8");
      edited = await this.handler({ kind: req.kind, content });
    } catch {
      edited = undefined;
    }
    if (!authed) {
      return;
    }
    const resp =
      edited === undefined
        ? { ok: false }
        : { ok: true, content_b64: Buffer.from(edited, "utf8").toString("base64") };
    socket.write(JSON.stringify(resp) + "\n");
  }

  private static makeSocketPath(): string {
    const id = crypto.randomBytes(8).toString("hex");
    if (process.platform === "win32") {
      return `\\\\.\\pipe\\vsgit-${id}`;
    }
    return path.join(os.tmpdir(), `vsgit-${id}.sock`);
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
