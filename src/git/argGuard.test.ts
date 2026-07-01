import { test } from "node:test";
import assert from "node:assert";
import {
  isOptionLike,
  redactRemoteUrl,
  safeRef,
  safeRemoteUrl,
} from "./argGuard";
import { GitError } from "./GitError";

// ---------------------------------------------------------------------------
// isOptionLike — the single predicate every guard is built on. It must flag a
// value IFF it begins with "-" (the only thing git can mistake for an option),
// and nothing else.
// ---------------------------------------------------------------------------

test("isOptionLike: true for any value starting with a dash", () => {
  for (const v of [
    "-",
    "-D",
    "-f",
    "--",
    "--force",
    "--upload-pack=evil",
    "--output=/tmp/x",
    "-oProxyCommand=evil",
    "-with spaces",
    "-\t",
    "--=",
    "-😀",
  ]) {
    assert.strictEqual(isOptionLike(v), true, `expected option-like: ${JSON.stringify(v)}`);
  }
});

test("isOptionLike: false for ordinary refs, SHAs, ranges and names", () => {
  for (const v of [
    "main",
    "origin/feature",
    "HEAD",
    "HEAD~3",
    "HEAD^",
    "HEAD^^",
    "a1b2c3d",
    "0000000000000000000000000000000000000000",
    "refs/heads/dev",
    "refs/tags/v1.0.0",
    "v1.2.3",
    "feature/JIRA-123",
    "stash@{0}",
    "@{upstream}",
    "main...feature", // range
    "a..b", // range
    "release-1.0",
    "user@host:repo.git",
    "https://example.com/r.git",
  ]) {
    assert.strictEqual(isOptionLike(v), false, `expected NOT option-like: ${JSON.stringify(v)}`);
  }
});

test("isOptionLike: false for empty string (handled separately by safeRef)", () => {
  assert.strictEqual(isOptionLike(""), false);
});

test("isOptionLike: a dash anywhere but the first char is fine", () => {
  assert.strictEqual(isOptionLike("a-b"), false);
  assert.strictEqual(isOptionLike("feature-x"), false);
  assert.strictEqual(isOptionLike("HEAD~1-rc"), false);
  // Only the leading character matters.
  assert.strictEqual(isOptionLike(" -leadingspace"), false);
});

// ---------------------------------------------------------------------------
// safeRef — returns valid refs unchanged; throws GitError otherwise.
// ---------------------------------------------------------------------------

test("safeRef: returns ordinary refs and SHAs unchanged (identity)", () => {
  for (const v of [
    "main",
    "a1b2c3d",
    "refs/heads/dev",
    "HEAD^",
    "HEAD~3",
    "origin/main",
    "v1.0.0",
    "feature/x",
    "stash@{2}",
    "@{upstream}",
    "main...feature",
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  ]) {
    assert.strictEqual(safeRef(v), v, `should pass through unchanged: ${v}`);
  }
});

test("safeRef: rejects option-like values", () => {
  for (const v of ["-f", "-D", "--output=/tmp/x", "--upload-pack=x", "--", "-oProxyCommand=id"]) {
    assert.throws(() => safeRef(v), GitError, `should reject: ${v}`);
  }
});

test("safeRef: rejects empty string", () => {
  assert.throws(() => safeRef(""), GitError);
});

test("safeRef: rejects non-string inputs (defensive, untrusted IPC payloads)", () => {
  // Values arrive from webview postMessage / JSON, so a non-string can appear.
  assert.throws(() => safeRef(undefined as unknown as string), GitError);
  assert.throws(() => safeRef(null as unknown as string), GitError);
  assert.throws(() => safeRef(123 as unknown as string), GitError);
  assert.throws(() => safeRef({} as unknown as string), GitError);
});

test("safeRef: empty-value error message names the label", () => {
  assert.throws(
    () => safeRef("", "commit"),
    (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.match(e.message, /commit/);
      assert.match(e.message, /empty/i);
      return true;
    },
  );
});

test("safeRef: option-injection error names the label and the offending value", () => {
  assert.throws(
    () => safeRef("--evil", "start point"),
    (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.match(e.message, /start point/);
      assert.match(e.message, /--evil/);
      assert.match(e.message, /option injection/i);
      return true;
    },
  );
});

test("safeRef: default label is 'ref' when none supplied", () => {
  assert.throws(
    () => safeRef("-x"),
    (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.match(e.message, /\bref\b/);
      return true;
    },
  );
});

