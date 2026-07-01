import * as path from "node:path";
import { GitExecutor } from "./GitExecutor";
import { safeRef, safeRemoteUrl } from "./argGuard";
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
import { parseWorktreeList, WorktreeInfo } from "./parsers/worktree";
import { GRAPH_LOG_FORMAT, parseGraphLog } from "./parsers/graphLog";

export { WorktreeInfo } from "./parsers/worktree";

export interface RemoteInfo {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface StashInfo {
  /** Index in the stash stack (0 == most recent). */
  index: number;
  /** Ref name, e.g. stash@{0}. */
  ref: string;
  /** Commit object for the stash entry itself. */
  objectId?: string;
  /** First parent of the stash commit: the commit the stash was based on. */
  baseObjectId?: string;
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
  private submodulesLoaded = false;
  private submodulesInFlight: Promise<void> | undefined;

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
    await this.git.run(
      ["branch", "-m", safeRef(oldName, "branch"), safeRef(newName, "branch")],
      { cwd: this.root },
    );
  }

  /** Delete a local branch (-d, or -D when force). */
  async deleteBranch(name: string, force: boolean): Promise<void> {
    await this.git.run(["branch", force ? "-D" : "-d", safeRef(name, "branch")], {
      cwd: this.root,
    });
  }

  /**
   * Drop a single commit from the current branch by rebasing the commits that
   * follow it onto its parent. Fails (and leaves a rebase in progress) on conflict.
   */
  async dropCommit(sha: string): Promise<void> {
    safeRef(sha, "commit");
    await this.git.run(["rebase", "--onto", `${sha}^`, sha], { cwd: this.root });
  }

  /** Set (or clear) the upstream tracking ref for a local branch. */
  async setUpstream(branch: string, upstream?: string): Promise<void> {
    safeRef(branch, "branch");
    const args = upstream
      ? ["branch", `--set-upstream-to=${safeRef(upstream, "upstream")}`, branch]
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
    args.push(safeRef(ref));
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
    args.push(safeRef(onto));
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
    await this.git.run(
      ["remote", "add", safeRef(name, "remote"), safeRemoteUrl(url)],
      { cwd: this.root },
    );
  }

  async removeRemote(name: string): Promise<void> {
    await this.git.run(["remote", "remove", safeRef(name, "remote")], {
      cwd: this.root,
    });
  }

