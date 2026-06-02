import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlamePorcelain } from "./blame";

const A = "a".repeat(40);
const B = "b".repeat(40);
const ZERO = "0".repeat(40);

function block(
  sha: string,
  finalLine: number,
  withMeta: boolean,
  content: string,
): string {
  const lines = [`${sha} ${finalLine} ${finalLine} 1`];
  if (withMeta) {
    lines.push(
      `author Alice`,
      `author-mail <a@a.com>`,
      `author-time 1700000000`,
      `author-tz -0800`,
      `committer Alice`,
      `committer-time 1700000000`,
      `summary did a thing`,
      `filename f`,
    );
  }
  lines.push(`\t${content}`);
  return lines.join("\n");
}

test("parses lines and caches commit metadata", () => {
  const out =
    block(A, 1, true, "line1") + "\n" + block(A, 2, false, "line2") + "\n";
  const blame = parseBlamePorcelain(out);
  assert.equal(blame.length, 2);
  assert.equal(blame[0].authorName, "Alice");
  assert.equal(blame[0].summary, "did a thing");
  // Second line references the same commit; metadata is reused from cache.
  assert.equal(blame[1].authorName, "Alice");
  assert.equal(blame[1].shortSha, "aaaaaaaa");
});

test("handles multiple commits and orders by line", () => {
  const out =
    block(B, 2, true, "two") + "\n" + block(A, 1, true, "one") + "\n";
  const blame = parseBlamePorcelain(out);
  assert.deepEqual(
    blame.map((b) => b.line),
    [1, 2],
  );
});

test("flags uncommitted (zero sha) lines", () => {
  const out = block(ZERO, 1, true, "new line") + "\n";
  const blame = parseBlamePorcelain(out);
  assert.equal(blame[0].uncommitted, true);
  assert.equal(blame[0].authorName, "You");
});
