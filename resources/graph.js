'use strict';

/*
 * Git Graph webview client.
 *
 * Clean-room implementation of a git-graph style DAG: lane layout, coloured
 * branch lines (rounded or angular), ref badges, an uncommitted-changes row,
 * stash badges, resizable / hideable columns, a find widget, a docked commit
 * details view with a changed-file list, and commit / ref context menus.
 */

const vscode = acquireVsCodeApi();

// ─── tunables ──────────────────────────────────────────────────────────────
const ROW_H = 24; // px per row
const COL_W = 14; // px per graph column
const R = 4;      // commit dot radius
const PAD = 8;    // left / right padding inside the graph cell

// Config pushed in from the extension (palette, style, columns, dateFormat).
let CONFIG = {
  palette: ['#0085d9','#d9008f','#00d90a','#d98500','#a300d9','#ff0000',
            '#00d9cc','#e138e8','#85d900','#dc5b23','#6f24d6','#ffcc00'],
  style: 'rounded',
  dateFormat: 'relative',
  columns: { date: true, author: true, commit: true },
  showRemoteBranches: true,
};
function laneColor(idx) { return CONFIG.palette[idx % CONFIG.palette.length]; }

// ─── state ───────────────────────────────────────────────────────────────────
let graphData = null;       // { commits, branches, tags, head, uncommitted, stashes }
let layoutRows = [];        // output of buildLayout
let selectedSha = null;
let findMatches = [];       // array of sha
let findIndex = -1;

// Persisted UI state (column widths, toggles).
const persisted = vscode.getState() || {};
let colWidths = persisted.colWidths || {};   // { desc, date, author, commit }

function savePersisted() {
  vscode.setState({ ...vscode.getState(), colWidths });
}

// ─── ref helpers ─────────────────────────────────────────────────────────────
// Each commit.refs is [{ name, type }]; type ∈ head|localBranch|remoteBranch|tag|stash.
// Badges render as "coloured logo + value", tinted to the lane colour of the
// commit they point at (git-graph style).
function refClass(type) {
  switch (type) {
    case 'head': return 'ref-head';
    case 'localBranch': return 'ref-local';
    case 'remoteBranch': return 'ref-remote';
    case 'tag': return 'ref-tag';
    case 'stash': return 'ref-stash';
    default: return 'ref-local';
  }
}
// Inline SVG glyph per ref type, coloured by the lane.
function refGlyph(type, color) {
  const c = color;
  switch (type) {
    case 'tag':
      return '<svg class="ref-svg" viewBox="0 0 16 16" width="11" height="11">' +
        '<path fill="' + c + '" d="M2 2h6l6 6-6 6-6-6V2z"/>' +
        '<circle cx="5" cy="5" r="1.4" fill="#fff"/></svg>';
    case 'remoteBranch':
      return '<svg class="ref-svg" viewBox="0 0 16 16" width="11" height="11">' +
        '<path fill="' + c + '" d="M4.5 12a3 3 0 0 1-.3-5.98A4 4 0 0 1 12 6.2 2.9 2.9 0 0 1 11.5 12h-7z"/></svg>';
    case 'stash':
      return '<svg class="ref-svg" viewBox="0 0 16 16" width="11" height="11">' +
        '<path fill="' + c + '" d="M2 4l6-2 6 2-6 2-6-2zm0 2l6 2 6-2v6l-6 2-6-2V6z"/></svg>';
    default: // branch / head
      return '<svg class="ref-svg" viewBox="0 0 16 16" width="11" height="11">' +
        '<circle cx="4" cy="3.5" r="1.8" fill="' + c + '"/>' +
        '<circle cx="4" cy="12.5" r="1.8" fill="' + c + '"/>' +
        '<circle cx="12" cy="3.5" r="1.8" fill="' + c + '"/>' +
        '<path stroke="' + c + '" stroke-width="1.4" fill="none" d="M4 5.3v5.4M12 5.3c0 3-3.5 2.5-7 2.5"/></svg>';
  }
}

