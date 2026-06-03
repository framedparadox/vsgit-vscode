import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfigListZ } from "./config";

test("parses key/value records", () => {
  const out = "user.name\nAlice\0user.email\nalice@example.com\0";
  const entries = parseConfigListZ(out);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { key: "user.name", value: "Alice" });
  assert.deepEqual(entries[1], { key: "user.email", value: "alice@example.com" });
});

test("handles multiline values", () => {
  const out = "alias.lg\nlog --oneline\n--graph\0";
  const entries = parseConfigListZ(out);
  assert.equal(entries[0].key, "alias.lg");
  assert.equal(entries[0].value, "log --oneline\n--graph");
});

test("handles valueless key", () => {
  const out = "core.bare\0";
  const entries = parseConfigListZ(out);
  assert.deepEqual(entries[0], { key: "core.bare", value: "" });
});

test("preserves repeated multivar keys", () => {
  const out = "remote.origin.fetch\n+refs/heads/*\0remote.origin.fetch\n+refs/tags/*\0";
  const entries = parseConfigListZ(out);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].key, entries[1].key);
});
