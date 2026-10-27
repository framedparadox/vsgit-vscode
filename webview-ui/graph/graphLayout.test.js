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

test('openParents keeps a lane running to the bottom for an unloaded parent', () => {
  // A page of history cut off below B: B's parent C was not loaded.
  const commits = [c('A', ['B']), c('X', ['B']), c('B', ['C'])];
  const rows = buildLayout(commits, { openParents: true });
  const geom = defaultGeom({ bottomY: 500 });
  const edges = computeEdges(rows, geom);
  const offPage = edges.filter((e) => e.offPage);
  assert.strictEqual(offPage.length, 1, 'one edge continues off the page');
  assert.strictEqual(offPage[0].sha, 'B');
  assert.ok(offPage[0].d.trim().endsWith(',500'), 'the edge runs to the bottom of the graph');
  // Without openParents the same history draws no dangling edge (History view behaviour).
  assert.strictEqual(computeEdges(buildLayout(commits), geom).filter((e) => e.offPage).length, 0);
});

test('open lanes are reserved: later commits never sit on a continuing line', () => {
  // A's parent P is off-page; B and C are an unrelated branch loaded below.
  const commits = [c('A', ['P']), c('B', ['C']), c('C', [])];
  const rows = buildLayout(commits, { openParents: true });
  const aLane = rows[0].outgoing[0].toCol;
  assert.notStrictEqual(rows[1].col, aLane, 'B avoids the continuing lane');
  assert.notStrictEqual(rows[2].col, aLane, 'C avoids the continuing lane');
});

test('the uncommitted row never opens a lane and its edge is dashed', () => {
  const commits = [
    c('*uncommitted*', ['H'], { kind: 'uncommitted' }),
    c('H', ['G']),
    c('G', []),
  ];
  const edges = computeEdges(buildLayout(commits, { openParents: true }));
  const wip = edges.filter((e) => e.sha === '*uncommitted*');
  assert.strictEqual(wip.length, 1);
  assert.strictEqual(wip[0].dashed, true);
  assert.strictEqual(wip[0].offPage, false);

  // HEAD outside the loaded set (e.g. filtered out): no dangling WIP line.
  const orphan = computeEdges(buildLayout([c('*uncommitted*', ['Z'], { kind: 'uncommitted' }), c('G', [])], { openParents: true }));
  assert.strictEqual(orphan.length, 0);
});

test('a lane keeps its colour when another branch joins it from the side', () => {
  // M merges T into main; F is a feature branch forked from main's D and listed
  // first (topo order). D sits in main's lane and must keep main's colour even
  // though F's lane reaches it first.
  const commits = [
    c('F', ['D']),
    c('M', ['D', 'T']),
    c('T', ['B']),
    c('D', ['B']),
    c('B', []),
  ];
  const rows = buildLayout(commits);
  const byId = new Map(rows.map((r) => [r.commit.sha, r]));
  const d = byId.get('D');
  // D lands in the leftmost lane flowing to it, and takes that lane's colour.
  const laneIntoD = d.incoming.find((seg) => seg.toNode && seg.fromCol === d.col);
  assert.ok(laneIntoD, 'D is entered from its own column');
  assert.strictEqual(d.colorIdx, laneIntoD.colorIdx, 'dot colour matches the lane it sits in');
  // Every commit's first-parent edge continues in the commit's own colour.
  for (const r of rows) {
    if (r.outgoing.length && r.parentShas.length) {
      assert.strictEqual(r.outgoing[0].colorIdx, r.colorIdx, `${r.commit.sha} keeps its colour`);
    }
  }
});
