import { test } from "node:test";
import assert from "node:assert";
import { Repository } from "./Repository";
import { GitExecutor, GitResult, GitRunOptions } from "./GitExecutor";
import { GitError } from "./GitError";
import { LOG_FORMAT } from "./parsers/log";

/**
 * These tests verify the SECURITY WIRING of Repository: that every method which
 * accepts a ref / SHA / branch / tag / remote name / URL routes it through the
 * argGuard before it reaches git's argv. We do not spawn git — instead a fake
 * GitExecutor records the exact argv each method would run.
 *
 * Two properties are checked per method:
 *   1. Hostile input (an option-like value, or an ext::/fd:: URL) THROWS a
 *      GitError and never reaches the executor (recorded calls stay empty).
 *   2. Valid input produces the precise argv we expect (so the guard didn't
 *      mangle a legitimate ref, and the command is still correct).
 */

interface RecordedCall {
  args: string[];
  options: GitRunOptions;
}

/** A GitExecutor stand-in that records argv and returns canned stdout. */
class FakeGitExecutor extends GitExecutor {
  calls: RecordedCall[] = [];
  /** Canned stdout for `run`/`stdout`. Empty string => parsers yield []. */
  nextStdout = "";

  constructor() {
    super("git-not-actually-run");
  }

  override async run(args: string[], options: GitRunOptions): Promise<GitResult> {
    this.calls.push({ args, options });
    return { stdout: this.nextStdout, stderr: "", exitCode: 0 };
  }

  override async stdout(args: string[], options: GitRunOptions): Promise<string> {
    this.calls.push({ args, options });
    return this.nextStdout;
  }
}

function makeRepo(): { repo: Repository; git: FakeGitExecutor } {
  const git = new FakeGitExecutor();
  const repo = new Repository("/repo/root", git);
  return { repo, git };
}

/** Canonical hostile inputs that every guarded ref parameter must reject. */
const HOSTILE_REFS = ["-f", "--output=/tmp/x", "--upload-pack=evil", "", "--"];
/** Hostile URLs: option-like AND remote-helper transports. */
const HOSTILE_URLS = [
  "--upload-pack=evil",
  "ext::sh -c id",
  "fd::17",
  "EXT::sh -c id",
  "",
];

/**
 * Assert that calling `fn` with a hostile value throws GitError and that NO git
 * command was issued (the guard fired before the executor was touched).
 */
async function assertRejectsBeforeGit(
  git: FakeGitExecutor,
  fn: () => Promise<unknown>,
  label: string,
): Promise<void> {
  git.calls = [];
  await assert.rejects(fn(), GitError, `expected rejection for ${label}`);
  assert.strictEqual(
    git.calls.length,
    0,
    `${label}: git must not be invoked when the guard rejects`,
  );
}

// ===========================================================================
// Branch operations
// ===========================================================================

test("renameBranch: rejects option-like old/new names, accepts valid", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.renameBranch(bad, "new"), `old=${bad}`);
    await assertRejectsBeforeGit(git, () => repo.renameBranch("old", bad), `new=${bad}`);
  }
  git.calls = [];
  await repo.renameBranch("old", "new");
  assert.deepStrictEqual(git.calls[0].args, ["branch", "-m", "old", "new"]);
});

test("deleteBranch: rejects option-like name, force toggles -d/-D", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.deleteBranch(bad, false), `name=${bad}`);
    await assertRejectsBeforeGit(git, () => repo.deleteBranch(bad, true), `name=${bad}`);
  }
  git.calls = [];
  await repo.deleteBranch("feature/x", false);
  assert.deepStrictEqual(git.calls[0].args, ["branch", "-d", "feature/x"]);
  git.calls = [];
  await repo.deleteBranch("feature/x", true);
  assert.deepStrictEqual(git.calls[0].args, ["branch", "-D", "feature/x"]);
});

