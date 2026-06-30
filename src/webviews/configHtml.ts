/**
 * HTML for the Git config editor. The extension posts the entries (with scope);
 * the user can edit values, add, and delete keys. Edits are sent back as
 * messages the extension translates into `git config` calls.
 * Also supports Remotes and Extension Settings tabs.
 */
export function configHtml(nonce: string, cspSource: string): string {
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
  button:focus-visible, input:focus-visible, select:focus-visible {
    outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  h2 { margin: 0 0 8px; font-size: 1.1em; }
  .scope { margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 4px; }
  .scope button { font-family: inherit; padding: 4px 10px; border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 2px; cursor: pointer; }
  .scope button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: var(--vscode-descriptionForeground); font-weight: normal; padding: 4px 6px; }
  td { padding: 3px 6px; border-bottom: 1px solid var(--vscode-panel-border); }
  td.key { font-family: var(--vscode-editor-font-family, monospace); width: 40%; }
  input[type=text], input:not([type]) { width: 100%; box-sizing: border-box; font-family: inherit; color: var(--vscode-input-foreground);
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 5px; border-radius: 2px; }
  input[type=checkbox] { cursor: pointer; }
  input[type=number] { box-sizing: border-box; font-family: inherit; color: var(--vscode-input-foreground);
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 5px; border-radius: 2px; width: 80px; }
  select { font-family: inherit; color: var(--vscode-input-foreground);
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 5px; border-radius: 2px; }
  .del { cursor: pointer; color: var(--vscode-descriptionForeground); border: 0; background: transparent; }
  .del:hover { color: var(--vscode-errorForeground); }
  #add { margin-top: 12px; display: flex; gap: 6px; }
  #add input { flex: 1; }
  #add button, button.action-btn { font-family: inherit; padding: 4px 12px; border: none; border-radius: 2px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.action-btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-panel-border); }
  .hint { color: var(--vscode-descriptionForeground); margin: 8px 0; font-size: 0.9em; }
  .section-title { font-weight: bold; margin: 12px 0 6px; color: var(--vscode-descriptionForeground); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; }
  .setting-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); gap: 12px; }
  .setting-label { flex: 1; }
  .setting-label strong { display: block; }
  .setting-label small { color: var(--vscode-descriptionForeground); }
  .remote-actions { display: flex; gap: 6px; }
  #remotes-add-form { margin-top: 12px; display: flex; gap: 6px; }
  #remotes-add-form input { flex: 1; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .dim-cell { color: var(--vscode-descriptionForeground); }
  @media (forced-colors: active) {
    button, input, select, table { forced-color-adjust: auto; }
  }
