import * as path from "node:path";
import { GitExecutor } from "./GitExecutor";
import { FOR_EACH_REF_FORMAT, parseForEachRef, RefInfo } from "./parsers/refs";
import { parseStatusV2, StatusResult } from "./parsers/status";
import {
  Commit,
  CommitFile,
  LOG_FORMAT,
  parseLog,
  parseNameStatus,
} from "./parsers/log";
import { parseReflog, REFLOG_FORMAT, ReflogEntry } from "./parsers/reflog";
import { BlameLine, parseBlamePorcelain } from "./parsers/blame";
import { ConfigEntry, parseConfigListZ } from "./parsers/config";

export interface RemoteInfo {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | undefined;
  bare: boolean;
  locked: boolean;
}

function parseWorktreeList(raw: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> | undefined;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) {
        worktrees.push(finishWorktree(current));
      }
      current = { path: line.slice("worktree ".length).trim(), bare: false, locked: false };
    } else if (current) {
      if (line.startsWith("HEAD ")) {
        current.head = line.slice(5).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice(7).trim();
        // refs/heads/main -> main
        current.branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        current.bare = true;
      } else if (line.startsWith("locked")) {
        current.locked = true;
      }
    }
  }
  if (current) {
    worktrees.push(finishWorktree(current));
  }
  return worktrees;
}

function finishWorktree(partial: Partial<WorktreeInfo>): WorktreeInfo {
  return {
    path: partial.path ?? "",
    head: partial.head ?? "",
    branch: partial.branch,
    bare: partial.bare ?? false,
    locked: partial.locked ?? false,
  };
}

export interface StashInfo {
  /** Index in the stash stack (0 == most recent). */
  index: number;
  /** Ref name, e.g. stash@{0}. */
  ref: string;
  message: string;
}

export interface SubmoduleInfo {
  path: string;
  objectId: string;
  /** Leading status char from `git submodule status` (' ', '-', '+', 'U'). */
  status: string;
}

/**
 * A single git working tree. Holds cached, lazily-refreshed snapshots of refs,
 * status, remotes, stashes and submodules. All git access goes through the
 * shared GitExecutor.
 */
export class Repository {
  refs: RefInfo[] = [];
  status: StatusResult = { changes: [] };
  remotes: RemoteInfo[] = [];
  stashes: StashInfo[] = [];
  submodules: SubmoduleInfo[] = [];
  headName: string | undefined;

  constructor(
    readonly root: string,
    private readonly git: GitExecutor,
  ) {}

  get name(): string {
    return path.basename(this.root);
  }

  get localBranches(): RefInfo[] {
    return this.refs.filter((r) => r.kind === "localBranch");
  }

  get remoteBranches(): RefInfo[] {
    return this.refs.filter((r) => r.kind === "remoteBranch");
  }

  get tags(): RefInfo[] {
    return this.refs.filter((r) => r.kind === "tag");
  }

  /** Files with index-side changes (staged). */
  get stagedChanges() {
    return this.status.changes.filter(
      (c) => c.conflicted || c.indexState !== undefined,
    );
  }

  /** Files with working-tree changes (unstaged, including untracked). */
  get unstagedChanges() {
    return this.status.changes.filter(
      (c) => c.conflicted || c.worktreeState !== undefined,
    );
  }

