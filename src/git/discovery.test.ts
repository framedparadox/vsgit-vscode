import { test } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findGitCheckouts, isInsideGitDir } from "./discovery";

test("findGitCheckouts finds clones and worktrees below a folder up to maxDepth", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vsgit-discovery-test-"));
  const mk = (rel: string) => fs.mkdirSync(path.join(root, rel), { recursive: true });
  mk("api/.git");
  mk("web/.git");
  fs.mkdirSync(path.join(root, "group/lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "group/lib/.git"), "gitdir: ../../api/.git/worktrees/lib\n");
  mk("node_modules/pkg/.git");
  mk(".hidden/repo/.git");
  mk("api/nested/.git");

  assert.deepStrictEqual(await findGitCheckouts(root, 1), [
    path.join(root, "api"),
    path.join(root, "web"),
  ]);
  // Depth 2 reaches group/lib; a checkout's own subfolders are never searched,
  // and dependency / hidden folders are skipped.
  assert.deepStrictEqual(await findGitCheckouts(root, 2), [
    path.join(root, "api"),
    path.join(root, "group", "lib"),
    path.join(root, "web"),
  ]);
  assert.deepStrictEqual(await findGitCheckouts(root, 0), []);
  assert.deepStrictEqual(await findGitCheckouts(path.join(root, "missing"), 2), []);
});

test("isInsideGitDir matches only .git path segments", () => {
  assert.strictEqual(isInsideGitDir("/w/repo/.git"), true);
  assert.strictEqual(isInsideGitDir("/w/repo/.git/index"), true);
  assert.strictEqual(isInsideGitDir("C:\\w\\repo\\.git\\HEAD"), true);
  assert.strictEqual(isInsideGitDir("/w/repo/src/.gitignore"), false);
  assert.strictEqual(isInsideGitDir("/w/repo/my.git/file"), false);
  assert.strictEqual(isInsideGitDir("/w/repo/src/main.ts"), false);
});