</style>
</head>
<body>
  <div id="aria-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <h2>Git Config</h2>
  <div class="scope" role="tablist" aria-label="Configuration scope">
    <button type="button" role="tab" aria-selected="true" data-scope="local" class="active">Local (repo)</button>
    <button type="button" role="tab" aria-selected="false" data-scope="global">Global (user)</button>
    <button type="button" role="tab" aria-selected="false" data-scope="system">System</button>
    <button type="button" role="tab" aria-selected="false" data-scope="remotes">Remotes</button>
    <button type="button" role="tab" aria-selected="false" data-scope="extension">Extension Settings</button>
  </div>

  <!-- Git config tabs (local/global/system) -->
  <div id="tab-gitconfig" class="tab-content active">
    <p class="hint" id="hint">System scope is read-only.</p>
    <table>
      <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div id="add">
      <input id="newKey" placeholder="section.key" aria-label="Configuration key" />
      <input id="newVal" placeholder="value" aria-label="Configuration value" />
      <button id="addBtn">Add</button>
    </div>
  </div>

  <!-- Remotes tab -->
  <div id="tab-remotes" class="tab-content">
    <table>
      <thead><tr><th>Name</th><th>Fetch URL</th><th>Push URL</th><th></th></tr></thead>
      <tbody id="remotes-rows"></tbody>
    </table>
    <div id="remotes-add-form">
      <input id="remoteName" placeholder="Remote name (e.g. origin)" aria-label="Remote name" />
      <input id="remoteUrl" placeholder="URL" aria-label="Remote URL" />
      <button id="remoteAddBtn" class="action-btn">Add Remote</button>
    </div>
  </div>

  <!-- Extension Settings tab -->
  <div id="tab-extension" class="tab-content">
    <div class="section-title">Refresh</div>
    <div class="setting-row">
      <div class="setting-label"><strong>Auto Refresh</strong><small>Refresh views when repository state changes outside VS Code</small></div>
      <input type="checkbox" id="ext-autoRefresh" aria-label="Auto Refresh" />
    </div>
    <div class="section-title">Auto Fetch</div>
    <div class="setting-row">
      <div class="setting-label"><strong>Enable Auto Fetch</strong><small>Automatically fetch remotes in the background</small></div>
      <input type="checkbox" id="ext-autoFetch.enabled" aria-label="Enable Auto Fetch" />
    </div>
    <div class="setting-row">
      <div class="setting-label"><strong>Fetch Interval (minutes)</strong><small>How often to auto-fetch</small></div>
      <input type="number" id="ext-autoFetch.intervalMinutes" min="1" max="60" aria-label="Fetch Interval in minutes" />
    </div>
    <div class="setting-row">
      <div class="setting-label"><strong>Incoming Commit Notifications</strong><small>Notify when auto-fetch finds new commits</small></div>
      <input type="checkbox" id="ext-autoFetch.notify" aria-label="Incoming Commit Notifications" />
    </div>
    <div class="section-title">Safety</div>
    <div class="setting-row">
      <div class="setting-label"><strong>Confirm Destructive Actions</strong><small>Show confirmation for hard reset, force push, etc.</small></div>
      <input type="checkbox" id="ext-confirmDestructiveActions" aria-label="Confirm Destructive Actions" />
    </div>
    <div class="section-title">Pull</div>
    <div class="setting-row">
      <div class="setting-label"><strong>Default Pull Mode</strong><small>Strategy used when pulling</small></div>
      <select id="ext-defaultPullMode" aria-label="Default Pull Mode">
        <option value="merge">Merge</option>
        <option value="rebase">Rebase</option>
      </select>
    </div>
  </div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let scope = 'local';
let entries = [];
let remotes = [];
const announce = (message) => {
  const status = document.getElementById('aria-status');
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = message; });
};

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function isGitScope(s) { return s === 'local' || s === 'global' || s === 'system'; }
function editable() { return scope !== 'system'; }

