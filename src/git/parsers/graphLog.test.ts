import { test } from "node:test";
import assert from "node:assert";
import { parseGraphLog } from "./graphLog";

const NUL = "\x00";
function line(fields: string[]): string {
  return fields.join(NUL);
}

test("parses a commit with a HEAD-pointer ref and multiple refs", () => {
  const raw = line([
    "a".repeat(40),
    "aaaaaaa",
    "Initial commit",
    "Ada Lovelace",
    "2026-06-01 10:00:00 +0000",
    "Ada Lovelace",
    "2026-06-01 10:05:00 +0000",
    "",
    "HEAD -> main, origin/main, tag: v1.0",
  ]);
  const [c] = parseGraphLog(raw);
  assert.strictEqual(c.sha, "a".repeat(40));
  assert.strictEqual(c.shortSha, "aaaaaaa");
  assert.strictEqual(c.message, "Initial commit");
  assert.strictEqual(c.author, "Ada Lovelace");
  assert.strictEqual(c.date, "2026-06-01 10:00:00 +0000");
  assert.strictEqual(c.committerDate, "2026-06-01 10:05:00 +0000");
  assert.deepStrictEqual(c.parents, []);
  // The "HEAD -> " pointer prefix is stripped; the rest are kept verbatim.
  assert.deepStrictEqual(c.refs, ["main", "origin/main", "tag: v1.0"]);
});

test("parses parent SHAs (merge commit has two) and empty refs", () => {
  const raw = line([
    "m".repeat(40),
    "mmmmmmm",
    "Merge branch feature",
    "Dev",
    "2026-06-02 09:00:00 +0000",
    "Dev",
    "2026-06-02 09:00:00 +0000",
    `${"p".repeat(40)} ${"q".repeat(40)}`,
    "",
  ]);
  const [c] = parseGraphLog(raw);
  assert.deepStrictEqual(c.parents, ["p".repeat(40), "q".repeat(40)]);
  assert.deepStrictEqual(c.refs, []);
});

test("parses multiple commits, one per line", () => {
  const raw = [
    line(["1".repeat(40), "1111111", "first", "A", "d1", "A", "d1", "", ""]),
    line(["2".repeat(40), "2222222", "second", "B", "d2", "B", "d2", "1".repeat(40), ""]),
  ].join("\n");
  const commits = parseGraphLog(raw);
  assert.strictEqual(commits.length, 2);
  assert.strictEqual(commits[1].message, "second");
  assert.deepStrictEqual(commits[1].parents, ["1".repeat(40)]);
});

test("empty output yields no commits", () => {
  assert.deepStrictEqual(parseGraphLog(""), []);
  assert.deepStrictEqual(parseGraphLog("\n  \n"), []);
});

test("a subject containing commas is not confused with ref separators", () => {
  const raw = line([
    "b".repeat(40),
    "bbbbbbb",
    "fix: a, b, and c",
    "A",
    "d",
    "A",
    "d",
    "",
    "main",
  ]);
  const [c] = parseGraphLog(raw);
  assert.strictEqual(c.message, "fix: a, b, and c");
  assert.deepStrictEqual(c.refs, ["main"]);
});
