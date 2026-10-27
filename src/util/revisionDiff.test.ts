import { test } from "node:test";
import assert from "node:assert";
import { diffPathsForFile, shortRefLabel } from "./revisionDiff";

test("shortRefLabel abbreviates full SHAs and leaves refs alone", () => {
  assert.strictEqual(
    shortRefLabel("0123456789abcdef0123456789abcdef01234567"),
    "01234567",
  );
  assert.strictEqual(shortRefLabel("HEAD"), "HEAD");
  assert.strictEqual(shortRefLabel("main"), "main");
  assert.strictEqual(shortRefLabel("abc1234"), "abc1234");
});

test("shortRefLabel keeps parent suffixes on abbreviated SHAs", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.strictEqual(shortRefLabel(`${sha}~1`), "01234567~1");
  assert.strictEqual(shortRefLabel(`${sha}^`), "01234567^");
  assert.strictEqual(shortRefLabel(`${sha}^2~3`), "01234567^2~3");
  assert.strictEqual(shortRefLabel("HEAD~1"), "HEAD~1");
  // Only a pure parent suffix qualifies; anything else stays verbatim.
  assert.strictEqual(shortRefLabel(`${sha}:path`), `${sha}:path`);
});

test("diffPathsForFile uses origPath on the left for renames", () => {
  assert.deepStrictEqual(diffPathsForFile({ path: "new.ts", origPath: "old.ts" }), {
    leftRel: "old.ts",
    rightRel: "new.ts",
  });
  assert.deepStrictEqual(diffPathsForFile({ path: "same.ts" }), {
    leftRel: "same.ts",
    rightRel: "same.ts",
  });
});