test("safeRef: thrown error is a GitError with the documented field shape", () => {
  assert.throws(
    () => safeRef("-x"),
    (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.strictEqual(e.name, "GitError");
      assert.strictEqual(e.exitCode, -1);
      assert.strictEqual(e.stderr, "");
      assert.strictEqual(e.stdout, "");
      assert.deepStrictEqual(e.args, []);
      return true;
    },
  );
});

test("safeRef: a leading dash is rejected even when the rest looks like a ref", () => {
  // "-main" is NOT a valid ref to git; it would be parsed as bundled options.
  assert.throws(() => safeRef("-main"), GitError);
  assert.throws(() => safeRef("-HEAD"), GitError);
});

// ---------------------------------------------------------------------------
// safeRemoteUrl — safeRef PLUS a block on remote-helper transports that run
// arbitrary commands (ext::, fd::). This is the credential/RCE-critical guard.
// ---------------------------------------------------------------------------

test("safeRemoteUrl: rejects ext:: and fd:: remote-helper transports (RCE)", () => {
  for (const v of [
    "ext::sh -c 'touch /tmp/pwned'",
    "ext::sh -c id",
    "ext::",
    "fd::17",
    "fd::0",
    "fd::7 8",
  ]) {
    assert.throws(() => safeRemoteUrl(v), GitError, `should reject transport: ${v}`);
  }
});

test("safeRemoteUrl: transport check is case-insensitive", () => {
  for (const v of ["EXT::sh -c id", "Ext::x", "eXt::x", "FD::1", "Fd::0", "fD::2"]) {
    assert.throws(() => safeRemoteUrl(v), GitError, `should reject (case): ${v}`);
  }
});

test("safeRemoteUrl: ordinary transports pass through unchanged", () => {
  for (const v of [
    "https://github.com/o/r.git",
    "http://example.com/r.git",
    "git@github.com:o/r.git",
    "ssh://git@host/o/r.git",
    "git://example.com/r.git",
    "file:///srv/repos/r.git",
    "/absolute/local/path/r.git",
    "user@host:path/to/repo",
  ]) {
    assert.strictEqual(safeRemoteUrl(v), v, `should pass through: ${v}`);
  }
});

test("safeRemoteUrl: 'ext'/'fd' only matched as a SCHEME, not as a substring", () => {
  // A host or path that merely contains ext/fd must NOT be rejected.
  for (const v of [
    "https://ext.example.com/r.git",
    "https://example.com/ext::not-a-scheme",
    "git@host:fd-team/repo.git",
    "https://example.com/fd/r.git",
    "context::not-really", // does not start with ext::/fd::
  ]) {
    assert.strictEqual(safeRemoteUrl(v), v, `should pass through: ${v}`);
  }
});

test("safeRemoteUrl: inherits safeRef — rejects option-like URLs", () => {
  for (const v of ["--upload-pack=evil", "-oProxyCommand=evil", "-x"]) {
    assert.throws(() => safeRemoteUrl(v), GitError, `should reject option-like url: ${v}`);
  }
});

test("safeRemoteUrl: inherits safeRef — rejects empty and non-string", () => {
  assert.throws(() => safeRemoteUrl(""), GitError);
  assert.throws(() => safeRemoteUrl(undefined as unknown as string), GitError);
  assert.throws(() => safeRemoteUrl(null as unknown as string), GitError);
});

test("safeRemoteUrl: transport-rejection error names label and explains the risk", () => {
  assert.throws(
    () => safeRemoteUrl("ext::sh -c id", "submodule URL"),
    (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.match(e.message, /submodule URL/);
      assert.match(e.message, /ext::\/fd::/);
      assert.match(e.message, /arbitrary commands/i);
      return true;
    },
  );
});

test("safeRemoteUrl: default label is 'remote URL'", () => {
  assert.throws(
    () => safeRemoteUrl("ext::x"),
    (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.match(e.message, /remote URL/);
      return true;
    },
  );
});

test("safeRemoteUrl: option-like check runs before the transport check", () => {
  // "-ext::x" is option-like; either rejection is acceptable, but it must throw.
  assert.throws(() => safeRemoteUrl("-ext::x"), GitError);
});

test("redactRemoteUrl removes embedded credentials from display text", () => {
  assert.strictEqual(
    redactRemoteUrl("https://user:secret@example.com/repo.git"),
    "https://***@example.com/repo.git",
  );
  assert.strictEqual(
    redactRemoteUrl("https://example.com/repo.git?access_token=secret&x=1"),
    "https://example.com/repo.git?access_token=***&x=1",
  );
  assert.strictEqual(
    redactRemoteUrl("git@example.com:owner/repo.git"),
    "git@example.com:owner/repo.git",
  );
});
