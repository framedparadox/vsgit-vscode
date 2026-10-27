import { test } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Repository } from "./Repository";
import { GIT_BASE_ENV, GitExecutor } from "./GitExecutor";
import { classifyGraphRef } from "./parsers/graphLog";

/**
 * Behavioural tests against a real `git` binary in throwaway repositories.
 * Repository.test.ts pins argv construction with a fake executor; these check
 * that the resulting commands actually do the right thing.
 */

const IDENTITY: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  // Keep the user's global/system config (signing, hooks, editors) out.
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  // Simulate an extension host started from a terminal: git would try to run
  // a terminal editor if nothing told it otherwise.
  TERM: "xterm-256color",
  EDITOR: "",
  VISUAL: "",
  GIT_EDITOR: "",
};

function executor(): GitExecutor {
  const git = new GitExecutor();
  git.setBaseEnv(IDENTITY);
  return git;
}

async function makeRepo(): Promise<{ repo: Repository; git: GitExecutor; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsgit-repo-test-"));
  const git = executor();
  await git.run(["init", "-q", "-b", "main"], { cwd: dir });
  return { repo: new Repository(dir, git), git, dir };
}

async function commitFile(
  git: GitExecutor,
  dir: string,
  file: string,
  content: string,
  message: string,
): Promise<string> {
  fs.writeFileSync(path.join(dir, file), content);
  await git.run(["add", "--", file], { cwd: dir });
  await git.run(["commit", "-q", "-m", message], { cwd: dir });
  return (await git.stdout(["rev-parse", "HEAD"], { cwd: dir })).trim();
}

/** main: base → m1; topic: base → t1; merge commit M = merge topic into main. */
async function makeMergeRepo() {
  const ctx = await makeRepo();
  const { git, dir } = ctx;
  const base = await commitFile(git, dir, "base.txt", "base\n", "base");
  await git.run(["checkout", "-q", "-b", "topic"], { cwd: dir });
  const t1 = await commitFile(git, dir, "topic.txt", "topic\n", "topic change");
  await git.run(["checkout", "-q", "main"], { cwd: dir });
  const m1 = await commitFile(git, dir, "main.txt", "main\n", "main change");
  await git.run(["merge", "-q", "--no-ff", "-m", "Merge topic", "topic"], { cwd: dir });
  const merge = (await git.stdout(["rev-parse", "HEAD"], { cwd: dir })).trim();
  return { ...ctx, base, t1, m1, merge };
}

test("GitExecutor: base env sits between process env and per-call env", async () => {
  const git = new GitExecutor();
  assert.strictEqual(git.environmentFor().GIT_TERMINAL_PROMPT, "0", "terminal prompts are disabled");
  assert.strictEqual(git.environmentFor().LC_ALL, GIT_BASE_ENV.LC_ALL, "git output is English");
  git.setBaseEnv({ VSGIT_PROBE: "base", GIT_ASKPASS: "/askpass" });
  assert.strictEqual(git.environmentFor().VSGIT_PROBE, "base");
  assert.strictEqual(git.environmentFor({ VSGIT_PROBE: "call" }).VSGIT_PROBE, "call");
  // A later setBaseEnv merges rather than replacing the askpass wiring.
  git.setBaseEnv({ OTHER: "1" });
  assert.strictEqual(git.environmentFor().GIT_ASKPASS, "/askpass");

  const out = await git.stdout(["var", "GIT_EDITOR"], {
    cwd: os.tmpdir(),
    env: { GIT_EDITOR: "probe-editor" },
  });
  assert.strictEqual(out.trim(), "probe-editor", "per-call env reaches git");
});

test("commitFiles lists a merge commit's changes against its first parent", async () => {
  const { repo, merge, base } = await makeMergeRepo();
  const files = await repo.commitFiles(merge);
  assert.deepStrictEqual(files, [{ status: "A", path: "topic.txt" }]);
  const root = await repo.commitFiles(base);
  assert.deepStrictEqual(root, [{ status: "A", path: "base.txt" }], "root commit lists its files");
});

test("commitParents / isAncestor / commitDetails", async () => {
  const { repo, git, dir, merge, m1, t1 } = await makeMergeRepo();
  assert.deepStrictEqual(await repo.commitParents(merge), [m1, t1]);
  assert.strictEqual(await repo.isAncestor(t1, "HEAD"), true);
  await git.run(["checkout", "-q", "-b", "side", m1], { cwd: dir });
  assert.strictEqual(await repo.isAncestor(t1, "HEAD"), false);

  await commitFile(git, dir, "body.txt", "x\n", "Subject line\n\nBody paragraph.");
  const details = await repo.commitDetails("HEAD");
  assert.strictEqual(details.authorEmail, "test@example.com");
  assert.strictEqual(details.message, "Subject line\n\nBody paragraph.");
});

