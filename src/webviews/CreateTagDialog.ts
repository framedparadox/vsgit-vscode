import * as vscode from "vscode";

export interface CreateTagDialogResult {
  name: string;
  message?: string;
  annotate: boolean;
  sign: boolean;
  force: boolean;
  push: boolean;
}

export async function showCreateTagDialog(
  extensionUri: vscode.Uri,
  shaLabel = "HEAD",
): Promise<CreateTagDialogResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    "vsgit.createTag",
    "Create Tag",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [extensionUri],
    },
  );
  panel.webview.html = createTagHtml(getNonce(), panel.webview.cspSource, shaLabel);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CreateTagDialogResult | undefined) => {
      if (settled) return;
      settled = true;
      resolve(result);
      panel.dispose();
    };

    panel.onDidDispose(() => finish(undefined));
    panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "cancel") {
        finish(undefined);
      } else if (message.type === "create") {
        finish(message.data as CreateTagDialogResult);
      }
    });
  });
}

function createTagHtml(nonce: string, cspSource: string, shaLabel: string): string {
  const escapedSha = escapeHtml(shaLabel);
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .backdrop {
    width: 100%;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.38);
  }
  form {
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    border-radius: 4px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 8px;
    border-bottom: 1px solid var(--vscode-editorWidget-border, #454545);
  }
  h1 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .close:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
  main {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    overflow: auto;
  }
  label.field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  label.check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
    font-size: 12px;
  }
  label span { color: var(--vscode-descriptionForeground); }
  input[type="text"], textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 2px;
    padding: 5px 7px;
    font-family: var(--vscode-font-family);
    font-size: 12px;
  }
  input[readonly], textarea:disabled { opacity: 0.72; }
  textarea {
    resize: vertical;
    min-height: 72px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--vscode-editorWidget-border, #454545);
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 26px;
    font-family: inherit;
    font-size: 12px;
    padding: 5px 12px;
    border: 1px solid transparent;
    border-radius: 2px;
    cursor: pointer;
  }
  #create {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  #create:hover { background: var(--vscode-button-hoverBackground); }
  #cancel {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
</style>
</head>
<body>
  <div class="backdrop">
    <form id="form" autocomplete="off">
      <header>
        <h1>Create Tag</h1>
        <button type="button" class="close" id="close" title="Close" aria-label="Close">&times;</button>
      </header>
      <main>
        <label class="field">
          <span>Tag Name</span>
          <input id="name" type="text" placeholder="v1.0.0" required>
        </label>
        <label class="field">
          <span>Commit</span>
          <input id="sha" type="text" value="${escapedSha}" readonly>
        </label>
        <label class="check">
          <input id="annotate" type="checkbox">
          <span>Annotated Tag</span>
        </label>
        <label class="check">
          <input id="sign" type="checkbox">
          <span>Sign Tag with GPG</span>
        </label>
        <label class="field">
          <span>Message</span>
          <textarea id="message" rows="4" placeholder="Release version 1.0.0" disabled></textarea>
        </label>
        <label class="check">
          <input id="force" type="checkbox">
          <span>Force replace existing tag</span>
        </label>
        <label class="check">
          <input id="push" type="checkbox">
          <span>Push tag after creation</span>
        </label>
      </main>
      <footer>
        <button type="button" id="cancel">Cancel</button>
        <button type="submit" id="create">Create Tag</button>
      </footer>
    </form>
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const form = document.getElementById('form');
const nameInput = document.getElementById('name');
const annotateInput = document.getElementById('annotate');
const signInput = document.getElementById('sign');
const messageInput = document.getElementById('message');
function close() { vscode.postMessage({ type: 'cancel' }); }
function syncMessage() {
  messageInput.disabled = !annotateInput.checked && !signInput.checked;
  if (messageInput.disabled) messageInput.value = '';
}
annotateInput.addEventListener('change', syncMessage);
signInput.addEventListener('change', () => {
  if (signInput.checked) annotateInput.checked = true;
  syncMessage();
});
document.getElementById('close').addEventListener('click', close);
document.getElementById('cancel').addEventListener('click', close);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const message = messageInput.value.trim();
  if (!name) return;
  if (signInput.checked && !message) {
    messageInput.focus();
    return;
  }
  vscode.postMessage({
    type: 'create',
    data: {
      name,
      message: message || undefined,
      annotate: annotateInput.checked,
      sign: signInput.checked,
      force: document.getElementById('force').checked,
      push: document.getElementById('push').checked
    }
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
});
nameInput.focus();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
