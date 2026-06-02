import * as vscode from "vscode";
import { RepositoryManager } from "../git/RepositoryManager";
import { Repository } from "../git/Repository";
import { EgitNode } from "../views/RepositoriesProvider";
import { Credentials } from "../util/credentials";
import { resolveRepo, withProgress } from "./shared";

/** Fetch / Pull / Push (with a push dialog) plus merge and rebase. */
export function registerTransportCommands(
  context: vscode.ExtensionContext,
  manager: RepositoryManager,
): void {
  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  const creds = new Credentials(context);

  reg("egit.fetch", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) {
      return;
    }
    const remote = await pickRemote(repo, true);
    if (remote === undefined) {
      return;
    }
    await withProgress(manager, "Fetch", () =>
      creds.withAskpass((env) =>
        repo.fetch(remote === "<all>" ? undefined : remote, {
          all: remote === "<all>",
          prune: true,
          tags: true,
          env,
        }),
      ),
    );
  });

  reg("egit.pull", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) {
      return;
    }
    const mode = await vscode.window.showQuickPick(["Merge", "Rebase"], {
      placeHolder: "Pull strategy",
    });
    if (!mode) {
      return;
    }
    await withProgress(manager, "Pull", () =>
      creds.withAskpass((env) =>
        repo.pull({ rebase: mode === "Rebase", env }),
      ),
    );
  });

  reg("egit.push", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) {
      return;
    }
    await pushDialog(manager, creds, repo);
  });

  reg("egit.merge", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) {
      return;
    }
    const ref = await pickMergeSource(repo, node as EgitNode);
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

  reg("egit.rebase", async (node) => {
    const repo = await resolveRepo(manager, node as EgitNode);
    if (!repo) {
      return;
    }
    const onto = await pickMergeSource(repo, node as EgitNode, "Rebase onto");
    if (!onto) {
      return;
    }
    await withProgress(manager, `Rebase onto ${onto}`, () =>
      repo.rebase(onto),
    );
  });

  // Sequencer controls (rebase/merge in progress).
  reg("egit.rebase.continue", (node) => seq(manager, node, "rebase", "continue"));
  reg("egit.rebase.skip", (node) => seq(manager, node, "rebase", "skip"));
  reg("egit.rebase.abort", (node) => seq(manager, node, "rebase", "abort"));
  reg("egit.merge.abort", (node) => seq(manager, node, "merge", "abort"));
}

async function seq(
  manager: RepositoryManager,
  node: unknown,
  kind: "rebase" | "merge",
  action: "continue" | "skip" | "abort",
): Promise<void> {
  const repo = await resolveRepo(manager, node as EgitNode);
  if (!repo) {
    return;
  }
  await withProgress(manager, `${kind} --${action}`, () =>
    repo.sequencerAction(kind, action),
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
  const branch = repo.headName ?? "HEAD";
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
    setUpstream?: boolean;
    force?: boolean;
    forceWithLease?: boolean;
    tags?: boolean;
    env?: NodeJS.ProcessEnv;
  } = { remote };
  const selected = new Set(flags.map((f) => f.key));
  opts.setUpstream = selected.has("setUpstream");
  opts.tags = selected.has("tags");
  opts.forceWithLease = selected.has("forceWithLease");
  opts.force = selected.has("force");
  await withProgress(manager, `Push to ${remote}`, () =>
    creds.withAskpass((env) => repo.push({ ...opts, env })),
  );
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
  node: EgitNode,
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