test("cherry-pick and revert of a merge commit use the chosen mainline", async () => {
  const { repo, git, dir, merge, base } = await makeMergeRepo();
  await git.run(["checkout", "-q", "-b", "release", base], { cwd: dir });
  await assert.rejects(repo.cherryPick(merge), "git refuses a merge without -m");
  await git.run(["cherry-pick", "--abort"], { cwd: dir, okCodes: [128] });
  await repo.cherryPick(merge, { mainline: 1 });
  assert.ok(fs.existsSync(path.join(dir, "topic.txt")), "mainline 1 brings in the topic side");

  await git.run(["checkout", "-q", "main"], { cwd: dir });
  await repo.revert(merge, { mainline: 1 });
  assert.ok(!fs.existsSync(path.join(dir, "topic.txt")), "reverting the merge removes the topic side");
});

test("sequencerAction continue never waits on a terminal editor", async () => {
  const { repo, git, dir } = await makeRepo();
  await commitFile(git, dir, "f.txt", "base\n", "base");
  await git.run(["checkout", "-q", "-b", "topic"], { cwd: dir });
  await commitFile(git, dir, "f.txt", "topic\n", "topic");
  await git.run(["checkout", "-q", "main"], { cwd: dir });
  await commitFile(git, dir, "f.txt", "main\n", "main");
  await git.run(["merge", "topic"], { cwd: dir, okCodes: [1] });
  assert.strictEqual(await repo.inProgressOperation(), "merge");

  fs.writeFileSync(path.join(dir, "f.txt"), "resolved\n");
  await repo.markResolved("f.txt");
  // With TERM set and no editor configured, a plain `git merge --continue`
  // would launch vi and hang; the timeout turns a hang into a failure.
  await Promise.race([
    repo.sequencerAction("merge", "continue"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("continue hung")), 15_000)),
  ]);
  assert.strictEqual(await repo.inProgressOperation(), undefined);
  const subject = (await git.stdout(["log", "-1", "--format=%s"], { cwd: dir })).trim();
  assert.match(subject, /^Merge branch 'topic'/, "git's prepared merge message is kept");
  await assert.rejects(repo.sequencerAction("merge", "skip"), /cannot be skipped/);
});

test("inProgressOperation reports `git am` separately from rebase", async () => {
  const { repo, git, dir } = await makeRepo();
  await commitFile(git, dir, "f.txt", "one\n", "one");
  await commitFile(git, dir, "f.txt", "two\n", "two");
  const patch = await git.stdout(["format-patch", "-1", "--stdout"], { cwd: dir });
  await git.run(["reset", "-q", "--hard", "HEAD~1"], { cwd: dir });
  await commitFile(git, dir, "f.txt", "conflict\n", "conflicting");
  await git.run(["am"], { cwd: dir, stdin: patch, okCodes: [128] });
  assert.strictEqual(await repo.inProgressOperation(), "am");
  await repo.sequencerAction("am", "abort");
  assert.strictEqual(await repo.inProgressOperation(), undefined);
});

test("rebaseNeedsMessageEditor is true only while reword/squash steps remain", async () => {
  const { repo, git, dir } = await makeRepo();
  await commitFile(git, dir, "f.txt", "base\n", "base");
  await git.run(["checkout", "-q", "-b", "topic"], { cwd: dir });
  await commitFile(git, dir, "f.txt", "topic\n", "topic");
  await commitFile(git, dir, "g.txt", "g\n", "second");
  await git.run(["checkout", "-q", "main"], { cwd: dir });
  await commitFile(git, dir, "f.txt", "main\n", "main");
  await git.run(["checkout", "-q", "topic"], { cwd: dir });

  // A plain rebase stopped on a conflict: only picks remain.
  await git.run(["rebase", "main"], { cwd: dir, okCodes: [1] });
  assert.strictEqual(await repo.inProgressOperation(), "rebase");
  assert.strictEqual(await repo.rebaseNeedsMessageEditor(), false);
  await repo.sequencerAction("rebase", "abort");

  // An interactive rebase whose later step rewords a commit. (perl ships with
  // git on every platform, including Git for Windows.)
  await git.run(["rebase", "-i", "main"], {
    cwd: dir,
    okCodes: [1],
    env: { GIT_SEQUENCE_EDITOR: "perl -pi -e 's/^pick/reword/ if $. == 2'" },
  });
  assert.strictEqual(await repo.rebaseNeedsMessageEditor(), true);
  await repo.sequencerAction("rebase", "abort");
  assert.strictEqual(await repo.rebaseNeedsMessageEditor(), false);
});

