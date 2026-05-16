import * as vscode from 'vscode';
import { CommandStore } from './store';
import { CommandTreeItem, PinnedTreeProvider, ProjectTreeProvider, ScopedTreeProvider } from './treeProvider';
import { CmdEntry, CmdFolder, CommandScope } from './types';

export function activate(context: vscode.ExtensionContext) {
  const store = new CommandStore(context.globalState, context.workspaceState);

  // Register tree providers
  const pinnedProvider = new PinnedTreeProvider(store);
  const globalProvider = new ScopedTreeProvider(store, 'global', () => undefined);
  const workspaceProvider = new ScopedTreeProvider(store, 'workspace', () => undefined);
  const projectProvider = new ProjectTreeProvider(store);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('cmdClipboard.pinnedView', pinnedProvider),
    vscode.window.registerTreeDataProvider('cmdClipboard.globalView', globalProvider),
    vscode.window.registerTreeDataProvider('cmdClipboard.workspaceView', workspaceProvider),
    vscode.window.registerTreeDataProvider('cmdClipboard.projectView', projectProvider),
  );

  // --- Status bar button ---
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(terminal) Cmds';
  statusBarItem.tooltip = 'Toggle Command Clipboard';
  statusBarItem.command = 'cmdClipboard.togglePanel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.togglePanel', () => {
      vscode.commands.executeCommand('workbench.view.extension.cmd-clipboard');
    })
  );

  // --- Helper: pick project folder ---
  async function pickProjectPath(): Promise<string | undefined> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      vscode.window.showWarningMessage('No workspace folders open. Open a folder first.');
      return undefined;
    }
    if (wsFolders.length === 1) {
      return wsFolders[0].uri.fsPath;
    }
    const pick = await vscode.window.showQuickPick(
      wsFolders.map(f => ({ label: f.name, description: f.uri.fsPath, path: f.uri.fsPath })),
      { placeHolder: 'Which project folder?' }
    );
    return pick?.path;
  }

  // --- Helper: send a command to a terminal, clearing any half-typed input first ---
  function runInTerminal(snippet: string): void {
    const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('Command Clipboard');
    terminal.show();
    const clearBeforeRun = vscode.workspace
      .getConfiguration('cmdClipboard')
      .get<boolean>('terminal.clearBeforeRun', true);
    if (clearBeforeRun) {
      // Ctrl+U clears the current line in bash/zsh/fish/PowerShell readline without executing it.
      terminal.sendText('\x15', false);
    }
    terminal.sendText(snippet);
  }

  // --- Helper: ask user for scope (used by command palette fallback) ---
  async function pickScope(): Promise<CommandScope | undefined> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Global', description: 'Visible everywhere', scope: 'global' as CommandScope },
        { label: 'Workspace', description: 'Visible in this workspace', scope: 'workspace' as CommandScope },
        { label: 'Project', description: 'Visible in this project folder', scope: 'project' as CommandScope },
      ],
      { placeHolder: 'Where should this be saved?' }
    );
    return pick?.scope;
  }

  // --- Shared add logic (scope already known) ---
  async function addItemWithScope(scope: CommandScope, projectPath?: string) {
    // Step 1: What to add?
    const typePick = await vscode.window.showQuickPick(
      [
        { label: '$(terminal) Command', description: 'A command snippet to copy', type: 'command' },
        { label: '$(folder) Folder', description: 'A folder to organize commands', type: 'folder' },
      ],
      { placeHolder: 'What do you want to add?' }
    );
    if (!typePick) { return; }

    if (typePick.type === 'folder') {
      const label = await vscode.window.showInputBox({
        prompt: 'Folder name',
        placeHolder: 'e.g. Docker, Git, Build',
      });
      if (!label) { return; }

      await store.addFolder(label, scope, projectPath);
      vscode.window.showInformationMessage(`Folder created: ${label}`);
    } else {
      const label = await vscode.window.showInputBox({
        prompt: 'Command name (display label)',
        placeHolder: 'e.g. Start dev server',
      });
      if (!label) { return; }

      const snippet = await vscode.window.showInputBox({
        prompt: 'The actual command to copy',
        placeHolder: 'e.g. npm run dev',
      });
      if (!snippet) { return; }

      const description = await vscode.window.showInputBox({
        prompt: 'Description (optional, press Enter to skip)',
        placeHolder: 'e.g. Starts the development server on port 3000',
      });

      // Pick a folder to put it in
      const folders = store.getFolders(scope, projectPath);
      let folderId: string | undefined;
      if (folders.length > 0) {
        const folderPick = await vscode.window.showQuickPick(
          [
            { label: '(No folder)', id: undefined as string | undefined },
            ...folders.map(f => ({ label: f.label, id: f.id as string | undefined })),
          ],
          { placeHolder: 'Put in folder? (optional)' }
        );
        folderId = folderPick?.id;
      }

      await store.addCommand(label, snippet, scope, folderId, projectPath, description || undefined);
      vscode.window.showInformationMessage(`Command added: ${label}`);
    }
  }

  // --- Command palette fallback: asks for scope ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addItem', async () => {
      const scope = await pickScope();
      if (!scope) { return; }

      let projectPath: string | undefined;
      if (scope === 'project') {
        projectPath = await pickProjectPath();
        if (!projectPath) { return; }
      }

      await addItemWithScope(scope, projectPath);
    })
  );

  // --- View-specific add buttons (no scope picker needed) ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addGlobalItem', async () => {
      await addItemWithScope('global');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addWorkspaceItem', async () => {
      await addItemWithScope('workspace');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addProjectItem', async () => {
      const projectPath = await pickProjectPath();
      if (!projectPath) { return; }
      await addItemWithScope('project', projectPath);
    })
  );

  // --- Copy command ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.copyCommand', async (item: CommandTreeItem) => {
      let cmd = item?.cmdEntry;
      // Fallback: look up by id if custom property was lost
      if (!cmd && item?.id) {
        const cmdId = String(item.id).replace(/^(pin-|cmd-)/, '');
        cmd = store.findCommand(cmdId);
      }
      if (cmd) {
        await vscode.env.clipboard.writeText(cmd.snippet);
        vscode.window.showInformationMessage(`Copied: ${cmd.label}`);
      }
    })
  );

  // --- Helpers to resolve items with id fallback ---
  function resolveCommand(item: CommandTreeItem): CmdEntry | undefined {
    if (item?.cmdEntry) { return item.cmdEntry; }
    if (item?.id) {
      const cmdId = String(item.id).replace(/^(pin-|cmd-)/, '');
      return store.findCommand(cmdId);
    }
    return undefined;
  }

  function resolveFolder(item: CommandTreeItem): CmdFolder | undefined {
    if (item?.folder) { return item.folder; }
    if (item?.id) {
      const folderId = String(item.id).replace('folder-', '');
      return store.findFolder(folderId);
    }
    return undefined;
  }

  // --- Pin/Unpin ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.pinCommand', async (item: CommandTreeItem) => {
      const cmd = resolveCommand(item);
      if (cmd) {
        await store.togglePin(cmd.id);
        const action = cmd.pinned ? 'Unpinned' : 'Pinned';
        vscode.window.showInformationMessage(`${action}: ${cmd.label}`);
      }
    })
  );

  // --- Edit (works for both commands and folders) ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.editCommand', async (item: CommandTreeItem) => {
      const cmd = resolveCommand(item);
      const folder = !cmd ? resolveFolder(item) : undefined;

      if (cmd) {
        const label = await vscode.window.showInputBox({
          prompt: 'Command name',
          value: cmd.label,
        });
        if (!label) { return; }

        const snippet = await vscode.window.showInputBox({
          prompt: 'Command to copy',
          value: cmd.snippet,
        });
        if (!snippet) { return; }

        const description = await vscode.window.showInputBox({
          prompt: 'Description (optional)',
          value: cmd.description ?? '',
        });

        await store.editCommand(cmd.id, label, snippet, description || undefined);
        vscode.window.showInformationMessage(`Updated: ${label}`);
      } else if (folder) {
        const label = await vscode.window.showInputBox({
          prompt: 'Folder name',
          value: folder.label,
        });
        if (!label) { return; }

        await store.editFolder(folder.id, label);
        vscode.window.showInformationMessage(`Renamed folder to: ${label}`);
      }
    })
  );

  // --- Delete ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.deleteItem', async (item: CommandTreeItem) => {
      if (!item) { return; }

      const cmd = resolveCommand(item);
      const folder = !cmd ? resolveFolder(item) : undefined;
      const itemLabel = cmd?.label ?? folder?.label ?? 'item';

      const confirm = await vscode.window.showWarningMessage(
        `Delete "${itemLabel}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') { return; }

      if (cmd) {
        await store.deleteCommand(cmd.id);
      } else if (folder) {
        await store.deleteFolder(folder.id);
      }
      vscode.window.showInformationMessage(`Deleted: ${itemLabel}`);
    })
  );

  // --- Add command directly into a folder ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addCommandToFolder', async (item: CommandTreeItem) => {
      // Try direct property first, then fallback to store lookup via item id
      let folder = item?.folder;
      if (!folder && item?.id) {
        const folderId = String(item.id).replace('folder-', '');
        folder = store.findFolder(folderId);
      }
      if (!folder) {
        vscode.window.showErrorMessage('Could not identify the folder. Try right-clicking and selecting "Add Command Here".');
        return;
      }

      const label = await vscode.window.showInputBox({
        prompt: 'Command name (display label)',
        placeHolder: 'e.g. Start dev server',
      });
      if (!label) { return; }

      const snippet = await vscode.window.showInputBox({
        prompt: 'The actual command to copy',
        placeHolder: 'e.g. npm run dev',
      });
      if (!snippet) { return; }

      const description = await vscode.window.showInputBox({
        prompt: 'Description (optional, press Enter to skip)',
        placeHolder: 'e.g. Starts the development server on port 3000',
      });

      await store.addCommand(label, snippet, folder.scope, folder.id, folder.projectPath, description || undefined);
      vscode.window.showInformationMessage(`Command added to "${folder.label}": ${label}`);
    })
  );

  // --- Move to folder ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.moveToFolder', async (item: CommandTreeItem) => {
      const cmd = resolveCommand(item);
      if (!cmd) { return; }

      const folders = store.getFolders(cmd.scope, cmd.projectPath);
      const picks = [
        { label: '(No folder - move to root)', id: undefined as string | undefined },
        ...folders.map(f => ({ label: f.label, id: f.id as string | undefined })),
      ];

      const pick = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Move to folder',
      });
      if (pick === undefined) { return; }

      await store.moveToFolder(cmd.id, pick.id);
      vscode.window.showInformationMessage(`Moved "${cmd.label}" to ${pick.label}`);
    })
  );

  // --- Refresh all views ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.refreshAll', () => {
      pinnedProvider.refresh();
      globalProvider.refresh();
      workspaceProvider.refresh();
      projectProvider.refresh();
      vscode.window.showInformationMessage('Command Clipboard refreshed');
    })
  );

  // --- Run in Terminal ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.runInTerminal', async (item: CommandTreeItem) => {
      const cmd = resolveCommand(item);
      if (!cmd) { return; }

      runInTerminal(cmd.snippet);
    })
  );

  // --- Search commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.searchCommands', async () => {
      const allCommands = store.getAllCommands();
      if (allCommands.length === 0) {
        vscode.window.showInformationMessage('No commands saved yet.');
        return;
      }

      const picks = allCommands.map(c => ({
        label: c.label,
        description: `[${c.scope}] ${c.snippet}`,
        detail: c.description,
        cmd: c,
      }));

      const pick = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Search commands...',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!pick) { return; }

      const action = await vscode.window.showQuickPick(
        [
          { label: '$(clippy) Copy to Clipboard', action: 'copy' },
          { label: '$(play) Run in Terminal', action: 'run' },
        ],
        { placeHolder: `What to do with "${pick.cmd.label}"?` }
      );

      if (action?.action === 'copy') {
        await vscode.env.clipboard.writeText(pick.cmd.snippet);
        vscode.window.showInformationMessage(`Copied: ${pick.cmd.label}`);
      } else if (action?.action === 'run') {
        runInTerminal(pick.cmd.snippet);
      }
    })
  );

  // --- Duplicate command ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.duplicateCommand', async (item: CommandTreeItem) => {
      const cmd = resolveCommand(item);
      if (!cmd) { return; }

      await store.addCommand(
        `${cmd.label} (copy)`,
        cmd.snippet,
        cmd.scope,
        cmd.folderId,
        cmd.projectPath,
        cmd.description
      );
      vscode.window.showInformationMessage(`Duplicated: ${cmd.label}`);
    })
  );
}

export function deactivate() {}
