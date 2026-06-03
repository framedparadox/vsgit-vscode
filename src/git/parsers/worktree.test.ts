import { test } from "node:test";
import assert from "node:assert";
import { parseWorktreeList } from "./worktree";

test("parses a single linked worktree on a branch", () => {
  const raw = [
    "worktree /home/u/project",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
  ].join("\n");
  const wts = parseWorktreeList(raw);
  assert.strictEqual(wts.length, 1);
  assert.deepStrictEqual(wts[0], {
    path: "/home/u/project",
    head: "1111111111111111111111111111111111111111",
    branch: "main",
    bare: false,
    locked: false,
  });
});

test("parses multiple worktrees including bare, detached and locked", () => {
  const raw = [
    "worktree /repos/main.git",
    "bare",
    "",
    "worktree /repos/wt-feature",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/feature/x",
    "",
    "worktree /repos/wt-detached",
    "HEAD 3333333333333333333333333333333333333333",
    "detached",
    "",
    "worktree /repos/wt-locked",
    "HEAD 4444444444444444444444444444444444444444",
    "branch refs/heads/release",
    "locked building artifacts",
    "",
  ].join("\n");
  const wts = parseWorktreeList(raw);
  assert.strictEqual(wts.length, 4);

  assert.strictEqual(wts[0].bare, true);
  assert.strictEqual(wts[0].path, "/repos/main.git");

  // Branch refs are shortened past refs/heads/, keeping embedded slashes.
  assert.strictEqual(wts[1].branch, "feature/x");

  // Detached worktree has a HEAD but no branch.
  assert.strictEqual(wts[2].branch, undefined);
  assert.strictEqual(wts[2].head, "3333333333333333333333333333333333333333");

  assert.strictEqual(wts[3].locked, true);
  assert.strictEqual(wts[3].branch, "release");
});

test("empty output yields no worktrees", () => {
  assert.deepStrictEqual(parseWorktreeList(""), []);
});

test("trailing record without a blank line is still captured", () => {
  const raw = [
    "worktree /repos/only",
    "HEAD 5555555555555555555555555555555555555555",
    "branch refs/heads/dev",
  ].join("\n");
  const wts = parseWorktreeList(raw);
  assert.strictEqual(wts.length, 1);
  assert.strictEqual(wts[0].branch, "dev");
});
