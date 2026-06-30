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
  "extension/package.json",
  "extension/dist/extension.js",
  "extension/readme.md",
  "extension/LICENSE.txt",
  "extension/resources/icon.svg",
  "extension/resources/documentation.js",
  "extension/resources/documentation.css",
];
const forbiddenPrefixes = [
  "extension/src/",
  "extension/out/",
  "extension/out-test/",
  "extension/out-integration/",
  "extension/archive/",
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

const sizeMiB = statSync(vsixPath).size / (1024 * 1024);
if (sizeMiB > 10) {
  throw new Error(`VSIX is unexpectedly large: ${sizeMiB.toFixed(2)} MiB`);
}

console.log(
  `Verified ${rootManifest.publisher}.${rootManifest.name}@${rootManifest.version}: ` +
    `${entries.length} files, ${sizeMiB.toFixed(2)} MiB`,
);
