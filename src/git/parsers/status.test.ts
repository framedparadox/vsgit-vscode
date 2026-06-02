import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatusV2 } from "./status";

test("parses untracked entries", () => {
  const out = "? foo.txt\0? src/bar.ts\0";
  const { changes } = parseStatusV2(out);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].path, "foo.txt");
  assert.equal(changes[0].worktreeState, "untracked");
});

test("parses ordinary modified entry", () => {
  // "1 .M N... 100644 100644 100644 hH hI README.md"
  const out =
    "1 .M N... 100644 100644 100644 1111111 2222222 README.md\0";
  const { changes } = parseStatusV2(out);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "README.md");
  assert.equal(changes[0].indexState, undefined);
  assert.equal(changes[0].worktreeState, "modified");
});

test("parses staged added entry", () => {
  const out = "1 A. N... 000000 100644 100644 0000000 3333333 new.ts\0";
  const { changes } = parseStatusV2(out);
  assert.equal(changes[0].indexState, "added");
  assert.equal(changes[0].worktreeState, undefined);
});

test("parses renamed entry with orig path", () => {
  const out =
    "2 R. N... 100644 100644 100644 aaa bbb R100 new-name.ts\0old-name.ts\0";
  const { changes } = parseStatusV2(out);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "new-name.ts");
  assert.equal(changes[0].origPath, "old-name.ts");
  assert.equal(changes[0].indexState, "renamed");
});

test("parses unmerged/conflicted entry", () => {
  // u XY sub m1 m2 m3 mW h1 h2 h3 path
  const out =
    "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts\0";
  const { changes } = parseStatusV2(out);
  assert.equal(changes[0].conflicted, true);
  assert.equal(changes[0].path, "conflict.ts");
});
