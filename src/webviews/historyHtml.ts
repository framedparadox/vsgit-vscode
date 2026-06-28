/**
 * Returns the HTML for the History webview — a linear commit log (git-log style),
 * intentionally distinct from the Git Graph DAG panel. Each commit is a two-line
 * list item (subject + ref pills on top, author · date · short SHA underneath);
 * selecting one shows its metadata, message body, and changed files in the right
 * pane. There is deliberately NO lane/graph rendering here so the History view
 * reads as a chronological log rather than a branch graph.
 *
 * All styling uses VS Code theme variables so it matches the active color theme.
 */
export function historyHtml(
  nonce: string,
  cspSource: string,
  codiconCssUri: string,
): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; font-src ${cspSource}; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${codiconCssUri}" />
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  #toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 6px; align-items: center; padding: 6px 8px;
    background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); }
  #toolbar input, #toolbar select, #toolbar button {
    font-family: inherit; font-size: inherit; color: var(--vscode-input-foreground);
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent);
    padding: 3px 6px; border-radius: 2px; }
  #toolbar label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; color: var(--vscode-foreground); }
  #toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; }
  #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  #search { flex: 1; min-width: 80px; }

  #scopeBanner { display: none; align-items: center; gap: 8px; padding: 5px 10px; font-size: 0.9em;
    background: var(--vscode-inputValidation-infoBackground, rgba(0,120,215,0.1));
    border-bottom: 1px solid var(--vscode-inputValidation-infoBorder, #06c); }
  #scopeBanner.on { display: flex; }
  #scopeBanner button { background: transparent; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; }
  #scopeText { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  #layout { display: flex; height: calc(100vh - 37px); }
  #layout.scoped { height: calc(100vh - 37px - 28px); }
  #list { flex: 1; overflow: auto; padding: 2px 0; }
  #details { width: 40%; min-width: 260px; overflow: auto; border-left: 1px solid var(--vscode-panel-border); padding: 10px 12px; }

  /* commit list item (two-line, git-log style) */
  .commit-item { display: flex; gap: 8px; padding: 5px 10px; cursor: pointer; border-left: 2px solid transparent; }
  .commit-item:hover { background: var(--vscode-list-hoverBackground); }
  .commit-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground);
    border-left-color: var(--vscode-focusBorder); }
  .commit-bullet { flex: 0 0 auto; width: 9px; height: 9px; margin-top: 4px; border-radius: 50%;
    background: var(--vscode-charts-blue, #3794ff); border: 1px solid rgba(0,0,0,0.25); }
  .commit-main { flex: 1; min-width: 0; }
  .commit-subject { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .commit-sub { font-size: 0.86em; color: var(--vscode-descriptionForeground); margin-top: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .commit-item.selected .commit-sub { color: var(--vscode-list-activeSelectionForeground); opacity: 0.85; }
  .commit-sub .dot { opacity: 0.6; margin: 0 5px; }
  .commit-sub .sha { font-family: var(--vscode-editor-font-family, monospace); }

  .ref { display: inline-block; padding: 0 5px; margin-right: 5px; border-radius: 3px; font-size: 0.82em;
    line-height: 16px; vertical-align: middle; }
  .ref.head { background: var(--vscode-gitDecoration-modifiedResourceForeground, #4a8); color: #000; font-weight: 600; }
  .ref.localBranch { background: var(--vscode-charts-green, #3a3); color: #000; }
  .ref.remoteBranch { background: var(--vscode-charts-blue, #36c); color: #fff; }
  .ref.tag { background: var(--vscode-charts-yellow, #cc3); color: #000; }

  #loadMore { display: block; width: calc(100% - 20px); margin: 8px 10px 14px; padding: 6px;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; cursor: pointer; font: inherit; }
  #loadMore:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }

  #details h3 { margin: 0 0 6px; font-size: 1.05em; }
  #details .meta { color: var(--vscode-descriptionForeground); margin-bottom: 10px; line-height: 1.5; word-break: break-all; }
  #details .meta b { color: var(--vscode-foreground); font-weight: 600; }
  #details .body { white-space: pre-wrap; margin-bottom: 12px; padding: 8px; border-radius: 3px;
    background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border, #555); }
  #details .files-head { display: flex; align-items: center; gap: 8px; font-size: 0.85em;
    color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  #details .files-view-toggle { margin-left: auto; display: inline-flex; gap: 2px; }
  .fv-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
    border-radius: 4px; cursor: pointer; color: var(--vscode-icon-foreground, var(--vscode-foreground)); }
  .fv-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
  .fv-btn.active { background: var(--vscode-inputOption-activeBackground, rgba(128,128,128,0.25)); }
  .fv-btn .codicon { font-size: 16px; line-height: 16px; color: currentColor; opacity: 0.85; }

  #files { padding-left: 0; margin: 0; }
  .file-row { cursor: pointer; padding: 2px 4px; border-radius: 3px; display: flex; gap: 6px; align-items: center;
    white-space: nowrap; overflow: hidden; }
  .file-row:hover { background: var(--vscode-list-hoverBackground); }
  .file-row .st { flex: 0 0 auto; width: 14px; text-align: center; font-weight: 700; font-family: var(--vscode-editor-font-family, monospace); }
  .file-row .fp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-row.A .st { color: var(--vscode-gitDecoration-addedResourceForeground); }
  .file-row.D .st { color: var(--vscode-gitDecoration-deletedResourceForeground); }
  .file-row.M .st { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
  .file-row.R .st { color: var(--vscode-gitDecoration-renamedResourceForeground, #6cf); }

  .tree-folder { display: flex; align-items: center; gap: 4px; padding: 2px 4px; border-radius: 3px; cursor: pointer; user-select: none; white-space: nowrap; }
  .tree-folder:hover { background: var(--vscode-list-hoverBackground); }
  .tree-folder .chev { display: inline-flex; align-items: center; width: 16px; height: 16px; flex: 0 0 auto; transition: transform 0.1s ease; }
  .tree-folder .chev.expanded { transform: rotate(90deg); }
  .tree-folder .chev .codicon { font-size: 16px; line-height: 16px; color: var(--vscode-icon-foreground, var(--vscode-foreground)); opacity: 0.8; }
  .tree-folder .fname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-children.collapsed { display: none; }
  .empty { padding: 16px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div id="toolbar">
    <input id="search" type="text" placeholder="Filter commits…" />
    <select id="searchBy"><option value="message">Message</option><option value="author">Author</option></select>
    <label><input id="allBranches" type="checkbox" checked /> All branches</label>
    <button id="btnCompare" title="Compare Branches…">⇄ Compare</button>
    <button id="btnFilter" title="Filter by Branch…">⎇ Branch</button>
    <button id="refresh" title="Refresh">↺</button>
  </div>
  <div id="scopeBanner"><span id="scopeText"></span><button id="clearCompare">Clear</button></div>
  <div id="layout">
    <div id="list"><div class="empty">Loading…</div></div>
    <div id="details"><div class="empty">Select a commit to see its details.</div></div>
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let commits = [], selected = null, hasMore = false, compareMode = null, filePath = null;
// Changed-file pane view: 'tree' (folder hierarchy) or 'list' (flat) — same
// toggle the Git Graph commit-details pane offers. Persisted across reloads.
let fileViewMode = (vscode.getState() || {}).historyFileViewMode || 'tree';
let detailsData = null; // { commit, files } — cached so the toggle re-renders.

const ICON_TREE = '<i class="codicon codicon-list-tree"></i>';
const ICON_LIST = '<i class="codicon codicon-list-flat"></i>';
const ICON_CHEVRON = '<i class="codicon codicon-chevron-right"></i>';

function render() {
  const list = document.getElementById('list');
  const prevScroll = list.scrollTop;
  if (commits.length === 0) { list.innerHTML = '<div class="empty">No commits found.</div>'; return; }

  const frag = document.createDocumentFragment();
  commits.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'commit-item' + (c.sha === selected ? ' selected' : '');
    item.dataset.sha = c.sha;
    const refs = (c.refs || []).map((rf) => '<span class="ref ' + esc(rf.kind) + '">' + esc(rf.name) + '</span>').join('');
    item.innerHTML =
      '<div class="commit-bullet"></div>' +
      '<div class="commit-main">' +
        '<div class="commit-subject">' + refs + esc(c.subject) + '</div>' +
        '<div class="commit-sub">' + esc(c.authorName) +
          '<span class="dot">·</span>' + fmtDate(c.authorDate) +
          '<span class="dot">·</span><span class="sha">' + esc(c.shortSha) + '</span>' +
        '</div>' +
      '</div>';
    item.addEventListener('click', () => select(c.sha));
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); select(c.sha); vscode.postMessage({ type: 'context', sha: c.sha }); });
    frag.appendChild(item);
  });
  list.innerHTML = '';
  list.appendChild(frag);
  if (hasMore) {
    const more = document.createElement('button');
    more.id = 'loadMore';
    more.textContent = 'Load more commits';
    more.addEventListener('click', () => vscode.postMessage({ type: 'loadMore' }));
    list.appendChild(more);
  }
  list.scrollTop = prevScroll;
}

function select(sha) {
  selected = sha;
  document.querySelectorAll('.commit-item').forEach((el) => el.classList.toggle('selected', el.dataset.sha === sha));
  vscode.postMessage({ type: 'select', sha });
}

function renderDetails(c, files) {
  const d = document.getElementById('details');
  if (!c) { detailsData = null; d.innerHTML = '<div class="empty">Select a commit to see its details.</div>'; return; }
  files = files || [];
  detailsData = { commit: c, files };
  d.innerHTML =
    '<h3>' + esc(c.subject) + '</h3>' +
    '<div class="meta">' +
      '<b>Commit:</b> ' + esc(c.sha) + '<br>' +
      '<b>Author:</b> ' + esc(c.authorName) + ' &lt;' + esc(c.authorEmail) + '&gt;<br>' +
      '<b>Date:</b> ' + fmtDate(c.authorDate) +
    '</div>' +
    (c.body ? '<div class="body">' + esc(c.body) + '</div>' : '') +
    '<div class="files-head">' +
      '<span>' + files.length + ' changed file' + (files.length === 1 ? '' : 's') + '</span>' +
      '<span class="files-view-toggle">' +
        '<span id="fvTree" class="fv-btn" title="Tree View">' + ICON_TREE + '</span>' +
        '<span id="fvList" class="fv-btn" title="List View">' + ICON_LIST + '</span>' +
      '</span>' +
    '</div>' +
    '<div id="files"></div>';
  syncFileViewButtons();
  document.getElementById('fvTree').addEventListener('click', () => setFileViewMode('tree'));
  document.getElementById('fvList').addEventListener('click', () => setFileViewMode('list'));
  renderFilePane(c.sha, files);
}

function renderFilePane(sha, files) {
  const host = document.getElementById('files');
  if (!host) return;
  host.innerHTML = '';
  if (!files.length) { host.innerHTML = '<div class="empty">No files</div>'; return; }
  host.appendChild(fileViewMode === 'tree' ? buildFileTree(sha, files) : buildFileList(sha, files));
}

function setFileViewMode(mode) {
  if (fileViewMode === mode) return;
  fileViewMode = mode;
  vscode.setState({ ...(vscode.getState() || {}), historyFileViewMode: mode });
  syncFileViewButtons();
  if (detailsData) renderFilePane(detailsData.commit.sha, detailsData.files);
}
function syncFileViewButtons() {
  const tree = document.getElementById('fvTree'), list = document.getElementById('fvList');
  if (tree) tree.classList.toggle('active', fileViewMode === 'tree');
  if (list) list.classList.toggle('active', fileViewMode === 'list');
}

function makeFileRow(sha, f, label) {
  const row = document.createElement('div');
  const code = String(f.status || 'M').charAt(0).toUpperCase();
  row.className = 'file-row ' + code;
  row.title = f.path;
  row.innerHTML = '<span class="st">' + esc(code) + '</span><span class="fp">' + esc(label) + '</span>';
  row.addEventListener('click', () => vscode.postMessage({ type: 'openFile', sha, path: f.path }));
  return row;
}

function buildFileList(sha, files) {
  const wrap = document.createElement('div');
  files.slice().sort((a, b) => a.path.localeCompare(b.path)).forEach((f) => wrap.appendChild(makeFileRow(sha, f, f.path)));
  return wrap;
}

function buildFileTree(sha, files) {
  const root = { dirs: new Map(), files: [] };
  files.forEach((f) => {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push({ file: f, name: parts[parts.length - 1] });
  });
  const wrap = document.createElement('div');
  renderTreeLevel(sha, root, wrap, 0);
  return wrap;
}

function renderTreeLevel(sha, node, parent, depth) {
  Array.from(node.dirs.keys()).sort((a, b) => a.localeCompare(b)).forEach((name) => {
    const dir = node.dirs.get(name);
    const folder = document.createElement('div');
    folder.className = 'tree-folder';
    folder.style.paddingLeft = (4 + depth * 14) + 'px';
    folder.innerHTML = '<span class="chev expanded">' + ICON_CHEVRON + '</span><span class="fname">' + esc(name) + '</span>';
    const children = document.createElement('div');
    children.className = 'tree-children';
    renderTreeLevel(sha, dir, children, depth + 1);
    folder.addEventListener('click', () => {
      const collapsed = children.classList.toggle('collapsed');
      folder.querySelector('.chev').classList.toggle('expanded', !collapsed);
    });
    parent.appendChild(folder);
    parent.appendChild(children);
  });
  node.files.sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => {
    const row = makeFileRow(sha, entry.file, entry.name);
    row.style.paddingLeft = (4 + depth * 14 + 16) + 'px';
    parent.appendChild(row);
  });
}

function applyCompareBanner() {
  const banner = document.getElementById('scopeBanner');
  const layout = document.getElementById('layout');
  if (compareMode) {
    document.getElementById('scopeText').textContent =
      'Comparing ' + compareMode.ref1 + ' … ' + compareMode.ref2;
    document.getElementById('clearCompare').style.display = '';
    banner.classList.add('on');
    layout.classList.add('scoped');
  } else if (filePath) {
    document.getElementById('scopeText').textContent = 'File history: ' + filePath;
    document.getElementById('clearCompare').style.display = 'none';
    banner.classList.add('on');
    layout.classList.add('scoped');
  } else {
    document.getElementById('clearCompare').style.display = 'none';
    banner.classList.remove('on');
    layout.classList.remove('scoped');
  }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
function fmtDate(unix) {
  if (!unix) return '';
  const dt = new Date(unix * 1000);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + dt.toTimeString().slice(0, 5);
}

function requestLog() {
  vscode.postMessage({ type: 'query',
    search: document.getElementById('search').value,
    searchBy: document.getElementById('searchBy').value,
    branch: document.getElementById('allBranches').checked ? 'all' : 'HEAD' });
}

let t;
document.getElementById('search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(requestLog, 250); });
document.getElementById('searchBy').addEventListener('change', requestLog);
document.getElementById('allBranches').addEventListener('change', requestLog);
document.getElementById('refresh').addEventListener('click', requestLog);
document.getElementById('btnCompare').addEventListener('click', () => vscode.postMessage({ type: 'compareBranches' }));
document.getElementById('btnFilter').addEventListener('click', () => vscode.postMessage({ type: 'filterByBranch' }));
document.getElementById('clearCompare').addEventListener('click', () => vscode.postMessage({ type: 'clearCompare' }));

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'commits') {
    commits = m.commits || [];
    hasMore = !!m.hasMore;
    compareMode = m.compareMode || null;
    filePath = m.filePath || null;
    applyCompareBanner();
    render();
  } else if (m.type === 'details') {
    renderDetails(m.commit, m.files);
  }
});
requestLog();
</script>
</body>
</html>`;
}
