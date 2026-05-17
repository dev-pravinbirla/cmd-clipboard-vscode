import * as vscode from 'vscode';
import * as path from 'path';
import { CommandStore, ExportData } from './store';
import { showCommandForm } from './commandForm';
import { CommandTreeItem, PinnedTreeProvider, ProjectTreeProvider, ScopedTreeProvider } from './treeProvider';
import { CmdEntry, CmdFolder, CommandScope } from './types';
import { discoverLegacyGlobal, discoverLegacyWorkspace } from './migration';

const LEGACY_GLOBAL_FLAG = 'cmdClipboard.legacyGlobalMigrationDone';
const LEGACY_WORKSPACE_FLAG = 'cmdClipboard.legacyWorkspaceMigrationDone';

async function runLegacyMigration(
  context: vscode.ExtensionContext,
  store: CommandStore,
): Promise<void> {
  const globalDone = context.globalState.get<boolean>(LEGACY_GLOBAL_FLAG, false);
  const workspaceDone = context.workspaceState.get<boolean>(LEGACY_WORKSPACE_FLAG, false);
  if (globalDone && workspaceDone) { return; }

  try {
    const legacyGlobal = globalDone
      ? { commands: [], folders: [] }
      : await discoverLegacyGlobal(context.extensionPath);

    // Determine the current workspace's state.vscdb path from VS Code's
    // per-workspace storageUri. storageUri is undefined when no folder is open.
    let legacyWorkspace: { commands: import('./types').CmdEntry[]; folders: import('./types').CmdFolder[] } = { commands: [], folders: [] };
    if (!workspaceDone && context.storageUri) {
      const wsDb = path.join(path.dirname(context.storageUri.fsPath), 'state.vscdb');
      legacyWorkspace = await discoverLegacyWorkspace(context.extensionPath, wsDb);
    }

    const total = legacyGlobal.commands.length + legacyGlobal.folders.length
      + legacyWorkspace.commands.length + legacyWorkspace.folders.length;

    if (total === 0) {
      // Nothing to migrate — mark flags so we don't keep scanning every launch.
      if (!globalDone) { await context.globalState.update(LEGACY_GLOBAL_FLAG, true); }
      if (!workspaceDone) { await context.workspaceState.update(LEGACY_WORKSPACE_FLAG, true); }
      return;
    }

    const summary = `${legacyGlobal.commands.length + legacyWorkspace.commands.length} commands and ${legacyGlobal.folders.length + legacyWorkspace.folders.length} folders`;
    const choice = await vscode.window.showInformationMessage(
      `Command Clipboard found ${summary} from an older version of this extension. Recover them?`,
      'Recover',
      'Dismiss',
    );

    if (choice === 'Recover') {
      const result = await store.mergeLegacy(legacyGlobal, legacyWorkspace);
      vscode.window.showInformationMessage(
        `Recovered ${result.commands} commands and ${result.folders} folders.`,
      );
    }

    // Either way, set flags so we don't keep prompting.
    if (!globalDone) { await context.globalState.update(LEGACY_GLOBAL_FLAG, true); }
    if (!workspaceDone) { await context.workspaceState.update(LEGACY_WORKSPACE_FLAG, true); }
  } catch (err) {
    // Migration is best-effort: never block activation, never disrupt the user.
    console.error('cmd-clipboard legacy migration failed:', err);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const store = new CommandStore(context.globalState, context.workspaceState);

  // Best-effort one-time migration from older publisher ids. Runs async — does
  // not block activation. See src/migration.ts for what it reads.
  void runLegacyMigration(context, store);

  // Register tree providers (createTreeView gives us access to selection for multi-select run)
  const pinnedProvider = new PinnedTreeProvider(store);
  const globalProvider = new ScopedTreeProvider(store, 'global', () => undefined);
  const workspaceProvider = new ScopedTreeProvider(store, 'workspace', () => undefined);
  const projectProvider = new ProjectTreeProvider(store);

  const pinnedTreeView = vscode.window.createTreeView('cmdClipboard.pinnedView', {
    treeDataProvider: pinnedProvider, canSelectMany: true,
  });
  const globalTreeView = vscode.window.createTreeView('cmdClipboard.globalView', {
    treeDataProvider: globalProvider, canSelectMany: true,
  });
  const workspaceTreeView = vscode.window.createTreeView('cmdClipboard.workspaceView', {
    treeDataProvider: workspaceProvider, canSelectMany: true,
  });
  const projectTreeView = vscode.window.createTreeView('cmdClipboard.projectView', {
    treeDataProvider: projectProvider, canSelectMany: true,
  });
  const treeViews = [pinnedTreeView, globalTreeView, workspaceTreeView, projectTreeView];
  context.subscriptions.push(...treeViews);

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

  // --- Helper: short human label for a scope/project pair, shown as a form badge ---
  function formatScopeBadge(scope: CommandScope, projectPath?: string): string {
    if (scope === 'project' && projectPath) {
      const name = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;
      return `Project · ${name}`;
    }
    return scope.charAt(0).toUpperCase() + scope.slice(1);
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

  // --- Add command (scope already known): opens the webview form directly ---
  async function addCommandWithScope(scope: CommandScope, projectPath?: string) {
    const folders = store.getFolders(scope, projectPath);
    const result = await showCommandForm({
      mode: 'add',
      initial: { label: '', snippet: '', description: '', folderId: undefined },
      folders: folders.map(f => ({ id: f.id, label: f.label })),
      scopeBadge: formatScopeBadge(scope, projectPath),
    });
    if (!result) { return; }

    await store.addCommand(result.label, result.snippet, scope, result.folderId, projectPath, result.description);
    vscode.window.showInformationMessage(`Command added: ${result.label}`);
  }

  // --- Add folder (scope already known): prompts for folder name ---
  async function addFolderWithScope(scope: CommandScope, projectPath?: string) {
    const label = await vscode.window.showInputBox({
      prompt: 'Folder name',
      placeHolder: 'e.g. Docker, Git, Build',
    });
    if (!label) { return; }

    await store.addFolder(label, scope, projectPath);
    vscode.window.showInformationMessage(`Folder created: ${label}`);
  }

  // --- Command palette: pick scope, then add a command ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addItem', async () => {
      const scope = await pickScope();
      if (!scope) { return; }

      let projectPath: string | undefined;
      if (scope === 'project') {
        projectPath = await pickProjectPath();
        if (!projectPath) { return; }
      }

      await addCommandWithScope(scope, projectPath);
    })
  );

  // --- Command palette: pick scope, then add a folder ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addFolderItem', async () => {
      const scope = await pickScope();
      if (!scope) { return; }

      let projectPath: string | undefined;
      if (scope === 'project') {
        projectPath = await pickProjectPath();
        if (!projectPath) { return; }
      }

      await addFolderWithScope(scope, projectPath);
    })
  );

  // --- View-specific add command buttons (no scope picker needed) ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addGlobalItem', async () => {
      await addCommandWithScope('global');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addWorkspaceItem', async () => {
      await addCommandWithScope('workspace');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addProjectItem', async () => {
      const projectPath = await pickProjectPath();
      if (!projectPath) { return; }
      await addCommandWithScope('project', projectPath);
    })
  );

  // --- View-specific add folder buttons ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addGlobalFolder', async () => {
      await addFolderWithScope('global');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addWorkspaceFolder', async () => {
      await addFolderWithScope('workspace');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.addProjectFolder', async () => {
      const projectPath = await pickProjectPath();
      if (!projectPath) { return; }
      await addFolderWithScope('project', projectPath);
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
        const folders = store.getFolders(cmd.scope, cmd.projectPath);
        const result = await showCommandForm({
          mode: 'edit',
          initial: {
            label: cmd.label,
            snippet: cmd.snippet,
            description: cmd.description,
            folderId: cmd.folderId,
          },
          folders: folders.map(f => ({ id: f.id, label: f.label })),
          scopeBadge: formatScopeBadge(cmd.scope, cmd.projectPath),
        });
        if (!result) { return; }

        await store.editCommand(cmd.id, result.label, result.snippet, result.description);
        if ((result.folderId ?? undefined) !== (cmd.folderId ?? undefined)) {
          await store.moveToFolder(cmd.id, result.folderId);
        }
        vscode.window.showInformationMessage(`Updated: ${result.label}`);
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

  // --- Rename (label-only quick edit, works for commands and folders) ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.renameCommand', async (item: CommandTreeItem) => {
      const cmd = resolveCommand(item);
      const folder = !cmd ? resolveFolder(item) : undefined;

      if (cmd) {
        const label = await vscode.window.showInputBox({
          prompt: 'New name',
          value: cmd.label,
        });
        if (!label || label === cmd.label) { return; }
        await store.editCommand(cmd.id, label, cmd.snippet, cmd.description);
        vscode.window.showInformationMessage(`Renamed to: ${label}`);
      } else if (folder) {
        const label = await vscode.window.showInputBox({
          prompt: 'New folder name',
          value: folder.label,
        });
        if (!label || label === folder.label) { return; }
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

      const result = await showCommandForm({
        mode: 'add',
        initial: { label: '', snippet: '', description: '', folderId: folder.id },
        scopeBadge: `${formatScopeBadge(folder.scope, folder.projectPath)} · ${folder.label}`,
        // No folder picker: the folder is implicit from "Add Command Here"
      });
      if (!result) { return; }

      await store.addCommand(result.label, result.snippet, folder.scope, folder.id, folder.projectPath, result.description);
      vscode.window.showInformationMessage(`Command added to "${folder.label}": ${result.label}`);
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

  // --- Run Selected (multi-select chained run with && ) ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.runSelectedInTerminal', async (
      clicked?: CommandTreeItem,
      selected?: CommandTreeItem[],
    ) => {
      // VS Code passes (clickedItem, allSelectedItems) for tree-view context menus.
      // From the palette neither is provided, so fall back to the visible tree view's selection.
      let items: readonly CommandTreeItem[] = selected && selected.length > 0
        ? selected
        : (clicked ? [clicked] : []);

      if (items.length === 0) {
        for (const tv of treeViews) {
          if (tv.visible && tv.selection.length > 0) {
            items = tv.selection;
            break;
          }
        }
      }

      const cmds = items
        .map(i => resolveCommand(i))
        .filter((c): c is CmdEntry => !!c);

      if (cmds.length === 0) {
        vscode.window.showInformationMessage('Select one or more commands to run.');
        return;
      }

      const allowComplex = vscode.workspace
        .getConfiguration('cmdClipboard')
        .get<boolean>('allowComplexChaining', false);

      if (!allowComplex && cmds.length > 1) {
        const offenders = cmds.filter(c => /&&|\|\||;|\r|\n/.test(c.snippet));
        if (offenders.length > 0) {
          const names = offenders.map(c => `• ${c.label}`).join('\n');
          const choice = await vscode.window.showWarningMessage(
            `Some selected commands contain chaining operators (&&, ||, ;) or newlines and can't be safely chained:\n\n${names}`,
            { modal: true, detail: `Enable "cmdClipboard.allowComplexChaining" in settings to run anyway.` },
            'Open Settings',
          );
          if (choice === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'cmdClipboard.allowComplexChaining');
          }
          return;
        }
      }

      if (cmds.length === 1) {
        runInTerminal(cmds[0].snippet);
        return;
      }

      const joined = cmds.map(c => c.snippet).join(' && ');
      const numbered = cmds.map((c, i) => `${i + 1}. ${c.label}`).join('\n');
      const confirm = await vscode.window.showInformationMessage(
        `Run ${cmds.length} commands chained with && ?`,
        { modal: true, detail: `${numbered}\n\n${joined}` },
        'Run',
      );
      if (confirm !== 'Run') { return; }

      runInTerminal(joined);
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

  // --- Export all commands and folders to JSON ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.exportAll', async () => {
      const data = store.exportAllData();
      const totalCmds = data.global.commands.length + data.workspace.commands.length;
      const totalFolders = data.global.folders.length + data.workspace.folders.length;

      if (totalCmds === 0 && totalFolders === 0) {
        vscode.window.showInformationMessage('Nothing to export — no commands or folders saved yet.');
        return;
      }

      const defaultName = `cmd-clipboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      const defaultUri = wsFolder
        ? vscode.Uri.joinPath(wsFolder.uri, defaultName)
        : vscode.Uri.file(defaultName);

      const target = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { JSON: ['json'] },
        saveLabel: 'Export Commands',
      });
      if (!target) { return; }

      const json = JSON.stringify(data, null, 2);
      await vscode.workspace.fs.writeFile(target, Buffer.from(json, 'utf8'));

      const open = await vscode.window.showInformationMessage(
        `Exported ${totalCmds} commands and ${totalFolders} folders.`,
        'Open File',
      );
      if (open === 'Open File') {
        await vscode.commands.executeCommand('vscode.open', target);
      }
    })
  );

  // --- Import commands and folders from JSON ---
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdClipboard.importJson', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { JSON: ['json'] },
        openLabel: 'Import',
      });
      if (!picked || picked.length === 0) { return; }

      let parsed: ExportData;
      try {
        const raw = await vscode.workspace.fs.readFile(picked[0]);
        parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as ExportData;
      } catch (err: any) {
        vscode.window.showErrorMessage(`Could not read backup file: ${err?.message ?? err}`);
        return;
      }

      const incomingCmds = (parsed?.global?.commands?.length ?? 0) + (parsed?.workspace?.commands?.length ?? 0);
      const incomingFolders = (parsed?.global?.folders?.length ?? 0) + (parsed?.workspace?.folders?.length ?? 0);
      if (incomingCmds === 0 && incomingFolders === 0) {
        vscode.window.showWarningMessage('Backup file contains no commands or folders.');
        return;
      }

      const choice = await vscode.window.showWarningMessage(
        `Import ${incomingCmds} commands and ${incomingFolders} folders?`,
        { modal: true, detail: 'Merge: keep your existing data and add the imported entries.\nReplace: discard your current data and use the imported one.' },
        'Merge',
        'Replace',
      );
      if (choice !== 'Merge' && choice !== 'Replace') { return; }

      try {
        const summary = await store.importData(parsed, choice === 'Replace' ? 'replace' : 'merge');
        vscode.window.showInformationMessage(
          `Imported ${summary.commands} commands and ${summary.folders} folders.`,
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Import failed: ${err?.message ?? err}`);
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
