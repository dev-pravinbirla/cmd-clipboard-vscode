import * as vscode from 'vscode';

export interface CommandFormInitial {
  label: string;
  snippet: string;
  description?: string;
  folderId?: string;
}

export interface CommandFormOptions {
  mode: 'add' | 'edit';
  initial: CommandFormInitial;
  /** When provided, a folder dropdown is rendered. First entry is treated as "no folder". */
  folders?: { id: string; label: string }[];
  /** Short label shown as a badge at the top, e.g. "Global", "Workspace", "Project: my-app" */
  scopeBadge?: string;
  /** Override the panel tab title. */
  title?: string;
}

export interface CommandFormResult {
  label: string;
  snippet: string;
  description?: string;
  folderId?: string;
}

/**
 * Open a webview-based form to add or edit a command. Resolves to the entered values on Save,
 * or `undefined` if the user cancels.
 *
 * The form opens in `ViewColumn.Beside` with a centered card layout to behave like a focused dialog —
 * VS Code's extension API does not support true floating popups for webviews.
 */
export function showCommandForm(options: CommandFormOptions): Promise<CommandFormResult | undefined> {
  const titleDefault = options.mode === 'add' ? 'Add Command' : `Edit: ${options.initial.label || 'Command'}`;
  const panel = vscode.window.createWebviewPanel(
    'cmdClipboard.commandForm',
    options.title ?? titleDefault,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = renderHtml(panel.webview, options);

  return new Promise((resolve) => {
    let settled = false;

    const sub = panel.webview.onDidReceiveMessage((msg) => {
      if (settled) { return; }
      if (msg?.type === 'save') {
        const label = String(msg.label ?? '').trim();
        const snippet = String(msg.snippet ?? '').trim();
        const description = String(msg.description ?? '').trim();
        const folderIdRaw = typeof msg.folderId === 'string' ? msg.folderId : '';
        if (!label || !snippet) {
          panel.webview.postMessage({ type: 'validation', message: 'Name and Command are required.' });
          return;
        }
        settled = true;
        resolve({
          label,
          snippet,
          description: description || undefined,
          folderId: folderIdRaw || undefined,
        });
        panel.dispose();
      } else if (msg?.type === 'cancel') {
        settled = true;
        resolve(undefined);
        panel.dispose();
      }
    });

    panel.onDidDispose(() => {
      sub.dispose();
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    });
  });
}

function renderHtml(webview: vscode.Webview, options: CommandFormOptions): string {
  const nonce = generateNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const isEdit = options.mode === 'edit';
  const heading = isEdit ? 'Edit Command' : 'Add Command';
  const submitLabel = isEdit ? 'Save Changes' : 'Add Command';

  const showFolders = Array.isArray(options.folders) && options.folders.length > 0;
  const folderOptions = showFolders
    ? options.folders!.map(f =>
        `<option value="${escapeHtml(f.id)}"${f.id === options.initial.folderId ? ' selected' : ''}>${escapeHtml(f.label)}</option>`
      ).join('')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${escapeHtml(heading)}</title>
<style>
  :root {
    --gap: 14px;
    --radius: 6px;
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 32px 16px 24px;
    font-size: 13px;
    display: flex;
    justify-content: center;
  }
  .card {
    width: 100%;
    max-width: 560px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
    border-radius: var(--radius);
    padding: 22px 24px 18px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    flex: 1;
  }
  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    text-transform: capitalize;
    white-space: nowrap;
  }
  .subtitle {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    margin: 0 0 18px;
  }
  .field { margin-bottom: var(--gap); }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 5px;
    font-weight: 500;
    font-size: 12px;
    color: var(--vscode-foreground);
  }
  label .req { color: var(--vscode-errorForeground); }
  input[type="text"], textarea, select {
    width: 100%;
    padding: 7px 9px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border, transparent));
    border-radius: 3px;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    outline: none;
    transition: border-color 0.12s ease;
  }
  input[type="text"]:focus, textarea:focus, select:focus {
    border-color: var(--vscode-focusBorder);
  }
  textarea#snippet {
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    min-height: 78px;
    resize: vertical;
    line-height: 1.4;
  }
  textarea#description {
    min-height: 56px;
    resize: vertical;
    line-height: 1.4;
  }
  .hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
    line-height: 1.4;
  }
  .divider {
    border: none;
    border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
    margin: 16px 0 14px;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .footer .kbd-hint {
    flex: 1;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  kbd {
    display: inline-block;
    padding: 1px 5px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.17));
    color: var(--vscode-keybindingLabel-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-keybindingLabel-border, transparent);
    border-bottom-width: 2px;
    border-radius: 3px;
    line-height: 1;
  }
  button {
    padding: 7px 16px;
    font-size: 13px;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--vscode-font-family);
    font-weight: 500;
  }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #error {
    color: var(--vscode-errorForeground);
    font-size: 12px;
    margin-top: 8px;
    min-height: 16px;
  }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>${escapeHtml(heading)}</h1>
    ${options.scopeBadge ? `<span class="badge">${escapeHtml(options.scopeBadge)}</span>` : ''}
  </div>
  <p class="subtitle">${isEdit ? 'Update the details below and save.' : 'Save a new command for quick copy or run.'}</p>

  <div class="field">
    <label for="label">Name <span class="req">*</span></label>
    <input id="label" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. Start dev server" />
    <div class="hint">Short display label shown in the tree.</div>
  </div>

  <div class="field">
    <label for="snippet">Command <span class="req">*</span></label>
    <textarea id="snippet" spellcheck="false" placeholder="e.g. npm run dev"></textarea>
    <div class="hint">The exact text that gets copied or sent to the terminal.</div>
  </div>

  <div class="field">
    <label for="description">Description</label>
    <textarea id="description" placeholder="What this command does, when to use it..."></textarea>
    <div class="hint">Optional. Shown on hover and in search results.</div>
  </div>

  ${showFolders ? `
  <div class="field">
    <label for="folderId">Folder</label>
    <select id="folderId">
      <option value="">(No folder)</option>
      ${folderOptions}
    </select>
    <div class="hint">Group related commands together.</div>
  </div>` : ''}

  <div id="error"></div>
  <hr class="divider" />
  <div class="footer">
    <span class="kbd-hint"><kbd>⌘ Enter</kbd> save · <kbd>Esc</kbd> cancel</span>
    <button class="secondary" id="cancelBtn">Cancel</button>
    <button class="primary" id="saveBtn">${escapeHtml(submitLabel)}</button>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const labelEl = document.getElementById('label');
  const snippetEl = document.getElementById('snippet');
  const descriptionEl = document.getElementById('description');
  const folderEl = document.getElementById('folderId');
  const errorEl = document.getElementById('error');
  const saveBtn = document.getElementById('saveBtn');

  labelEl.value = ${JSON.stringify(options.initial.label)};
  snippetEl.value = ${JSON.stringify(options.initial.snippet)};
  descriptionEl.value = ${JSON.stringify(options.initial.description ?? '')};

  labelEl.focus();
  if (labelEl.value) { labelEl.select(); }

  function updateSaveState() {
    saveBtn.disabled = !labelEl.value.trim() || !snippetEl.value.trim();
  }
  updateSaveState();
  [labelEl, snippetEl].forEach(el => el.addEventListener('input', updateSaveState));

  function save() {
    if (saveBtn.disabled) { return; }
    vscode.postMessage({
      type: 'save',
      label: labelEl.value,
      snippet: snippetEl.value,
      description: descriptionEl.value,
      folderId: folderEl ? folderEl.value : '',
    });
  }
  function cancel() {
    vscode.postMessage({ type: 'cancel' });
  }

  saveBtn.addEventListener('click', save);
  document.getElementById('cancelBtn').addEventListener('click', cancel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cancel(); }
    else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { save(); }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg?.type === 'validation') {
      errorEl.textContent = msg.message ?? '';
    }
  });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