test("setUpstream: rejects option-like branch and upstream; set vs unset", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.setUpstream(bad, "origin/main"), `branch=${bad}`);
  }
  // A falsy (empty) upstream is the "unset" path, not an injection — only
  // NON-empty option-like upstreams should be rejected.
  for (const bad of ["-x", "--set-upstream-to=evil", "--evil"]) {
    await assertRejectsBeforeGit(git, () => repo.setUpstream("main", bad), `upstream=${bad}`);
  }
  git.calls = [];
  await repo.setUpstream("main", "origin/main");
  assert.deepStrictEqual(git.calls[0].args, [
    "branch",
    "--set-upstream-to=origin/main",
    "main",
  ]);
  // Both no-arg and empty-string take the unset path.
  git.calls = [];
  await repo.setUpstream("main");
  assert.deepStrictEqual(git.calls[0].args, ["branch", "--unset-upstream", "main"]);
  git.calls = [];
  await repo.setUpstream("main", "");
  assert.deepStrictEqual(git.calls[0].args, ["branch", "--unset-upstream", "main"]);
});

test("checkoutRef: rejects option-like ref, accepts valid", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.checkoutRef(bad), `ref=${bad}`);
  }
  git.calls = [];
  await repo.checkoutRef("main");
  assert.deepStrictEqual(git.calls[0].args, ["checkout", "main"]);
});

test("createBranchAt: rejects option-like name and start point", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.createBranchAt(bad, "HEAD", false), `name=${bad}`);
    await assertRejectsBeforeGit(git, () => repo.createBranchAt("x", bad, false), `sha=${bad}`);
  }
  git.calls = [];
  await repo.createBranchAt("feat", "abc1234", false);
  assert.deepStrictEqual(git.calls[0].args, ["branch", "feat", "abc1234"]);
  git.calls = [];
  await repo.createBranchAt("feat", "abc1234", true);
  assert.deepStrictEqual(git.calls[0].args, ["checkout", "-b", "feat", "abc1234"]);
});

// ===========================================================================
// Merge / rebase / drop
// ===========================================================================

test("merge: rejects option-like ref; flags map correctly", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.merge(bad), `ref=${bad}`);
  }
  git.calls = [];
  await repo.merge("feature", { noFf: true, squash: true });
  assert.deepStrictEqual(git.calls[0].args, ["merge", "--no-ff", "--squash", "feature"]);
});

test("rebase: rejects option-like onto; interactive adds -i", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.rebase(bad), `onto=${bad}`);
  }
  git.calls = [];
  await repo.rebase("main", { interactive: true });
  assert.deepStrictEqual(git.calls[0].args, ["rebase", "-i", "main"]);
});

test("dropCommit: rejects option-like sha, builds --onto <sha>^ <sha>", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.dropCommit(bad), `sha=${bad}`);
  }
  git.calls = [];
  await repo.dropCommit("abc123");
  assert.deepStrictEqual(git.calls[0].args, ["rebase", "--onto", "abc123^", "abc123"]);
});

// ===========================================================================
// Remotes & URLs  (URL paths block ext::/fd:: RCE)
// ===========================================================================

test("addRemote: rejects bad name and bad/ext:: URL; accepts valid", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.addRemote(bad, "https://x/r.git"), `name=${bad}`);
  }
  for (const bad of HOSTILE_URLS) {
    await assertRejectsBeforeGit(git, () => repo.addRemote("origin", bad), `url=${bad}`);
  }
  git.calls = [];
  await repo.addRemote("origin", "https://github.com/o/r.git");
  assert.deepStrictEqual(git.calls[0].args, [
    "remote",
    "add",
    "origin",
    "https://github.com/o/r.git",
  ]);
});

test("removeRemote / pruneRemote / renameRemote: reject option-like names", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.removeRemote(bad), `remove ${bad}`);
    await assertRejectsBeforeGit(git, () => repo.pruneRemote(bad), `prune ${bad}`);
    await assertRejectsBeforeGit(git, () => repo.renameRemote(bad, "new"), `rename old ${bad}`);
    await assertRejectsBeforeGit(git, () => repo.renameRemote("old", bad), `rename new ${bad}`);
  }
  git.calls = [];
  await repo.removeRemote("origin");
  assert.deepStrictEqual(git.calls[0].args, ["remote", "remove", "origin"]);
  git.calls = [];
  await repo.renameRemote("origin", "upstream");
  assert.deepStrictEqual(git.calls[0].args, ["remote", "rename", "origin", "upstream"]);
});

test("setRemoteUrl: rejects bad name and ext:: URL; accepts valid", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_URLS) {
    await assertRejectsBeforeGit(git, () => repo.setRemoteUrl("origin", bad), `url=${bad}`);
  }
  git.calls = [];
  await repo.setRemoteUrl("origin", "git@github.com:o/r.git");
  assert.deepStrictEqual(git.calls[0].args, [
    "remote",
    "set-url",
    "origin",
    "git@github.com:o/r.git",
  ]);
});

