import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const vsixPath = resolve(process.argv[2] ?? "artifacts/vsgit-vscode.vsix");
const rootManifest = JSON.parse(readFileSync("package.json", "utf8"));

function unzip(args) {
  const result = spawnSync("unzip", args, { encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    throw new Error("VSIX verification requires the standard `unzip` command.");
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `unzip ${args.join(" ")} failed`);
  }
  return result.stdout;
}

const entries = unzip(["-Z1", vsixPath])
  .split(/\r?\n/)
  .filter(Boolean);
const entrySet = new Set(entries);
const required = [
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/dist/extension.js",
  "extension/readme.md",
  "extension/LICENSE.txt",
  "extension/resources/icon.svg",
  // Node shims git spawns at runtime: credential prompts and interactive rebase.
  "extension/webview-ui/shared/askpass.js",
  "extension/webview-ui/shared/sequence-editor.js",
  "extension/webview-ui/shared/codicon.css",
  "extension/webview-ui/shared/codicon.ttf",
  "extension/webview-ui/shared/seti.css",
  "extension/webview-ui/shared/seti.woff",
  "extension/webview-ui/shared/setiIcons.js",
  "extension/webview-ui/commit/commit.css",
  "extension/webview-ui/commit/commit.js",
  "extension/webview-ui/commit/commitView.js",
  "extension/webview-ui/graph/graph.css",
  "extension/webview-ui/graph/graph.js",
  "extension/webview-ui/graph/graphLayout.js",
  "extension/webview-ui/documentation/documentation.js",
  "extension/webview-ui/documentation/documentation.css",
];
const forbiddenPrefixes = [
  "extension/src/",
  "extension/out/",
  "extension/out-test/",
  "extension/out-integration/",
  "extension/artifacts/",
  "extension/.github/",
  "extension/scripts/",
];

for (const entry of required) {
  if (!entrySet.has(entry)) {
    throw new Error(`Required VSIX entry is missing: ${entry}`);
  }
}
for (const entry of entries) {
  if (
    forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)) ||
    entry.endsWith(".test.js") ||
    entry.endsWith(".test.ts")
  ) {
    throw new Error(`Development-only file leaked into VSIX: ${entry}`);
  }
}

const packagedManifest = JSON.parse(
  unzip(["-p", vsixPath, "extension/package.json"]),
);
if (packagedManifest.name !== rootManifest.name) {
  throw new Error(
    `Packaged name ${packagedManifest.name} does not match ${rootManifest.name}`,
  );
}
if (packagedManifest.publisher !== rootManifest.publisher) {
  throw new Error(
    `Packaged publisher ${packagedManifest.publisher} does not match ${rootManifest.publisher}`,
  );
}
if (packagedManifest.version !== rootManifest.version) {
  throw new Error(
    `Packaged version ${packagedManifest.version} does not match ${rootManifest.version}`,
  );
}

// This verifier is the stable release gate; packaging with `--pre-release`
// must never produce an artifact that passes it accidentally.
const vsixManifest = unzip(["-p", vsixPath, "extension.vsixmanifest"]);
const preReleaseProperty = vsixManifest
  .match(/<Property\b[^>]*>/gi)
  ?.find(
    (property) =>
      /\bId\s*=\s*["']Microsoft\.VisualStudio\.Code\.PreRelease["']/i.test(
        property,
      ) && /\bValue\s*=\s*["']true["']/i.test(property),
  );
if (preReleaseProperty) {
  throw new Error("VSIX is marked as a pre-release extension.");
}

const sizeMiB = statSync(vsixPath).size / (1024 * 1024);
if (sizeMiB > 10) {
  throw new Error(`VSIX is unexpectedly large: ${sizeMiB.toFixed(2)} MiB`);
}

console.log(
  `Verified ${rootManifest.publisher}.${rootManifest.name}@${rootManifest.version}: ` +
    `${entries.length} files, ${sizeMiB.toFixed(2)} MiB`,
);
