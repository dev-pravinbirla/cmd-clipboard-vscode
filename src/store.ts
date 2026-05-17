import * as vscode from 'vscode';
import { CmdEntry, CmdFolder, CommandScope, StoreData } from './types';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export interface ExportData {
  version: number;
  exportedAt: number;
  global: StoreData;
  workspace: StoreData;
}

export type ImportMode = 'merge' | 'replace';

export interface ImportSummary {
  commands: number;
  folders: number;
}

export class CommandStore {
  private static GLOBAL_KEY = 'cmdClipboard.globalData';
  private static WORKSPACE_KEY = 'cmdClipboard.workspaceData';

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private globalState: vscode.Memento,
    private workspaceState: vscode.Memento
  ) {}

  // --- Data access ---

  private getGlobalData(): StoreData {
    return this.globalState.get<StoreData>(CommandStore.GLOBAL_KEY, { commands: [], folders: [] });
  }

  private getWorkspaceData(): StoreData {
    return this.workspaceState.get<StoreData>(CommandStore.WORKSPACE_KEY, { commands: [], folders: [] });
  }

  private async saveGlobalData(data: StoreData): Promise<void> {
    await this.globalState.update(CommandStore.GLOBAL_KEY, data);
    this._onDidChange.fire();
  }

  private async saveWorkspaceData(data: StoreData): Promise<void> {
    await this.workspaceState.update(CommandStore.WORKSPACE_KEY, data);
    this._onDidChange.fire();
  }

  // Global commands/folders stored in globalState
  // Workspace + Project commands/folders stored in workspaceState (project commands filtered by projectPath)

  getAllCommands(): CmdEntry[] {
    const global = this.getGlobalData();
    const ws = this.getWorkspaceData();
    return [...global.commands, ...ws.commands];
  }

  getCommands(scope: CommandScope, projectPath?: string): CmdEntry[] {
    if (scope === 'global') {
      return this.getGlobalData().commands;
    }
    const ws = this.getWorkspaceData();
    if (scope === 'workspace') {
      return ws.commands.filter(c => c.scope === 'workspace');
    }
    // project
    return ws.commands.filter(c => c.scope === 'project' && c.projectPath === projectPath);
  }

  getFolders(scope: CommandScope, projectPath?: string): CmdFolder[] {
    if (scope === 'global') {
      return this.getGlobalData().folders;
    }
    const ws = this.getWorkspaceData();
    if (scope === 'workspace') {
      return ws.folders.filter(f => f.scope === 'workspace');
    }
    return ws.folders.filter(f => f.scope === 'project' && f.projectPath === projectPath);
  }

  getPinnedCommands(): CmdEntry[] {
    return this.getAllCommands().filter(c => c.pinned);
  }

  getAllProjectCommands(): CmdEntry[] {
    const ws = this.getWorkspaceData();
    return ws.commands.filter(c => c.scope === 'project');
  }

  getAllProjectFolders(): CmdFolder[] {
    const ws = this.getWorkspaceData();
    return ws.folders.filter(f => f.scope === 'project');
  }

  getProjectPaths(): string[] {
    const cmds = this.getAllProjectCommands();
    const folders = this.getAllProjectFolders();
    const paths = new Set<string>();
    cmds.forEach(c => { if (c.projectPath) { paths.add(c.projectPath); } });
    folders.forEach(f => { if (f.projectPath) { paths.add(f.projectPath); } });
    return Array.from(paths).sort();
  }

  // --- Mutations ---

  async addCommand(label: string, snippet: string, scope: CommandScope, folderId?: string, projectPath?: string, description?: string): Promise<CmdEntry> {
    const cmd: CmdEntry = {
      id: generateId(),
      label,
      snippet,
      description,
      folderId,
      pinned: false,
      scope,
      projectPath: scope === 'project' ? projectPath : undefined,
      createdAt: Date.now(),
    };

    if (scope === 'global') {
      const data = this.getGlobalData();
      data.commands.push(cmd);
      await this.saveGlobalData(data);
    } else {
      const data = this.getWorkspaceData();
      data.commands.push(cmd);
      await this.saveWorkspaceData(data);
    }
    return cmd;
  }

  async addFolder(label: string, scope: CommandScope, projectPath?: string): Promise<CmdFolder> {
    const folder: CmdFolder = {
      id: generateId(),
      label,
      scope,
      projectPath: scope === 'project' ? projectPath : undefined,
    };

    if (scope === 'global') {
      const data = this.getGlobalData();
      data.folders.push(folder);
      await this.saveGlobalData(data);
    } else {
      const data = this.getWorkspaceData();
      data.folders.push(folder);
      await this.saveWorkspaceData(data);
    }
    return folder;
  }

  async togglePin(commandId: string): Promise<void> {
    // Try global first
    const globalData = this.getGlobalData();
    const gCmd = globalData.commands.find(c => c.id === commandId);
    if (gCmd) {
      gCmd.pinned = !gCmd.pinned;
      await this.saveGlobalData(globalData);
      return;
    }

    const wsData = this.getWorkspaceData();
    const wCmd = wsData.commands.find(c => c.id === commandId);
    if (wCmd) {
      wCmd.pinned = !wCmd.pinned;
      await this.saveWorkspaceData(wsData);
    }
  }

  async editCommand(commandId: string, label: string, snippet: string, description?: string): Promise<void> {
    const globalData = this.getGlobalData();
    const gCmd = globalData.commands.find(c => c.id === commandId);
    if (gCmd) {
      gCmd.label = label;
      gCmd.snippet = snippet;
      gCmd.description = description;
      await this.saveGlobalData(globalData);
      return;
    }

    const wsData = this.getWorkspaceData();
    const wCmd = wsData.commands.find(c => c.id === commandId);
    if (wCmd) {
      wCmd.label = label;
      wCmd.snippet = snippet;
      wCmd.description = description;
      await this.saveWorkspaceData(wsData);
    }
  }

  async deleteCommand(commandId: string): Promise<void> {
    const globalData = this.getGlobalData();
    const gIdx = globalData.commands.findIndex(c => c.id === commandId);
    if (gIdx !== -1) {
      globalData.commands.splice(gIdx, 1);
      await this.saveGlobalData(globalData);
      return;
    }

    const wsData = this.getWorkspaceData();
    const wIdx = wsData.commands.findIndex(c => c.id === commandId);
    if (wIdx !== -1) {
      wsData.commands.splice(wIdx, 1);
      await this.saveWorkspaceData(wsData);
    }
  }

  async deleteFolder(folderId: string): Promise<void> {
    // Delete folder and ungroup its commands (move to root)
    const globalData = this.getGlobalData();
    const gIdx = globalData.folders.findIndex(f => f.id === folderId);
    if (gIdx !== -1) {
      globalData.folders.splice(gIdx, 1);
      globalData.commands.forEach(c => {
        if (c.folderId === folderId) {
          c.folderId = undefined;
        }
      });
      await this.saveGlobalData(globalData);
      return;
    }

    const wsData = this.getWorkspaceData();
    const wIdx = wsData.folders.findIndex(f => f.id === folderId);
    if (wIdx !== -1) {
      wsData.folders.splice(wIdx, 1);
      wsData.commands.forEach(c => {
        if (c.folderId === folderId) {
          c.folderId = undefined;
        }
      });
      await this.saveWorkspaceData(wsData);
    }
  }

  async moveToFolder(commandId: string, folderId: string | undefined): Promise<void> {
    const globalData = this.getGlobalData();
    const gCmd = globalData.commands.find(c => c.id === commandId);
    if (gCmd) {
      gCmd.folderId = folderId;
      await this.saveGlobalData(globalData);
      return;
    }

    const wsData = this.getWorkspaceData();
    const wCmd = wsData.commands.find(c => c.id === commandId);
    if (wCmd) {
      wCmd.folderId = folderId;
      await this.saveWorkspaceData(wsData);
    }
  }

  findCommand(commandId: string): CmdEntry | undefined {
    return this.getAllCommands().find(c => c.id === commandId);
  }

  findFolder(folderId: string): CmdFolder | undefined {
    const globalData = this.getGlobalData();
    const gFolder = globalData.folders.find(f => f.id === folderId);
    if (gFolder) { return gFolder; }
    const wsData = this.getWorkspaceData();
    return wsData.folders.find(f => f.id === folderId);
  }

  // --- Export / Import ---

  exportAllData(): ExportData {
    return {
      version: 1,
      exportedAt: Date.now(),
      global: this.getGlobalData(),
      workspace: this.getWorkspaceData(),
    };
  }

  /**
   * Merge data found in legacy publisher storage. IDs are preserved so that
   * if this ever runs twice, duplicates are skipped on the second pass.
   */
  async mergeLegacy(
    legacyGlobal: { commands: CmdEntry[]; folders: CmdFolder[] },
    legacyWorkspace: { commands: CmdEntry[]; folders: CmdFolder[] },
  ): Promise<ImportSummary> {
    let added = 0;
    let addedFolders = 0;

    if (legacyGlobal.commands.length || legacyGlobal.folders.length) {
      const globalData = this.getGlobalData();
      const cmdIds = new Set(globalData.commands.map(c => c.id));
      const folderIds = new Set(globalData.folders.map(f => f.id));
      for (const c of legacyGlobal.commands) {
        if (!cmdIds.has(c.id)) { globalData.commands.push(c); added++; }
      }
      for (const f of legacyGlobal.folders) {
        if (!folderIds.has(f.id)) { globalData.folders.push(f); addedFolders++; }
      }
      await this.saveGlobalData(globalData);
    }

    if (legacyWorkspace.commands.length || legacyWorkspace.folders.length) {
      const wsData = this.getWorkspaceData();
      const cmdIds = new Set(wsData.commands.map(c => c.id));
      const folderIds = new Set(wsData.folders.map(f => f.id));
      for (const c of legacyWorkspace.commands) {
        if (!cmdIds.has(c.id)) { wsData.commands.push(c); added++; }
      }
      for (const f of legacyWorkspace.folders) {
        if (!folderIds.has(f.id)) { wsData.folders.push(f); addedFolders++; }
      }
      await this.saveWorkspaceData(wsData);
    }

    return { commands: added, folders: addedFolders };
  }

  async importData(data: ExportData, mode: ImportMode): Promise<ImportSummary> {
    if (!data || typeof data !== 'object' || !data.global || !data.workspace) {
      throw new Error('Invalid backup file: missing global/workspace sections.');
    }

    if (mode === 'replace') {
      await this.saveGlobalData(data.global);
      await this.saveWorkspaceData(data.workspace);
      return {
        commands: data.global.commands.length + data.workspace.commands.length,
        folders: data.global.folders.length + data.workspace.folders.length,
      };
    }

    // Merge: regenerate ids to avoid collisions, remap folderId references.
    const folderIdMap = new Map<string, string>();

    const remapFolders = (folders: CmdFolder[]): CmdFolder[] =>
      folders.map(f => {
        const newId = generateId();
        folderIdMap.set(f.id, newId);
        const { _commandCount, ...rest } = f;
        return { ...rest, id: newId };
      });

    const remapCommands = (cmds: CmdEntry[]): CmdEntry[] =>
      cmds.map(c => ({
        ...c,
        id: generateId(),
        folderId: c.folderId ? folderIdMap.get(c.folderId) ?? undefined : undefined,
      }));

    const importedGlobalFolders = remapFolders(data.global.folders);
    const importedGlobalCommands = remapCommands(data.global.commands);
    const importedWsFolders = remapFolders(data.workspace.folders);
    const importedWsCommands = remapCommands(data.workspace.commands);

    const globalData = this.getGlobalData();
    globalData.folders.push(...importedGlobalFolders);
    globalData.commands.push(...importedGlobalCommands);

    const wsData = this.getWorkspaceData();
    wsData.folders.push(...importedWsFolders);
    wsData.commands.push(...importedWsCommands);

    await this.saveGlobalData(globalData);
    await this.saveWorkspaceData(wsData);

    return {
      commands: importedGlobalCommands.length + importedWsCommands.length,
      folders: importedGlobalFolders.length + importedWsFolders.length,
    };
  }

  async editFolder(folderId: string, label: string): Promise<void> {
    const globalData = this.getGlobalData();
    const gFolder = globalData.folders.find(f => f.id === folderId);
    if (gFolder) {
      gFolder.label = label;
      await this.saveGlobalData(globalData);
      return;
    }

    const wsData = this.getWorkspaceData();
    const wFolder = wsData.folders.find(f => f.id === folderId);
    if (wFolder) {
      wFolder.label = label;
      await this.saveWorkspaceData(wsData);
    }
  }
}