test("graphLog walks branches and tags but not stash, notes, or other internal refs", async () => {
  const { repo, git, dir, merge } = await makeMergeRepo();
  await git.run(["tag", "v1"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "main.txt"), "wip\n");
  await git.run(["stash", "push", "-q"], { cwd: dir });
  await git.run(["notes", "add", "-m", "a note", "HEAD"], { cwd: dir });
  await git.run(["update-ref", "refs/prefetch/remotes/origin/main", "HEAD~1"], { cwd: dir });

  const { commits, headSha, hasMore } = await repo.graphLog({ limit: 50 });
  assert.strictEqual(hasMore, false);
  assert.strictEqual(headSha, merge);
  assert.strictEqual(commits.length, 4, "base, main change, topic change, merge");
  assert.ok(
    commits.every((c) => !/^(WIP on|index on|Notes added)/.test(c.message)),
    "no stash or notes commits leak into the graph",
  );
  const head = commits.find((c) => c.isHead);
  assert.strictEqual(head?.sha, merge);
  const types = head!.refs.map((raw) => classifyGraphRef(raw, "main"));
  assert.deepStrictEqual(
    types.filter(Boolean).map((r) => `${r!.type}:${r!.name}`).sort(),
    ["head:main", "tag:v1"],
  );
  assert.ok(
    commits.every((c) => c.refs.every((raw) => !raw.includes("stash") && !raw.includes("prefetch"))),
    "internal refs are not decorated",
  );
});

test("graphLog pages with hasMore and can leave out remote-only history", async () => {
  const { repo, git, dir } = await makeRepo();
  for (let i = 0; i < 5; i++) {
    await commitFile(git, dir, "f.txt", `${i}\n`, `c${i}`);
  }
  const page = await repo.graphLog({ limit: 3 });
  assert.strictEqual(page.commits.length, 3);
  assert.strictEqual(page.hasMore, true);
  assert.strictEqual((await repo.graphLog({ limit: 5 })).hasMore, false);

  // A remote-tracking branch with a commit no local branch contains.
  await git.run(["checkout", "-q", "-b", "tmp"], { cwd: dir });
  const remoteOnly = await commitFile(git, dir, "r.txt", "r\n", "remote only");
  await git.run(["update-ref", "refs/remotes/origin/feature", remoteOnly], { cwd: dir });
  await git.run(["checkout", "-q", "main"], { cwd: dir });
  await git.run(["branch", "-D", "tmp"], { cwd: dir });

  const withRemotes = await repo.graphLog({ limit: 50 });
  assert.ok(withRemotes.commits.some((c) => c.sha === remoteOnly));
  const localOnly = await repo.graphLog({ limit: 50, remotes: false });
  assert.ok(!localOnly.commits.some((c) => c.sha === remoteOnly));
});

test("graphLog honours the configured ordering and branch filters", async () => {
  const { repo, t1, m1 } = await makeMergeRepo();
  const filtered = await repo.graphLog({ limit: 50, branches: ["topic"] });
  assert.ok(filtered.commits.some((c) => c.sha === t1));
  assert.ok(!filtered.commits.some((c) => c.sha === m1), "main-only commits are filtered out");
  for (const order of ["topo", "date", "author-date"] as const) {
    const { commits } = await repo.graphLog({ limit: 50, order });
    const index = new Map(commits.map((c, i) => [c.sha, i]));
    for (const c of commits) {
      for (const p of c.parents) {
        assert.ok(index.get(p)! > index.get(c.sha)!, `${order}: child before parent`);
      }
    }
  }
});

test("classifyGraphRef handles full decorations", () => {
  assert.deepStrictEqual(classifyGraphRef("refs/heads/origin/x", "main"), {
    name: "origin/x",
    type: "localBranch",
  });
  assert.deepStrictEqual(classifyGraphRef("refs/remotes/origin/x", "main"), {
    name: "origin/x",
    type: "remoteBranch",
  });
  assert.deepStrictEqual(classifyGraphRef("tag: refs/tags/main", "main"), {
    name: "main",
    type: "tag",
  });
  assert.deepStrictEqual(classifyGraphRef("refs/heads/main", "main"), { name: "main", type: "head" });
  assert.deepStrictEqual(classifyGraphRef("HEAD", undefined), { name: "HEAD", type: "head" });
  assert.strictEqual(classifyGraphRef("refs/remotes/origin/HEAD", "main"), undefined);
  assert.strictEqual(classifyGraphRef("refs/stash", "main"), undefined);
});