// ===========================================================================
// fetch / pull / push
// ===========================================================================

test("fetch: rejects option-like remote; --all bypasses positional remote", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.fetch("-x"), "remote=-x");
  git.calls = [];
  await repo.fetch("origin", { prune: true, tags: true });
  assert.deepStrictEqual(git.calls[0].args, ["fetch", "--prune", "--tags", "origin"]);
  git.calls = [];
  await repo.fetch("origin", { all: true });
  // With --all the remote is intentionally omitted, so a bad remote is moot.
  assert.deepStrictEqual(git.calls[0].args, ["fetch", "--all"]);
});

test("pull: rejects option-like remote and branch", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.pull({ remote: "-x" }), "remote=-x");
  await assertRejectsBeforeGit(
    git,
    () => repo.pull({ remote: "origin", branch: "--evil" }),
    "branch=--evil",
  );
  git.calls = [];
  await repo.pull({ rebase: true, remote: "origin", branch: "main" });
  assert.deepStrictEqual(git.calls[0].args, ["pull", "--rebase", "origin", "main"]);
});

test("push: rejects option-like remote and refspec; flags map correctly", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.push({ remote: "-x" }), "remote=-x");
  await assertRejectsBeforeGit(
    git,
    () => repo.push({ remote: "origin", refspec: "--evil" }),
    "refspec=--evil",
  );
  git.calls = [];
  await repo.push({
    remote: "origin",
    refspec: "HEAD:refs/heads/main",
    setUpstream: true,
    forceWithLease: true,
  });
  assert.deepStrictEqual(git.calls[0].args, [
    "push",
    "-u",
    "--force-with-lease",
    "origin",
    "HEAD:refs/heads/main",
  ]);
});

// ===========================================================================
// Tags
// ===========================================================================

test("deleteTag / pushTag: reject option-like values; build refspecs", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.deleteTag("-x"), "tag=-x");
  await assertRejectsBeforeGit(git, () => repo.pushTag("-x", "v1"), "remote=-x");
  await assertRejectsBeforeGit(git, () => repo.pushTag("origin", "-x"), "tag=-x");
  git.calls = [];
  await repo.deleteTag("v1.0.0");
  assert.deepStrictEqual(git.calls[0].args, ["tag", "-d", "v1.0.0"]);
  git.calls = [];
  await repo.pushTag("origin", "v1.0.0");
  assert.deepStrictEqual(git.calls[0].args, ["push", "origin", "refs/tags/v1.0.0"]);
});

test("createTagAt: rejects option-like name/sha; annotated/lightweight/signed/force", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.createTagAt("-x", "HEAD"), "name=-x");
  await assertRejectsBeforeGit(git, () => repo.createTagAt("v1", "--evil"), "sha=--evil");
  git.calls = [];
  await repo.createTagAt("v1", "abc123");
  assert.deepStrictEqual(git.calls[0].args, ["tag", "v1", "abc123"]);
  git.calls = [];
  await repo.createTagAt("v1", "abc123", "msg");
  assert.deepStrictEqual(git.calls[0].args, ["tag", "-a", "v1", "-m", "msg", "abc123"]);
  git.calls = [];
  await repo.createTagAt("v1", "abc123", "msg", false, true);
  assert.deepStrictEqual(git.calls[0].args, ["tag", "-f", "-a", "v1", "-m", "msg", "abc123"]);
});

test("deleteRemoteTag: rejects option-like remote/name; builds delete refspec", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.deleteRemoteTag("-x", "v1"), "remote=-x");
  await assertRejectsBeforeGit(git, () => repo.deleteRemoteTag("origin", "-x"), "name=-x");
  git.calls = [];
  await repo.deleteRemoteTag("origin", "v1.0.0");
  assert.deepStrictEqual(git.calls[0].args, ["push", "origin", ":refs/tags/v1.0.0"]);
});

// ===========================================================================
// Remote branches
// ===========================================================================

test("checkoutRemoteBranch: rejects option-like local/remote names", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(
    git,
    () => repo.checkoutRemoteBranch("origin/x", "-local"),
    "local=-local",
  );
  await assertRejectsBeforeGit(
    git,
    () => repo.checkoutRemoteBranch("--evil", "local"),
    "remote=--evil",
  );
  git.calls = [];
  await repo.checkoutRemoteBranch("origin/feature", "feature");
  assert.deepStrictEqual(git.calls[0].args, [
    "checkout",
    "-b",
    "feature",
    "--track",
    "origin/feature",
  ]);
});