function makeRefBadge(ref, colorIdx) {
  const color = laneColor(colorIdx);
  const span = document.createElement('span');
  span.className = 'ref-badge ' + refClass(ref.type) + ' clickable';
  span.dataset.refName = ref.name;
  span.dataset.refType = ref.type;
  span.style.setProperty('--ref-color', color);
  const glyph = document.createElement('span');
  glyph.className = 'ref-icon';
  glyph.innerHTML = refGlyph(ref.type, ref.type === 'head' ? '#fff' : color);
  span.appendChild(glyph);
  span.appendChild(document.createTextNode(ref.name));
  span.title = ref.name;
  span.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showRefMenu(e.clientX, e.clientY, ref);
  });
  span.addEventListener('click', (e) => e.stopPropagation());
  return span;
}

// All refs (branches, HEAD, remotes, tags, stashes) render in the refs column,
// each tinted to the lane colour of the commit it points at.
function refBadgesFor(commit, colorIdx) {
  const frag = document.createDocumentFragment();
  (commit.refs || []).forEach((r) => frag.appendChild(makeRefBadge(r, colorIdx)));
  return frag;
}

// ─── lane layout (two-half connected model) ──────────────────────────────────
/*
 * Each row produces two segment lists tied to one global lane assignment:
 *
 *   incoming  — upper half (y:0 → cy). One segment per column live at the row's
 *               TOP boundary. The column carrying THIS commit terminates at the
 *               node; every other live column passes straight down to cy.
 *   outgoing  — lower half (cy → y:ROW_H). One segment per column live at the
 *               row's BOTTOM boundary (the parent lanes). The first parent stays
 *               in the commit's column; extra parents / redirects curve out.
 *
 * Because the bottom-boundary lane set of row N is exactly the top-boundary set
 * of row N+1, adjacent canvases always connect — no gaps, no jitter. Colour is
 * carried per-line (keyed by the SHA flowing in a column) so it persists down a
 * whole branch instead of being recomputed per row.
 */
