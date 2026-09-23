import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { VsgitNode } from "../views/RepositoriesProvider";
import { Credentials } from "../util/credentials";
import { resolveRepo, withProgress } from "./shared";
import { confirmDestructiveAction, DestructiveOperations } from "../util/confirmation";
import { runSequencerAction } from "./interactiveRebase";

/** Fetch / Pull / Push (with a push dialog) plus merge and rebase. */
export function registerTransportCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  const creds = new Credentials(context);

  reg("vsgit.fetch", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    const remote = await pickRemote(repo, true);
    if (remote === undefined) {
      return;
    }
    const prune = vscode.workspace
      .getConfiguration("vsgit")
      .get<boolean>("fetch.pruneOnFetch", true);
    await withProgress(manager, "Fetch", () =>
      creds.withAskpass((env) =>
        repo.fetch(remote === "<all>" ? undefined : remote, {
          all: remote === "<all>",
          prune,
          tags: true,
          env,
        }),
      ),
    );
  });

  reg("vsgit.pull", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    const defaultMode = vscode.workspace
      .getConfiguration("vsgit")
      .get<string>("defaultPullMode", "merge");
    // A single-select quick pick ignores `picked`, so list the configured
    // default first to make Enter choose it.
    const strategies = [
      { label: "Merge", description: defaultMode !== "rebase" ? "default" : undefined },
      { label: "Rebase", description: defaultMode === "rebase" ? "default" : undefined },
      { label: "Fast-forward only", description: "--ff-only" },
    ];
    if (defaultMode === "rebase") {
      [strategies[0], strategies[1]] = [strategies[1], strategies[0]];
    }
    const mode = await vscode.window.showQuickPick(strategies, {
      placeHolder: "Pull strategy",
    });
    if (!mode) {
      return;
    }
    await withProgress(manager, "Pull", () =>
      creds.withAskpass((env) =>
        repo.pull({
          rebase: mode.label === "Rebase",
          ffOnly: mode.label === "Fast-forward only",
          env,
        }),
      ),
    );
  });

  reg("vsgit.push", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    await pushDialog(manager, creds, repo);
  });

  reg("vsgit.merge", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    const ref = await pickMergeSource(repo, node as VsgitNode);
    if (!ref) {
      return;
    }
    const ffMode = await vscode.window.showQuickPick(
      [
        { label: "Default (fast-forward when possible)", key: "default" },
        { label: "No fast-forward (--no-ff)", key: "noFf" },
        { label: "Fast-forward only (--ff-only)", key: "ffOnly" },
        { label: "Squash (--squash)", key: "squash" },
      ],
      { placeHolder: `Merge ${ref} into ${repo.headName}` },
    );
    if (!ffMode) {
      return;
    }
    const opts: Record<string, boolean> = {};
    if (ffMode.key !== "default") {
      opts[ffMode.key] = true;
    }
    await withProgress(manager, `Merge ${ref}`, () => repo.merge(ref, opts));
  });

  reg("vsgit.rebase", async (node) => {
    const repo = await resolveRepo(manager, node as VsgitNode);
    if (!repo) {
      return;
    }
    const onto = await pickMergeSource(repo, node as VsgitNode, "Rebase onto");
    if (!onto) {
      return;
    }
    await withProgress(manager, `Rebase onto ${onto}`, () =>
      repo.rebase(onto),
    );
  });

  // Sequencer controls (rebase/merge in progress).
  reg("vsgit.rebase.continue", (node) => seq(manager, node, "rebase", "continue"));
  reg("vsgit.rebase.skip", (node) => seq(manager, node, "rebase", "skip"));
  reg("vsgit.rebase.abort", (node) => seq(manager, node, "rebase", "abort"));
  reg("vsgit.merge.abort", (node) => seq(manager, node, "merge", "abort"));
}

async function seq(
  manager: RepositoryManager,
  node: unknown,
  kind: "rebase" | "merge",
  action: "continue" | "skip" | "abort",
): Promise<void> {
  const repo = await resolveRepo(manager, node as VsgitNode);
  if (!repo) {
    return;
  }
  await withProgress(manager, `${kind} --${action}`, () =>
    runSequencerAction(repo, kind, action),
  );
}

async function pushDialog(
  manager: RepositoryManager,
  creds: Credentials,
  repo: Repository,
): Promise<void> {
  const remote = await pickRemote(repo, false);
  if (remote === undefined || remote === "<all>") {
    return;
  }
  const branch = currentBranch(repo);
  if (!branch) {
    vscode.window.showWarningMessage(
      "HEAD is detached. Check out a branch (or create one here) before pushing.",
    );
    return;
  }
  const flags = await vscode.window.showQuickPick(
    [
      { label: "Set upstream (-u)", key: "setUpstream", picked: true },
      { label: "Push tags (--tags)", key: "tags", picked: false },
      { label: "Force with lease (--force-with-lease)", key: "forceWithLease", picked: false },
      { label: "Force (--force)", key: "force", picked: false },
    ],
    { canPickMany: true, placeHolder: `Push ${branch} → ${remote}` },
  );
  if (flags === undefined) {
    return;
  }
  const opts: {
    remote: string;
    refspec?: string;
    setUpstream?: boolean;
    force?: boolean;
    forceWithLease?: boolean;
    tags?: boolean;
    env?: NodeJS.ProcessEnv;
  } = { remote, refspec: repo.pushRefspec(branch, remote) };
  const selected = new Set(flags.map((f) => f.key));
  opts.setUpstream = selected.has("setUpstream");
  opts.tags = selected.has("tags");
  opts.forceWithLease = selected.has("forceWithLease");
  opts.force = selected.has("force");
  if (opts.forceWithLease || opts.force) {
    const confirmed = await confirmDestructiveAction({
      operation: DestructiveOperations.FORCE_PUSH,
      message: opts.forceWithLease
        ? `Force push with lease to ${remote}?`
        : `Force push to ${remote}? This can overwrite remote history.`,
    });
    if (!confirmed) {
      return;
    }
  }
  await withProgress(manager, `Push to ${remote}`, () =>
    creds.withAskpass((env) => repo.push({ ...opts, env })),
  );
}

/** The checked-out branch name, or undefined when HEAD is detached. */
function currentBranch(repo: Repository): string | undefined {
  return repo.localBranches.find((b) => b.isHead)?.shortName;
}

async function pickRemote(
  repo: Repository,
  allowAll: boolean,
): Promise<string | undefined> {
  if (repo.remotes.length === 0) {
    vscode.window.showWarningMessage("No remotes configured.");
    return undefined;
  }
  const items = repo.remotes.map((r) => r.name);
  if (allowAll && repo.remotes.length > 1) {
    items.unshift("<all>");
  }
  if (items.length === 1) {
    return items[0];
  }
  return vscode.window.showQuickPick(items, { placeHolder: "Select remote" });
}

/** Pick a branch/ref to merge or rebase. Defaults from the clicked node. */
async function pickMergeSource(
  repo: Repository,
  node: VsgitNode,
  placeHolder = "Select branch to merge",
): Promise<string | undefined> {
  if (node && node.type === "branch") {
    return node.ref.shortName;
  }
  const refs = [
    ...repo.localBranches.map((b) => b.shortName),
    ...repo.remoteBranches.map((b) => b.shortName),
  ];
  return vscode.window.showQuickPick(refs, { placeHolder });
}
