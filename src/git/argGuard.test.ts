import { test } from "node:test";
import assert from "node:assert";
import { isOptionLike, safeRef, safeRemoteUrl } from "./argGuard";
import { GitError } from "./GitError";

test("isOptionLike flags only values beginning with a dash", () => {
  assert.strictEqual(isOptionLike("-D"), true);
  assert.strictEqual(isOptionLike("--upload-pack=evil"), true);
  assert.strictEqual(isOptionLike("main"), false);
  assert.strictEqual(isOptionLike("origin/feature"), false);
  assert.strictEqual(isOptionLike("HEAD~3"), false);
  assert.strictEqual(isOptionLike(""), false);
});

test("safeRef returns ordinary refs and SHAs unchanged", () => {
  assert.strictEqual(safeRef("main"), "main");
  assert.strictEqual(safeRef("a1b2c3d"), "a1b2c3d");
  assert.strictEqual(safeRef("refs/heads/dev"), "refs/heads/dev");
  assert.strictEqual(safeRef("HEAD^"), "HEAD^");
});

test("safeRef rejects option-like and empty values", () => {
  assert.throws(() => safeRef("--output=/tmp/x"), GitError);
  assert.throws(() => safeRef("-f"), GitError);
  assert.throws(() => safeRef(""), GitError);
});

test("safeRemoteUrl rejects ext::/fd:: remote-helper transports", () => {
  assert.throws(() => safeRemoteUrl("ext::sh -c 'touch /tmp/pwned'"), GitError);
  assert.throws(() => safeRemoteUrl("fd::17"), GitError);
  // Ordinary URLs pass through.
  assert.strictEqual(
    safeRemoteUrl("https://github.com/o/r.git"),
    "https://github.com/o/r.git",
  );
  assert.strictEqual(safeRemoteUrl("git@github.com:o/r.git"), "git@github.com:o/r.git");
});