function buildLayout(commits) {
  const rowOf = new Map();
  commits.forEach((c, i) => rowOf.set(c.sha, i));

  let active = [];                 // active[col] = sha expected to flow into col
  const lineColor = new Map();     // sha -> colour index (per branch line)
  let nextColor = 0;

  const rows = commits.map((commit) => {
    const parentShas = (commit.parents || []).filter((p) => rowOf.has(p));

    // Snapshot of columns entering this row from above (the top boundary). This
    // equals the previous row's `active`, so incoming lines line up exactly.
    const topActive = active.slice();

    // Column for this commit: where a child already routed it, else first free.
    let myCol = topActive.indexOf(commit.sha);
    if (myCol === -1) {
      myCol = firstFree(topActive);
    }
    if (!lineColor.has(commit.sha)) lineColor.set(commit.sha, nextColor++);
    const myColorIdx = lineColor.get(commit.sha);

    // ── incoming (upper half) ────────────────────────────────────────────
    // Every live top-boundary column draws from y=0 down to cy. The column(s)
    // carrying this commit terminate at the node; the rest are pass-through and
    // continue below. Merge collapses any duplicate columns also holding our sha.
    const incoming = [];
    topActive.forEach((sha, c) => {
      if (sha === null) return;
      const colorIdx = lineColor.get(sha) ?? c;
      incoming.push({ fromCol: c, toCol: c, colorIdx, toNode: sha === commit.sha });
    });

    // ── build the bottom boundary (parent lanes) ─────────────────────────
    // Start from the top boundary, then clear every slot holding this commit
    // (a merge target may have routed it into several columns).
    const bottom = topActive.slice();
    for (let c = 0; c < bottom.length; c++) {
      if (bottom[c] === commit.sha) bottom[c] = null;
    }

    const outgoing = []; // {fromCol(at cy), toCol(at bottom), colorIdx}

    parentShas.forEach((pSha, pi) => {
      if (pi === 0) {
        // First parent continues straight down in the commit's own column.
        bottom[myCol] = pSha;
        if (!lineColor.has(pSha)) lineColor.set(pSha, myColorIdx);
        outgoing.push({ fromCol: myCol, toCol: myCol, colorIdx: myColorIdx });
      } else {
        // Extra parent (merge source): reuse its existing lane if present, else
        // allocate a fresh one. The line curves from the node out to that lane.
        let targetCol = bottom.indexOf(pSha);
        if (targetCol === -1) {
          targetCol = firstFree(bottom);
          bottom[targetCol] = pSha;
          if (!lineColor.has(pSha)) lineColor.set(pSha, nextColor++);
        }
        outgoing.push({ fromCol: myCol, toCol: targetCol, colorIdx: lineColor.get(pSha) });
      }
    });

    // Pass-through columns (live at top, not this commit, not already emitted as
    // a parent target) continue straight down through the lower half too.
    const parentTargets = new Set(outgoing.map((o) => o.toCol));
    topActive.forEach((sha, c) => {
      if (sha === null || sha === commit.sha) return;
      if (bottom[c] !== sha) return;          // it moved / was cleared
      if (c === myCol) return;                 // handled by first-parent
      if (parentTargets.has(c)) return;        // already a parent line
      outgoing.push({ fromCol: c, toCol: c, colorIdx: lineColor.get(sha) ?? c });
    });

    // Trim trailing empty lanes so the graph stays compact.
    while (bottom.length > 0 && bottom[bottom.length - 1] === null) bottom.pop();
    active = bottom;

    return {
      commit,
      col: myCol,
      colorIdx: myColorIdx,
      incoming,
      outgoing,
      topCols: topActive.length,
      bottomCols: bottom.length,
    };
  });

  // Single global column count → every row uses identical X positions / width.
  const maxCols = rows.reduce((m, r) => Math.max(m, r.col + 1, r.topCols, r.bottomCols), 1);
  rows.forEach((r) => { r.maxCols = maxCols; });
  return rows;
}

function firstFree(arr) {
  for (let i = 0; i < arr.length; i++) if (arr[i] === null || arr[i] === undefined) return i;
  arr.push(null);
  return arr.length - 1;
}

// ─── drawing ──────────────────────────────────────────────────────────────────
const cx = (c) => PAD + c * COL_W + COL_W / 2;

// One vertical-handled curve (or elbow) between two columns across a half-row.
function drawConnector(ctx, x1, y1, x2, y2) {
  if (x1 === x2) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    return;
  }
  if (CONFIG.style === 'angular') {
    const mid = (y1 + y2) / 2;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, mid);
    ctx.lineTo(x2, mid);
    ctx.lineTo(x2, y2);
  } else {
    // Cubic bezier whose control handles are vertical, so the line leaves and
    // arrives perpendicular to the row boundaries (smooth git-graph curve).
    const dy = (y2 - y1) * 0.5;
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, y1 + dy, x2, y2 - dy, x2, y2);
  }
}

function drawRowGraph(row) {
  const w = row.maxCols * COL_W + PAD * 2;
  const cv = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr;
  cv.height = ROW_H * dpr;
  cv.style.width = w + 'px';
  cv.style.height = ROW_H + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';

  const cy = ROW_H / 2;

  // Upper half: incoming lines from the top boundary down to cy.
  row.incoming.forEach((e) => {
    ctx.beginPath();
    ctx.strokeStyle = laneColor(e.colorIdx);
    drawConnector(ctx, cx(e.fromCol), 0, cx(e.toCol), cy);
    ctx.stroke();
  });

  // Lower half: outgoing lines from cy down to the bottom boundary.
  row.outgoing.forEach((e) => {
    ctx.beginPath();
    ctx.strokeStyle = laneColor(e.colorIdx);
    drawConnector(ctx, cx(e.fromCol), cy, cx(e.toCol), ROW_H);
    ctx.stroke();
  });

  // Node on top of the lines.
  const x = cx(row.col);
  const isWork = row.commit.kind === 'uncommitted';
  if (isWork) {
    ctx.beginPath();
    ctx.arc(x, cy, R, 0, 2 * Math.PI);
    ctx.strokeStyle = laneColor(row.colorIdx);
    ctx.lineWidth = 1.8;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, cy, R, 0, 2 * Math.PI);
    ctx.fillStyle = laneColor(row.colorIdx);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, cy, R, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return cv;
}

