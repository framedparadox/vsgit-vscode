/*
 * Credential helper invoked by git as GIT_ASKPASS during clone/fetch/push.
 *
 * Git runs:  node askpass.js "Username for 'https://host': "
 * We forward the prompt to the extension over the IPC socket (EGIT_ASKPASS_SOCK)
 * and print the user's answer on stdout, which git consumes.
 *
 * Plain CommonJS, node built-ins only — runs OUTSIDE the VS Code process.
 */
const net = require("node:net");

const prompt = process.argv[2] || "";
const sockPath = process.env.EGIT_ASKPASS_SOCK;
const token = process.env.EGIT_ASKPASS_TOKEN;

if (!sockPath || !token) {
  process.exit(1);
}

const socket = net.connect(sockPath, () => {
  // The token authenticates us to the extension's IPC server.
  socket.write(JSON.stringify({ prompt, token }) + "\n");
});

let buf = "";
socket.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  const nl = buf.indexOf("\n");
  if (nl === -1) {
    return;
  }
  socket.end();
  let resp;
  try {
    resp = JSON.parse(buf.slice(0, nl));
  } catch {
    process.exit(1);
  }
  if (!resp || resp.ok !== true) {
    process.exit(1);
  }
  process.stdout.write(resp.value);
  process.exit(0);
});

socket.on("error", () => process.exit(1));