test("deleteRemoteBranch: rejects option-like remote/branch; builds delete refspec", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.deleteRemoteBranch("-x", "main"), "remote=-x");
  await assertRejectsBeforeGit(git, () => repo.deleteRemoteBranch("origin", "-x"), "branch=-x");
  git.calls = [];
  await repo.deleteRemoteBranch("origin", "feature");
  assert.deepStrictEqual(git.calls[0].args, ["push", "origin", ":refs/heads/feature"]);
});

// ===========================================================================
// Gerrit
// ===========================================================================

test("pushForReview: rejects option-like remote/target; builds refs/for refspec", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.pushForReview("-x", "main"), "remote=-x");
  await assertRejectsBeforeGit(git, () => repo.pushForReview("origin", "-x"), "target=-x");
  git.calls = [];
  await repo.pushForReview("origin", "main");
  assert.deepStrictEqual(git.calls[0].args, ["push", "origin", "HEAD:refs/for/main"]);
});

// ===========================================================================
// Notes
// ===========================================================================

test("notes add/edit/remove/show: reject option-like ref; keep message safe", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.notesAdd("-x", "m"), "add ref=-x");
  await assertRejectsBeforeGit(git, () => repo.notesEdit("-x", "m"), "edit ref=-x");
  await assertRejectsBeforeGit(git, () => repo.notesRemove("-x"), "remove ref=-x");
  await assertRejectsBeforeGit(git, () => repo.notesShow("-x"), "show ref=-x");
  git.calls = [];
  await repo.notesAdd("abc123", "a note");
  assert.deepStrictEqual(git.calls[0].args, ["notes", "add", "-m", "a note", "abc123"]);
  git.calls = [];
  await repo.notesEdit("abc123", "a note");
  assert.deepStrictEqual(git.calls[0].args, ["notes", "add", "-f", "-m", "a note", "abc123"]);
  // A message that *looks* option-like is still safe (it follows -m, not positional).
  git.calls = [];
  await repo.notesAdd("abc123", "--not-an-option");
  assert.deepStrictEqual(git.calls[0].args, ["notes", "add", "-m", "--not-an-option", "abc123"]);
  // notesShow returns "" for "no notes" but must NOT swallow a guard rejection.
  git.calls = [];
  await repo.notesShow("abc123");
  assert.deepStrictEqual(git.calls[0].args, ["notes", "show", "abc123"]);
});

// ===========================================================================
// Stash
// ===========================================================================

test("stash apply/pop/drop/files: reject option-like ref", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.stashApply("-x"), "apply -x");
  await assertRejectsBeforeGit(git, () => repo.stashPop("-x"), "pop -x");
  await assertRejectsBeforeGit(git, () => repo.stashDrop("-x"), "drop -x");
  await assertRejectsBeforeGit(git, () => repo.stashFiles("-x"), "files -x");
  git.calls = [];
  await repo.stashApply("stash@{0}");
  assert.deepStrictEqual(git.calls[0].args, ["stash", "apply", "stash@{0}"]);
});

test("stashBranch: rejects option-like name/stashRef", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.stashBranch("-x", "stash@{0}"), "name=-x");
  await assertRejectsBeforeGit(git, () => repo.stashBranch("feat", "-x"), "stash=-x");
  git.calls = [];
  await repo.stashBranch("feat", "stash@{0}");
  assert.deepStrictEqual(git.calls[0].args, ["stash", "branch", "feat", "stash@{0}"]);
});

test("stashClear: issues `stash clear` with no untrusted args", async () => {
  const { repo, git } = makeRepo();
  git.calls = [];
  await repo.stashClear();
  assert.deepStrictEqual(git.calls[0].args, ["stash", "clear"]);
});

// ===========================================================================
// Commit operations
// ===========================================================================