  // --- Staging operations -------------------------------------------------

  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    await this.git.run(["add", "--", ...paths], { cwd: this.root });
  }

  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    await this.git.run(["reset", "-q", "HEAD", "--", ...paths], {
      cwd: this.root,
    });
  }

  async stageAll(): Promise<void> {
    await this.git.run(["add", "-A"], { cwd: this.root });
  }

  async unstageAll(): Promise<void> {
    await this.git.run(["reset", "-q", "HEAD", "--"], { cwd: this.root });
  }

  /** Discard working-tree changes for tracked files; delete untracked. */
  async discard(paths: string[], untracked: string[]): Promise<void> {
    if (paths.length > 0) {
      await this.git.run(["checkout", "--", ...paths], { cwd: this.root });
    }
    if (untracked.length > 0) {
      await this.git.run(["clean", "-fd", "--", ...untracked], {
        cwd: this.root,
      });
    }
  }

  /** Apply a partial patch to the index (forward to stage, reverse to unstage). */
  async applyToIndex(patch: string, reverse: boolean): Promise<void> {
    const args = ["apply", "--cached", "--whitespace=nowarn"];
    if (reverse) {
      args.push("--reverse");
    }
    await this.git.run(args, { cwd: this.root, stdin: patch });
  }

  /** Raw diff for a single file (unstaged, or --cached for staged). */
  async diffFile(path: string, cached: boolean): Promise<string> {
    const args = ["diff", "--no-color"];
    if (cached) {
      args.push("--cached");
    }
    args.push("--", path);
    return this.git.stdout(args, { cwd: this.root });
  }

  // --- Commit -------------------------------------------------------------

  async commit(
    message: string,
    opts: { amend?: boolean; signoff?: boolean; signoff_gpg?: boolean; author?: string } = {},
  ): Promise<void> {
    const args = ["commit", "-F", "-"];
    if (opts.amend) {
      args.push("--amend");
    }
    if (opts.signoff) {
      args.push("--signoff");
    }
    if (opts.signoff_gpg) {
      args.push("-S");
    }
    if (opts.author) {
      args.push(`--author=${opts.author}`);
    }
    await this.git.run(args, { cwd: this.root, stdin: message });
  }

  /** Subject + body of HEAD, for prefilling an amend. */
  async headCommitMessage(): Promise<string> {
    return (
      await this.git.stdout(["log", "-1", "--format=%B"], { cwd: this.root })
    ).replace(/\n+$/, "");
  }

  // --- Branch / merge / rebase --------------------------------------------

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.git.run(["branch", "-m", oldName, newName], { cwd: this.root });
  }

  /** Delete a local branch (-d, or -D when force). */
  async deleteBranch(name: string, force: boolean): Promise<void> {
    await this.git.run(["branch", force ? "-D" : "-d", name], { cwd: this.root });
  }

  /**
   * Drop a single commit from the current branch by rebasing the commits that
   * follow it onto its parent. Fails (and leaves a rebase in progress) on conflict.
   */
  async dropCommit(sha: string): Promise<void> {
    await this.git.run(["rebase", "--onto", `${sha}^`, sha], { cwd: this.root });
  }

  /** Set (or clear) the upstream tracking ref for a local branch. */
  async setUpstream(branch: string, upstream?: string): Promise<void> {
    const args = upstream
      ? ["branch", `--set-upstream-to=${upstream}`, branch]
      : ["branch", "--unset-upstream", branch];
    await this.git.run(args, { cwd: this.root });
  }

  async merge(
    ref: string,
    opts: { noCommit?: boolean; noFf?: boolean; ffOnly?: boolean; squash?: boolean } = {},
  ): Promise<void> {
    const args = ["merge"];
    if (opts.noCommit) {
      args.push("--no-commit");
    }
    if (opts.noFf) {
      args.push("--no-ff");
    }
    if (opts.ffOnly) {
      args.push("--ff-only");
    }
    if (opts.squash) {
      args.push("--squash");
    }
    args.push(ref);
    await this.git.run(args, { cwd: this.root });
  }

  async rebase(
    onto: string,
    opts: { interactive?: boolean; env?: NodeJS.ProcessEnv } = {},
  ): Promise<void> {
    const args = ["rebase"];
    if (opts.interactive) {
      args.push("-i");
    }
    args.push(onto);
    await this.git.run(args, { cwd: this.root, env: opts.env });
  }

  /** Continue/skip/abort an in-progress rebase, merge, or cherry-pick. */
  async sequencerAction(
    kind: "rebase" | "merge" | "cherry-pick" | "revert",
    action: "continue" | "skip" | "abort",
  ): Promise<void> {
    if (kind === "merge" && action !== "abort") {
      // merge only supports --abort/--continue (no --skip).
      await this.git.run(["merge", `--${action}`], { cwd: this.root });
      return;
    }
    await this.git.run([kind, `--${action}`], { cwd: this.root });
  }

  // --- Remotes / transport ------------------------------------------------

  async addRemote(name: string, url: string): Promise<void> {
    await this.git.run(["remote", "add", name, url], { cwd: this.root });
  }

  async removeRemote(name: string): Promise<void> {
    await this.git.run(["remote", "remove", name], { cwd: this.root });
  }

  /** Prune stale remote-tracking refs that no longer exist on the remote. */
  async pruneRemote(name: string): Promise<void> {
    await this.git.run(["remote", "prune", name], { cwd: this.root });
  }

  // --- Maintenance --------------------------------------------------------

  /** Garbage-collect: compress history and prune unreachable objects. */
  async gc(aggressive = false): Promise<void> {
    const args = ["gc"];
    if (aggressive) {
      args.push("--aggressive");
    }
    await this.git.run(args, { cwd: this.root });
  }

  /** Verify object database connectivity and report dangling/broken objects. */
  async fsck(): Promise<string> {
    return this.git.stdout(["fsck", "--full"], { cwd: this.root });
  }

  /** Prune loose unreachable objects from the object database. */
  async pruneObjects(): Promise<void> {
    await this.git.run(["prune"], { cwd: this.root });
  }

  async renameRemote(oldName: string, newName: string): Promise<void> {
    await this.git.run(["remote", "rename", oldName, newName], {
      cwd: this.root,
    });
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.git.run(["remote", "set-url", name, url], { cwd: this.root });
  }

  async fetch(
    remote?: string,
    opts: { prune?: boolean; all?: boolean; tags?: boolean; env?: NodeJS.ProcessEnv } = {},
  ): Promise<void> {
    const args = ["fetch"];
    if (opts.all) {
      args.push("--all");
    }
    if (opts.prune) {
      args.push("--prune");
    }
    if (opts.tags) {
      args.push("--tags");
    }
    if (remote && !opts.all) {
      args.push(remote);
    }
    await this.git.run(args, { cwd: this.root, env: opts.env });
  }

  async pull(
    opts: { rebase?: boolean; remote?: string; branch?: string; env?: NodeJS.ProcessEnv } = {},
  ): Promise<void> {
    const args = ["pull"];
    if (opts.rebase) {
      args.push("--rebase");
    }
    if (opts.remote) {
      args.push(opts.remote);
      if (opts.branch) {
        args.push(opts.branch);
      }
    }
    await this.git.run(args, { cwd: this.root, env: opts.env });
  }

  async push(opts: {
    remote: string;
    refspec?: string;
    setUpstream?: boolean;
    force?: boolean;
    forceWithLease?: boolean;
    tags?: boolean;
    env?: NodeJS.ProcessEnv;
  }): Promise<void> {
    const args = ["push"];
    if (opts.setUpstream) {
      args.push("-u");
    }
    if (opts.forceWithLease) {
      args.push("--force-with-lease");
    } else if (opts.force) {
      args.push("--force");
    }
    if (opts.tags) {
      args.push("--tags");
    }
    args.push(opts.remote);
    if (opts.refspec) {
      args.push(opts.refspec);
    }
    await this.git.run(args, { cwd: this.root, env: opts.env });
  }

  // --- Tags ---------------------------------------------------------------

  async deleteTag(name: string): Promise<void> {
    await this.git.run(["tag", "-d", name], { cwd: this.root });
  }

  async pushTag(remote: string, name: string, env?: NodeJS.ProcessEnv): Promise<void> {
    await this.git.run(["push", remote, `refs/tags/${name}`], {
      cwd: this.root,
      env,
    });
  }

  // --- Gerrit / LFS -------------------------------------------------------

  /** Push HEAD to Gerrit's magic refs/for/<branch> ref for code review. */
  async pushForReview(
    remote: string,
    targetBranch: string,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    await this.git.run(
      ["push", remote, `HEAD:refs/for/${targetBranch}`],
      { cwd: this.root, env },
    );
  }

  /** True if the repo has a .gitattributes with git-lfs filters configured. */
  async hasLfs(): Promise<boolean> {
    const fs = await import("node:fs/promises");
    const pathMod = await import("node:path");
    try {
      const attrs = await fs.readFile(
        pathMod.join(this.root, ".gitattributes"),
        "utf8",
      );
      return /filter=lfs/.test(attrs);
    } catch {
      return false;
    }
  }

  /** List of LFS-tracked files (best effort; empty if git-lfs unavailable). */
  async lfsFiles(): Promise<string[]> {
    try {
      const out = await this.git.stdout(["lfs", "ls-files", "-n"], {
        cwd: this.root,
      });
      return out.split("\n").filter((l) => l.trim() !== "");
    } catch {
      return [];
    }
  }

  /** Track file pattern with LFS. */
  async lfsTrack(pattern: string): Promise<void> {
    await this.git.run(["lfs", "track", pattern], { cwd: this.root });
  }

  /** Untrack file pattern from LFS. */
  async lfsUntrack(pattern: string): Promise<void> {
    await this.git.run(["lfs", "untrack", pattern], { cwd: this.root });
  }

  /** Lock file on LFS remote. */
  async lfsLock(file: string): Promise<void> {
    await this.git.run(["lfs", "lock", file], { cwd: this.root });
  }

  /** Unlock file on LFS remote. */
  async lfsUnlock(file: string, force?: boolean): Promise<void> {
    const args = ["lfs", "unlock", file];
    if (force) args.push("--force");
    await this.git.run(args, { cwd: this.root });
  }

  /** List all LFS locks. Returns JSON array from git lfs locks --json. */
  async lfsLocks(): Promise<Array<{ id: string; path: string; owner: { name: string }; locked_at: string }>> {
    try {
      const out = await this.git.stdout(["lfs", "locks", "--json"], { cwd: this.root });
      const parsed = JSON.parse(out);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Download LFS objects for current ref. */
  async lfsPull(): Promise<void> {
    await this.git.run(["lfs", "pull"], { cwd: this.root });
  }

  /** Prune old LFS objects. */
  async lfsPrune(): Promise<void> {
    await this.git.run(["lfs", "prune"], { cwd: this.root });
  }

  // --- Git Notes ----------------------------------------------------------

  /** Add note to commit. */
  async notesAdd(ref: string, message: string): Promise<void> {
    await this.git.run(["notes", "add", "-m", message, ref], { cwd: this.root });
  }

  /** Edit note for commit (replaces existing). */
  async notesEdit(ref: string, message: string): Promise<void> {
    await this.git.run(["notes", "add", "-f", "-m", message, ref], { cwd: this.root });
  }

  /** Remove note from commit. */
  async notesRemove(ref: string): Promise<void> {
    await this.git.run(["notes", "remove", ref], { cwd: this.root });
  }

  /** Show notes for commit. Returns empty string if no notes. */
  async notesShow(ref: string): Promise<string> {
    try {
      return await this.git.stdout(["notes", "show", ref], { cwd: this.root });
    } catch {
      return "";
    }
  }

  // --- Worktree Lock ------------------------------------------------------

  /** Lock worktree to prevent pruning. */
  async worktreeLock(path: string, reason?: string): Promise<void> {
    const args = ["worktree", "lock", path];
    if (reason) args.push("--reason", reason);
    await this.git.run(args, { cwd: this.root });
  }

  /** Unlock worktree. */
  async worktreeUnlock(path: string): Promise<void> {
    await this.git.run(["worktree", "unlock", path], { cwd: this.root });
  }

  // --- Git Archive --------------------------------------------------------

  /** Create archive from ref. Format: zip, tar, tar.gz, etc. */
  async archive(ref: string, format: string, output: string, prefix?: string): Promise<void> {
    const args = ["archive", `--format=${format}`, `--output=${output}`, ref];
    if (prefix) args.push(`--prefix=${prefix}`);
    await this.git.run(args, { cwd: this.root });
  }

  // --- Git Subtree --------------------------------------------------------

  /** Add subtree from external repository. */
  async subtreeAdd(prefix: string, repository: string, ref?: string): Promise<void> {
    const args = ["subtree", "add", "--prefix", prefix, repository];
    if (ref) args.push(ref);
    else args.push("master");
    await this.git.run(args, { cwd: this.root });
  }

  /** Pull subtree updates from external repository. */
  async subtreePull(prefix: string, repository: string, ref?: string): Promise<void> {
    const args = ["subtree", "pull", "--prefix", prefix, repository];
    if (ref) args.push(ref);
    else args.push("master");
    await this.git.run(args, { cwd: this.root });
  }

  /** Push subtree changes to external repository. */
  async subtreePush(prefix: string, repository: string, ref?: string): Promise<void> {
    const args = ["subtree", "push", "--prefix", prefix, repository];
    if (ref) args.push(ref);
    else args.push("master");
    await this.git.run(args, { cwd: this.root });
  }

  /** Split subtree into separate history and return new commit SHA. */
  async subtreeSplit(prefix: string): Promise<string> {
    const out = await this.git.stdout(
      ["subtree", "split", "--prefix", prefix],
      { cwd: this.root }
    );
    return out.trim();
  }

  async checkoutRef(ref: string): Promise<void> {
    await this.git.run(["checkout", ref], { cwd: this.root });
  }

  // --- Synchronize (incoming / outgoing) ----------------------------------

  /** Ahead/behind counts of HEAD vs its upstream, if an upstream is set. */
  async aheadBehind(): Promise<{ ahead: number; behind: number } | undefined> {
    try {
      const out = await this.git.stdout(
        ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        { cwd: this.root },
      );
      const [ahead, behind] = out.trim().split(/\s+/).map(Number);
      return { ahead: ahead || 0, behind: behind || 0 };
    } catch {
      return undefined; // no upstream configured
    }
  }

  /** Commits present on one side only. direction: outgoing = ahead, incoming = behind. */
  async syncCommits(direction: "incoming" | "outgoing"): Promise<Commit[]> {
    const range =
      direction === "outgoing" ? "@{upstream}..HEAD" : "HEAD..@{upstream}";
    try {
      return await this.log({ revRange: range, all: false });
    } catch {
      return [];
    }
  }

  // --- Config -------------------------------------------------------------

  /** List config entries. scope: local (repo), global (user), or system. */
  async listConfig(
    scope: "local" | "global" | "system",
  ): Promise<ConfigEntry[]> {
    try {
      const out = await this.git.stdout(
        ["config", `--${scope}`, "--list", "-z"],
        { cwd: this.root },
      );
      return parseConfigListZ(out);
    } catch {
      return [];
    }
  }

  async setConfig(
    scope: "local" | "global",
    key: string,
    value: string,
  ): Promise<void> {
    await this.git.run(["config", `--${scope}`, key, value], {
      cwd: this.root,
    });
  }

  async unsetConfig(scope: "local" | "global", key: string): Promise<void> {
    await this.git.run(["config", `--${scope}`, "--unset-all", key], {
      cwd: this.root,
    });
  }

  // --- Stash --------------------------------------------------------------

  async stashPush(message: string | undefined, includeUntracked: boolean): Promise<void> {
    const args = ["stash", "push"];
    if (includeUntracked) {
      args.push("--include-untracked");
    }
    if (message) {
      args.push("-m", message);
    }
    await this.git.run(args, { cwd: this.root });
  }

  async stashApply(ref: string): Promise<void> {
    await this.git.run(["stash", "apply", ref], { cwd: this.root });
  }

  async stashPop(ref: string): Promise<void> {
    await this.git.run(["stash", "pop", ref], { cwd: this.root });
  }

  async stashDrop(ref: string): Promise<void> {
    await this.git.run(["stash", "drop", ref], { cwd: this.root });
  }

  /** Files changed in a stash, name-status. */
  async stashFiles(ref: string): Promise<CommitFile[]> {
    const out = await this.git.stdout(
      ["stash", "show", "--name-status", "-z", ref],
      { cwd: this.root },
    );
    return parseNameStatus(out);
  }

  // --- Submodules ---------------------------------------------------------

  async submoduleAdd(url: string, pathArg: string): Promise<void> {
    await this.git.run(["submodule", "add", url, pathArg], { cwd: this.root });
  }

  async submoduleInit(pathArg?: string): Promise<void> {
    const args = ["submodule", "init"];
    if (pathArg) {
      args.push("--", pathArg);
    }
    await this.git.run(args, { cwd: this.root });
  }

  async submoduleUpdate(pathArg?: string, recursive = true): Promise<void> {
    const args = ["submodule", "update", "--init"];
    if (recursive) {
      args.push("--recursive");
    }
    if (pathArg) {
      args.push("--", pathArg);
    }
    await this.git.run(args, { cwd: this.root });
  }

  async submoduleSync(pathArg?: string): Promise<void> {
    const args = ["submodule", "sync"];
    if (pathArg) {
      args.push("--", pathArg);
    }
    await this.git.run(args, { cwd: this.root });
  }

  // --- Reflog -------------------------------------------------------------

  /** Reflog for a ref (default HEAD). */
  async reflog(ref = "HEAD", limit = 200): Promise<ReflogEntry[]> {
    const out = await this.git.stdout(
      ["reflog", `--format=${REFLOG_FORMAT}`, `--max-count=${limit}`, ref],
      { cwd: this.root },
    );
    return parseReflog(out);
  }

  // --- Blame --------------------------------------------------------------

  /** Per-line blame for a working-tree file (relative path). */
  async blame(relPath: string): Promise<BlameLine[]> {
    const out = await this.git.stdout(
      ["blame", "--porcelain", "--", relPath],
      { cwd: this.root },
    );
    return parseBlamePorcelain(out);
  }

  // --- Conflict resolution ------------------------------------------------

  /** Files currently in an unmerged/conflicted state. */
  get conflictedPaths(): string[] {
    return this.status.changes.filter((c) => c.conflicted).map((c) => c.path);
  }

  /** Resolve a conflict by taking our side or their side, then stage it. */
  async resolveWith(relPath: string, side: "ours" | "theirs"): Promise<void> {
    await this.git.run(["checkout", `--${side}`, "--", relPath], {
      cwd: this.root,
    });
    await this.git.run(["add", "--", relPath], { cwd: this.root });
  }

  /** Mark a conflicted file resolved (stage it as-is). */
  async markResolved(relPath: string): Promise<void> {
    await this.git.run(["add", "--", relPath], { cwd: this.root });
  }

  // --- Interactive rebase -------------------------------------------------

  /** Detect whether a rebase/merge/cherry-pick is currently in progress. */
  async inProgressOperation(): Promise<
    "rebase" | "merge" | "cherry-pick" | "revert" | undefined
  > {
    const gitDir = await this.git
      .stdout(["rev-parse", "--git-dir"], { cwd: this.root })
      .then((s) => s.trim())
      .catch(() => ".git");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const abs = path.isAbsolute(gitDir)
      ? gitDir
      : path.join(this.root, gitDir);
    const exists = (p: string) => fs.existsSync(path.join(abs, p));
    if (exists("rebase-merge") || exists("rebase-apply")) {
      return "rebase";
    }
    if (exists("MERGE_HEAD")) {
      return "merge";
    }
    if (exists("CHERRY_PICK_HEAD")) {
      return "cherry-pick";
    }
    if (exists("REVERT_HEAD")) {
      return "revert";
    }
    return undefined;
  }

  // --- History ------------------------------------------------------------

  /** Load commits. `revs` selects branches (default: --all); `search` filters. */
  async log(options: {
    limit?: number;
    skip?: number;
    all?: boolean;
    revRange?: string;
    search?: string;
    searchBy?: "message" | "author" | "sha";
    file?: string;
    since?: string;
    until?: string;
  } = {}): Promise<Commit[]> {
    const args = ["log", `--format=${LOG_FORMAT}`, "--date-order"];
    if (options.limit !== undefined) {
      args.push(`--max-count=${options.limit}`);
    }
    if (options.skip) {
      args.push(`--skip=${options.skip}`);
    }
    if (options.all) {
      args.push("--all");
    }
    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.until) {
      args.push(`--until=${options.until}`);
    }
    if (options.search) {
      switch (options.searchBy) {
        case "author":
          args.push(`--author=${options.search}`);
          break;
        case "sha":
          // Handled by revRange below; ignore here.
          break;
        default:
          args.push(`--grep=${options.search}`, "-i");
      }
    }
    if (options.revRange) {
      args.push(options.revRange);
    }
    if (options.file) {
      args.push("--follow", "--", options.file);
    }
    const out = await this.git.stdout(args, { cwd: this.root });
    return parseLog(out);
  }

  /**
   * Get commit graph data for visualization.
   * Returns commits with graph structure (parents, children, branch/tag refs).
   */
  async graphLog(options: {
    limit?: number;
    all?: boolean;
    branches?: string[];
  } = {}): Promise<{
    commits: Array<{
      sha: string;
      shortSha: string;
      message: string;
      author: string;
      date: string;
      parents: string[];
      refs: string[];
    }>;
    branches: Array<{ name: string; sha: string; isHead: boolean }>;
    tags: Array<{ name: string; sha: string }>;
  }> {
    // Get commits with graph structure
    const format = "%H%x00%h%x00%s%x00%an%x00%ai%x00%P%x00%D";
    // --topo-order guarantees a child is always listed before its parents, which
    // keeps the lane layout free of backtracking edges (date-order can interleave
    // branches and place a child after a parent dated earlier).
    const args = ["log", `--format=${format}`, "--topo-order"];
    
    if (options.limit !== undefined) {
      args.push(`--max-count=${options.limit}`);
    }
    
    if (options.all) {
      args.push("--all");
    } else if (options.branches && options.branches.length > 0) {
      for (const branch of options.branches) {
        args.push(branch);
      }
    }

    const out = await this.git.stdout(args, { cwd: this.root });
    const lines = out.trim().split("\n").filter((l) => l.length > 0);
    
    const commits = lines.map((line) => {
      const [sha, shortSha, message, author, date, parentsStr, refsStr] = line.split("\x00");
      const parents = parentsStr ? parentsStr.split(" ") : [];
      const refs = refsStr
        ? refsStr.split(", ").map((r) => r.trim().replace(/^HEAD -> /, ""))
        : [];
      
      return {
        sha,
        shortSha,
        message,
        author,
        date,
        parents,
        refs,
      };
    });

    // Get branch and tag info
    const branches = this.localBranches.map((b) => ({
      name: b.shortName,
      sha: b.objectId,
      isHead: b.isHead,
    }));
    
    const remoteBranches = this.remoteBranches.map((b) => ({
      name: b.shortName,
      sha: b.objectId,
      isHead: false,
    }));

    const tags = this.tags.map((t) => ({
      name: t.shortName,
      sha: t.objectId,
    }));

    return {
      commits,
      branches: [...branches, ...remoteBranches],
      tags,
    };
  }

  /** Files touched by a commit (name-status, rename-aware). */
  async commitFiles(sha: string): Promise<CommitFile[]> {
    const out = await this.git.stdout(
      ["show", "--name-status", "-z", "-M", "--format=", sha],
      { cwd: this.root },
    );
    return parseNameStatus(out);
  }

  /** Files changed between two refs (name-status, rename-aware). */
  async diffFiles(ref1: string, ref2: string): Promise<CommitFile[]> {
    const out = await this.git.stdout(
      ["diff", "--name-status", "-z", "-M", ref1, ref2],
      { cwd: this.root },
    );
    return parseNameStatus(out);
  }

  // --- Commit operations --------------------------------------------------

  async checkoutDetached(sha: string): Promise<void> {
    await this.git.run(["checkout", sha], { cwd: this.root });
  }

  async cherryPick(sha: string): Promise<void> {
    await this.git.run(["cherry-pick", sha], { cwd: this.root });
  }

  async revert(sha: string): Promise<void> {
    await this.git.run(["revert", "--no-edit", sha], { cwd: this.root });
  }

  /** Fetch a specific refspec from a remote (e.g. for GitHub PRs). */
  async fetchRefspec(remote: string, refspec: string, env?: NodeJS.ProcessEnv): Promise<void> {
    await this.git.run(["fetch", remote, refspec], { cwd: this.root, env });
  }

  /** Verify the GPG signature on a commit. */
  async verifyCommitSignature(sha: string): Promise<{
    valid: boolean;
    signer?: string;
    keyId?: string;
    error?: string;
  }> {
    try {
      const out = await this.git.stdout(
        ["verify-commit", "--verbose", sha],
        { cwd: this.root },
      );
      const signerMatch = /Good signature from "(.+)"/i.exec(out);
      const keyMatch = /key ID ([0-9A-Fa-f]+)/i.exec(out);
      return {
        valid: true,
        signer: signerMatch?.[1],
        keyId: keyMatch?.[1],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/No public key|key not available/i.test(msg)) {
        return { valid: false, error: "Signature present but public key not available" };
      }
      return { valid: false, error: msg.split("\n")[0] };
    }
  }

  async reset(sha: string, mode: "soft" | "mixed" | "hard"): Promise<void> {
    await this.git.run(["reset", `--${mode}`, sha], { cwd: this.root });
  }

  async createBranchAt(name: string, sha: string, checkout: boolean): Promise<void> {
    const args = checkout ? ["checkout", "-b", name, sha] : ["branch", name, sha];
    await this.git.run(args, { cwd: this.root });
  }

  async createTagAt(
    name: string,
    sha: string,
    message?: string,
    sign = false,
    force = false,
  ): Promise<void> {
    let args: string[];
    if (sign) {
      args = ["tag", "-s", name, "-m", message ?? name, sha];
    } else if (message) {
      args = ["tag", "-a", name, "-m", message, sha];
    } else {
      args = ["tag", name, sha];
    }
    if (force) {
      args.splice(1, 0, "-f");
    }
    await this.git.run(args, { cwd: this.root });
  }

  /** Delete a remote tag by pushing an empty refspec. */
  async deleteRemoteTag(remote: string, name: string): Promise<void> {
    await this.git.run(["push", remote, `:refs/tags/${name}`], {
      cwd: this.root,
    });
  }

  /** Checkout a remote branch creating a local tracking branch. */
  async checkoutRemoteBranch(
    remoteBranch: string,
    localName: string,
  ): Promise<void> {
    await this.git.run(["checkout", "-b", localName, "--track", remoteBranch], {
      cwd: this.root,
    });
  }

  /** Delete a remote branch via push with empty src refspec. */
  async deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    await this.git.run(["push", remote, `:refs/heads/${branch}`], {
      cwd: this.root,
    });
  }

  /** Replace a working-tree file with its content at a given ref. */
  async replaceWithRef(relPath: string, ref: string): Promise<void> {
    await this.git.run(["checkout", ref, "--", relPath], { cwd: this.root });
  }

  /** Set or clear git update-index --assume-unchanged for paths. */
  async assumeUnchanged(paths: string[], assume: boolean): Promise<void> {
    const flag = assume ? "--assume-unchanged" : "--no-assume-unchanged";
    await this.git.run(["update-index", flag, "--", ...paths], {
      cwd: this.root,
    });
  }

  /** Set or clear git update-index --skip-worktree for paths. */
  async skipWorktree(paths: string[], skip: boolean): Promise<void> {
    const flag = skip ? "--skip-worktree" : "--no-skip-worktree";
    await this.git.run(["update-index", flag, "--", ...paths], {
      cwd: this.root,
    });
  }

  /** Remove files from the index only (git rm --cached). */
  async untrack(paths: string[]): Promise<void> {
    await this.git.run(["rm", "--cached", "--", ...paths], { cwd: this.root });
  }

  /** Remove untracked files/dirs (git clean -fd). */
  async cleanUntracked(paths?: string[]): Promise<void> {
    const args = ["clean", "-fd"];
    if (paths && paths.length > 0) {
      args.push("--", ...paths);
    }
    await this.git.run(args, { cwd: this.root });
  }

  /** Create a branch from a stash entry and apply it (git stash branch). */
  async stashBranch(name: string, stashRef: string): Promise<void> {
    await this.git.run(["stash", "branch", name, stashRef], {
      cwd: this.root,
    });
  }

  /** List all worktrees. Returns raw porcelain output lines grouped per worktree. */
  async worktreeList(): Promise<WorktreeInfo[]> {
    const out = await this.git.stdout(["worktree", "list", "--porcelain"], {
      cwd: this.root,
    });
    return parseWorktreeList(out);
  }

  /** Add a new linked worktree. */
  async worktreeAdd(
    worktreePath: string,
    branch: string,
    createBranch = false,
  ): Promise<void> {
    const args = ["worktree", "add"];
    if (createBranch) {
      args.push("-b", branch);
    }
    args.push(worktreePath);
    if (!createBranch) {
      args.push(branch);
    }
    await this.git.run(args, { cwd: this.root });
  }

  /** Remove a linked worktree. */
  async worktreeRemove(worktreePath: string, force = false): Promise<void> {
    const args = ["worktree", "remove"];
    if (force) {
      args.push("--force");
    }
    args.push(worktreePath);
    await this.git.run(args, { cwd: this.root });
  }

  /** Prune stale worktree administrative files. */
  async worktreePrune(): Promise<void> {
    await this.git.run(["worktree", "prune"], { cwd: this.root });
  }

  // --- Bisect -------------------------------------------------------------

  async bisectStart(): Promise<void> {
    await this.git.run(["bisect", "start"], { cwd: this.root });
  }

  async bisectMark(good: boolean, sha?: string): Promise<string> {
    const args = ["bisect", good ? "good" : "bad"];
    if (sha) {
      args.push(sha);
    }
    return this.git.stdout(args, { cwd: this.root });
  }

  async bisectReset(): Promise<void> {
    await this.git.run(["bisect", "reset"], { cwd: this.root });
  }

  async bisectLog(): Promise<string> {
    return this.git.stdout(["bisect", "log"], { cwd: this.root });
  }

  async addToGitignore(patterns: string[]): Promise<void> {
    const fs = await import("node:fs/promises");
    const pathMod = await import("node:path");
    const file = pathMod.join(this.root, ".gitignore");
    let existing = "";
    try {
      existing = await fs.readFile(file, "utf8");
    } catch {
      existing = "";
    }
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    await fs.writeFile(file, existing + prefix + patterns.join("\n") + "\n");
  }

  async refresh(): Promise<void> {
    await Promise.all([
      this.refreshRefs(),
      this.refreshStatus(),
      this.refreshRemotes(),
      this.refreshStashes(),
      this.refreshSubmodules(),
      this.refreshHead(),
    ]);
  }

  private async refreshRefs(): Promise<void> {
    const out = await this.git.stdout(
      ["for-each-ref", `--format=${FOR_EACH_REF_FORMAT}`],
      { cwd: this.root },
    );
    this.refs = parseForEachRef(out);
  }

  private async refreshStatus(): Promise<void> {
    const out = await this.git.stdout(
      ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
      { cwd: this.root },
    );
    this.status = parseStatusV2(out);
  }

  private async refreshRemotes(): Promise<void> {
    const out = await this.git.stdout(["remote", "-v"], { cwd: this.root });
    const map = new Map<string, RemoteInfo>();
    for (const line of out.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      // "name\turl (fetch|push)"
      const match = /^(\S+)\t(\S+)\s+\((fetch|push)\)$/.exec(line);
      if (!match) {
        continue;
      }
      const [, name, url, kind] = match;
      const info = map.get(name) ?? { name };
      if (kind === "fetch") {
        info.fetchUrl = url;
      } else {
        info.pushUrl = url;
      }
      map.set(name, info);
    }
    this.remotes = [...map.values()];
  }

  private async refreshStashes(): Promise<void> {
    const out = await this.git.stdout(
      ["stash", "list", "--format=%gd\x1f%gs"],
      { cwd: this.root },
    );
    const stashes: StashInfo[] = [];
    for (const line of out.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      const [ref, message] = line.split("\x1f");
      const m = /stash@\{(\d+)\}/.exec(ref);
      stashes.push({
        ref,
        message: message ?? "",
        index: m ? Number(m[1]) : stashes.length,
      });
    }
    this.stashes = stashes;
  }

  private async refreshSubmodules(): Promise<void> {
    const out = await this.git.stdout(["submodule", "status"], {
      cwd: this.root,
    });
    const subs: SubmoduleInfo[] = [];
    for (const line of out.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      // " <sha> <path> (<describe>)" with a leading status char
      const status = line[0];
      const rest = line.slice(1).trim();
      const [objectId, subPath] = rest.split(/\s+/);
      subs.push({ status, objectId, path: subPath });
    }
    this.submodules = subs;
  }

  private async refreshHead(): Promise<void> {
    try {
      const out = await this.git.stdout(
        ["symbolic-ref", "--short", "HEAD"],
        { cwd: this.root },
      );
      this.headName = out.trim();
    } catch {
      // Detached HEAD — fall back to short sha.
      const sha = await this.git.stdout(["rev-parse", "--short", "HEAD"], {
        cwd: this.root,
      });
      this.headName = `(detached ${sha.trim()})`;
    }
  }
}