// ─── table rendering ──────────────────────────────────────────────────────────
function renderTable(rows) {
  const tbody = document.getElementById('graph-body');
  tbody.innerHTML = '';
  if (rows.length === 0) return;

  const maxCols = rows.length ? rows[0].maxCols : 1;
  const graphColW = maxCols * COL_W + PAD * 2;
  document.getElementById('col-graph').style.width = graphColW + 'px';

  // Map each commit's SHA to its lane colour so ref badges (which point at a
  // commit) can be tinted to that commit's branch colour.
  const colorOf = new Map();
  rows.forEach((r) => colorOf.set(r.commit.sha, r.colorIdx));

  applyColumnWidths();
  applyColumnVisibility();

  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const commit = row.commit;
    const tr = document.createElement('tr');
    tr.className = 'commit-row' + (commit.kind === 'uncommitted' ? ' uncommitted' : '');
    tr.dataset.sha = commit.sha;
    if (commit.sha === selectedSha) tr.classList.add('selected');

    const tdGraph = document.createElement('td');
    tdGraph.className = 'col-graph';
    tdGraph.appendChild(drawRowGraph(row));
    tr.appendChild(tdGraph);

    const tdRefs = document.createElement('td');
    tdRefs.className = 'col-refs';
    tdRefs.appendChild(refBadgesFor(commit, colorOf.get(commit.sha) ?? row.colorIdx));
    tr.appendChild(tdRefs);

    const tdDesc = document.createElement('td');
    tdDesc.className = 'col-desc';
    const text = document.createElement('span');
    text.className = 'desc-text';
    text.textContent = commit.message;
    text.title = commit.message;
    tdDesc.appendChild(text);
    tr.appendChild(tdDesc);

    const tdDate = document.createElement('td');
    tdDate.className = 'col-date';
    tdDate.textContent = commit.kind === 'uncommitted' ? '' : formatDate(commit.date);
    tr.appendChild(tdDate);

    const tdAuthor = document.createElement('td');
    tdAuthor.className = 'col-author';
    tdAuthor.textContent = commit.author || '';
    tr.appendChild(tdAuthor);

    const tdCommit = document.createElement('td');
    tdCommit.className = 'col-commit';
    tdCommit.textContent = commit.kind === 'uncommitted' ? '*' : commit.shortSha;
    tr.appendChild(tdCommit);

    tr.addEventListener('click', () => selectCommit(commit, tr));
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (commit.kind === 'uncommitted') return;
      showCommitMenu(e.clientX, e.clientY, commit);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  applyColumnVisibility();
}

function applyColumnWidths() {
  const set = (id, w) => { if (w) document.getElementById(id).style.width = w + 'px'; };
  set('col-refs', colWidths.refs || 160);
  set('col-date', colWidths.date || 92);
  set('col-author', colWidths.author || 140);
  set('col-commit', colWidths.commit || 80);
}

function applyColumnVisibility() {
  const toggle = (cls, show) => {
    document.querySelectorAll('.' + cls).forEach((el) => {
      el.classList.toggle('hidden-col', !show);
    });
  };
  toggle('col-refs', CONFIG.columns.refs !== false);
  toggle('col-date', CONFIG.columns.date);
  toggle('col-author', CONFIG.columns.author);
  toggle('col-commit', CONFIG.columns.commit);
}