test("checkoutDetached / cherryPick / revert / reset: reject option-like sha", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.checkoutDetached("-x"), "detached -x");
  await assertRejectsBeforeGit(git, () => repo.cherryPick("-x"), "cherry -x");
  await assertRejectsBeforeGit(git, () => repo.revert("-x"), "revert -x");
  await assertRejectsBeforeGit(git, () => repo.reset("-x", "hard"), "reset -x");
  git.calls = [];
  await repo.cherryPick("abc123");
  assert.deepStrictEqual(git.calls[0].args, ["cherry-pick", "abc123"]);
  git.calls = [];
  await repo.revert("abc123");
  assert.deepStrictEqual(git.calls[0].args, ["revert", "--no-edit", "abc123"]);
  git.calls = [];
  await repo.reset("abc123", "soft");
  assert.deepStrictEqual(git.calls[0].args, ["reset", "--soft", "abc123"]);
});

test("verifyCommitSignature: rejects option-like sha", async () => {
  const { repo, git } = makeRepo();
  // verifyCommitSignature swallows GitError internally, so assert no git call.
  git.calls = [];
  const res = await repo.verifyCommitSignature("--evil");
  assert.strictEqual(res.valid, false);
  assert.strictEqual(git.calls.length, 0, "guard must fire before git for bad sha");
  git.calls = [];
  await repo.verifyCommitSignature("abc123");
  assert.deepStrictEqual(git.calls[0].args, ["verify-commit", "--verbose", "abc123"]);
});

test("bisectMark: rejects option-like sha; omits sha when absent", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.bisectMark(true, "-x"), "sha=-x");
  git.calls = [];
  await repo.bisectMark(true);
  assert.deepStrictEqual(git.calls[0].args, ["bisect", "good"]);
  git.calls = [];
  await repo.bisectMark(false, "abc123");
  assert.deepStrictEqual(git.calls[0].args, ["bisect", "bad", "abc123"]);
});

// ===========================================================================
// Read paths that take refs (commitFiles / diffFiles / reflog / log range)
// ===========================================================================

test("commitFiles: rejects option-like sha; positional sha after --format=", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.commitFiles("-x"), "sha=-x");
  git.calls = [];
  await repo.commitFiles("abc123");
  assert.deepStrictEqual(git.calls[0].args, [
    "show",
    "--name-status",
    "-z",
    "-M",
    "--format=",
    "abc123",
  ]);
});

test("diffFiles: rejects either option-like ref", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.diffFiles("-x", "HEAD"), "ref1=-x");
  await assertRejectsBeforeGit(git, () => repo.diffFiles("HEAD", "-x"), "ref2=-x");
  git.calls = [];
  await repo.diffFiles("main", "feature");
  assert.deepStrictEqual(git.calls[0].args, [
    "diff",
    "--name-status",
    "-z",
    "-M",
    "main",
    "feature",
  ]);
});

test("reflog: rejects option-like ref; default HEAD", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.reflog("-x"), "ref=-x");
  git.calls = [];
  await repo.reflog();
  const args = git.calls[0].args;
  assert.strictEqual(args[0], "reflog");
  assert.strictEqual(args[args.length - 1], "HEAD");
});

test("log: rejects option-like revRange", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.log({ revRange: "--evil" }), "revRange=--evil");
  git.calls = [];
  await repo.log({ revRange: "main...feature", order: "topo" });
  assert.ok(git.calls[0].args.includes("main...feature"));
});

test("log: scopes file history after revision arguments", async () => {
  const { repo, git } = makeRepo();
  await repo.log({ all: true, limit: 25, skip: 5, file: "src/example.ts" });
  assert.deepStrictEqual(git.calls[0].args, [
    "log",
    `--format=${LOG_FORMAT}`,
    "--date-order",
    "--max-count=25",
    "--skip=5",
    "--all",
    "--follow",
    "--",
    "src/example.ts",
  ]);
});

test("graphLog: rejects option-like branch in the branches list", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(
    git,
    () => repo.graphLog({ branches: ["--evil"] }),
    "branch=--evil",
  );
  git.calls = [];
  await repo.graphLog({ branches: ["main", "develop"] });
  const args = git.calls[0].args;
  assert.ok(args.includes("main") && args.includes("develop"));
});

// ===========================================================================
// Ref membership (--contains) / describe
// ===========================================================================

test("branchesContaining / tagsContaining: reject option-like sha; bind it to --contains=", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.branchesContaining(bad), `branch sha=${bad}`);
    await assertRejectsBeforeGit(git, () => repo.tagsContaining(bad), `tag sha=${bad}`);
  }
  git.calls = [];
  await repo.branchesContaining("abc123");
  assert.deepStrictEqual(git.calls[0].args, [
    "branch",
    "-a",
    "--contains=abc123",
    "--format=%(refname:short)",
  ]);
  git.calls = [];
  await repo.tagsContaining("abc123");
  assert.deepStrictEqual(git.calls[0].args, ["tag", "--contains=abc123"]);
});

