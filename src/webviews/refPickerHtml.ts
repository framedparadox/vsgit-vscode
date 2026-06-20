/**
 * HTML for the "Compare / Replace with a Branch, Tag, or Reference" picker.
 * Replicates the Eclipse VsGit ref-picker dialog:
 *   - Title + subtitle showing the file name and action
 *   - Filter text input with clear button
 *   - Collapsible tree: Local | Remote Tracking | Tags | References
 *   - Each leaf: icon · name · shortSha · subject (dimmed)
 *   - Keyboard navigation, double-click or Enter to confirm
 */
export function refPickerHtml(nonce: string, _cspSource: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
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
    padding: 14px 16px 10px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
  }
  #header h2 {
    margin: 0 0 3px;
    font-size: 1.05em; font-weight: 700;
  }
  #header p {
    margin: 0;
    font-size: 0.88em;
    color: var(--vscode-descriptionForeground);
  }

  /* ── Search ── */
  #searchRow {
    padding: 8px 12px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
  }
  #filterWrap {
    display: flex; align-items: center;
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, #555));
    border-radius: 2px;
    background: var(--vscode-input-background);
    padding: 2px 6px;
  }
  #filterWrap:focus-within {
    border-color: var(--vscode-focusBorder);
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  #filter {
    flex: 1; border: none; outline: none; background: transparent;
    color: var(--vscode-input-foreground);
    font-family: inherit; font-size: inherit;
    padding: 3px 4px;
  }
  #filter::placeholder { color: var(--vscode-input-placeholderForeground); }
  #clearBtn {
    display: none; background: none; border: none; padding: 0 2px;
    color: var(--vscode-input-foreground); cursor: pointer; opacity: 0.6; font-size: 1em;
    line-height: 1;
  }
  #clearBtn:hover { opacity: 1; }

  /* ── Tree ── */
  #treeWrap {
    flex: 1; overflow: auto;
  }
  .group {
    user-select: none;
  }
  .group-header {
    display: flex; align-items: center; gap: 5px;
    padding: 4px 8px;
    cursor: pointer;
    font-weight: 600; font-size: 0.9em;
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border);
    position: sticky; top: 0; z-index: 1;
  }
  .group-header:hover { background: var(--vscode-list-hoverBackground); }
  .chevron { font-size: 0.75em; transition: transform 0.1s; display: inline-block; width: 12px; }
  .chevron.open { transform: rotate(90deg); }
  .group-icon { font-size: 1em; }
  .group-name { flex: 1; }

  .group-children { }
  .group-children.collapsed { display: none; }

  /* ── Leaf rows ── */
  .leaf {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px 3px 28px;
    cursor: pointer;
    font-size: 0.9em;
    border-bottom: 1px solid transparent;
  }
  .leaf:hover { background: var(--vscode-list-hoverBackground); }
  .leaf.selected {
    background: var(--vscode-list-activeSelectionBackground) !important;
    color: var(--vscode-list-activeSelectionForeground) !important;
  }
  .leaf.selected .sha,
  .leaf.selected .subject { color: var(--vscode-list-activeSelectionForeground) !important; }
  .leaf-icon { flex-shrink: 0; font-size: 1em; width: 18px; text-align: center; }
  .leaf-name { flex-shrink: 0; font-weight: 500; white-space: nowrap; }
  .sha {
    flex-shrink: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    color: var(--vscode-charts-orange, #e5a84b);
  }
  .subject {
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--vscode-descriptionForeground);
    font-size: 0.88em;
  }

  /* ── HEAD indicator ── */
  .head-badge {
    font-size: 0.75em; padding: 0 4px;
    background: var(--vscode-charts-green, #2ea043); color: #fff;
    border-radius: 3px; flex-shrink: 0;
  }

  /* ── Footer ── */
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
  #btnOk:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  #btnOk:disabled { opacity: 0.4; cursor: default; }
  #btnCancel {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  #btnCancel:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }

  .empty { padding: 20px; color: var(--vscode-descriptionForeground); text-align: center; }
  .hidden { display: none; }
</style>
</head>
<body>
  <div id="header">
    <h2 id="headTitle">Select a Branch, Tag, or Reference</h2>
    <p id="headSub">Select a branch, tag, or reference to compare the resource with</p>
  </div>

  <div id="searchRow">
    <div id="filterWrap">
      <input id="filter" type="text" placeholder="type filter text" autocomplete="off" spellcheck="false"/>
      <button id="clearBtn" title="Clear filter">✕</button>
    </div>
  </div>

  <div id="treeWrap">
    <div id="tree"></div>
    <div id="empty" class="empty hidden">No refs match your filter.</div>
  </div>

  <div id="footer">
    <button id="btnCancel">Cancel</button>
    <button id="btnOk" disabled>OK</button>
  </div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let groups = [];          // [{ id, label, icon, items: [{ref, shortSha, subject, isHead, icon}] }]
let selectedRef = null;   // the currently selected ref string
let collapsedGroups = {}; // group id -> bool

// ── Receive data ───────────────────────────────────────────────────────────
window.addEventListener('message', ({ data }) => {
  if (data.command !== 'load') return;
  groups = data.groups;
  if (data.title)    document.getElementById('headTitle').textContent = data.title;
  if (data.subtitle) document.getElementById('headSub').textContent  = data.subtitle;
  // Collapse Remote Tracking by default (matches VsGit behaviour)
  groups.forEach(g => {
    collapsedGroups[g.id] = g.collapsedByDefault === true;
  });
  render('');
  document.getElementById('filter').focus();
});

// ── Filter ─────────────────────────────────────────────────────────────────
document.getElementById('filter').addEventListener('input', e => {
  const q = e.target.value;
  document.getElementById('clearBtn').style.display = q ? '' : 'none';
  render(q);
});
document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('filter').value = '';
  document.getElementById('clearBtn').style.display = 'none';
  render('');
  document.getElementById('filter').focus();
});

