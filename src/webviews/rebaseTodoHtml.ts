/**
 * HTML for the interactive-rebase todo editor. The extension posts the parsed
 * commit list in; the user picks an action per row and reorders rows, then
 * Start sends the final ordered list back.
 */
export function rebaseTodoHtml(nonce: string, cspSource: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
  body { margin: 0; padding: 12px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  h2 { margin: 0 0 4px; font-size: 1.1em; }
  p.hint { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: var(--vscode-descriptionForeground); font-weight: normal; padding: 2px 6px; }
  td { padding: 3px 6px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
  tr.dropped td.subject, tr.dropped td.sha { text-decoration: line-through; opacity: 0.55; }
  select { font-family: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; border-radius: 2px; }
  td.sha { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-descriptionForeground); }
  td.subject { width: 100%; }
  .move { cursor: pointer; padding: 0 4px; user-select: none; color: var(--vscode-descriptionForeground);
    border: 0; background: transparent; }
  .move:hover { color: var(--vscode-foreground); }
  #actions { margin-top: 14px; display: flex; gap: 8px; }
  button { font-family: inherit; font-size: inherit; padding: 5px 14px; border: none; border-radius: 2px; cursor: pointer; }
  #start { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .legend { margin-top: 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  button:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  @media (forced-colors: active) { button, select, table { forced-color-adjust: auto; } }
</style>
</head>
<body>
  <div id="aria-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <h2>Interactive Rebase</h2>
  <p class="hint">Top row is applied first (oldest). Choose an action per commit and reorder with ↑ ↓.</p>
  <table>
    <thead><tr><th></th><th>Action</th><th>Commit</th><th>Subject</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="actions">
    <button id="start">Start Rebase</button>
    <button id="cancel">Cancel</button>
  </div>
  <div class="legend">
    pick = keep · reword = edit message · edit = stop to amend · squash = meld into previous (keep messages) ·
    fixup = meld into previous (discard message) · drop = remove
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ACTIONS = ["pick","reword","edit","squash","fixup","drop"];
let items = [];
const announce = (message) => {
  const status = document.getElementById('aria-status');
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = message; });
};

function render() {
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';
  items.forEach((it, i) => {
    const tr = document.createElement('tr');
    if (it.action === 'drop') tr.className = 'dropped';
    const opts = ACTIONS.map(a => '<option value="' + a + '"' + (a === it.action ? ' selected' : '') + '>' + a + '</option>').join('');
    tr.innerHTML =
      '<td><button type="button" class="move" data-up="' + i + '" aria-label="Move ' + esc(it.subject) + ' up">↑</button>' +
      '<button type="button" class="move" data-down="' + i + '" aria-label="Move ' + esc(it.subject) + ' down">↓</button></td>' +
      '<td><select data-i="' + i + '" aria-label="Action for ' + esc(it.subject) + '">' + opts + '</select></td>' +
      '<td class="sha">' + esc(it.sha) + '</td>' +
      '<td class="subject">' + esc(it.subject) + '</td>';
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('select').forEach(sel =>
    sel.addEventListener('change', () => { items[+sel.dataset.i].action = sel.value; render(); }));
  tbody.querySelectorAll('[data-up]').forEach(el =>
    el.addEventListener('click', () => move(+el.dataset.up, -1)));
  tbody.querySelectorAll('[data-down]').forEach(el =>
    el.addEventListener('click', () => move(+el.dataset.down, 1)));
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= items.length) return;
  const t = items[i]; items[i] = items[j]; items[j] = t;
  render();
  announce('Moved commit to position ' + (j + 1) + ' of ' + items.length + '.');
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

document.getElementById('start').addEventListener('click', () => vscode.postMessage({ type: 'start', items }));
document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

window.addEventListener('message', (e) => {
  if (e.data.type === 'init') {
    items = e.data.items; render();
    announce(items.length + ' commits loaded for interactive rebase.');
  }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
