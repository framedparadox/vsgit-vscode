import * as path from "node:path";
import { GitExecutor } from "./GitExecutor";
import { GitError } from "./GitError";
import { safeRef, safeRemoteUrl, safeRevRange } from "./argGuard";
import { FOR_EACH_REF_FORMAT, parseForEachRef, RefInfo } from "./parsers/refs";
import { FileChangeState, parseStatusV2, StatusResult } from "./parsers/status";
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
import { GRAPH_LOG_FORMAT, GRAPH_REF_EXCLUDES, GraphCommit, parseGraphLog } from "./parsers/graphLog";

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

/** Name-status letter for each parsed file state. */
const STATE_LETTER: Partial<Record<FileChangeState, string>> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  conflicted: "U",
};

/** Multi-step operations git can pause for conflict resolution. */
export type SequencerKind = "rebase" | "merge" | "cherry-pick" | "revert" | "am";

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

  /**
   * Continue/skip/abort an in-progress rebase, merge, cherry-pick, revert, or
   * `git am`.
   *
   * `--continue` (and `--skip` while replaying a sequence) commits the resolved
   * state, which makes git launch an editor for the message. The extension
   * host has no terminal, so without an editor git either fails ("Terminal is
   * dumb, but EDITOR unset") or blocks on a terminal editor forever. Unless
   * the caller routes GIT_EDITOR somewhere interactive, accept the message git
   * prepared (`:` is git's built-in "no-op editor").
   */
  async sequencerAction(
    kind: SequencerKind,
    action: "continue" | "skip" | "abort",
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    if (kind === "merge" && action === "skip") {
      throw new GitError("A merge cannot be skipped; continue or abort it.", -1, "", "", []);
    }
    const runEnv = action === "abort" ? env : { GIT_EDITOR: ":", ...env };
    await this.git.run([kind, `--${action}`], { cwd: this.root, env: runEnv });
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
    opts: {
      rebase?: boolean;
      ffOnly?: boolean;
      remote?: string;
      branch?: string;
      env?: NodeJS.ProcessEnv;
    } = {},
  ): Promise<void> {
    const args = ["pull"];
    if (opts.rebase) {
      args.push("--rebase");
    } else if (opts.ffOnly) {
      args.push("--ff-only");
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

  /**
   * Explicit refspec for pushing local `branch` to `remote`. With git's
   * default `push.default=simple`, a bare `git push <remote>` refuses a branch
   * that has no upstream yet ("The current branch has no upstream branch") and
   * one whose upstream has a different name, so always name the destination:
   * the tracked branch when it lives on this remote, otherwise the same name.
   */
  pushRefspec(branch: string, remote: string): string {
    const upstream = this.localBranches.find((b) => b.shortName === branch)?.upstream;
    const prefix = `${remote}/`;
    if (upstream && upstream.startsWith(prefix)) {
      const target = upstream.slice(prefix.length);
      return target === branch ? branch : `${branch}:refs/heads/${target}`;
    }
    return branch;
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

  /**
   * Stash changes. `includeUntracked` also stashes new files; `keepIndex`
   * leaves staged changes in place; `staged` stashes only what is staged.
   * `paths` limits the stash to those files.
   */
  async stashPush(
    message: string | undefined,
    includeUntracked: boolean,
    opts: { keepIndex?: boolean; staged?: boolean; paths?: string[] } = {},
  ): Promise<void> {
    const args = ["stash", "push"];
    if (opts.staged) {
      args.push("--staged");
    } else if (includeUntracked) {
      args.push("--include-untracked");
    }
    if (opts.keepIndex && !opts.staged) {
      args.push("--keep-index");
    }
    if (message) {
      args.push("-m", message);
    }
    if (opts.paths && opts.paths.length > 0) {
      args.push("--", ...opts.paths);
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

  /**
   * Files changed in a stash, name-status. Includes files stashed with
   * `--include-untracked` where git supports showing them (2.32+).
   */
  async stashFiles(ref: string): Promise<CommitFile[]> {
    const stash = safeRef(ref, "stash");
    const out = await this.git
      .stdout(["stash", "show", "--name-status", "-z", "--include-untracked", stash], {
        cwd: this.root,
      })
      .catch(() =>
        this.git.stdout(["stash", "show", "--name-status", "-z", stash], { cwd: this.root }),
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

  /** Detect whether a rebase/merge/cherry-pick/revert/am is in progress. */
  async inProgressOperation(): Promise<SequencerKind | undefined> {
    const gitDir = await this.gitDirectory().catch(() =>
      path.join(this.root, ".git"),
    );
    const fs = await import("node:fs");
    const exists = (p: string) => fs.existsSync(path.join(gitDir, p));
    // `git am` shares the rebase-apply directory with the old apply backend
    // of `git rebase`; the `applying` marker tells them apart. Continuing an
    // am session with `git rebase --continue` would fail.
    if (exists("rebase-apply/applying")) {
      return "am";
    }
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

  /**
   * True when continuing the stopped rebase will ask for a commit message:
   * the stopped step or a remaining step is a reword, a squash, or a
   * `fixup -c`. Such rebases need a real message editor on continue/skip; any
   * other rebase (including every non-interactive one) can accept git's
   * prepared messages.
   */
  async rebaseNeedsMessageEditor(): Promise<boolean> {
    try {
      const fs = await import("node:fs/promises");
      const read = async (name: string) =>
        fs.readFile(await this.gitPath(`rebase-merge/${name}`), "utf8").catch(() => "");
      const [done, todo] = await Promise.all([read("done"), read("git-rebase-todo")]);
      const steps = (text: string) =>
        text.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
      const stopped = steps(done).slice(-1);
      return [...stopped, ...steps(todo)].some((line) =>
        /^(reword|r|squash|s)\s/.test(line) || /^(fixup|f)\s+-c\s/.test(line),
      );
    } catch {
      return false;
    }
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
      args.push(safeRevRange(options.revRange, "rev range"));
    }
    if (options.file) {
      args.push("--follow", "--", options.file);
    }
    const out = await this.git.stdout(args, { cwd: this.root });
    return parseLog(out, this.remotes.map((r) => r.name));
  }

  /**
   * Commit graph data for visualization: commits (child before parent) with
   * parents and full ref decorations, plus the HEAD commit and whether more
   * commits exist beyond `limit`.
   *
   * Only branch, remote-tracking, and tag history is walked. `--all` would
   * also walk git's internal refs — the stash (whose "WIP on"/"index on"
   * commits would appear as merge commits), notes, maintenance prefetch refs,
   * replace refs, and filter-branch backups — none of which belong in a
   * branch graph. Stashes are decorated onto their base commit by the caller.
   */
  async graphLog(options: {
    limit?: number;
    /** Walk remote-tracking branches too (default true). */
    remotes?: boolean;
    /** Restrict the walk to these refs instead of every branch and tag. */
    branches?: string[];
    order?: "date" | "author-date" | "topo";
    /** @deprecated kept for callers written against the old API. */
    all?: boolean;
  } = {}): Promise<{
    commits: GraphCommit[];
    headSha: string | undefined;
    hasMore: boolean;
  }> {
    // Every supported order lists a child before all of its parents, which the
    // lane layout relies on. `topo` also keeps each branch's commits together.
    const orderFlag =
      options.order === "date"
        ? "--date-order"
        : options.order === "author-date"
          ? "--author-date-order"
          : "--topo-order";
    // `--decorate=full` makes %D print full ref names (refs/heads/x,
    // refs/remotes/origin/x, tag: refs/tags/x) so a local branch called
    // `origin/x`, or a branch and tag sharing a name, classify correctly.
    const args = ["log", `--format=${GRAPH_LOG_FORMAT}`, "--decorate=full", orderFlag];

    const limit = options.limit;
    if (limit !== undefined) {
      // One extra commit tells us whether a "load more" is possible.
      args.push(`--max-count=${limit + 1}`);
    }

    // Validate untrusted branch names before running anything.
    const branchArgs = (options.branches ?? []).map((branch) => safeRef(branch, "branch"));
    const headSha = await this.headCommit();
    if (branchArgs.length > 0) {
      args.push(...branchArgs);
    } else if (options.remotes === false) {
      // HEAD keeps a detached checkout visible; an unborn HEAD would be fatal.
      args.push("--branches", "--tags", ...(headSha ? ["HEAD"] : []));
    } else {
      args.push(...GRAPH_REF_EXCLUDES, "--all");
    }

    const out = await this.git.stdout(args, { cwd: this.root });
    let commits = parseGraphLog(out);
    const hasMore = limit !== undefined && commits.length > limit;
    if (hasMore) {
      commits = commits.slice(0, limit);
    }
    return { commits, headSha, hasMore };
  }

  /** SHA of HEAD, or undefined on an unborn branch. */
  async headCommit(): Promise<string | undefined> {
    try {
      const out = await this.git.stdout(["rev-parse", "--verify", "-q", "HEAD"], {
        cwd: this.root,
      });
      return out.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Parent SHAs of a commit (two or more for a merge). */
  async commitParents(sha: string): Promise<string[]> {
    const out = await this.git.stdout(
      ["rev-list", "--parents", "-n", "1", "--end-of-options", safeRef(sha, "commit")],
      { cwd: this.root },
    );
    return out.trim().split(/\s+/).slice(1).filter(Boolean);
  }

  /** Full message and identities of a commit, for commit-details panes. */
  async commitDetails(sha: string): Promise<{
    authorName: string;
    authorEmail: string;
    committerName: string;
    committerEmail: string;
    message: string;
  }> {
    const out = await this.git.stdout(
      ["show", "-s", "--format=%an%x00%ae%x00%cn%x00%ce%x00%B", "--end-of-options", safeRef(sha, "commit")],
      { cwd: this.root },
    );
    const [authorName = "", authorEmail = "", committerName = "", committerEmail = "", ...rest] =
      out.split("\x00");
    return {
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      message: rest.join("\x00").replace(/\s+$/, ""),
    };
  }

  /** True when `ancestor` is reachable from `descendant` (default HEAD). */
  async isAncestor(ancestor: string, descendant = "HEAD"): Promise<boolean> {
    const result = await this.git.run(
      ["merge-base", "--is-ancestor", safeRef(ancestor, "commit"), safeRef(descendant, "commit")],
      { cwd: this.root, okCodes: [1] },
    );
    return result.exitCode === 0;
  }

  /**
   * Uncommitted changes (staged and unstaged, combined) as name-status
   * records, for the graph's "Uncommitted Changes" row.
   */
  get workingChanges(): CommitFile[] {
    return this.status.changes
      .filter((change) => change.worktreeState !== "ignored")
      .map((change) => {
        if (change.conflicted) {
          return { status: "U", path: change.path };
        }
        const state = change.worktreeState ?? change.indexState;
        const renamed = change.indexState === "renamed" || change.indexState === "copied";
        return {
          status: state === "untracked" ? "?" : renamed ? "R" : STATE_LETTER[state ?? "modified"] ?? "M",
          path: change.path,
          origPath: renamed ? change.origPath : undefined,
        };
      });
  }

  /**
   * Split a remote-tracking branch's short name ("origin/feature/x") into its
   * remote and branch, preferring the longest configured remote name so
   * remotes that contain a slash work too.
   */
  splitRemoteBranch(shortName: string): { remote: string; branch: string } | undefined {
    const remote = this.remotes
      .map((r) => r.name)
      .filter((name) => shortName.startsWith(`${name}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (remote) {
      return { remote, branch: shortName.slice(remote.length + 1) };
    }
    const slash = shortName.indexOf("/");
    return slash > 0
      ? { remote: shortName.slice(0, slash), branch: shortName.slice(slash + 1) }
      : undefined;
  }

  /**
   * Files touched by a commit (name-status, rename-aware). A merge commit is
   * compared with its first parent — plain `git show` prints a combined diff
   * that lists nothing for a clean merge — which matches the `<sha>~1` left
   * side the diff editors open.
   */
  async commitFiles(sha: string): Promise<CommitFile[]> {
    const out = await this.git.stdout(
      ["show", "--name-status", "-z", "-M", "-m", "--first-parent", "--format=", safeRef(sha, "commit")],
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

  /** Best common ancestor of two revisions, or undefined when unrelated. */
  async mergeBase(ref1: string, ref2: string): Promise<string | undefined> {
    // Guard outside the try so an option-injection attempt surfaces as an
    // error rather than being silently swallowed as "no merge base".
    const safe1 = safeRef(ref1);
    const safe2 = safeRef(ref2);
    try {
      const out = await this.git.stdout(["merge-base", safe1, safe2], {
        cwd: this.root,
      });
      return out.trim() || undefined;
    } catch {
      return undefined; // no common ancestor (unrelated histories)
    }
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

  /**
   * Cherry-pick a commit. Merge commits need `mainline` (1-based parent
   * number): git refuses to pick a merge without knowing which side it is
   * relative to.
   */
  async cherryPick(sha: string, opts: { mainline?: number; noCommit?: boolean } = {}): Promise<void> {
    const args = ["cherry-pick"];
    if (opts.mainline) {
      args.push("-m", String(Math.trunc(opts.mainline)));
    }
    if (opts.noCommit) {
      args.push("--no-commit");
    }
    args.push(safeRef(sha, "commit"));
    await this.git.run(args, { cwd: this.root });
  }

  /** Revert a commit; merge commits need `mainline` like cherryPick. */
  async revert(sha: string, opts: { mainline?: number } = {}): Promise<void> {
    const args = ["revert", "--no-edit"];
    if (opts.mainline) {
      args.push("-m", String(Math.trunc(opts.mainline)));
    }
    args.push(safeRef(sha, "commit"));
    await this.git.run(args, { cwd: this.root });
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

  /**
   * Replace working-tree files with their content at a given ref.
   * Returns paths that did not exist at `ref` (the rest were restored). Throws
   * only when every path fails, so one new/untracked file in a multi-select
   * does not block the rest of the checkout.
   */
  async replaceWithRef(relPaths: string | string[], ref: string): Promise<string[]> {
    const paths = Array.isArray(relPaths) ? relPaths : [relPaths];
    if (paths.length === 0) {
      return [];
    }
    const safe = safeRef(ref);
    try {
      // One git process for the whole selection when every path exists at ref.
      await this.git.run(["checkout", safe, "--", ...paths], {
        cwd: this.root,
      });
      return [];
    } catch (e) {
      if (paths.length === 1) {
        throw e;
      }
      const failed: string[] = [];
      for (const p of paths) {
        try {
          await this.git.run(["checkout", safe, "--", p], { cwd: this.root });
        } catch {
          failed.push(p);
        }
      }
      if (failed.length === paths.length) {
        throw e;
      }
      return failed;
    }
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
      // " <sha> <path> (<describe>)" with a leading status char. The path may
      // contain spaces; the describe suffix is optional.
      const match = /^(.)([0-9a-f]+) (.+?)(?: \([^()]*\))?$/.exec(line);
      if (!match) {
        continue;
      }
      const [, status, objectId, subPath] = match;
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