  /** Prune stale remote-tracking refs that no longer exist on the remote. */
  async pruneRemote(name: string): Promise<void> {
    await this.git.run(["remote", "prune", safeRef(name, "remote")], {
      cwd: this.root,
    });
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
    await this.git.run(
      ["remote", "rename", safeRef(oldName, "remote"), safeRef(newName, "remote")],
      { cwd: this.root },
    );
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.git.run(
      ["remote", "set-url", safeRef(name, "remote"), safeRemoteUrl(url)],
      { cwd: this.root },
    );
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
      args.push(safeRef(remote, "remote"));
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
      args.push(safeRef(opts.remote, "remote"));
      if (opts.branch) {
        args.push(safeRef(opts.branch, "branch"));
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
    args.push(safeRef(opts.remote, "remote"));
    if (opts.refspec) {
      args.push(safeRef(opts.refspec, "refspec"));
    }
    await this.git.run(args, { cwd: this.root, env: opts.env });
  }

  // --- Tags ---------------------------------------------------------------

  async deleteTag(name: string): Promise<void> {
    await this.git.run(["tag", "-d", safeRef(name, "tag")], { cwd: this.root });
  }

  async pushTag(remote: string, name: string, force = false): Promise<void> {
    const args = ["push", safeRef(remote, "remote")];
    if (force) {
      args.push("--force");
    }
    args.push(`refs/tags/${safeRef(name, "tag")}`);
    await this.git.run(args, { cwd: this.root });
  }

  // --- Gerrit / LFS -------------------------------------------------------

  /** Push HEAD to Gerrit's magic refs/for/<branch> ref for code review. */
  async pushForReview(
    remote: string,
    targetBranch: string,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    await this.git.run(
      ["push", safeRef(remote, "remote"), `HEAD:refs/for/${safeRef(targetBranch, "branch")}`],
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
    await this.git.run(["lfs", "track", "--", pattern], { cwd: this.root });
  }

  /** Untrack file pattern from LFS. */
  async lfsUntrack(pattern: string): Promise<void> {
    await this.git.run(["lfs", "untrack", "--", pattern], { cwd: this.root });
  }

  /** Lock file on LFS remote. */
  async lfsLock(file: string): Promise<void> {
    await this.git.run(["lfs", "lock", "--", file], { cwd: this.root });
  }

  /** Unlock file on LFS remote. */
  async lfsUnlock(file: string, force?: boolean): Promise<void> {
    const args = ["lfs", "unlock"];
    if (force) args.push("--force");
    args.push("--", file);
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
    await this.git.run(["notes", "add", "-m", message, safeRef(ref, "commit")], {
      cwd: this.root,
    });
  }

  /** Edit note for commit (replaces existing). */
  async notesEdit(ref: string, message: string): Promise<void> {
    await this.git.run(
      ["notes", "add", "-f", "-m", message, safeRef(ref, "commit")],
      { cwd: this.root },
    );
  }

  /** Remove note from commit. */
  async notesRemove(ref: string): Promise<void> {
    await this.git.run(["notes", "remove", safeRef(ref, "commit")], {
      cwd: this.root,
    });
  }

  /** Show notes for commit. Returns empty string if no notes. */
  async notesShow(ref: string): Promise<string> {
    // Guard outside the try so an option-injection attempt surfaces as an error
    // rather than being silently swallowed as "no notes".
    const safe = safeRef(ref, "commit");
    try {
      return await this.git.stdout(["notes", "show", safe], { cwd: this.root });
    } catch {
      return "";
    }
  }

  // --- Worktree Lock ------------------------------------------------------

  /** Lock worktree to prevent pruning. */
  async worktreeLock(path: string, reason?: string): Promise<void> {
    // `git worktree lock` has no `--` separator, so the worktree path itself
    // must not be parseable as an option. Keep flags first, path last.
    const args = ["worktree", "lock"];
    if (reason) args.push("--reason", reason);
    args.push(safeRef(path, "worktree path"));
    await this.git.run(args, { cwd: this.root });
  }

  /** Unlock worktree. */
  async worktreeUnlock(path: string): Promise<void> {
    await this.git.run(["worktree", "unlock", safeRef(path, "worktree path")], {
      cwd: this.root,
    });
  }

  // --- Git Archive --------------------------------------------------------

  /** Create archive from ref. Format: zip, tar, tar.gz, etc. */
  async archive(ref: string, format: string, output: string, prefix?: string): Promise<void> {
    const args = [
      "archive",
      `--format=${safeRef(format, "archive format")}`,
      `--output=${safeRef(output, "output path")}`,
      safeRef(ref),
    ];
    if (prefix) args.push(`--prefix=${safeRef(prefix, "archive prefix")}`);
    await this.git.run(args, { cwd: this.root });
  }

  // --- Git Subtree --------------------------------------------------------

  /**
   * Resolve the branch to use when a subtree ref isn't specified: the remote's
   * own default branch (via `HEAD`) rather than a hardcoded name. Falls back to
   * "master" only if the remote's HEAD can't be read (e.g. offline), preserving
   * the historical behaviour for that edge case.
   */
  private async defaultSubtreeRef(repository: string): Promise<string> {
    try {
      const out = await this.git.stdout(
        ["ls-remote", "--symref", safeRemoteUrl(repository, "repository"), "HEAD"],
        { cwd: this.root },
      );
      // Line looks like: "ref: refs/heads/main\tHEAD"
      const match = out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m);
      if (match) return match[1];
    } catch {
      // Fall through to the historical default.
    }
    return "master";
  }

  /** Add subtree from external repository. */
  async subtreeAdd(prefix: string, repository: string, ref?: string): Promise<void> {
    const resolvedRef = ref ? safeRef(ref) : await this.defaultSubtreeRef(repository);
    const args = ["subtree", "add", "--prefix", prefix, safeRemoteUrl(repository, "repository"), resolvedRef];
    await this.git.run(args, { cwd: this.root });
  }

  /** Pull subtree updates from external repository. */
  async subtreePull(prefix: string, repository: string, ref?: string): Promise<void> {
    const resolvedRef = ref ? safeRef(ref) : await this.defaultSubtreeRef(repository);
    const args = ["subtree", "pull", "--prefix", prefix, safeRemoteUrl(repository, "repository"), resolvedRef];
    await this.git.run(args, { cwd: this.root });
  }

  /** Push subtree changes to external repository. */
  async subtreePush(prefix: string, repository: string, ref?: string): Promise<void> {
    const resolvedRef = ref ? safeRef(ref) : await this.defaultSubtreeRef(repository);
    const args = ["subtree", "push", "--prefix", prefix, safeRemoteUrl(repository, "repository"), resolvedRef];
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
    await this.git.run(["checkout", safeRef(ref)], { cwd: this.root });
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

  /**
   * Effective `user.name` for this repository (local overriding global/system),
   * or an empty string when unset. Used to tell whether the current user owns a
   * resource such as an LFS lock.
   */
  async configuredUserName(): Promise<string> {
    try {
      return (
        await this.git.stdout(["config", "--get", "user.name"], {
          cwd: this.root,
        })
      ).trim();
    } catch {
      return "";
    }
  }

  async setConfig(
    scope: "local" | "global",
    key: string,
    value: string,
  ): Promise<void> {
    // `key` arrives from the config webview (postMessage) and lands in option
    // position. `git config` has no `--` separator, so reject option-like keys
    // to stop a key such as `--global`/`--unset` from being parsed as a flag.
    // (`value` may legitimately start with "-", and git treats it positionally
    // once `key` precedes it, so it is left unguarded.)
    safeRef(key, "config key");
    await this.git.run(["config", `--${scope}`, key, value], {
      cwd: this.root,
    });
  }

  async unsetConfig(scope: "local" | "global", key: string): Promise<void> {
    safeRef(key, "config key");
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
    await this.git.run(["stash", "apply", safeRef(ref, "stash")], { cwd: this.root });
  }

  async stashPop(ref: string): Promise<void> {
    await this.git.run(["stash", "pop", safeRef(ref, "stash")], { cwd: this.root });
  }

  async stashDrop(ref: string): Promise<void> {
    await this.git.run(["stash", "drop", safeRef(ref, "stash")], { cwd: this.root });
  }

  /** Drop every stash entry (git stash clear). Irreversible. */
  async stashClear(): Promise<void> {
    await this.git.run(["stash", "clear"], { cwd: this.root });
  }

  /** Files changed in a stash, name-status. */
  async stashFiles(ref: string): Promise<CommitFile[]> {
    const out = await this.git.stdout(
      ["stash", "show", "--name-status", "-z", safeRef(ref, "stash")],
      { cwd: this.root },
    );
    return parseNameStatus(out);
  }

  // --- Submodules ---------------------------------------------------------

  async submoduleAdd(url: string, pathArg: string): Promise<void> {
    await this.git.run(["submodule", "add", "--", safeRemoteUrl(url), pathArg], {
      cwd: this.root,
    });
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
      ["reflog", `--format=${REFLOG_FORMAT}`, `--max-count=${limit}`, safeRef(ref)],
      { cwd: this.root },
    );
    return parseReflog(out);
  }

  /** Resolve a ref/object name without exposing the repository's executor. */
  async resolveRevision(ref: string): Promise<string> {
    return (
      await this.git.stdout(
        ["rev-parse", "--verify", "--end-of-options", safeRef(ref)],
        { cwd: this.root },
      )
    ).trim();
  }

  /** Read a commit subject for reference-picker metadata. */
  async commitSubject(ref: string): Promise<string> {
    return (
      await this.git.stdout(
        ["log", "-1", "--format=%s", "--end-of-options", safeRef(ref)],
        { cwd: this.root },
      )
    ).trim();
  }

  /** Absolute path to this worktree's Git administrative directory. */
  async gitDirectory(): Promise<string> {
    const gitDir = (
      await this.git.stdout(["rev-parse", "--absolute-git-dir"], {
        cwd: this.root,
      })
    ).trim();
    return path.isAbsolute(gitDir) ? gitDir : path.resolve(this.root, gitDir);
  }

  /** Resolve a path inside the actual Git dir, including linked worktrees. */
  async gitPath(relativePath: string): Promise<string> {
    const value = (
      await this.git.stdout(
        ["rev-parse", "--git-path", safeRef(relativePath, "Git path")],
        { cwd: this.root },
      )
    ).trim();
    return path.isAbsolute(value) ? value : path.resolve(this.root, value);
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
    const gitDir = await this.gitDirectory().catch(() =>
      path.join(this.root, ".git"),
    );
    const fs = await import("node:fs");
    const exists = (p: string) => fs.existsSync(path.join(gitDir, p));
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
    /**
     * Commit ordering. `topo` lists a child before all of its parents, which the
     * graph renderer needs to lay out lanes without backtracking edges; `date`
     * (the default) is reverse-chronological for plain list views; `author-date`
     * sorts by author timestamp when possible while preserving child-before-parent
     * constraints.
     */
    order?: "date" | "author-date" | "topo";
  } = {}): Promise<Commit[]> {
    const orderFlag =
      options.order === "topo"
        ? "--topo-order"
        : options.order === "author-date"
          ? "--author-date-order"
          : "--date-order";
    const args = ["log", `--format=${LOG_FORMAT}`, orderFlag];
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
      args.push(safeRef(options.revRange, "rev range"));
    }
    if (options.file) {
      args.push("--follow", "--", options.file);
    }
    const out = await this.git.stdout(args, { cwd: this.root });
    return parseLog(out, this.remotes.map((r) => r.name));
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
      committer: string;
      committerDate: string;
      parents: string[];
      refs: string[];
    }>;
    branches: Array<{ name: string; sha: string; isHead: boolean }>;
    tags: Array<{ name: string; sha: string }>;
  }> {
    // Get commits with graph structure. Fields (NUL-separated): full SHA, short
    // SHA, subject, author name, author date, committer name, committer date,
    // parent SHAs, ref names. VsGit's history shows author and committer (and both
    // of their dates) as separate columns, so we capture %cn/%ci alongside %an/%ai.
    // --topo-order guarantees a child is always listed before its parents, which
    // keeps the lane layout free of backtracking edges (date-order can interleave
    // branches and place a child after a parent dated earlier).
    const args = ["log", `--format=${GRAPH_LOG_FORMAT}`, "--topo-order"];

    if (options.limit !== undefined) {
      args.push(`--max-count=${options.limit}`);
    }

    if (options.all) {
      args.push("--all");
    } else if (options.branches && options.branches.length > 0) {
      for (const branch of options.branches) {
        args.push(safeRef(branch, "branch"));
      }
    }

    const out = await this.git.stdout(args, { cwd: this.root });
    const commits = parseGraphLog(out);

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
      ["show", "--name-status", "-z", "-M", "--format=", safeRef(sha, "commit")],
      { cwd: this.root },
    );
    return parseNameStatus(out);
  }

  /** Files changed between two refs (name-status, rename-aware). */
  async diffFiles(ref1: string, ref2: string): Promise<CommitFile[]> {
    const out = await this.git.stdout(
      ["diff", "--name-status", "-z", "-M", safeRef(ref1), safeRef(ref2)],
      { cwd: this.root },
    );
    return parseNameStatus(out);
  }

  /** Local + remote branches that contain a commit (git branch --contains). */
  async branchesContaining(sha: string): Promise<string[]> {
    const out = await this.git.stdout(
      ["branch", "-a", `--contains=${safeRef(sha, "commit")}`, "--format=%(refname:short)"],
      { cwd: this.root },
    );
    return out.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  }

  /** Tags that contain a commit (git tag --contains). */
  async tagsContaining(sha: string): Promise<string[]> {
    const out = await this.git.stdout(
      ["tag", `--contains=${safeRef(sha, "commit")}`],
      { cwd: this.root },
    );
    return out.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  }

  /**
   * Tag-relative name of a commit (git describe). `--always` falls back to an
   * abbreviated SHA when no tag is reachable, so this never throws on a valid ref.
   */
  async describe(sha = "HEAD"): Promise<string> {
    const out = await this.git.stdout(
      ["describe", "--tags", "--always", safeRef(sha, "commit")],
      { cwd: this.root },
    );
    return out.trim();
  }

  // --- Commit operations --------------------------------------------------

  async checkoutDetached(sha: string): Promise<void> {
    await this.git.run(["checkout", safeRef(sha, "commit")], { cwd: this.root });
  }

  async cherryPick(sha: string): Promise<void> {
    await this.git.run(["cherry-pick", safeRef(sha, "commit")], { cwd: this.root });
  }

  async revert(sha: string): Promise<void> {
    await this.git.run(["revert", "--no-edit", safeRef(sha, "commit")], { cwd: this.root });
  }

  /** Fetch a specific refspec from a remote (e.g. for GitHub PRs). */
  async fetchRefspec(remote: string, refspec: string, env?: NodeJS.ProcessEnv): Promise<void> {
    await this.git.run(
      ["fetch", safeRef(remote, "remote"), safeRef(refspec, "refspec")],
      { cwd: this.root, env },
    );
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
        ["verify-commit", "--verbose", safeRef(sha, "commit")],
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

  async reset(sha: string, mode: "soft" | "mixed" | "hard" | "keep" | "merge"): Promise<void> {
    await this.git.run(["reset", `--${mode}`, safeRef(sha, "commit")], { cwd: this.root });
  }

  async createBranchAt(name: string, sha: string, checkout: boolean): Promise<void> {
    safeRef(name, "branch name");
    safeRef(sha, "start point");
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
    safeRef(name, "tag");
    safeRef(sha, "commit");
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
    await this.git.run(
      ["push", safeRef(remote, "remote"), `:refs/tags/${safeRef(name, "tag")}`],
      { cwd: this.root },
    );
  }

  /** Checkout a remote branch creating a local tracking branch. */
  async checkoutRemoteBranch(
    remoteBranch: string,
    localName: string,
  ): Promise<void> {
    await this.git.run(
      ["checkout", "-b", safeRef(localName, "branch"), "--track", safeRef(remoteBranch, "branch")],
      { cwd: this.root },
    );
  }

  /** Delete a remote branch via push with empty src refspec. */
  async deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    await this.git.run(
      ["push", safeRef(remote, "remote"), `:refs/heads/${safeRef(branch, "branch")}`],
      { cwd: this.root },
    );
  }

  /** Replace a working-tree file with its content at a given ref. */
  async replaceWithRef(relPath: string, ref: string): Promise<void> {
    await this.git.run(["checkout", safeRef(ref), "--", relPath], { cwd: this.root });
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

  /**
   * Delete tracked files from both the working tree and the index (git rm).
   * `recursive` (-r) is required to remove tracked directories.
   */
  async removeFiles(
    paths: string[],
    opts: { force?: boolean; recursive?: boolean } = {},
  ): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    const args = ["rm"];
    if (opts.force) {
      args.push("-f");
    }
    if (opts.recursive) {
      args.push("-r");
    }
    // Paths follow `--`, so a name beginning with "-" is data, not an option.
    args.push("--", ...paths);
    await this.git.run(args, { cwd: this.root });
  }

  /** Move or rename a tracked file/directory (git mv). */
  async moveFile(source: string, dest: string): Promise<void> {
    // `git mv` honours the `--` separator, so option-like paths are inert and
    // need no safeRef (mirrors stage()/untrack()).
    await this.git.run(["mv", "--", source, dest], { cwd: this.root });
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
    await this.git.run(
      ["stash", "branch", safeRef(name, "branch"), safeRef(stashRef, "stash")],
      { cwd: this.root },
    );
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
    safeRef(branch, "branch");
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

  /** Move a linked worktree to a new location (git worktree move). */
  async worktreeMove(from: string, to: string): Promise<void> {
    // `git worktree move` has no `--` separator, so both paths sit in option
    // position — guard them like worktreeLock().
    await this.git.run(
      ["worktree", "move", safeRef(from, "worktree path"), safeRef(to, "destination path")],
      { cwd: this.root },
    );
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
      args.push(safeRef(sha, "commit"));
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
    const tasks = [
      this.refreshRefs(),
      this.refreshStatus(),
      this.refreshRemotes(),
      this.refreshStashes(),
      this.refreshHead(),
    ];
    // Submodule enumeration can recurse into nested repositories and is not
    // needed for normal staging/commit workflows. Refresh it only after a view
    // has requested submodule data at least once.
    if (this.submodulesLoaded) {
      tasks.push(this.refreshSubmodules());
    }
    await Promise.all(tasks);
  }

  async ensureSubmodules(): Promise<void> {
    if (this.submodulesLoaded) {
      return;
    }
    if (!this.submodulesInFlight) {
      this.submodulesInFlight = this.refreshSubmodules()
        .then(() => {
          this.submodulesLoaded = true;
        })
        .finally(() => {
          this.submodulesInFlight = undefined;
        });
    }
    return this.submodulesInFlight;
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
      ["stash", "list", "--format=%gd\x1f%H\x1f%P\x1f%gs"],
      { cwd: this.root },
    );
    const stashes: StashInfo[] = [];
    for (const line of out.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      const [ref, objectId, parents, message] = line.split("\x1f");
      const baseObjectId = parents?.split(/\s+/).filter(Boolean)[0];
      const m = /stash@\{(\d+)\}/.exec(ref);
      stashes.push({
        ref,
        objectId: objectId || undefined,
        baseObjectId,
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