// ── Render ─────────────────────────────────────────────────────────────────
function render(q) {
  const lq = q.toLowerCase();
  const tree = document.getElementById('tree');
  const empty = document.getElementById('empty');
  tree.innerHTML = '';

  let totalVisible = 0;

  groups.forEach(g => {
    const items = lq
      ? g.items.filter(it =>
          it.ref.toLowerCase().includes(lq) ||
          (it.subject || '').toLowerCase().includes(lq) ||
          (it.shortSha || '').toLowerCase().includes(lq)
        )
      : g.items;

    if (items.length === 0) return;
    totalVisible += items.length;

    const groupEl = document.createElement('div');
    groupEl.className = 'group';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'group-header';
    const collapsed = !lq && collapsedGroups[g.id];
    hdr.innerHTML =
      \`<span class="chevron \${collapsed ? '' : 'open'}">&#9658;</span>\` +
      \`<span class="group-icon">\${g.icon}</span>\` +
      \`<span class="group-name">\${esc(g.label)}</span>\`;
    hdr.addEventListener('click', () => toggleGroup(g.id, childrenEl, hdr.querySelector('.chevron')));
    groupEl.appendChild(hdr);

    // Children
    const childrenEl = document.createElement('div');
    childrenEl.className = 'group-children' + (collapsed ? ' collapsed' : '');

    items.forEach(it => {
      const leaf = document.createElement('div');
      leaf.className = 'leaf' + (it.ref === selectedRef ? ' selected' : '');
      leaf.dataset.ref = it.ref;

      let html = \`<span class="leaf-icon">\${it.icon || '📄'}</span>\`;
      html += \`<span class="leaf-name">\${esc(it.ref)}</span>\`;
      if (it.isHead) html += \`<span class="head-badge">HEAD</span>\`;
      if (it.shortSha) html += \`<span class="sha">\${esc(it.shortSha)}</span>\`;
      if (it.subject)  html += \`<span class="subject">\${esc(it.subject)}</span>\`;
      leaf.innerHTML = html;

      leaf.addEventListener('click', () => selectLeaf(it.ref));
      leaf.addEventListener('dblclick', () => { selectLeaf(it.ref); confirm(); });
      childrenEl.appendChild(leaf);
    });

    groupEl.appendChild(childrenEl);
    tree.appendChild(groupEl);
  });

  empty.style.display = totalVisible === 0 ? '' : 'none';
  syncOkButton();
}

function toggleGroup(id, childrenEl, chevron) {
  const isOpen = !childrenEl.classList.contains('collapsed');
  collapsedGroups[id] = isOpen;
  childrenEl.classList.toggle('collapsed', isOpen);
  chevron.classList.toggle('open', !isOpen);
}

// ── Selection ──────────────────────────────────────────────────────────────
function selectLeaf(ref) {
  selectedRef = ref;
  document.querySelectorAll('.leaf').forEach(el => {
    el.classList.toggle('selected', el.dataset.ref === ref);
  });
  syncOkButton();
}

function syncOkButton() {
  document.getElementById('btnOk').disabled = !selectedRef;
}

function confirm() {
  if (!selectedRef) return;
  vscode.postMessage({ command: 'pick', ref: selectedRef });
}

// ── Keyboard ───────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { confirm(); return; }
  if (e.key === 'Escape') { vscode.postMessage({ command: 'cancel' }); return; }

  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();

  const leaves = Array.from(document.querySelectorAll('.leaf'));
  if (leaves.length === 0) return;
  const cur = leaves.findIndex(l => l.classList.contains('selected'));
  const next = e.key === 'ArrowDown'
    ? (cur < leaves.length - 1 ? cur + 1 : cur)
    : (cur > 0 ? cur - 1 : 0);
  const target = leaves[next];
  if (target) {
    selectLeaf(target.dataset.ref);
    target.scrollIntoView({ block: 'nearest' });
  }
});

document.getElementById('btnOk').addEventListener('click', confirm);
document.getElementById('btnCancel').addEventListener('click', () => {
  vscode.postMessage({ command: 'cancel' });
});

// ── Utilities ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;
}
