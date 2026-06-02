import { test } from "node:test";
import assert from "node:assert/strict";
import { FOR_EACH_REF_FORMAT, parseForEachRef } from "./refs";

const SEP = "\x1f";

test("FOR_EACH_REF_FORMAT is defined and contains field separators", () => {
  assert.ok(FOR_EACH_REF_FORMAT.includes("\x1f"));
});

test("parses local branch", () => {
  const line = `refs/heads/main${SEP}abc123${SEP}origin/main${SEP}*${SEP}Initial commit`;
  const refs = parseForEachRef(line);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.equal(ref.fullName, "refs/heads/main");
  assert.equal(ref.shortName, "main");
  assert.equal(ref.kind, "localBranch");
  assert.equal(ref.objectId, "abc123");
  assert.equal(ref.upstream, "origin/main");
  assert.equal(ref.subject, "Initial commit");
  assert.equal(ref.isHead, true);
});

test("parses remote tracking branch", () => {
  const line = `refs/remotes/origin/develop${SEP}def456${SEP}${SEP}${SEP}Add feature`;
  const refs = parseForEachRef(line);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.equal(ref.shortName, "origin/develop");
  assert.equal(ref.kind, "remoteBranch");
  assert.equal(ref.isHead, false);
  assert.equal(ref.upstream, undefined);
});

test("parses tag ref", () => {
  const line = `refs/tags/v1.0.0${SEP}tagobj789${SEP}${SEP}${SEP}Release 1.0.0`;
  const refs = parseForEachRef(line);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.equal(ref.shortName, "v1.0.0");
  assert.equal(ref.kind, "tag");
  assert.equal(ref.isHead, false);
});

test("skips unknown ref namespaces (e.g. refs/stash)", () => {
  const line = `refs/stash${SEP}zzz999${SEP}${SEP}${SEP}WIP`;
  const refs = parseForEachRef(line);
  assert.equal(refs.length, 0);
});

test("skips empty lines", () => {
  const input = `\nrefs/heads/feat${SEP}111${SEP}${SEP}${SEP}msg\n\n`;
  const refs = parseForEachRef(input);
  assert.equal(refs.length, 1);
});

test("parses multiple refs", () => {
  const lines = [
    `refs/heads/main${SEP}a1${SEP}origin/main${SEP}*${SEP}main commit`,
    `refs/heads/dev${SEP}b2${SEP}${SEP}${SEP}dev commit`,
    `refs/tags/v2${SEP}c3${SEP}${SEP}${SEP}tag msg`,
  ].join("\n");
  const refs = parseForEachRef(lines);
  assert.equal(refs.length, 3);
  assert.equal(refs[0].kind, "localBranch");
  assert.equal(refs[1].kind, "localBranch");
  assert.equal(refs[2].kind, "tag");
});

test("branch with no upstream has upstream=undefined", () => {
  const line = `refs/heads/orphan${SEP}x1${SEP}${SEP}${SEP}orphan`;
  const refs = parseForEachRef(line);
  assert.equal(refs[0].upstream, undefined);
});

test("non-HEAD branch has isHead=false", () => {
  const line = `refs/heads/other${SEP}x2${SEP}${SEP} ${SEP}msg`;
  const refs = parseForEachRef(line);
  assert.equal(refs[0].isHead, false);
});