test("describe: rejects option-like sha; defaults to HEAD", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.describe("-x"), "sha=-x");
  git.calls = [];
  await repo.describe();
  assert.deepStrictEqual(git.calls[0].args, ["describe", "--tags", "--always", "HEAD"]);
  git.calls = [];
  await repo.describe("abc123");
  assert.deepStrictEqual(git.calls[0].args, ["describe", "--tags", "--always", "abc123"]);
});

// ===========================================================================
// Archive / subtree / worktree / submodule
// ===========================================================================

test("archive: rejects option-like ref; format/output bound to flags", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.archive("-x", "zip", "/tmp/o.zip"), "ref=-x");
  git.calls = [];
  await repo.archive("HEAD", "zip", "/tmp/o.zip", "p/");
  assert.deepStrictEqual(git.calls[0].args, [
    "archive",
    "--format=zip",
    "--output=/tmp/o.zip",
    "HEAD",
    "--prefix=p/",
  ]);
});

test("subtree add/pull/push: reject ext:: repository and option-like ref", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_URLS) {
    await assertRejectsBeforeGit(git, () => repo.subtreeAdd("p", bad), `add repo=${bad}`);
    await assertRejectsBeforeGit(git, () => repo.subtreePull("p", bad), `pull repo=${bad}`);
    await assertRejectsBeforeGit(git, () => repo.subtreePush("p", bad), `push repo=${bad}`);
  }
  await assertRejectsBeforeGit(
    git,
    () => repo.subtreeAdd("p", "https://x/r.git", "-x"),
    "ref=-x",
  );
  git.calls = [];
  await repo.subtreeAdd("lib/x", "https://github.com/o/r.git", "v1");
  assert.deepStrictEqual(git.calls[0].args, [
    "subtree",
    "add",
    "--prefix",
    "lib/x",
    "https://github.com/o/r.git",
    "v1",
  ]);
  // No ref => defaults to master.
  git.calls = [];
  await repo.subtreePull("lib/x", "https://github.com/o/r.git");
  assert.deepStrictEqual(git.calls[0].args, [
    "subtree",
    "pull",
    "--prefix",
    "lib/x",
    "https://github.com/o/r.git",
    "master",
  ]);
});

test("worktreeAdd: rejects option-like branch; createBranch toggles -b", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(
    git,
    () => repo.worktreeAdd("/wt", "-x", false),
    "branch=-x",
  );
  git.calls = [];
  await repo.worktreeAdd("/wt", "main", false);
  assert.deepStrictEqual(git.calls[0].args, ["worktree", "add", "/wt", "main"]);
  git.calls = [];
  await repo.worktreeAdd("/wt", "newbranch", true);
  assert.deepStrictEqual(git.calls[0].args, ["worktree", "add", "-b", "newbranch", "/wt"]);
});

test("worktreeMove: rejects option-like from/to (no -- separator); accepts valid", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_REFS) {
    await assertRejectsBeforeGit(git, () => repo.worktreeMove(bad, "/new"), `from=${bad}`);
    await assertRejectsBeforeGit(git, () => repo.worktreeMove("/old", bad), `to=${bad}`);
  }
  git.calls = [];
  await repo.worktreeMove("/wt/old", "/wt/new");
  assert.deepStrictEqual(git.calls[0].args, ["worktree", "move", "/wt/old", "/wt/new"]);
});

test("submoduleAdd: rejects ext:: URL; uses -- before url", async () => {
  const { repo, git } = makeRepo();
  for (const bad of HOSTILE_URLS) {
    await assertRejectsBeforeGit(git, () => repo.submoduleAdd(bad, "vendor/x"), `url=${bad}`);
  }
  git.calls = [];
  await repo.submoduleAdd("https://github.com/o/r.git", "vendor/x");
  assert.deepStrictEqual(git.calls[0].args, [
    "submodule",
    "add",
    "--",
    "https://github.com/o/r.git",
    "vendor/x",
  ]);
});

// ===========================================================================
// Transport / config / worktree-lock / LFS — newly hardened sinks
// ===========================================================================

