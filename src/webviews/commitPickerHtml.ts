/**
 * HTML for the "Select a Commit" picker webview.
 * Replicates the Eclipse VsGit commit-picker dialog:
 *   - Header: count + repo name, subtitle
 *   - Search bar with a magnifier icon
 *   - Resizable table: graph | Id | Message | Author | Authored Date | Committer | Committed Date
 *   - Commit graph drawn on canvas (straight lines only — sufficient for a picker)
 *   - Keyboard navigation (↑/↓/Enter), double-click to confirm
 *   - Posts { command:"pick", sha } back to the extension on confirm
 */
export function commitPickerHtml(nonce: string, _cspSource: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  }

  /* ── Header ── */
  #header {
    padding: 12px 16px 6px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }
  #header h2 {
    margin: 0 0 2px;
    font-size: 1em; font-weight: 600;
    color: var(--vscode-foreground);
  }
  #header p {
    margin: 0 0 8px;
    font-size: 0.88em;
    color: var(--vscode-descriptionForeground);
  }

  /* ── Search ── */
  #searchWrap {
    display: flex; align-items: center; gap: 0;
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, #555));
    border-radius: 2px;
    background: var(--vscode-input-background);
    padding: 0 4px;
  }
  #searchWrap svg { flex-shrink: 0; opacity: 0.6; }
  #search {
    flex: 1; border: none; outline: none; background: transparent;
    color: var(--vscode-input-foreground);
    font-family: inherit; font-size: inherit;
    padding: 4px 6px;
  }
  #search::placeholder { color: var(--vscode-input-placeholderForeground); }

  /* ── Table container ── */
  #tableWrap {
    flex: 1; overflow: auto;
    border-top: 1px solid var(--vscode-panel-border);
  }

  /* ── Column header ── */
  thead th {
    position: sticky; top: 0; z-index: 2;
    background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 4px 8px;
    text-align: left; font-weight: 600; white-space: nowrap;
    font-size: 0.9em;
    user-select: none; cursor: pointer;
  }
  thead th:hover { background: var(--vscode-list-hoverBackground); }
  thead th.sorted-asc::after  { content: " ▲"; font-size: 0.75em; }
  thead th.sorted-desc::after { content: " ▼"; font-size: 0.75em; }

  table {
    width: 100%; border-collapse: collapse; table-layout: fixed;
  }

  /* Column widths */
  col.c-graph   { width: 72px; }
  col.c-sha     { width: 82px; }
  col.c-msg     { width: auto; }
  col.c-author  { width: 120px; }
  col.c-adate   { width: 110px; }
  col.c-cname   { width: 120px; }
  col.c-cdate   { width: 110px; }

  /* ── Rows ── */
  tr.commit { cursor: pointer; }
  tr.commit:hover td { background: var(--vscode-list-hoverBackground); }
  tr.commit.selected td {
    background: var(--vscode-list-activeSelectionBackground) !important;
    color: var(--vscode-list-activeSelectionForeground) !important;
  }
  tr.commit.selected td.sha,
  tr.commit.selected td.dim { color: var(--vscode-list-activeSelectionForeground) !important; }

  td {
    padding: 2px 8px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    vertical-align: middle;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    font-size: 0.9em;
  }
  td.c-graph { padding: 0; overflow: visible; }
  td.sha { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-descriptionForeground); }
  td.dim { color: var(--vscode-descriptionForeground); }
  td.msg { width: 100%; }

  /* ── Ref badges ── */
  .ref {
    display: inline-block; padding: 0 5px; margin-right: 3px;
    border-radius: 3px; font-size: 0.78em; font-weight: 600;
    vertical-align: middle; line-height: 1.5;
  }
  .ref.head         { background: #2ea043; color: #fff; }
  .ref.localBranch  { background: #1f6feb; color: #fff; }
  .ref.remoteBranch { background: #6e40c9; color: #fff; }
  .ref.tag          { background: #9e6a03; color: #fff; }

  /* ── Footer buttons ── */
  #footer {
    display: flex; align-items: center; justify-content: flex-end;
    gap: 8px; padding: 8px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }
  button {
    font-family: inherit; font-size: inherit;
    padding: 4px 14px; border-radius: 2px; cursor: pointer;
    border: 1px solid var(--vscode-button-border, transparent);
  }
  #btnOk {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  #btnOk:hover { background: var(--vscode-button-hoverBackground); }
  #btnOk:disabled { opacity: 0.4; cursor: default; }
  #btnCancel {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  #btnCancel:hover { background: var(--vscode-button-secondaryHoverBackground); }

  .empty { padding: 20px; color: var(--vscode-descriptionForeground); text-align: center; }
</style>
</head>
<body>
  <div id="header">
    <h2 id="headTitle">Select a Commit</h2>
    <p id="headSub">Please select a commit from the list</p>
    <div id="searchWrap">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.868-3.834zm-5.242 1.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>
      </svg>
      <input id="search" type="text" placeholder="Find" autocomplete="off" spellcheck="false" />
    </div>
  </div>

  <div id="tableWrap">
    <table>
      <colgroup>
        <col class="c-graph"/>
        <col class="c-sha"/>
        <col class="c-msg"/>
        <col class="c-author"/>
        <col class="c-adate"/>
        <col class="c-cname"/>
        <col class="c-cdate"/>
      </colgroup>
      <thead>
        <tr>
          <th data-col="graph"  title="Commit graph"></th>
          <th data-col="sha"    title="Commit Id">Id</th>
          <th data-col="msg"    title="Commit message">Message</th>
          <th data-col="author" title="Author name">Author</th>
          <th data-col="adate"  title="Author date">Authored Date</th>
          <th data-col="cname"  title="Committer name">Committer</th>
          <th data-col="cdate"  title="Committer date">Committed Date</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
    <div id="empty" class="empty" style="display:none">No commits match your search.</div>
  </div>

  <div id="footer">
    <button id="btnCancel">Cancel</button>
    <button id="btnOk" disabled>OK</button>
  </div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let allCommits   = [];   // full list from extension
let filtered     = [];   // after search filter
let selectedIdx  = -1;   // index into filtered[]
let sortCol      = null; // null = natural order
let sortDir      = 1;    // 1=asc -1=desc

// ── Graph lane colours ─────────────────────────────────────────────────────
const LANE_COLORS = [
  '#4fc1ff','#f9c859','#a8cc8c','#e88388','#b5b4ff','#f2a272','#78dce8','#ab9df2'
];
const LANE_W  = 12;  // px per lane
const ROW_H   = 22;  // must match td line-height
const DOT_R   = 4;

// ── Receive data from extension ────────────────────────────────────────────
window.addEventListener('message', ({ data }) => {
  if (data.command === 'load') {
    allCommits = data.commits;
    document.getElementById('headTitle').textContent =
      data.repoName
        ? \`\${allCommits.length} commits in repository \${data.repoName}\`
        : \`\${allCommits.length} commits\`;
    applyFilter();
  }
});

// ── Search ─────────────────────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', (e) => {
  applyFilter(e.target.value);
});

function applyFilter(q = '') {
  const lq = q.toLowerCase();
  filtered = lq
    ? allCommits.filter(c =>
        c.subject.toLowerCase().includes(lq) ||
        c.shortSha.toLowerCase().includes(lq) ||
        c.authorName.toLowerCase().includes(lq) ||
        c.committerName.toLowerCase().includes(lq)
      )
    : allCommits.slice();

  if (sortCol) applySortInPlace();

  selectedIdx = -1;
  render();
}

// ── Sort ───────────────────────────────────────────────────────────────────
document.querySelectorAll('thead th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (col === 'graph') return;
    if (sortCol === col) { sortDir = -sortDir; }
    else { sortCol = col; sortDir = 1; }
    document.querySelectorAll('thead th').forEach(t => t.classList.remove('sorted-asc','sorted-desc'));
    th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
    applySortInPlace();
    selectedIdx = -1;
    render();
  });
});

function applySortInPlace() {
  filtered.sort((a, b) => {
    let va, vb;
    switch (sortCol) {
      case 'sha':    va = a.shortSha;       vb = b.shortSha;       break;
      case 'msg':    va = a.subject;        vb = b.subject;        break;
      case 'author': va = a.authorName;     vb = b.authorName;     break;
      case 'adate':  va = a.authorDate;     vb = b.authorDate;     break;
      case 'cname':  va = a.committerName;  vb = b.committerName;  break;
      case 'cdate':  va = a.committerDate;  vb = b.committerDate;  break;
      default:       return 0;
    }
    if (va < vb) return -sortDir;
    if (va > vb) return  sortDir;
    return 0;
  });
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('empty');
  empty.style.display = filtered.length === 0 ? '' : 'none';

  // Build graph lane assignments once per render
  const lanes = buildLanes(filtered);

  tbody.innerHTML = '';
  filtered.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.className = 'commit' + (i === selectedIdx ? ' selected' : '');
    tr.dataset.idx = i;

    // Graph cell — canvas
    const canvasTd = document.createElement('td');
    canvasTd.className = 'c-graph';
    const { canvas, laneCount } = buildGraphCell(c, i, lanes, filtered);
    canvasTd.style.width = (laneCount * LANE_W + 4) + 'px';
    canvasTd.appendChild(canvas);
    tr.appendChild(canvasTd);

    // SHA
    tr.appendChild(cell(c.shortSha, 'sha'));

    // Message with ref badges
    const msgTd = document.createElement('td');
    msgTd.className = 'msg';
    let msgHtml = '';
    for (const ref of (c.refs || [])) {
      msgHtml += \`<span class="ref \${ref.kind}">\${esc(ref.name)}</span>\`;
    }
    msgHtml += esc(c.subject);
    msgTd.innerHTML = msgHtml;
    tr.appendChild(msgTd);

    tr.appendChild(cell(c.authorName, 'dim'));
    tr.appendChild(cell(relDate(c.authorDate), 'dim'));
    tr.appendChild(cell(c.committerName, 'dim'));
    tr.appendChild(cell(relDate(c.committerDate), 'dim'));

    tr.addEventListener('click',    () => select(i));
    tr.addEventListener('dblclick', () => { select(i); confirm(); });

    tbody.appendChild(tr);
  });

  syncOkButton();

  // Scroll selected row into view
  if (selectedIdx >= 0) {
    const row = tbody.querySelector('tr.selected');
    row?.scrollIntoView({ block: 'nearest' });
  }
}

// ── Lane / graph helpers ───────────────────────────────────────────────────
function buildLanes(commits) {
  // Map sha -> lane index; track which lanes are free
  const shaToLane = new Map();
  const freeSlots = [];
  let maxLane = 0;

  // For each commit assign lanes bottom-up (natural log order = newest first)
  commits.forEach((c, i) => {
    let lane = shaToLane.get(c.sha);
    if (lane === undefined) {
      lane = freeSlots.length ? freeSlots.shift() : maxLane++;
    }
    shaToLane.set(c.sha, lane);

    // Assign lanes to parents
    c.parents.forEach((p, pi) => {
      if (!shaToLane.has(p)) {
        if (pi === 0) {
          shaToLane.set(p, lane); // first parent continues same lane
        } else {
          const newLane = freeSlots.length ? freeSlots.shift() : maxLane++;
          shaToLane.set(p, newLane);
        }
      }
    });
  });

  return { shaToLane, maxLane: Math.max(maxLane, 1) };
}

function buildGraphCell(c, rowIdx, { shaToLane, maxLane }, commits) {
  const laneCount = maxLane;
  const w = laneCount * LANE_W + 4;
  const h = ROW_H;
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 1.5;

  const myLane = shaToLane.get(c.sha) ?? 0;
  const cx = myLane * LANE_W + LANE_W / 2 + 2;
  const cy = h / 2;

  // Draw lines from this commit to its parents
  c.parents.forEach((p) => {
    const pLane = shaToLane.get(p) ?? myLane;
    const px = pLane * LANE_W + LANE_W / 2 + 2;
    ctx.beginPath();
    ctx.strokeStyle = LANE_COLORS[pLane % LANE_COLORS.length];
    ctx.moveTo(cx, cy);
    // Bezier curve when changing lanes
    if (pLane !== myLane) {
      ctx.bezierCurveTo(cx, cy + h * 0.6, px, cy + h * 0.4, px, h);
    } else {
      ctx.lineTo(px, h);
    }
    ctx.stroke();
  });

  // Draw incoming lines from children (commits above that point here)
  for (let r = 0; r < rowIdx; r++) {
    const prev = commits[r];
    if (prev.parents.includes(c.sha)) {
      const pLane = shaToLane.get(prev.sha) ?? 0;
      const px = pLane * LANE_W + LANE_W / 2 + 2;
      ctx.beginPath();
      ctx.strokeStyle = LANE_COLORS[myLane % LANE_COLORS.length];
      ctx.moveTo(px, 0);
      if (pLane !== myLane) {
        ctx.bezierCurveTo(px, h * 0.4, cx, h * 0.6, cx, cy);
      } else {
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      break; // only immediate child
    }
  }

  // Draw commit dot
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = LANE_COLORS[myLane % LANE_COLORS.length];
  ctx.fill();
  ctx.strokeStyle = 'var(--vscode-editor-background)';
  ctx.lineWidth = 1;
  ctx.stroke();

  return { canvas, laneCount };
}

// ── Selection & keyboard ───────────────────────────────────────────────────
function select(idx) {
  selectedIdx = idx;
  document.querySelectorAll('tr.commit').forEach((r, i) => {
    r.classList.toggle('selected', i === idx);
  });
  syncOkButton();
}

function syncOkButton() {
  document.getElementById('btnOk').disabled = selectedIdx < 0;
}

function confirm() {
  if (selectedIdx < 0) return;
  const c = filtered[selectedIdx];
  vscode.postMessage({ command: 'pick', sha: c.sha });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIdx < filtered.length - 1) { select(selectedIdx + 1); scrollSelected(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIdx > 0) { select(selectedIdx - 1); scrollSelected(); }
  } else if (e.key === 'Enter') {
    confirm();
  } else if (e.key === 'Escape') {
    vscode.postMessage({ command: 'cancel' });
  }
});

function scrollSelected() {
  const row = document.querySelector('tr.commit.selected');
  row?.scrollIntoView({ block: 'nearest' });
}

document.getElementById('btnOk').addEventListener('click', confirm);
document.getElementById('btnCancel').addEventListener('click', () => {
  vscode.postMessage({ command: 'cancel' });
});

// ── Utilities ──────────────────────────────────────────────────────────────
function cell(text, cls) {
  const td = document.createElement('td');
  td.className = cls || '';
  td.textContent = text;
  td.title = text;
  return td;
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function relDate(unix) {
  if (!unix) return '';
  const diff = Math.floor((Date.now() / 1000) - unix);
  if (diff < 60)          return 'just now';
  if (diff < 3600)        return Math.floor(diff / 60)    + ' minutes ago';
  if (diff < 86400)       return Math.floor(diff / 3600)  + ' hours ago';
  if (diff < 86400 * 30)  return Math.floor(diff / 86400) + ' days ago';
  if (diff < 86400 * 365) return Math.floor(diff / (86400 * 30)) + ' months ago';
  return Math.floor(diff / (86400 * 365)) + ' years ago';
}

// Focus search on open
document.getElementById('search').focus();
</script>
</body>
</html>`;
}
