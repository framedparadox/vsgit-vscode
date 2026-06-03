import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRebaseTodo, serializeRebaseTodo } from "./rebaseTodo";

const TODO = [
  "pick a1b2c3d Add feature",
  "pick d4e5f6a Fix bug",
  "",
  "# Rebase abc..def onto abc (2 commands)",
  "#",
  "# Commands:",
  "# p, pick <commit> = use commit",
].join("\n");

test("parses pick lines and ignores comments/blanks", () => {
  const items = parseRebaseTodo(TODO);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    action: "pick",
    sha: "a1b2c3d",
    subject: "Add feature",
  });
  assert.equal(items[1].subject, "Fix bug");
});

test("accepts short and long action names", () => {
  const items = parseRebaseTodo(
    ["p aaa one", "reword bbb two", "f ccc three", "drop ddd four"].join("\n"),
  );
  assert.deepEqual(
    items.map((i) => i.action),
    ["pick", "reword", "fixup", "drop"],
  );
});

test("serialize round-trips and omits dropped commits", () => {
  const items = parseRebaseTodo(TODO);
  items[1].action = "squash";
  items.push({ action: "drop", sha: "ffffff0", subject: "junk" });
  const out = serializeRebaseTodo(items);
  assert.equal(
    out,
    "pick a1b2c3d Add feature\nsquash d4e5f6a Fix bug\n",
  );
});

test("reorder is preserved", () => {
  const items = parseRebaseTodo(TODO);
  const reordered = [items[1], items[0]];
  const out = serializeRebaseTodo(reordered);
  assert.equal(out, "pick d4e5f6a Fix bug\npick a1b2c3d Add feature\n");
});
