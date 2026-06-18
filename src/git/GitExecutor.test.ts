import { test } from "node:test";
import assert from "node:assert";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { GitExecutor } from "./GitExecutor";
import { GitError } from "./GitError";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vsgit-executor-test-"));
}

test("run() returns stdout/stderr/exitCode on success", async () => {
  const git = new GitExecutor();
  const cwd = tmpDir();
  const result = await git.run(["--version"], { cwd });
  assert.strictEqual(result.exitCode, 0);
  assert.match(result.stdout, /git version/);
  assert.strictEqual(result.stderr, "");
});

test("run() throws GitError on non-zero exit", async () => {
  const git = new GitExecutor();
  const cwd = tmpDir();
  await assert.rejects(
    () => git.run(["not-a-real-subcommand"], { cwd }),
    (err: unknown) => {
      assert.ok(err instanceof GitError);
      assert.notStrictEqual(err.exitCode, 0);
      return true;
    },
  );
});

test("run() treats okCodes as success", async () => {
  const git = new GitExecutor();
  const cwd = tmpDir();
  fs.writeFileSync(path.join(cwd, "a.txt"), "a");
  await git.run(["init"], { cwd });
  // `git diff --no-index` exits 1 when files differ; allow it via okCodes.
  const other = tmpDir();
  fs.writeFileSync(path.join(other, "b.txt"), "b");
  const result = await git.run(
    ["diff", "--no-index", path.join(cwd, "a.txt"), path.join(other, "b.txt")],
    { cwd, okCodes: [1] },
  );
  assert.strictEqual(result.exitCode, 1);
});

test("run() writes stdin to the process", async () => {
  const git = new GitExecutor();
  const cwd = tmpDir();
  const result = await git.run(["hash-object", "--stdin"], { cwd, stdin: "hello\n" });
  assert.strictEqual(result.exitCode, 0);
  assert.match(result.stdout.trim(), /^[0-9a-f]{40}$/);
});

test("run() rejects with GitError after timeoutMs elapses", async () => {
  const git = new GitExecutor();
  const cwd = tmpDir();
  await assert.rejects(
    () => git.run(["log"], { cwd, timeoutMs: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof GitError);
      assert.match(err.message, /timed out/);
      return true;
    },
  );
});

test("stdout() returns only the stdout string", async () => {
  const git = new GitExecutor();
  const cwd = tmpDir();
  const out = await git.stdout(["--version"], { cwd });
  assert.match(out, /git version/);
});
