/**
 * Minimal text editor webview, used for commit-message editing during reword /
 * edit steps of an interactive rebase. The extension posts the initial text in;
 * Save sends the edited text back.
 */
export function editTextHtml(nonce: string, cspSource: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
  body { margin: 0; padding: 12px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: calc(100vh - 24px); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  h2 { margin: 0 0 8px; font-size: 1.05em; }
  textarea { flex: 1; width: 100%; box-sizing: border-box; resize: none;
    font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 13px);
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 8px; border-radius: 2px; }
  #actions { margin-top: 10px; display: flex; gap: 8px; }
  button { font-family: inherit; font-size: inherit; padding: 5px 14px; border: none; border-radius: 2px; cursor: pointer; }
  #save { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  @media (forced-colors: active) { button, textarea { forced-color-adjust: auto; } }
</style>
</head>
<body>
  <div id="aria-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <h2 id="title">Commit Message</h2>
  <p id="keyboard-help" class="sr-only">Press Control or Command Enter to save and continue. Press Escape to abort.</p>
  <textarea id="text" spellcheck="false" aria-labelledby="title" aria-describedby="keyboard-help"></textarea>
  <div id="actions">
    <button id="save">Save &amp; Continue</button>
    <button id="cancel">Abort</button>
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ta = document.getElementById('text');
const save = () => vscode.postMessage({ type: 'save', text: ta.value });
const cancel = () => vscode.postMessage({ type: 'cancel' });
document.getElementById('save').addEventListener('click', save);
document.getElementById('cancel').addEventListener('click', cancel);
ta.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault(); save();
  } else if (event.key === 'Escape') {
    event.preventDefault(); cancel();
  }
});
window.addEventListener('message', (e) => {
  if (e.data.type === 'init') {
    ta.value = e.data.text; ta.focus();
    document.getElementById('aria-status').textContent = 'Commit message loaded.';
  }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
