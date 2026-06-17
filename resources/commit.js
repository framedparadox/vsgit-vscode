'use strict';

/*
 * Commit view webview client. Renders the active repo's Conflicted / Staged /
 * Changes groups with per-file and per-group actions, plus a commit message
 * editor and Commit button. All git work happens in the extension host; this
 * file only posts intent messages and renders the pushed state.
 */

const vscode = acquireVsCodeApi();

// Pure, DOM-free helpers shared with Node tests (resources/commitView.js,
// loaded as a global by the webview before this script).
const { statusLabel, statusCode, fileExt, escapeHtml, buildFileTree } =
  self.CommitView;

let state = { active: false };
let viewMode = (vscode.getState() || {}).commitViewMode || 'tree';
// Advanced commit options (Amend / Sign off / GPG) are hidden behind a
// disclosure by default; remember whether the user expanded them.
let advancedOpen = (vscode.getState() || {}).commitAdvancedOpen === true;

const el = (id) => document.getElementById(id);
const post = (type, data) => vscode.postMessage({ type, data });

// ─── render ────────────────────────────────────────────────────────────────
function render() {
  if (!state.active) {
    el('empty').style.display = 'block';
    el('root').style.display = 'none';
    return;
  }
  el('empty').style.display = 'none';
  el('root').style.display = 'block';
  el('branch-name').textContent = state.branch || '';
  syncViewButtons();
  syncAdvanced();

  const groups = el('groups');
  groups.innerHTML = '';
  if (state.conflicted && state.conflicted.length) {
    groups.appendChild(renderGroup('Conflicts', 'conflicted', state.conflicted));
  }
  groups.appendChild(renderGroup('Staged Changes', 'staged', state.staged || []));
  groups.appendChild(renderGroup('Changes', 'unstaged', state.unstaged || []));
}

function renderGroup(title, group, files) {
  const wrap = document.createElement('div');
  wrap.className = 'group';

  const header = document.createElement('div');
  header.className = 'group-header';
  const label = document.createElement('span');
  label.className = 'group-label';
  label.textContent = title;
  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = String(files.length);
  header.appendChild(label);

  // Group-level action: stage-all / unstage-all.
  if (group === 'unstaged' && files.length) {
    header.appendChild(groupAction('Stage All Changes', '+', () => post('stageAll')));
  } else if (group === 'staged' && files.length) {
    header.appendChild(groupAction('Unstage All Changes', '−', () => post('unstageAll')));
  }
  header.appendChild(count);
  wrap.appendChild(header);

  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'file-empty';
    empty.textContent = 'No changes';
    wrap.appendChild(empty);
    return wrap;
  }

  if (viewMode === 'tree') {
    wrap.appendChild(renderTree(group, files));
  } else {
    files.forEach((f) => wrap.appendChild(renderFile(f, group)));
  }
  return wrap;
}

function groupAction(title, glyph, action) {
  const b = document.createElement('button');
  b.className = 'group-action';
  b.title = title;
  b.textContent = glyph;
  b.addEventListener('click', (e) => { e.stopPropagation(); action(); });
  return b;
}

function renderTree(group, files) {
  const root = buildFileTree(files);
  const wrap = document.createElement('div');
  renderTreeLevel(wrap, root, group, 0);
  return wrap;
}

function renderTreeLevel(parent, node, group, depth) {
  Array.from(node.dirs.keys()).sort((a, b) => a.localeCompare(b)).forEach((name) => {
    const dir = node.dirs.get(name);
    const folder = document.createElement('div');
    folder.className = 'tree-folder';
    folder.style.paddingLeft = (12 + depth * 14) + 'px';
    folder.innerHTML =
      '<span class="chev expanded">▶</span>' +
      '<span class="folder-name">' + escapeHtml(name) + '</span>';

    const children = document.createElement('div');
    children.className = 'tree-children';
    renderTreeLevel(children, dir, group, depth + 1);

    folder.addEventListener('click', () => {
      const collapsed = children.classList.toggle('collapsed');
      folder.querySelector('.chev').classList.toggle('expanded', !collapsed);
    });
    parent.appendChild(folder);
    parent.appendChild(children);
  });

  node.files.sort((a, b) => a.name.localeCompare(b.name)).forEach(({ file, name }) => {
    parent.appendChild(renderFile(file, group, depth, name));
  });
}

function renderFile(f, group, depth = 0, label = f.name) {
  const row = document.createElement('div');
  row.className = 'file-row';
  row.title = f.path;
  if (viewMode === 'tree') row.style.paddingLeft = (26 + depth * 14) + 'px';

  const code = statusCode(f);

  // LEFT: file extension chip.
  const ext = document.createElement('span');
  ext.className = 'file-ext s-' + code;
  ext.textContent = fileExt(f.name);
  row.appendChild(ext);

  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = label;
  row.appendChild(name);

  if (viewMode !== 'tree' && f.dir) {
    const dir = document.createElement('span');
    dir.className = 'file-dir';
    dir.textContent = f.dir;
    row.appendChild(dir);
  }

  // RIGHT: full change label (Modified, Added, …).
  const change = document.createElement('span');
  change.className = 'file-change s-' + code;
  change.textContent = statusLabel(code);
  row.appendChild(change);

  const actions = document.createElement('span');
  actions.className = 'file-actions';
  if (group === 'unstaged' || group === 'conflicted') {
    actions.appendChild(fileAction('Reset Changes', '↺', (e) => {
      e.stopPropagation();
      post('discard', { path: f.path, group });
    }));
    actions.appendChild(fileAction('Stage Changes', '+', (e) => {
      e.stopPropagation();
      post('stage', { path: f.path, group });
    }));
  } else {
    actions.appendChild(fileAction('Unstage Changes', '−', (e) => {
      e.stopPropagation();
      post('unstage', { path: f.path, group });
    }));
  }
  row.appendChild(actions);

  row.addEventListener('click', () => post('openDiff', { path: f.path, group }));
  return row;
}

