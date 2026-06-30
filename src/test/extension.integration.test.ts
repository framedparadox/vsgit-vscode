import * as assert from "node:assert";
import * as vscode from "vscode";

const extensionId = "framedparadox.vsgit-vscode";
let extension: vscode.Extension<unknown>;

suite("VsGit Extension Host", () => {
  suiteSetup(async () => {
    const candidate = vscode.extensions.getExtension(extensionId);
    assert.ok(candidate, `${extensionId} is installed in the test host`);
    extension = candidate;
    await extension.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("activates successfully in a real Extension Host", () => {
    assert.strictEqual(extension.isActive, true);
  });

  test("registers every contributed command", async () => {
    const contributed = (
      extension.packageJSON.contributes?.commands as
        | Array<{ command: string }>
        | undefined
    )?.map((entry) => entry.command) ?? [];
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter((command) => !registered.has(command));

    assert.ok(contributed.length > 150, "expected the full VsGit command surface");
    assert.deepStrictEqual(missing, []);
  });

  test("refreshes repository discovery without an activation error", async () => {
    await vscode.commands.executeCommand("vsgit.repositories.refresh");
  });

  test("opens the full documentation webview", async () => {
    await vscode.commands.executeCommand("vsgit.documentation.open");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});
