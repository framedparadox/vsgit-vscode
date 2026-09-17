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
  const result = await git.run(["--version"], { cwd: tmpDir() });
  assert.strictEqual(result.exitCode, 0);
  assert.match(result.stdout, /git version/);
  assert.strictEqual(result.stderr, "");
});

test("run() throws GitError on non-zero exit", async () => {
  const git = new GitExecutor();
  await assert.rejects(
    () => git.run(["not-a-real-subcommand"], { cwd: tmpDir() }),
    (error: unknown) => {
      assert.ok(error instanceof GitError);
      assert.notStrictEqual(error.exitCode, 0);
      return true;
    },
  );
});

test("run() treats okCodes as success", async () => {
  const git = new GitExecutor();
  const cwd = tmpDir();
  const other = tmpDir();
  fs.writeFileSync(path.join(cwd, "a.txt"), "a");
  fs.writeFileSync(path.join(other, "b.txt"), "b");
  await git.run(["init"], { cwd });
  const result = await git.run(
    ["diff", "--no-index", path.join(cwd, "a.txt"), path.join(other, "b.txt")],
    { cwd, okCodes: [1] },
  );
  assert.strictEqual(result.exitCode, 1);
});

test("run() writes stdin to the process", async () => {
  const git = new GitExecutor();
  const result = await git.run(["hash-object", "--stdin"], {
    cwd: tmpDir(),
    stdin: "hello\n",
  });
  assert.strictEqual(result.exitCode, 0);
  assert.match(result.stdout.trim(), /^[0-9a-f]{40}$/);
});

test("run() rejects with GitError after timeoutMs elapses", async () => {
  const git = new GitExecutor();
  await assert.rejects(
    () => git.run(["log"], { cwd: tmpDir(), timeoutMs: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof GitError);
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});

test("stdout() returns only the stdout string", async () => {
  const git = new GitExecutor();
  const out = await git.stdout(["--version"], { cwd: tmpDir() });
  assert.match(out, /git version/);
});

test("run() bounds combined process output", async () => {
  const processExecutor = new GitExecutor(process.execPath);
  await assert.rejects(
    () =>
      processExecutor.run(["-e", "process.stdout.write('x'.repeat(4096))"], {
        cwd: tmpDir(),
        maxOutputBytes: 1_024,
      }),
    (error: unknown) => {
      assert.ok(error instanceof GitError);
      assert.match(error.message, /exceeded the 1024-byte output limit/);
      return true;
    },
  );
});
