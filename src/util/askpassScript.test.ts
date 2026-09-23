import { test } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { ASKPASS_LAUNCHER_SCRIPT, isSecretPrompt } from "./askpassScript";

test("isSecretPrompt masks everything except usernames and yes/no questions", () => {
  assert.strictEqual(isSecretPrompt("Password for 'https://alice@example.com': "), true);
  assert.strictEqual(isSecretPrompt("Enter passphrase for key '/home/a/.ssh/id_ed25519': "), true);
  assert.strictEqual(isSecretPrompt("Passwort für 'https://example.com': "), true);
  assert.strictEqual(isSecretPrompt("Username for 'https://example.com': "), false);
  assert.strictEqual(
    isSecretPrompt("Are you sure you want to continue connecting (yes/no/[fingerprint])? "),
    false,
  );
});

test(
  "git runs the askpass launcher and receives credentials from the shim",
  { skip: process.platform === "win32" ? "POSIX launcher test" : false },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsgit askpass test-"));
    const launcher = path.join(dir, "askpass.sh");
    fs.writeFileSync(launcher, ASKPASS_LAUNCHER_SCRIPT, { mode: 0o700 });
    const sock = path.join(dir, "ipc.sock");
    const prompts: string[] = [];
    const server = net.createServer((socket) => {
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        const req = JSON.parse(buf.slice(0, nl)) as { prompt: string; token: string };
        prompts.push(req.prompt);
        const value = /Username/.test(req.prompt) ? "alice" : "s3cret";
        socket.write(JSON.stringify({ ok: req.token === "tok", value }) + "\n");
      });
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn("git", ["-c", "credential.helper=", "credential", "fill"], {
          env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: os.devNull,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: launcher,
            VSGIT_ASKPASS_NODE: process.execPath,
            VSGIT_ASKPASS_MAIN: path.resolve("webview-ui/shared/askpass.js"),
            VSGIT_ASKPASS_SOCK: sock,
            VSGIT_ASKPASS_TOKEN: "tok",
          },
        });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}`))));
        child.stdin.end("protocol=https\nhost=example.com\n\n");
      });
      assert.match(output, /^username=alice$/m);
      assert.match(output, /^password=s3cret$/m);
      assert.strictEqual(prompts.length, 2);
    } finally {
      server.close();
    }
  },
);
