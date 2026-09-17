import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out-integration/**/*.test.js",
  version: "stable",
  workspaceFolder: ".",
  launchArgs: ["--disable-extensions", "--disable-workspace-trust"],
  mocha: {
    timeout: 30_000,
  },
});
