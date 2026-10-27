'use strict';

/*
 * Shared commit-graph layout + geometry.
 *
 * This is the single source of truth for turning a list of commits (each with a
 * `sha` and `parents`) into a drawable DAG. It is consumed by BOTH webviews:
 *   • the Git Graph panel (webview-ui/graph/graph.js), and
 *   • the History view (built inline by src/webviews/historyHtml.ts),
 * and it is unit-tested directly in Node (webview-ui/graph/graphLayout.test.js).
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
  // Commits must arrive child-before-parents (--topo-order or --date-order).
  // Returns one row per commit:
  //   { commit, col, colorIdx, parentShas[], incoming[], outgoing[], maxCols, … }
  //
  // options.openParents: when the list is a truncated page of history, a parent
  // that has not been loaded yet keeps its lane open to the bottom of the graph
  // (so the line visibly continues) instead of silently ending at the commit.
  // The synthetic uncommitted row never opens a lane.
  function buildLayout(commits, options) {
    const openParents = !!(options && options.openParents);
    const rowOf = new Map();
    commits.forEach((c, i) => rowOf.set(c.sha, i));

    // lanes[col] = sha the lane flows toward; laneColors[col] = its colour.
    // Colour belongs to the lane, not to whichever child reached a commit
    // first, so a branch keeps one colour down its whole first-parent line
    // even when another branch's lane joins it from the side.
    let lanes = [];
    let laneColors = [];
    let nextColor = 0;
    const newColor = () => nextColor++;
    const firstFreeIn = (arr) => {
      for (let i = 0; i < arr.length; i++) if (arr[i] == null) return i;
      arr.push(null);
      return arr.length - 1;
    };

    const rows = commits.map((commit) => {
      const keepMissing = openParents && commit.kind !== 'uncommitted';
      const parentShas = (commit.parents || []).filter((p) => rowOf.has(p) || keepMissing);
      const top = lanes.slice();
      const topColors = laneColors.slice();
      const bottom = top.slice();
      const bottomColors = topColors.slice();

      let myCol = top.indexOf(commit.sha);
      let myColorIdx;
      if (myCol === -1) {
        // A branch tip: nothing flows into it, so it starts a new lane.
        myCol = firstFreeIn(bottom);
        if (myCol >= top.length) top[myCol] = null;
        myColorIdx = newColor();
      } else {
        myColorIdx = topColors[myCol];
      }

      const incoming = [];
      top.forEach((sha, c) => {
        if (sha == null) return;
        incoming.push({
          fromCol: c,
          toCol: sha === commit.sha ? myCol : c,
          colorIdx: topColors[c],
          toNode: sha === commit.sha,
        });
      });

      for (let c = 0; c < bottom.length; c++) {
        if (bottom[c] === commit.sha) {
          bottom[c] = null;
          bottomColors[c] = null;
        }
      }

      const outgoing = [];
      parentShas.forEach((pSha, pi) => {
        if (pi === 0) {
          // The first parent continues this commit's own lane and colour.
          bottom[myCol] = pSha;
          bottomColors[myCol] = myColorIdx;
          outgoing.push({ fromCol: myCol, toCol: myCol, colorIdx: myColorIdx });
        } else {
          // A merged-in parent joins its existing lane, or opens a new one.
          let targetCol = bottom.indexOf(pSha);
          if (targetCol === -1) {
            targetCol = firstFreeIn(bottom);
            bottom[targetCol] = pSha;
            bottomColors[targetCol] = newColor();
          }
          outgoing.push({ fromCol: myCol, toCol: targetCol, colorIdx: bottomColors[targetCol] });
        }
      });

      const parentTargets = new Set(outgoing.map((o) => o.toCol));
      top.forEach((sha, c) => {
        if (sha == null || sha === commit.sha) return;
        if (bottom[c] !== sha) return;
        if (c === myCol) return;
        if (parentTargets.has(c)) return;
        outgoing.push({ fromCol: c, toCol: c, colorIdx: topColors[c] });
      });

      while (bottom.length > 0 && bottom[bottom.length - 1] == null) {
        bottom.pop();
      }
      bottomColors.length = bottom.length;
      lanes = bottom;
      laneColors = bottomColors;

      return {
        commit,
        col: myCol,
        colorIdx: myColorIdx,
        parentShas,
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

  // Path from a commit into its lane and straight down to `bottomY`, for a
  // parent that lies beyond the loaded page of history.
  function commitToOffPagePath(geom, commitCol, commitRow, laneCol, bottomY) {
    const xc = geom.cx(commitCol), yc = geom.cyOf(commitRow);
    const xl = geom.cx(laneCol);
    const yNext = Math.min(geom.cyOf(commitRow + 1), bottomY);
    let d = `M${xc},${yc} ` + transition(geom, xc, yc, xl, yNext);
    if (bottomY > yNext) d += `L${xl},${bottomY} `;
    return d;
  }

  // Turn layout rows into plain edge descriptors: one per (commit → parent).
  // Each edge's lane column comes from this row's `outgoing` list (pi-th entry ==
  // pi-th parent), so the vertical run lands exactly on the parent's dot column.
  // Edges to parents beyond the loaded page (see buildLayout's openParents) run
  // to `geom.bottomY` and are flagged `offPage`; edges from the synthetic
  // uncommitted row are flagged `dashed`.
  function computeEdges(rows, geom) {
    geom = geom && geom.cx ? geom : defaultGeom(geom);
    const rowOf = new Map();
    rows.forEach((r, i) => rowOf.set(r.commit.sha, i));
    const colByRow = rows.map((r) => r.col);
    const bottomY = typeof geom.bottomY === 'number'
      ? geom.bottomY
      : geom.cyOf(rows.length - 1) + geom.ROW_H / 2;
    const edges = [];
    rows.forEach((row, i) => {
      const parents = row.parentShas || (row.commit.parents || []).filter((p) => rowOf.has(p));
      const dashed = row.commit.kind === 'uncommitted';
      parents.forEach((pSha, pi) => {
        const seg = row.outgoing[pi];
        const laneCol = seg ? seg.toCol : row.col;
        const colorIdx = seg ? seg.colorIdx : row.colorIdx;
        if (!rowOf.has(pSha)) {
          edges.push({
            sha: row.commit.sha,
            colorIdx,
            dashed,
            offPage: true,
            d: commitToOffPagePath(geom, row.col, i, laneCol, bottomY),
          });
          return;
        }
        const pRow = rowOf.get(pSha);
        const parentCol = colByRow[pRow];
        edges.push({
          sha: row.commit.sha,
          colorIdx,
          dashed,
          offPage: false,
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
    commitToOffPagePath,
    computeEdges,
    computeNodes,
  };
});
