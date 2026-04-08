export type CommandScope = 'global' | 'workspace' | 'project';

export interface CmdEntry {
  id: string;
  label: string;
  snippet: string;
  description?: string;
  folderId?: string;
  pinned: boolean;
  scope: CommandScope;
  projectPath?: string; // only for project-scoped commands
  createdAt: number;
}

export interface CmdFolder {
  id: string;
  label: string;
  scope: CommandScope;
  projectPath?: string;
  /** Transient field - not persisted, set by tree providers for display */
  _commandCount?: number;
}

export interface StoreData {
  commands: CmdEntry[];
  folders: CmdFolder[];
}