// ─── details (docked) ─────────────────────────────────────────────────────────
function selectCommit(commit, tr) {
  selectedSha = commit.sha;
  document.querySelectorAll('#graph-body tr.selected').forEach((r) => r.classList.remove('selected'));
  if (tr) tr.classList.add('selected');
  if (commit.kind === 'uncommitted') { closeDetails(); return; }
  showDetails(commit);
  vscode.postMessage({ type: 'requestFiles', data: commit.sha });
}

function showDetails(commit) {
  const panel = document.getElementById('details-panel');
  const dateStr = commit.date ? new Date(commit.date).toLocaleString() : '';
  document.getElementById('details-inner').innerHTML =
    '<div id="details-header">' +
      '<span class="detail-sha">' + esc(commit.shortSha) + '</span>' +
      '<button id="details-close" title="Close">✕</button>' +
    '</div>' +
    '<div class="detail-meta">' +
      '<span class="detail-label">Author</span><span class="detail-value">' + esc(commit.author || '') + '</span>' +
      '<span class="detail-label">Date</span><span class="detail-value">' + esc(dateStr) + '</span>' +
      '<span class="detail-label">Parents</span><span class="detail-value detail-mono">' +
        (commit.parents || []).map((p) => p.slice(0, 8)).join(' ') + '</span>' +
      '<span class="detail-label">Subject</span><span class="detail-value">' + esc(commit.message) + '</span>' +
    '</div>' +
    '<div id="details-files"><div class="detail-label">Loading files…</div></div>';
  panel.classList.add('visible');
  document.getElementById('details-close').addEventListener('click', closeDetails);
}

function closeDetails() {
  document.getElementById('details-panel').classList.remove('visible');
}

function renderFiles(sha, files) {
  if (selectedSha !== sha) return;
  const host = document.getElementById('details-files');
  if (!host) return;
  if (!files || files.length === 0) {
    host.innerHTML = '<div class="detail-label">No file changes.</div>';
    return;
  }
  host.innerHTML = '';
  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    const st = document.createElement('span');
    const code = (f.status || 'M').charAt(0).toUpperCase();
    st.className = 'file-status ' + code;
    st.textContent = code;
    const p = document.createElement('span');
    p.className = 'file-path';
    p.textContent = f.path;
    p.title = f.path;
    row.appendChild(st);
    row.appendChild(p);
    row.addEventListener('click', () => {
      vscode.postMessage({ type: 'openFileDiff', data: { sha, path: f.path } });
    });
    host.appendChild(row);
  });
}

// ─── context menus ────────────────────────────────────────────────────────────
function buildMenu(items) {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = '';
  items.forEach((it) => {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'context-menu-separator';
      menu.appendChild(s);
    } else if (it.title) {
      const t = document.createElement('div');
      t.className = 'context-menu-title';
      t.textContent = it.title;
      menu.appendChild(t);
    } else {
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      el.textContent = it.label;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('visible');
        it.action();
      });
      menu.appendChild(el);
    }
  });
  return menu;
}

function placeMenu(menu, x, y) {
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('visible');
  // nudge back on screen if overflowing
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - r.width - 4) + 'px';
  if (r.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - r.height - 4) + 'px';
}

function showCommitMenu(x, y, commit) {
  const sha = commit.sha;
  const send = (type, data) => vscode.postMessage({ type, data });
  const menu = buildMenu([
    { title: commit.shortSha },
    { label: 'Checkout Commit…', action: () => send('checkout', sha) },
    { label: 'Create Branch Here…', action: () => send('createBranch', { sha }) },
    { label: 'Create Tag Here…', action: () => send('createTag', { sha }) },
    { sep: true },
    { label: 'Merge into Current Branch…', action: () => send('merge', sha) },
    { label: 'Rebase Current Branch onto This…', action: () => send('rebase', sha) },
    { sep: true },
    { label: 'Cherry-Pick', action: () => send('cherryPick', sha) },
    { label: 'Revert', action: () => send('revert', sha) },
    { label: 'Drop Commit…', action: () => send('dropCommit', sha) },
    { sep: true },
    { label: 'Reset → Soft', action: () => send('reset', { sha, mode: 'soft' }) },
    { label: 'Reset → Mixed', action: () => send('reset', { sha, mode: 'mixed' }) },
    { label: 'Reset → Hard', action: () => send('reset', { sha, mode: 'hard' }) },
    { sep: true },
    { label: 'Compare with HEAD', action: () => send('compareWithHead', sha) },
    { label: 'Compare with Another Commit…', action: () => send('compareWithAnother', sha) },
    { sep: true },
    { label: 'Show Details', action: () => { selectedSha = sha; showDetails(commit); send('requestFiles', sha); } },
    { label: 'Copy SHA (short)', action: () => send('copyCommitSha', commit.shortSha) },
    { label: 'Copy SHA (full)', action: () => send('copyCommitSha', sha) },
  ]);
  placeMenu(menu, x, y);
}

