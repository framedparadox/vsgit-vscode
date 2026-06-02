/**
 * Returns the HTML for the History webview. The graph is drawn on a <canvas>
 * lane-by-lane from the commit/parents data the extension posts in. All styling
 * uses VS Code theme variables so it matches the active color theme.
 */
export function historyHtml(nonce: string, cspSource: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  #toolbar { position: sticky; top: 0; display: flex; gap: 6px; padding: 6px 8px;
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
  tr.commit { cursor: pointer; }
  tr.commit:hover { background: var(--vscode-list-hoverBackground); }
  tr.commit.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  td { padding: 2px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  td.graph { padding: 0; width: 0; }
  td.subject { width: 100%; max-width: 0; }
  td.author, td.date, td.sha { color: var(--vscode-descriptionForeground); }
  .ref { display: inline-block; padding: 0 5px; margin-right: 4px; border-radius: 3px; font-size: 0.85em; }
  .ref.head { background: var(--vscode-gitDecoration-modifiedResourceForeground, #4a8); color: #000; }
  .ref.localBranch { background: var(--vscode-charts-green, #3a3); color: #000; }
  .ref.remoteBranch { background: var(--vscode-charts-blue, #36c); color: #fff; }
  .ref.tag { background: var(--vscode-charts-yellow, #cc3); color: #000; }
  canvas { display: block; }
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
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ROW_H = 22, LANE_W = 14, DOT_R = 4;
const colors = ["#e06c75","#61afef","#98c379","#e5c07b","#c678dd","#56b6c2","#d19a66"];
let commits = [], selected = null;

function laneAssign(list) {
  // Simple lane layout: track active branches by expected next sha.
  const lanes = []; // array of sha each lane is currently waiting for
  const rows = [];
  for (const c of list) {
    let lane = lanes.indexOf(c.sha);
    if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) { lane = lanes.length; } lanes[lane] = c.sha; }
    const parentLanes = [];
    // First parent stays in this lane; others get new lanes.
    if (c.parents.length === 0) { lanes[lane] = null; }
    else {
      lanes[lane] = c.parents[0];
      parentLanes.push(lane);
      for (let i = 1; i < c.parents.length; i++) {
        let pl = lanes.indexOf(c.parents[i]);
        if (pl === -1) { pl = lanes.indexOf(null); if (pl === -1) pl = lanes.length; lanes[pl] = c.parents[i]; }
        parentLanes.push(pl);
      }
    }
    rows.push({ commit: c, lane, parentLanes, activeLanes: lanes.slice() });
  }
  return rows;
}

function render() {
  const list = document.getElementById('list');
  if (commits.length === 0) { list.innerHTML = '<div class="empty">No commits.</div>'; return; }
  const rows = laneAssign(commits);
  const maxLane = Math.max(1, ...rows.map(r => Math.max(r.lane, ...r.parentLanes, r.activeLanes.length))) ;
  const gw = (maxLane + 1) * LANE_W;

  const table = document.createElement('table');
  rows.forEach((r, idx) => {
    const c = r.commit;
    const tr = document.createElement('tr');
    tr.className = 'commit'; tr.dataset.sha = c.sha;
    if (c.sha === selected) tr.classList.add('selected');
    const refs = c.refs.map(rf => '<span class="ref ' + rf.kind + '">' + esc(rf.name) + '</span>').join('');
    tr.innerHTML =
      '<td class="graph"><canvas width="' + gw + '" height="' + ROW_H + '" data-row="' + idx + '"></canvas></td>' +
      '<td class="subject">' + refs + esc(c.subject) + '</td>' +
      '<td class="author">' + esc(c.authorName) + '</td>' +
      '<td class="date">' + fmtDate(c.authorDate) + '</td>' +
      '<td class="sha">' + esc(c.shortSha) + '</td>';
    tr.addEventListener('click', () => select(c.sha));
    tr.addEventListener('contextmenu', (e) => { e.preventDefault(); select(c.sha); vscode.postMessage({ type: 'context', sha: c.sha }); });
    table.appendChild(tr);
  });
  list.innerHTML = ''; list.appendChild(table);
  // Draw graph segments per row.
  rows.forEach((r, idx) => drawRow(table, rows, idx));
}

function drawRow(table, rows, idx) {
  const canvas = table.querySelector('canvas[data-row="' + idx + '"]');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const r = rows[idx];
  const x = (lane) => lane * LANE_W + LANE_W / 2;
  // Vertical pass-through lines for lanes active in next row.
  const next = rows[idx + 1];
  if (next) {
    next.activeLanes.forEach((sha, lane) => {
      if (sha == null) return;
      ctx.strokeStyle = colors[lane % colors.length]; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x(lane), ROW_H/2); ctx.lineTo(x(lane), ROW_H); ctx.stroke();
    });
  }
  // Incoming line from top to this dot.
  ctx.strokeStyle = colors[r.lane % colors.length]; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x(r.lane), 0); ctx.lineTo(x(r.lane), ROW_H/2); ctx.stroke();
  // Connections to parents (drawn into the next rows' lanes).
  r.parentLanes.forEach((pl) => {
    ctx.strokeStyle = colors[pl % colors.length];
    ctx.beginPath(); ctx.moveTo(x(r.lane), ROW_H/2); ctx.lineTo(x(pl), ROW_H); ctx.stroke();
  });
  // The commit dot.
  ctx.fillStyle = colors[r.lane % colors.length];
  ctx.beginPath(); ctx.arc(x(r.lane), ROW_H/2, DOT_R, 0, Math.PI*2); ctx.fill();
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
    '<li class="' + f.status + '" data-path="' + esc(f.path) + '" data-sha="' + c.sha + '">' +
    f.status + '  ' + esc(f.path) + '</li>').join('');
  d.innerHTML =
    '<h3>' + esc(c.subject) + '</h3>' +
    '<div class="meta">' + esc(c.shortSha) + ' · ' + esc(c.authorName) + ' &lt;' + esc(c.authorEmail) + '&gt; · ' + fmtDate(c.authorDate) + '</div>' +
    (c.body ? '<div class="body">' + esc(c.body) + '</div>' : '') +
    '<ul id="files">' + (fileItems || '<li class="empty">No files</li>') + '</ul>';
  d.querySelectorAll('#files li[data-path]').forEach(li =>
    li.addEventListener('click', () => vscode.postMessage({ type: 'openFile', sha: li.dataset.sha, path: li.dataset.path })));
}

function esc(s) { return String(s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
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
