'use strict';

/*
 * Shared commit-graph layout + geometry.
 *
 * This is the single source of truth for turning a list of commits (each with a
 * `sha` and `parents`) into a drawable DAG. It is consumed by BOTH webviews:
 *   • the Git Graph panel (resources/graph.js), and
 *   • the History view (built inline by src/webviews/historyHtml.ts),
 * and it is unit-tested directly in Node (resources/graphLayout.test.js).
 *
 * It is a UMD module: in the browser it attaches to `self.GraphLayout`; in Node
 * it exports via `module.exports`. It must therefore stay completely free of any
 * DOM or VS Code API — callers turn the returned plain-data edges/nodes into SVG.
 *
 * The layout uses a two-half connected model over commits supplied in
 * --topo-order (a child always precedes its parents). We maintain
 * `lanes[col] = sha that the lane currently flows toward`; each commit keeps a
 * single stable colour for the whole lane-line it heads, so a branch reads as one
 * colour top-to-bottom and edges never break across rows.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GraphLayout = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // ─── lane layout (two-half connected model, topological) ───────────────────
  // Commits must arrive in --topo-order (child before parents). Returns one row
  // per commit: { commit, col, colorIdx, incoming[], outgoing[], maxCols, ... }.
  function buildLayout(commits) {
    const rowOf = new Map();
    commits.forEach((c, i) => rowOf.set(c.sha, i));

    let lanes = [];
    const lineColor = new Map();
    let nextColor = 0;
    const colorFor = (sha) => {
      if (!lineColor.has(sha)) lineColor.set(sha, nextColor++);
      return lineColor.get(sha);
    };
    const firstFreeIn = (arr) => {
      for (let i = 0; i < arr.length; i++) if (arr[i] == null) return i;
      arr.push(null);
      return arr.length - 1;
    };

    const rows = commits.map((commit) => {
      const parentShas = (commit.parents || []).filter((p) => rowOf.has(p));
      const top = lanes.slice();
      const bottom = top.slice();

      let myCol = top.indexOf(commit.sha);
      if (myCol === -1) {
        myCol = firstFreeIn(bottom);
        if (myCol >= top.length) top[myCol] = null;
      }
      const myColorIdx = colorFor(commit.sha);

      const incoming = [];
      top.forEach((sha, c) => {
        if (sha == null) return;
        incoming.push({
          fromCol: c,
          toCol: sha === commit.sha ? myCol : c,
          colorIdx: colorFor(sha),
          toNode: sha === commit.sha,
        });
      });

      for (let c = 0; c < bottom.length; c++) {
        if (bottom[c] === commit.sha) bottom[c] = null;
      }

      const outgoing = [];
      parentShas.forEach((pSha, pi) => {
        if (pi === 0) {
          bottom[myCol] = pSha;
          if (!lineColor.has(pSha)) lineColor.set(pSha, myColorIdx);
          outgoing.push({ fromCol: myCol, toCol: myCol, colorIdx: myColorIdx });
        } else {
          let targetCol = bottom.indexOf(pSha);
          if (targetCol === -1) {
            targetCol = firstFreeIn(bottom);
            bottom[targetCol] = pSha;
            colorFor(pSha);
          }
          outgoing.push({ fromCol: myCol, toCol: targetCol, colorIdx: colorFor(pSha) });
        }
      });

      const parentTargets = new Set(outgoing.map((o) => o.toCol));
      top.forEach((sha, c) => {
        if (sha == null || sha === commit.sha) return;
        if (bottom[c] !== sha) return;
        if (c === myCol) return;
        if (parentTargets.has(c)) return;
        outgoing.push({ fromCol: c, toCol: c, colorIdx: colorFor(sha) });
      });

      while (bottom.length > 0 && bottom[bottom.length - 1] == null) bottom.pop();
      lanes = bottom;

      return {
        commit,
        col: myCol,
        colorIdx: myColorIdx,
        incoming,
        outgoing,
        topCols: top.length,
        bottomCols: lanes.length,
      };
    });

    const maxCols = rows.reduce((m, r) => Math.max(m, r.col + 1, r.topCols, r.bottomCols), 1);
    rows.forEach((r) => { r.maxCols = maxCols; });
    return rows;
  }

  // ─── geometry ──────────────────────────────────────────────────────────────
  // `geom` carries the pixel tunables and a `cyOf(rowIdx)` mapping the row index
  // to its vertical centre (overridable so a panel can offset rows below an
  // expanded details row). All functions below are pure and return path strings.
  function defaultGeom(overrides) {
    const g = Object.assign({ ROW_H: 24, COL_W: 14, PAD: 8, R: 4, style: 'rounded' }, overrides || {});
    if (typeof g.cyOf !== 'function') {
      g.cyOf = (rowIdx) => rowIdx * g.ROW_H + g.ROW_H / 2;
    }
    g.cx = (c) => g.PAD + c * g.COL_W + g.COL_W / 2;
    return g;
  }

  // One smooth/angular transition between two adjacent row centres.
  function transition(geom, x1, y1, x2, y2) {
    if (x1 === x2) return `L${x2},${y2} `;
    if (geom.style === 'angular') {
      const bend = geom.ROW_H * 0.4;
      return `L${x1},${y2 - bend} L${x2},${y2} `;
    }
    const dy = (y2 - y1) * 0.8;
    return `C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2} `;
  }

  // Path from a commit to one of its parents, travelling in the edge's lane
  // column. Horizontal moves are confined to single inter-row gaps so the line
  // never jumps across the table.
  function commitToParentPath(geom, commitCol, commitRow, laneCol, parentCol, parentRow) {
    const cx = geom.cx;
    const cyOf = geom.cyOf;
    const xc = cx(commitCol), yc = cyOf(commitRow);
    const xl = cx(laneCol);
    const xp = cx(parentCol), yp = cyOf(parentRow);
    let d = `M${xc},${yc} `;

    const yEnter = cyOf(commitRow + 1);
    d += transition(geom, xc, yc, xl, yEnter);

    const yBeforeParent = cyOf(parentRow - 1);
    if (yBeforeParent > yEnter) d += `L${xl},${yBeforeParent} `;

    if (parentRow - 1 >= commitRow + 1) {
      d += transition(geom, xl, yBeforeParent, xp, yp);
    } else if (xl !== xp) {
      d = `M${xc},${yc} ` + transition(geom, xc, yc, xp, yp);
    } else {
      d += `L${xp},${yp} `;
    }
    return d;
  }

  // Turn layout rows into plain edge descriptors: one per (commit → parent).
  // Each edge's lane column comes from this row's `outgoing` list (pi-th entry ==
  // pi-th parent), so the vertical run lands exactly on the parent's dot column.
  function computeEdges(rows, geom) {
    geom = geom && geom.cx ? geom : defaultGeom(geom);
    const rowOf = new Map();
    rows.forEach((r, i) => rowOf.set(r.commit.sha, i));
    const colByRow = rows.map((r) => r.col);
    const edges = [];
    rows.forEach((row, i) => {
      const parents = (row.commit.parents || []).filter((p) => rowOf.has(p));
      parents.forEach((pSha, pi) => {
        const pRow = rowOf.get(pSha);
        const seg = row.outgoing[pi];
        const laneCol = seg ? seg.toCol : row.col;
        const parentCol = colByRow[pRow];
        const colorIdx = seg ? seg.colorIdx : row.colorIdx;
        edges.push({
          sha: row.commit.sha,
          colorIdx,
          d: commitToParentPath(geom, row.col, i, laneCol, parentCol, pRow),
        });
      });
    });
    return edges;
  }

  // Turn layout rows into plain node descriptors (commit dots).
  function computeNodes(rows, geom) {
    geom = geom && geom.cx ? geom : defaultGeom(geom);
    return rows.map((row, i) => ({
      sha: row.commit.sha,
      colorIdx: row.colorIdx,
      cx: geom.cx(row.col),
      cy: geom.cyOf(i),
      kind: row.commit.kind,
    }));
  }

  return {
    buildLayout,
    defaultGeom,
    transition,
    commitToParentPath,
    computeEdges,
    computeNodes,
  };
});