function setViewMode(mode) {
  if (viewMode === mode) return;
  viewMode = mode;
  vscode.setState({ ...(vscode.getState() || {}), commitViewMode: mode });
  render();
}

function syncViewButtons() {
  el('view-tree').classList.toggle('active', viewMode === 'tree');
  el('view-list').classList.toggle('active', viewMode === 'list');
}

function setAdvancedOpen(open) {
  advancedOpen = open;
  vscode.setState({ ...(vscode.getState() || {}), commitAdvancedOpen: open });
  syncAdvanced();
}

// Reflect the advanced-options disclosure state into the DOM: toggle button
// (chevron + aria-expanded) and the hidden state of the options bar.
function syncAdvanced() {
  const toggle = el('advanced-toggle');
  const bar = el('commit-bar');
  if (!toggle || !bar) return;
  toggle.classList.toggle('open', advancedOpen);
  toggle.setAttribute('aria-expanded', String(advancedOpen));
  bar.hidden = !advancedOpen;
  syncAdvancedBadge();
}

// Show a badge on the (possibly collapsed) "Advanced" toggle whenever amend,
// sign-off, or GPG is active, so a checked option is never silently hidden.
function syncAdvancedBadge() {
  const badge = el('advanced-badge');
  const toggle = el('advanced-toggle');
  if (!badge || !toggle) return;
  const active =
    el('opt-amend').checked || el('opt-signoff').checked || el('opt-gpg').checked;
  badge.hidden = !active;
  toggle.classList.toggle('has-active', active);
}

function fileAction(title, glyph, handler) {
  const b = document.createElement('button');
  b.className = 'file-action';
  b.title = title;
  b.textContent = glyph;
  b.addEventListener('click', handler);
  return b;
}

// ─── commit ──────────────────────────────────────────────────────────────────
function doCommit() {
  post('commit', {
    message: el('message').value,
    amend: el('opt-amend').checked,
    signoff: el('opt-signoff').checked,
    gpg: el('opt-gpg').checked,
  });
}

// Message that was in the box right before Amend was checked, restored if the
// user unchecks Amend without editing the auto-filled text.
let preAmendMessage = '';
// The previous-commit message we auto-filled in, or null if none/edited away.
let lastAmendMessage = null;

function onAmendToggled() {
  syncAdvancedBadge();
  const msg = el('message');
  if (el('opt-amend').checked) {
    preAmendMessage = msg.value;
    post('amendToggled', { amend: true });
  } else if (lastAmendMessage !== null && msg.value === lastAmendMessage) {
    msg.value = preAmendMessage;
    post('messageChanged', msg.value);
    lastAmendMessage = null;
  }
}

function wire() {
  const msg = el('message');
  msg.addEventListener('input', () => post('messageChanged', msg.value));
  msg.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Enter commits, matching VS Code's SCM input.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doCommit();
    }
  });
  el('commit-btn').addEventListener('click', doCommit);
  el('view-tree').addEventListener('click', () => setViewMode('tree'));
  el('view-list').addEventListener('click', () => setViewMode('list'));
  el('advanced-toggle').addEventListener('click', () => setAdvancedOpen(!advancedOpen));
  el('opt-amend').addEventListener('change', onAmendToggled);
  el('opt-signoff').addEventListener('change', syncAdvancedBadge);
  el('opt-gpg').addEventListener('change', syncAdvancedBadge);
}

// ─── messages ────────────────────────────────────────────────────────────────
window.addEventListener('message', (event) => {
  const m = event.data;
  if (m.type === 'state') {
    state = m.data;
    // Preserve the in-progress textarea value if the host echoes a stale one.
    const cur = el('message');
    if (state.active && typeof state.message === 'string' && document.activeElement !== cur) {
      cur.value = state.message;
    }
    render();
  } else if (m.type === 'amendMessage') {
    // Only fill in the previous commit's message if the user hasn't already
    // started typing one, so we never clobber an in-progress draft.
    const cur = el('message');
    if (!cur.value.trim()) {
      lastAmendMessage = (m.data && m.data.message) || '';
      cur.value = lastAmendMessage;
      post('messageChanged', cur.value);
    }
  } else if (m.type === 'committed') {
    el('message').value = '';
    el('opt-amend').checked = false;
    el('opt-signoff').checked = false;
    el('opt-gpg').checked = false;
    preAmendMessage = '';
    lastAmendMessage = null;
    syncAdvancedBadge();
  }
});

wire();
syncAdvanced();
post('ready');
