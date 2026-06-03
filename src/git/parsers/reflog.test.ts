import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReflog, REFLOG_FORMAT } from "./reflog";

test("REFLOG_FORMAT has the expected fields", () => {
  assert.equal(REFLOG_FORMAT, "%H\x1f%gd\x1f%gs\x1f%an\x1f%at");
});

test("parses commit and checkout entries", () => {
  const out = [
    "f8ce5ba091fc\x1fHEAD@{0}\x1fcommit: second\x1fAlice\x1f1700000000",
    "e15f4adfabaf\x1fHEAD@{1}\x1fcheckout: moving from main to feature\x1fAlice\x1f1699999999",
  ].join("\n");
  const entries = parseReflog(out);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    { a: entries[0].action, m: entries[0].message, s: entries[0].selector },
    { a: "commit", m: "second", s: "HEAD@{0}" },
  );
  assert.equal(entries[1].action, "checkout");
  assert.equal(entries[1].message, "moving from main to feature");
  assert.equal(entries[0].shortSha, "f8ce5ba0");
});

test("handles initial-commit subject with parenthetical action", () => {
  const out =
    "abc\x1fHEAD@{0}\x1fcommit (initial): first commit\x1fBob\x1f1";
  const e = parseReflog(out)[0];
  assert.equal(e.action, "commit (initial)");
  assert.equal(e.message, "first commit");
});
