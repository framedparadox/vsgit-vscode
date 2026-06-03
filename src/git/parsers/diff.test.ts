import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, buildHunkPatch } from "./diff";

const SAMPLE = [
  "diff --git a/foo.txt b/foo.txt",
  "index 1111111..2222222 100644",
  "--- a/foo.txt",
  "+++ b/foo.txt",
  "@@ -1,3 +1,4 @@",
  " line1",
  "+inserted",
  " line2",
  " line3",
  "@@ -10,2 +11,2 @@",
  "-old",
  "+new",
  " tail",
  "",
].join("\n");

test("parses header and hunks", () => {
  const d = parseUnifiedDiff(SAMPLE);
  assert.equal(d.headerLines.length, 4);
  assert.equal(d.hunks.length, 2);
  assert.equal(d.hunks[0].oldStart, 1);
  assert.equal(d.hunks[0].oldLines, 3);
  assert.equal(d.hunks[0].newStart, 1);
  assert.equal(d.hunks[0].newLines, 4);
  assert.deepEqual(d.hunks[0].lines, [" line1", "+inserted", " line2", " line3"]);
});

test("hunk header without counts defaults to 1", () => {
  const diff = [
    "diff --git a/x b/x",
    "--- a/x",
    "+++ b/x",
    "@@ -5 +5 @@",
    "-a",
    "+b",
    "",
  ].join("\n");
  const d = parseUnifiedDiff(diff);
  assert.equal(d.hunks[0].oldLines, 1);
  assert.equal(d.hunks[0].newLines, 1);
});

test("buildHunkPatch emits applyable single-hunk patch", () => {
  const d = parseUnifiedDiff(SAMPLE);
  const patch = buildHunkPatch(d, d.hunks[1]);
  assert.ok(patch.startsWith("diff --git a/foo.txt b/foo.txt\n"));
  assert.ok(patch.includes("@@ -10,2 +11,2 @@"));
  assert.ok(patch.includes("+new"));
  assert.ok(!patch.includes("inserted"));
  assert.ok(patch.endsWith("\n"));
});