function showRefMenu(x, y, ref) {
  const send = (type, data) => vscode.postMessage({ type, data });
  let items = [{ title: ref.name }];
  if (ref.type === 'localBranch' || ref.type === 'head') {
    items = items.concat([
      { label: 'Checkout', action: () => send('checkout', ref.name) },
      { label: 'Merge into Current…', action: () => send('merge', ref.name) },
      { label: 'Rebase Current onto…', action: () => send('rebase', ref.name) },
      { sep: true },
      { label: 'Rename…', action: () => send('renameBranch', { name: ref.name }) },
      { label: 'Delete…', action: () => send('deleteBranch', { name: ref.name }) },
      { label: 'Push…', action: () => send('pushBranch', { name: ref.name }) },
    ]);
  } else if (ref.type === 'remoteBranch') {
    items = items.concat([
      { label: 'Checkout', action: () => send('checkout', ref.name) },
      { label: 'Delete Remote Branch…', action: () => send('deleteRemoteBranch', { name: ref.name }) },
    ]);
  } else if (ref.type === 'tag') {
    items = items.concat([
      { label: 'Checkout', action: () => send('checkout', ref.name) },
      { label: 'Delete Tag…', action: () => send('deleteTag', { name: ref.name }) },
      { label: 'Push Tag…', action: () => send('pushTag', { name: ref.name }) },
    ]);
  } else if (ref.type === 'stash') {
    items = items.concat([
      { label: 'Apply Stash', action: () => send('stashApply', { ref: ref.name }) },
      { label: 'Pop Stash', action: () => send('stashPop', { ref: ref.name }) },
      { label: 'Create Branch from Stash…', action: () => send('stashBranch', { ref: ref.name }) },
      { label: 'Drop Stash…', action: () => send('stashDrop', { ref: ref.name }) },
    ]);
  }
  placeMenu(buildMenu(items), x, y);
}

