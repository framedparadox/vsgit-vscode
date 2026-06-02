/*
 * Stand-alone editor shim invoked by git as GIT_SEQUENCE_EDITOR / GIT_EDITOR.
 *
 * Git runs:  node sequence-editor.js <file>
 * We connect to the extension's IPC server (path in VSGIT_IPC_SOCK), hand it the
 * file's current contents plus a "kind" derived from the filename, and block
 * until the extension returns the edited text (or signals cancellation).
 *
 * Plain CommonJS, node built-ins only — this runs OUTSIDE the VS Code process.
 */
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const file = process.argv[2];
const sockPath = process.env.VSGIT_IPC_SOCK;
const token = process.env.VSGIT_IPC_TOKEN;

if (!file || !sockPath || !token) {
  // No way to round-trip; leave the file untouched so git proceeds with defaults.
  process.exit(0);
}

const base = path.basename(file);
const kind = base === "git-rebase-todo" ? "sequence" : "commit";
const content = fs.readFileSync(file, "utf8");

const socket = net.connect(sockPath, () => {
  // The token authenticates us to the extension's IPC server.
  const req = JSON.stringify({ kind, token, content_b64: Buffer.from(content, "utf8").toString("base64") });
  socket.write(req + "\n");
});

let buf = "";
socket.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  const nl = buf.indexOf("\n");
  if (nl === -1) {
    return;
  }
  const line = buf.slice(0, nl);
  socket.end();
  let resp;
  try {
    resp = JSON.parse(line);
  } catch {
    process.exit(1);
  }
  if (!resp || resp.ok !== true) {
    // User cancelled — exit non-zero so git aborts the operation.
    process.exit(1);
  }
  const edited = Buffer.from(resp.content_b64, "base64").toString("utf8");
  fs.writeFileSync(file, edited);
  process.exit(0);
});

socket.on("error", () => process.exit(1));