test("fetchRefspec: rejects option-like remote and refspec; builds fetch argv", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.fetchRefspec("-x", "+a:b"), "remote=-x");
  await assertRejectsBeforeGit(git, () => repo.fetchRefspec("origin", "--evil"), "refspec=--evil");
  git.calls = [];
  await repo.fetchRefspec("origin", "+refs/pull/*/head:refs/remotes/origin/pr/*");
  assert.deepStrictEqual(git.calls[0].args, [
    "fetch",
    "origin",
    "+refs/pull/*/head:refs/remotes/origin/pr/*",
  ]);
});

test("setConfig: rejects option-like key (webview postMessage); value may start with -", async () => {
  const { repo, git } = makeRepo();
  for (const bad of ["--global", "--unset", "-x", ""]) {
    await assertRejectsBeforeGit(git, () => repo.setConfig("local", bad, "v"), `key=${bad}`);
  }
  git.calls = [];
  // A value that begins with "-" is legitimate config data and must pass.
  await repo.setConfig("global", "user.name", "-weird-but-valid");
  assert.deepStrictEqual(git.calls[0].args, [
    "config",
    "--global",
    "user.name",
    "-weird-but-valid",
  ]);
});

test("unsetConfig: rejects option-like key; builds --unset-all argv", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.unsetConfig("local", "--evil"), "key=--evil");
  git.calls = [];
  await repo.unsetConfig("local", "core.autocrlf");
  assert.deepStrictEqual(git.calls[0].args, [
    "config",
    "--local",
    "--unset-all",
    "core.autocrlf",
  ]);
});

test("worktreeLock/Unlock: reject option-like path; flags precede the path", async () => {
  const { repo, git } = makeRepo();
  await assertRejectsBeforeGit(git, () => repo.worktreeLock("-x"), "lock path=-x");
  await assertRejectsBeforeGit(git, () => repo.worktreeUnlock("-x"), "unlock path=-x");
  git.calls = [];
  await repo.worktreeLock("/wt", "in use");
  assert.deepStrictEqual(git.calls[0].args, ["worktree", "lock", "--reason", "in use", "/wt"]);
  git.calls = [];
  await repo.worktreeUnlock("/wt");
  assert.deepStrictEqual(git.calls[0].args, ["worktree", "unlock", "/wt"]);
});

test("lfs track/untrack/lock/unlock: place the path/pattern after a -- separator", async () => {
  const { repo, git } = makeRepo();
  // An option-like pattern is harmless because of the -- separator.
  git.calls = [];
  await repo.lfsTrack("--weird");
  assert.deepStrictEqual(git.calls[0].args, ["lfs", "track", "--", "--weird"]);
  git.calls = [];
  await repo.lfsUntrack("*.bin");
  assert.deepStrictEqual(git.calls[0].args, ["lfs", "untrack", "--", "*.bin"]);
  git.calls = [];
  await repo.lfsLock("--weird");
  assert.deepStrictEqual(git.calls[0].args, ["lfs", "lock", "--", "--weird"]);
  git.calls = [];
  await repo.lfsUnlock("a.bin", true);
  assert.deepStrictEqual(git.calls[0].args, ["lfs", "unlock", "--force", "--", "a.bin"]);
});

// ===========================================================================
// Negative control: methods that take only paths/messages stay unaffected.
// ===========================================================================

test("path-only operations are unguarded by safeRef (use -- separator)", async () => {
  const { repo, git } = makeRepo();
  // A file literally named like an option is fine because of the -- separator.
  git.calls = [];
  await repo.stage(["--weird-file"]);
  assert.deepStrictEqual(git.calls[0].args, ["add", "--", "--weird-file"]);
  git.calls = [];
  await repo.untrack(["--weird-file"]);
  assert.deepStrictEqual(git.calls[0].args, ["rm", "--cached", "--", "--weird-file"]);
  // git rm: flags precede the -- separator; option-like paths stay inert.
  git.calls = [];
  await repo.removeFiles(["--weird-file"], { force: true, recursive: true });
  assert.deepStrictEqual(git.calls[0].args, ["rm", "-f", "-r", "--", "--weird-file"]);
  git.calls = [];
  await repo.removeFiles([]); // no paths => no git call
  assert.strictEqual(git.calls.length, 0);
  // git mv: both source and dest follow --, so option-like names are inert.
  git.calls = [];
  await repo.moveFile("--old", "--new");
  assert.deepStrictEqual(git.calls[0].args, ["mv", "--", "--old", "--new"]);
});