function showTab(s) {
  document.querySelectorAll('.scope button').forEach(b => {
    const active = b.dataset.scope === s;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  document.getElementById('tab-gitconfig').classList.toggle('active', isGitScope(s));
  document.getElementById('tab-remotes').classList.toggle('active', s === 'remotes');
  document.getElementById('tab-extension').classList.toggle('active', s === 'extension');
}

function render() {
  showTab(scope);
  if (!isGitScope(scope)) return;
  document.getElementById('hint').style.display = editable() ? 'none' : 'block';
  document.getElementById('add').style.display = editable() ? 'flex' : 'none';
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';
  entries.forEach((e, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="key">' + esc(e.key) + '</td>' +
      '<td>' + (editable()
        ? '<input data-i="' + i + '" value="' + esc(e.value) + '" />'
        : esc(e.value)) + '</td>' +
      '<td>' + (editable() ? '<button type="button" class="del" data-del="' + i + '" aria-label="Delete ' + esc(e.key) + '">✕</button>' : '') + '</td>';
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input[data-i]').forEach(inp =>
    inp.addEventListener('change', () =>
      vscode.postMessage({ type: 'set', scope, key: entries[+inp.dataset.i].key, value: inp.value })));
  tbody.querySelectorAll('[data-del]').forEach(el =>
    el.addEventListener('click', () =>
      vscode.postMessage({ type: 'unset', scope, key: entries[+el.dataset.del].key })));
}

function renderRemotes() {
  const tbody = document.getElementById('remotes-rows');
  tbody.innerHTML = '';
  if (remotes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="dim-cell">(no remotes configured)</td></tr>';
    return;
  }
  remotes.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="key">' + esc(r.name) + '</td>' +
      '<td>' + esc(r.fetchUrl || '') + '</td>' +
      '<td>' + esc(r.pushUrl || '') + '</td>' +
      '<td><button type="button" class="del" data-remove="' + esc(r.name) + '" aria-label="Remove remote ' + esc(r.name) + '">✕</button></td>';
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-remove]').forEach(el =>
    el.addEventListener('click', () =>
      vscode.postMessage({ type: 'removeRemote', name: el.dataset.remove })));
}

function renderExtensionSettings(settings) {
  if (settings['autoRefresh'] !== undefined) {
    document.getElementById('ext-autoRefresh').checked = !!settings['autoRefresh'];
  }
  if (settings['autoFetch.enabled'] !== undefined) {
    document.getElementById('ext-autoFetch.enabled').checked = !!settings['autoFetch.enabled'];
  }
  if (settings['autoFetch.intervalMinutes'] !== undefined) {
    document.getElementById('ext-autoFetch.intervalMinutes').value = String(settings['autoFetch.intervalMinutes']);
  }
  if (settings['autoFetch.notify'] !== undefined) {
    document.getElementById('ext-autoFetch.notify').checked = !!settings['autoFetch.notify'];
  }
  if (settings['confirmDestructiveActions'] !== undefined) {
    document.getElementById('ext-confirmDestructiveActions').checked = !!settings['confirmDestructiveActions'];
  }
  if (settings['defaultPullMode'] !== undefined) {
    document.getElementById('ext-defaultPullMode').value = String(settings['defaultPullMode'] || 'merge');
  }
}

// Scope tab click
document.querySelectorAll('.scope button').forEach(b =>
  b.addEventListener('click', () => {
    scope = b.dataset.scope;
    if (isGitScope(scope)) {
      vscode.postMessage({ type: 'load', scope });
    } else if (scope === 'remotes') {
      showTab(scope);
      vscode.postMessage({ type: 'loadRemotes' });
    } else if (scope === 'extension') {
      showTab(scope);
      vscode.postMessage({ type: 'loadExtensionSettings' });
    }
  }));

// Git config add
document.getElementById('addBtn').addEventListener('click', () => {
  const key = document.getElementById('newKey').value.trim();
  const value = document.getElementById('newVal').value;
  if (key) {
    vscode.postMessage({ type: 'set', scope, key, value });
    document.getElementById('newKey').value = '';
    document.getElementById('newVal').value = '';
  }
});

// Remotes add
document.getElementById('remoteAddBtn').addEventListener('click', () => {
  const name = document.getElementById('remoteName').value.trim();
  const url = document.getElementById('remoteUrl').value.trim();
  if (name && url) {
    vscode.postMessage({ type: 'addRemote', name, url });
    document.getElementById('remoteName').value = '';
    document.getElementById('remoteUrl').value = '';
  }
});

// Extension settings change handlers
['ext-autoRefresh', 'ext-autoFetch.enabled', 'ext-autoFetch.notify', 'ext-confirmDestructiveActions'].forEach(id => {
  document.getElementById(id).addEventListener('change', (e) => {
    const key = id.replace('ext-', '');
    vscode.postMessage({ type: 'setExtensionSetting', key, value: e.target.checked });
  });
});
document.getElementById('ext-autoFetch.intervalMinutes').addEventListener('change', (e) => {
  vscode.postMessage({ type: 'setExtensionSetting', key: 'autoFetch.intervalMinutes', value: +e.target.value });
});
document.getElementById('ext-defaultPullMode').addEventListener('change', (e) => {
  vscode.postMessage({ type: 'setExtensionSetting', key: 'defaultPullMode', value: e.target.value });
});

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'entries') {
    scope = msg.scope; entries = msg.entries; render();
    announce(entries.length + ' configuration entr' + (entries.length === 1 ? 'y' : 'ies') + ' loaded for ' + scope + ' scope.');
  }
  else if (msg.type === 'remotes') {
    remotes = msg.remotes || []; renderRemotes();
    announce(remotes.length + ' remote' + (remotes.length === 1 ? '' : 's') + ' loaded.');
  }
  else if (msg.type === 'extensionSettings') {
    renderExtensionSettings(msg.settings || {});
    announce('Extension settings loaded.');
  }
});

vscode.postMessage({ type: 'load', scope });
</script>
</body>
</html>`;
}
