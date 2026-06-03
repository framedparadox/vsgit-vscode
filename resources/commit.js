'use strict';

/*
 * Commit view webview client. Renders the active repo's Conflicted / Staged /
 * Changes groups with per-file and per-group actions, plus a commit message
 * editor and Commit button. All git work happens in the extension host; this
 * file only posts intent messages and renders the pushed state.
 */

const vscode = acquireVsCodeApi();

let state = { active: false };

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

  files.forEach((f) => wrap.appendChild(renderFile(f, group)));
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

function renderFile(f, group) {
  const row = document.createElement('div');
  row.className = 'file-row';
  row.title = f.path;

  const code = f.conflicted ? 'C' : (f.state || 'modified').charAt(0).toUpperCase();
  const badge = document.createElement('span');
  badge.className = 'file-status s-' + code;
  badge.textContent = code;
  row.appendChild(badge);

  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = f.name;
  row.appendChild(name);

  if (f.dir) {
    const dir = document.createElement('span');
    dir.className = 'file-dir';
    dir.textContent = f.dir;
    row.appendChild(dir);
  }

  const actions = document.createElement('span');
  actions.className = 'file-actions';
  if (group === 'unstaged' || group === 'conflicted') {
    actions.appendChild(fileAction('Discard Changes', '↶', (e) => {
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
  } else if (m.type === 'committed') {
    el('message').value = '';
    el('opt-amend').checked = false;
    el('opt-signoff').checked = false;
    el('opt-gpg').checked = false;
  }
});

wire();
post('ready');