test("workingChanges summarises staged, unstaged, untracked, and renamed files", async () => {
  const { repo, git, dir } = await makeRepo();
  await commitFile(git, dir, "keep.txt", "k\n", "base");
  await commitFile(git, dir, "old.txt", "rename me\n", "old");
  fs.writeFileSync(path.join(dir, "keep.txt"), "changed\n");
  fs.writeFileSync(path.join(dir, "new.txt"), "new\n");
  await git.run(["mv", "old.txt", "renamed.txt"], { cwd: dir });
  await repo.refresh();
  const byPath = new Map(repo.workingChanges.map((f) => [f.path, f]));
  assert.strictEqual(byPath.get("keep.txt")?.status, "M");
  assert.strictEqual(byPath.get("new.txt")?.status, "?");
  assert.deepStrictEqual(byPath.get("renamed.txt"), {
    status: "R",
    path: "renamed.txt",
    origPath: "old.txt",
  });
});

test("stashPush supports keep-index and staged-only modes", async () => {
  const { repo, git, dir } = await makeRepo();
  await commitFile(git, dir, "a.txt", "a\n", "base");
  await commitFile(git, dir, "b.txt", "b\n", "base b");
  fs.writeFileSync(path.join(dir, "a.txt"), "staged\n");
  fs.writeFileSync(path.join(dir, "b.txt"), "unstaged\n");
  await git.run(["add", "a.txt"], { cwd: dir });

  await repo.stashPush("staged only", false, { staged: true });
  assert.strictEqual(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a\n", "staged change stashed");
  assert.strictEqual(fs.readFileSync(path.join(dir, "b.txt"), "utf8"), "unstaged\n", "unstaged change kept");
  await git.run(["stash", "pop", "-q", "--index"], { cwd: dir });

  await repo.stashPush("keep index", false, { keepIndex: true });
  assert.strictEqual(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "staged\n", "index kept in place");
  assert.strictEqual(fs.readFileSync(path.join(dir, "b.txt"), "utf8"), "b\n", "worktree change stashed");
});

test("pushRefspec names the destination so new branches push under push.default=simple", async () => {
  const { repo, git, dir } = await makeRepo();
  await commitFile(git, dir, "a.txt", "a\n", "base");
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "vsgit-remote-test-"));
  await git.run(["init", "-q", "--bare"], { cwd: remote });
  await git.run(["remote", "add", "origin", remote], { cwd: dir });
  await git.run(["checkout", "-q", "-b", "feature"], { cwd: dir });
  await repo.refresh();

  assert.strictEqual(repo.pushRefspec("feature", "origin"), "feature");
  await repo.push({ remote: "origin", refspec: repo.pushRefspec("feature", "origin"), setUpstream: true });
  await repo.refresh();
  assert.strictEqual(repo.localBranches.find((b) => b.shortName === "feature")?.upstream, "origin/feature");

  // A branch tracking a differently named upstream pushes to that upstream.
  await git.run(["branch", "--set-upstream-to=origin/feature", "main"], { cwd: dir });
  await repo.refresh();
  assert.strictEqual(repo.pushRefspec("main", "origin"), "main:refs/heads/feature");
  // Pushing to another remote uses the branch's own name.
  assert.strictEqual(repo.pushRefspec("main", "upstream"), "main");
});

test("splitRemoteBranch prefers the longest configured remote", async () => {
  const { repo, git, dir } = await makeRepo();
  await commitFile(git, dir, "a.txt", "a\n", "base");
  await git.run(["remote", "add", "team", "https://example.com/a.git"], { cwd: dir });
  await git.run(["remote", "add", "team/fork", "https://example.com/b.git"], { cwd: dir });
  await repo.refresh();
  assert.deepStrictEqual(repo.splitRemoteBranch("team/fork/feature/x"), {
    remote: "team/fork",
    branch: "feature/x",
  });
  assert.deepStrictEqual(repo.splitRemoteBranch("team/main"), { remote: "team", branch: "main" });
  assert.deepStrictEqual(repo.splitRemoteBranch("other/main"), { remote: "other", branch: "main" });
  assert.strictEqual(repo.splitRemoteBranch("nobranch"), undefined);
});

test("graphLog and workingChanges work in a repository with no commits yet", async () => {
  const { repo, dir } = await makeRepo();
  fs.writeFileSync(path.join(dir, "first.txt"), "hello\n");
  await repo.refresh();
  for (const remotes of [true, false]) {
    const page = await repo.graphLog({ limit: 10, remotes });
    assert.deepStrictEqual(page, { commits: [], headSha: undefined, hasMore: false });
  }
  assert.deepStrictEqual(repo.workingChanges, [{ status: "?", path: "first.txt", origPath: undefined }]);
});

test("stashFiles lists untracked files stashed with --include-untracked", async () => {
  const { repo, git, dir } = await makeRepo();
  await commitFile(git, dir, "a.txt", "a\n", "base");
  fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
  fs.writeFileSync(path.join(dir, "new.txt"), "new\n");
  await repo.stashPush("wip", true);
  const files = await repo.stashFiles("stash@{0}");
  assert.deepStrictEqual(files.map((f) => `${f.status} ${f.path}`).sort(), ["A new.txt", "M a.txt"]);
});

