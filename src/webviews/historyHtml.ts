/**
 * Returns the HTML for the History webview. The commit graph is drawn by a single
 * overlay SVG spanning every row in one coordinate space — the same robust model
 * the Git Graph panel uses — sourced from the shared, unit-tested layout module
 * (resources/graphLayout.js). The previous per-row <canvas> approach drew each
 * lane in half-row segments, so pass-through branch lines broke apart between
 * rows; the overlay SVG cannot fall out of alignment because every dot and edge
 * is positioned from the same row-index → pixel mapping.
 *
 * All styling uses VS Code theme variables so it matches the active color theme.
 *
 * @param layoutUri webview URI of resources/graphLayout.js (loaded before the
 *   inline script so `GraphLayout` is available).
 */
export function historyHtml(nonce: string, cspSource: string, layoutUri: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  #toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 6px; padding: 6px 8px;
    background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); }
  #toolbar input, #toolbar select, #toolbar button {
    font-family: inherit; font-size: inherit; color: var(--vscode-input-foreground);
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent);
    padding: 3px 6px; border-radius: 2px; }
  #toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
  #search { flex: 1; }
  #layout { display: flex; height: calc(100vh - 36px); }
  #list { flex: 1; overflow: auto; }
  #details { width: 40%; min-width: 240px; overflow: auto; border-left: 1px solid var(--vscode-panel-border); padding: 8px; }
  table { width: 100%; border-collapse: collapse; }
  /* Rows are locked to ROW_H (24px) so the single overlay SVG's per-row
     coordinates line up exactly with the table rows. No vertical padding on
     commit cells or the dot/line centres would drift. */
  tr.commit { cursor: pointer; height: 24px; }
  tr.commit td { height: 24px; max-height: 24px; padding: 0 8px; line-height: 24px; overflow: hidden; }
  tr.commit:hover { background: var(--vscode-list-hoverBackground); }
  tr.commit.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  td { white-space: nowrap; text-overflow: ellipsis; }
  /* The graph cell holds the overlay SVG (in the first row) and must not clip it. */
  td.graph { padding: 0; position: relative; overflow: visible; white-space: nowrap; }
  svg.graph-svg { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
  td.subject { width: 100%; max-width: 0; }
  td.author, td.date, td.sha { color: var(--vscode-descriptionForeground); }
  td.sha { font-family: var(--vscode-editor-font-family, monospace); }
  .ref { display: inline-block; padding: 0 5px; margin-right: 4px; border-radius: 3px; font-size: 0.85em; line-height: 16px; vertical-align: middle; }
  .ref.head { background: var(--vscode-gitDecoration-modifiedResourceForeground, #4a8); color: #000; }
  .ref.localBranch { background: var(--vscode-charts-green, #3a3); color: #000; }
  .ref.remoteBranch { background: var(--vscode-charts-blue, #36c); color: #fff; }
  .ref.tag { background: var(--vscode-charts-yellow, #cc3); color: #000; }
  #details h3 { margin: 0 0 4px; font-size: 1.05em; }
  #details .meta { color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  #details .body { white-space: pre-wrap; margin-bottom: 10px; padding: 6px; background: var(--vscode-textBlockQuote-background); }
  #files li { cursor: pointer; list-style: none; padding: 1px 0; }
  #files li:hover { text-decoration: underline; }
  #files .A { color: var(--vscode-gitDecoration-addedResourceForeground); }
  #files .D { color: var(--vscode-gitDecoration-deletedResourceForeground); }
  #files .M { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
  #files .R { color: var(--vscode-gitDecoration-renamedResourceForeground, #6cf); }
  ul { padding-left: 0; }
  .empty { padding: 16px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div id="toolbar">
    <input id="search" type="text" placeholder="Filter commits (message)…" />
    <select id="searchBy"><option value="message">Message</option><option value="author">Author</option></select>
    <label><input id="allBranches" type="checkbox" checked /> All branches</label>
    <button id="btnCompare" title="Compare Branches…">⇄ Compare</button>
    <button id="btnFilter" title="Filter by Branch…">⎇ Branch</button>
    <button id="refresh">↺ Refresh</button>
  </div>
  <div id="layout">
    <div id="list"><div class="empty">Loading…</div></div>
    <div id="details"><div class="empty">Select a commit</div></div>
  </div>
<script nonce="${nonce}" src="${layoutUri}"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const SVGNS = 'http://www.w3.org/2000/svg';
// Pixel tunables — ROW_H MUST match the CSS row height (24px) or the overlay SVG
// will drift out of alignment with the table rows.
const ROW_H = 24, COL_W = 14, PAD = 8, DOT_R = 4;
const colors = ["#e06c75","#61afef","#98c379","#e5c07b","#c678dd","#56b6c2","#d19a66"];
let commits = [], selected = null;

function laneColor(idx) { return colors[idx % colors.length]; }

function render() {
  const list = document.getElementById('list');
  if (commits.length === 0) { list.innerHTML = '<div class="empty">No commits.</div>'; return; }

  // One shared, unit-tested layout pass over the whole DAG.
  const rows = GraphLayout.buildLayout(commits);
  const maxCols = rows.length ? rows[0].maxCols : 1;
  const graphW = maxCols * COL_W + PAD * 2;

  const table = document.createElement('table');
  rows.forEach((r, idx) => {
    const c = r.commit;
    const tr = document.createElement('tr');
    tr.className = 'commit'; tr.dataset.sha = c.sha;
    if (c.sha === selected) tr.classList.add('selected');
    const refs = (c.refs || []).map(rf => '<span class="ref ' + esc(rf.kind) + '">' + esc(rf.name) + '</span>').join('');
    tr.innerHTML =
      '<td class="graph"></td>' +
      '<td class="subject">' + refs + esc(c.subject) + '</td>' +
      '<td class="author">' + esc(c.authorName) + '</td>' +
      '<td class="date">' + fmtDate(c.authorDate) + '</td>' +
      '<td class="sha">' + esc(c.shortSha) + '</td>';
    const graphCell = tr.firstChild;
    graphCell.style.width = graphW + 'px';
    // The overlay SVG lives in the first row's graph cell and spans every row.
    if (idx === 0) graphCell.appendChild(buildGraphSvg(rows, graphW));
    tr.addEventListener('click', () => select(c.sha));
    tr.addEventListener('contextmenu', (e) => { e.preventDefault(); select(c.sha); vscode.postMessage({ type: 'context', sha: c.sha }); });
    table.appendChild(tr);
  });
  list.innerHTML = ''; list.appendChild(table);
}

// Build the single overlay SVG: coloured edges first, commit dots on top.
function buildGraphSvg(rows, graphW) {
  const geom = GraphLayout.defaultGeom({ ROW_H: ROW_H, COL_W: COL_W, PAD: PAD, R: DOT_R, style: 'rounded' });
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'graph-svg');
  svg.setAttribute('width', String(graphW));
  svg.setAttribute('height', String(rows.length * ROW_H));

  GraphLayout.computeEdges(rows, geom).forEach((e) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', e.d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', laneColor(e.colorIdx));
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
  });
  GraphLayout.computeNodes(rows, geom).forEach((n) => {
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', String(n.cx));
    dot.setAttribute('cy', String(n.cy));
    dot.setAttribute('r', String(DOT_R));
    dot.setAttribute('fill', laneColor(n.colorIdx));
    dot.setAttribute('stroke', 'rgba(0,0,0,0.35)');
    dot.setAttribute('stroke-width', '1');
    svg.appendChild(dot);
  });
  return svg;
}

function select(sha) {
  selected = sha;
  document.querySelectorAll('tr.commit').forEach(tr => tr.classList.toggle('selected', tr.dataset.sha === sha));
  vscode.postMessage({ type: 'select', sha });
}

function renderDetails(c, files) {
  const d = document.getElementById('details');
  if (!c) { d.innerHTML = '<div class="empty">Select a commit</div>'; return; }
  const fileItems = files.map(f =>
    '<li class="' + esc(f.status) + '" data-path="' + esc(f.path) + '" data-sha="' + esc(c.sha) + '">' +
    esc(f.status) + '  ' + esc(f.path) + '</li>').join('');
  d.innerHTML =
    '<h3>' + esc(c.subject) + '</h3>' +
    '<div class="meta">' + esc(c.shortSha) + ' · ' + esc(c.authorName) + ' &lt;' + esc(c.authorEmail) + '&gt; · ' + fmtDate(c.authorDate) + '</div>' +
    (c.body ? '<div class="body">' + esc(c.body) + '</div>' : '') +
    '<ul id="files">' + (fileItems || '<li class="empty">No files</li>') + '</ul>';
  d.querySelectorAll('#files li[data-path]').forEach(li =>
    li.addEventListener('click', () => vscode.postMessage({ type: 'openFile', sha: li.dataset.sha, path: li.dataset.path })));
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function fmtDate(unix) { const dt = new Date(unix*1000); return dt.toISOString().slice(0,10) + ' ' + dt.toTimeString().slice(0,5); }

function requestLog() {
  vscode.postMessage({ type: 'query', search: document.getElementById('search').value,
    searchBy: document.getElementById('searchBy').value, all: document.getElementById('allBranches').checked });
}
let t; document.getElementById('search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(requestLog, 250); });
document.getElementById('searchBy').addEventListener('change', requestLog);
document.getElementById('allBranches').addEventListener('change', requestLog);
document.getElementById('refresh').addEventListener('click', requestLog);
document.getElementById('btnCompare').addEventListener('click', () => vscode.postMessage({ type: 'compareBranches' }));
document.getElementById('btnFilter').addEventListener('click', () => vscode.postMessage({ type: 'filterByBranch' }));

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'commits') { commits = m.commits; render(); }
  else if (m.type === 'details') { renderDetails(m.commit, m.files); }
});
requestLog();
</script>
</body>
</html>`;
}