// ─── find widget ──────────────────────────────────────────────────────────────
function openFind() {
  const w = document.getElementById('find-widget');
  w.classList.add('visible');
  document.getElementById('find-input').focus();
  document.getElementById('find-input').select();
}
function closeFind() {
  document.getElementById('find-widget').classList.remove('visible');
  clearFindHighlights();
  findMatches = [];
  findIndex = -1;
}
function clearFindHighlights() {
  document.querySelectorAll('.find-match,.find-current').forEach((el) =>
    el.classList.remove('find-match', 'find-current'));
}
function runFind(term) {
  clearFindHighlights();
  findMatches = [];
  findIndex = -1;
  const q = term.trim().toLowerCase();
  document.getElementById('find-count').textContent = '';
  if (!q || !graphData) return;
  graphData.commits.forEach((c) => {
    if (c.kind === 'uncommitted') return;
    const hay = (c.message + ' ' + (c.author || '') + ' ' + c.sha + ' ' +
      (c.refs || []).map((r) => r.name).join(' ')).toLowerCase();
    if (hay.includes(q)) findMatches.push(c.sha);
  });
  findMatches.forEach((sha) => {
    const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(sha) + '"]');
    if (tr) tr.classList.add('find-match');
  });
  if (findMatches.length) { findIndex = 0; gotoMatch(); }
  updateFindCount();
}
function updateFindCount() {
  document.getElementById('find-count').textContent =
    findMatches.length ? (findIndex + 1) + ' / ' + findMatches.length : 'No results';
}
function gotoMatch() {
  if (findIndex < 0 || findIndex >= findMatches.length) return;
  document.querySelectorAll('.find-current').forEach((el) => el.classList.remove('find-current'));
  const sha = findMatches[findIndex];
  const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(sha) + '"]');
  if (tr) {
    tr.classList.add('find-current');
    tr.scrollIntoView({ block: 'center' });
  }
  updateFindCount();
}
function findNext(dir) {
  if (!findMatches.length) return;
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  gotoMatch();
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  if (CONFIG.dateFormat === 'iso') return d.toISOString().slice(0, 19).replace('T', ' ');
  if (CONFIG.dateFormat === 'standard') return d.toLocaleString();
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString();
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

// ─── column resizing ──────────────────────────────────────────────────────────
function wireResizers() {
  document.querySelectorAll('.col-resizer').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const key = handle.dataset.col;       // date | author | commit | desc
      const th = handle.closest('th');
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      const onMove = (ev) => {
        const w = Math.max(40, startW + (ev.clientX - startX));
        th.style.width = w + 'px';
        if (key !== 'desc') {
          colWidths[key] = w;
          document.querySelectorAll('td.col-' + key).forEach((td) => { td.style.width = w + 'px'; });
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        savePersisted();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// ─── message handling ─────────────────────────────────────────────────────────
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'config':
      CONFIG = Object.assign(CONFIG, msg.data || {});
      syncControlsFromConfig();
      if (graphData) { layoutRows = buildLayout(graphData.commits); renderTable(layoutRows); }
      break;
    case 'graphData':
      graphData = msg.data;
      document.getElementById('loading').style.display = 'none';
      populateBranchFilter();
      layoutRows = buildLayout(graphData.commits);
      renderTable(layoutRows);
      document.getElementById('commit-count').textContent =
        graphData.commits.filter((c) => c.kind !== 'uncommitted').length + ' commits';
      break;
    case 'files':
      renderFiles(msg.data.sha, msg.data.files);
      break;
  }
});

function populateBranchFilter() {
  const sel = document.getElementById('branch-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All branches</option>';
  (graphData.branches || []).forEach((b) => {
    const o = document.createElement('option');
    o.value = b.name;
    o.textContent = b.name;
    sel.appendChild(o);
  });
  sel.value = cur;
}

function syncControlsFromConfig() {
  document.getElementById('toggle-remote').checked = !!CONFIG.showRemoteBranches;
}

// ─── controls wiring ──────────────────────────────────────────────────────────
function wireControls() {
  document.getElementById('refresh-btn').addEventListener('click', () => {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('graph-body').innerHTML = '';
    vscode.postMessage({ type: 'refresh' });
  });
  document.getElementById('find-btn').addEventListener('click', openFind);
  document.getElementById('toggle-remote').addEventListener('change', (e) => {
    vscode.postMessage({ type: 'setShowRemoteBranches', data: e.target.checked });
  });
  document.getElementById('branch-filter').addEventListener('change', (e) => {
    vscode.postMessage({ type: 'setBranchFilter', data: e.target.value });
  });

  const findInput = document.getElementById('find-input');
  findInput.addEventListener('input', (e) => runFind(e.target.value));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { closeFind(); }
  });
  document.getElementById('find-prev').addEventListener('click', () => findNext(-1));
  document.getElementById('find-next').addEventListener('click', () => findNext(1));
  document.getElementById('find-close').addEventListener('click', closeFind);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); vscode.postMessage({ type: 'refresh' }); }
  });

  document.addEventListener('click', () => {
    document.getElementById('context-menu').classList.remove('visible');
  });

  wireResizers();
}

wireControls();
vscode.postMessage({ type: 'ready' });
