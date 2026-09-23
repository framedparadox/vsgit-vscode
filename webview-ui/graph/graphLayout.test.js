'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildLayout,
  defaultGeom,
  computeEdges,
  computeNodes,
} = require('./graphLayout.js');

// Helper: build a commit list (already in --topo-order: child before parents).
function c(sha, parents, extra) {
  return Object.assign({ sha, parents: parents || [] }, extra || {});
}

test('empty input yields no rows, edges or nodes', () => {
  const rows = buildLayout([]);
  assert.deepStrictEqual(rows, []);
  assert.deepStrictEqual(computeEdges(rows), []);
  assert.deepStrictEqual(computeNodes(rows), []);
});

test('linear history stays in a single column and colour', () => {
  const commits = [c('A', ['B']), c('B', ['C']), c('C', [])];
  const rows = buildLayout(commits);
  assert.strictEqual(rows.length, 3);
  for (const r of rows) {
    assert.strictEqual(r.col, 0, 'every commit on column 0');
    assert.strictEqual(r.colorIdx, 0, 'one stable colour for the whole line');
  }
  assert.strictEqual(rows[0].maxCols, 1);
});

test('branch tip with no in-graph parent has no incoming lane', () => {
  const commits = [c('A', ['B']), c('B', [])];
  const rows = buildLayout(commits);
  // A is the tip: nothing flows into it from above.
  assert.strictEqual(rows[0].incoming.length, 0);
  // B receives A's lane from the top.
  assert.strictEqual(rows[1].incoming.length, 1);
  assert.strictEqual(rows[1].incoming[0].toNode, true);
});

test('one edge is emitted per in-graph parent, in parent order', () => {
  const commits = [c('A', ['B']), c('B', ['C']), c('C', [])];
  const edges = computeEdges(buildLayout(commits));
  // A->B and B->C; C has no parents in graph.
  assert.strictEqual(edges.length, 2);
  assert.ok(edges.every((e) => typeof e.d === 'string' && e.d.startsWith('M')));
  assert.deepStrictEqual(edges.map((e) => e.sha).sort(), ['A', 'B']);
});

test('parents missing from the commit set produce no dangling edge', () => {
  // C is referenced as a parent but not present (e.g. beyond the page limit).
  const commits = [c('A', ['B']), c('B', ['C'])];
  const rows = buildLayout(commits);
  const edges = computeEdges(rows);
  // Only A->B is drawable; B->C is dropped because C is off-page.
  assert.strictEqual(edges.length, 1);
  assert.strictEqual(edges[0].sha, 'A');
});

test('merge commit opens a second lane and keeps both parent edges', () => {
  // M is a merge of A and B which both descend from base.
  const commits = [
    c('M', ['A', 'B']),
    c('A', ['base']),
    c('B', ['base']),
    c('base', []),
  ];
  const rows = buildLayout(commits);
  const m = rows[0];
  // The merge has two outgoing segments heading to distinct columns.
  const targets = new Set(m.outgoing.slice(0, 2).map((o) => o.toCol));
  assert.strictEqual(targets.size, 2, 'two parents routed to two lanes');
  assert.ok(rows[0].maxCols >= 2, 'graph widens to at least two columns');

  const edges = computeEdges(rows);
  // M->A, M->B, A->base, B->base = 4 edges.
  assert.strictEqual(edges.length, 4);
  const mEdges = edges.filter((e) => e.sha === 'M');
  assert.strictEqual(mEdges.length, 2);
  // The two merge edges use different lane colours.
  assert.notStrictEqual(mEdges[0].colorIdx, mEdges[1].colorIdx);
});

test('computeNodes returns one centred dot per commit in row order', () => {
  const commits = [c('A', ['B']), c('B', [])];
  const geom = defaultGeom();
  const nodes = computeNodes(buildLayout(commits), geom);
  assert.strictEqual(nodes.length, 2);
  // Row centres are ROW_H/2, ROW_H*1.5, ...
  assert.strictEqual(nodes[0].cy, geom.ROW_H / 2);
  assert.strictEqual(nodes[1].cy, geom.ROW_H * 1.5);
  assert.ok(nodes[1].cy > nodes[0].cy, 'rows advance downward');
});

test('custom cyOf (expanded-row offset) shifts only rows below the gap', () => {
  const commits = [c('A', ['B']), c('B', ['C']), c('C', [])];
  const gap = 100;
  const geom = defaultGeom({
    cyOf: (i) => (i > 0 ? i * 24 + 12 + gap : i * 24 + 12),
  });
  const nodes = computeNodes(buildLayout(commits), geom);
  assert.strictEqual(nodes[0].cy, 12);
  assert.strictEqual(nodes[1].cy, 24 + 12 + gap);
  // The edge out of A must still begin exactly at A's dot.
  const edges = computeEdges(buildLayout(commits), geom);
  const aEdge = edges.find((e) => e.sha === 'A');
  assert.ok(aEdge.d.startsWith('M' + geom.cx(0) + ',12'));
});
