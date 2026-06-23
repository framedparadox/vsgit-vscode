import * as vscode from "vscode";

export async function shouldRunGitCommand(
  args: string[],
  cwd: string,
  gitPath = "git",
): Promise<boolean> {
  const enabled = vscode.workspace
    .getConfiguration("vsgit")
    .get<boolean>("showCommandPreview", false);
  if (!enabled) {
    return true;
  }
  if (isReadOnlyGitCommand(args)) {
    return true;
  }

  const command = [gitPath || "git", ...args].map(quoteArg).join(" ");
  const result = await vscode.window.showWarningMessage(
    `Run this Git command?\n\n${command}\n\nWorking directory:\n${cwd}`,
    { modal: true },
    "Execute",
    "Cancel",
  );
  return result === "Execute";
}

function isReadOnlyGitCommand(args: string[]): boolean {
  const command = args[0];
  if (!command) {
    return true;
  }
  if (
    [
      "rev-parse",
      "status",
      "for-each-ref",
      "symbolic-ref",
      "log",
      "reflog",
      "diff",
      "show",
      "describe",
      "blame",
      "fsck",
    ].includes(command)
  ) {
    return true;
  }
  if (command === "remote" && args[1] === "-v") {
    return true;
  }
  if (command === "branch" && (args.includes("--contains") || args.includes("-a"))) {
    return true;
  }
  if (command === "tag" && args.some((arg) => arg.startsWith("--contains"))) {
    return true;
  }
  if (command === "config" && args.includes("--list")) {
    return true;
  }
  if (command === "stash" && (args[1] === "list" || args[1] === "show")) {
    return true;
  }
  if (command === "submodule" && args[1] === "status") {
    return true;
  }
  if (command === "worktree" && args[1] === "list") {
    return true;
  }
  if (command === "notes" && args[1] === "show") {
    return true;
  }
  if (command === "lfs" && ["ls-files", "locks"].includes(args[1] ?? "")) {
    return true;
  }
  return false;
}

function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=@{}~+,-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
