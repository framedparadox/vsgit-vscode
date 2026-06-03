import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLog, parseNameStatus, LOG_FORMAT } from "./log";

function record(fields: string[]): string {
  return fields.join("\x1f") + "\x1e";
}

test("LOG_FORMAT uses unit and record separators", () => {
  assert.ok(LOG_FORMAT.includes("\x1f"));
  assert.ok(LOG_FORMAT.endsWith("\x1e"));
});

test("parses a single commit with refs", () => {
  const out = record([
    "abc123def456",        // %H sha
    "parent1 parent2",     // %P parents
    "Alice",               // %an author name
    "alice@example.com",   // %ae author email
    "1700000000",          // %at author date
    "Alice",               // %cn committer name
    "1700000000",          // %ct committer date
    "HEAD -> main, tag: v1, origin/main", // %D refs
    "Fix the thing",       // %s subject
    "Body line one\nBody line two", // %b body
  ]);
  const commits = parseLog(out);
  assert.equal(commits.length, 1);
  const c = commits[0];
  assert.equal(c.sha, "abc123def456");
  assert.equal(c.shortSha, "abc123de");
  assert.deepEqual(c.parents, ["parent1", "parent2"]);
  assert.equal(c.authorName, "Alice");
  assert.equal(c.authorDate, 1700000000);
  assert.equal(c.subject, "Fix the thing");
  assert.equal(c.body, "Body line one\nBody line two");
  assert.deepEqual(c.refs, [
    { name: "main", kind: "head" },
    { name: "v1", kind: "tag" },
    { name: "origin/main", kind: "remoteBranch" },
  ]);
});

test("root commit has no parents and no refs", () => {
  const out = record([
    "root",  // sha
    "",      // parents
    "Bob",   // author name
    "bob@x.com", // author email
    "1",     // author date
    "Bob",   // committer name
    "1",     // committer date
    "",      // refs
    "init",  // subject
    "",      // body
  ]);
  const c = parseLog(out)[0];
  assert.deepEqual(c.parents, []);
  assert.deepEqual(c.refs, []);
});

test("parses multiple commits", () => {
  const out =
    record(["a", "b", "A", "a@x", "2", "A", "2", "", "s1", ""]) +
    record(["b", "", "B", "b@x", "1", "B", "1", "", "s2", ""]);
  const commits = parseLog(out);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].sha, "a");
  assert.equal(commits[1].sha, "b");
});

test("parseNameStatus handles adds and renames", () => {
  const out = "A\0added.txt\0R100\0old.txt\0new.txt\0M\0changed.txt\0";
  const files = parseNameStatus(out);
  assert.equal(files.length, 3);
  assert.deepEqual(files[0], { status: "A", path: "added.txt" });
  assert.deepEqual(files[1], {
    status: "R",
    path: "new.txt",
    origPath: "old.txt",
  });
  assert.deepEqual(files[2], { status: "M", path: "changed.txt" });
});
