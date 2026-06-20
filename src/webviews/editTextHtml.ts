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
  h2 { margin: 0 0 8px; font-size: 1.05em; }
  textarea { flex: 1; width: 100%; box-sizing: border-box; resize: none;
    font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 13px);
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 8px; border-radius: 2px; }
  #actions { margin-top: 10px; display: flex; gap: 8px; }
  button { font-family: inherit; font-size: inherit; padding: 5px 14px; border: none; border-radius: 2px; cursor: pointer; }
  #save { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
  <h2 id="title">Commit Message</h2>
  <textarea id="text" spellcheck="false"></textarea>
  <div id="actions">
    <button id="save">Save &amp; Continue</button>
    <button id="cancel">Abort</button>
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ta = document.getElementById('text');
document.getElementById('save').addEventListener('click', () => vscode.postMessage({ type: 'save', text: ta.value }));
document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
window.addEventListener('message', (e) => { if (e.data.type === 'init') { ta.value = e.data.text; ta.focus(); } });
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
