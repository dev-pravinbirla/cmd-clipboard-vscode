import * as vscode from 'vscode';
import * as path from 'path';
import { CommandStore } from './store';
import { CmdEntry, CmdFolder, CommandScope } from './types';

export class CommandTreeItem extends vscode.TreeItem {
  constructor(
    public readonly cmdEntry?: CmdEntry,
    public readonly folder?: CmdFolder,
    public readonly isPinnedView?: boolean,
    public readonly projectGroup?: string, // projectPath for group headers
  ) {
    const label = cmdEntry?.label ?? folder?.label ?? (projectGroup ? path.basename(projectGroup) : '');
    const collapsible = (folder || projectGroup)
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;

    super(label, collapsible);

    // Set a unique id so VS Code can properly track tree items
    if (cmdEntry) {
      this.id = (isPinnedView ? 'pin-' : 'cmd-') + cmdEntry.id;
    } else if (folder) {
      this.id = 'folder-' + folder.id;
    } else if (projectGroup) {
      this.id = 'project-' + projectGroup;
    }

    if (cmdEntry) {
      // Build rich tooltip with markdown
      const tooltipMd = new vscode.MarkdownString();
      tooltipMd.appendCodeblock(cmdEntry.snippet, 'shellscript');
      if (cmdEntry.description) {
        tooltipMd.appendMarkdown(`\n\n${cmdEntry.description}`);
      }
      tooltipMd.appendMarkdown(`\n\n---\n*Scope: ${cmdEntry.scope}*`);
      if (cmdEntry.pinned) {
        tooltipMd.appendMarkdown(` · *Pinned*`);
      }
      this.tooltip = tooltipMd;

      // Show scope badge for pinned view, snippet otherwise
      const snippetPreview = cmdEntry.snippet.length > 50
        ? cmdEntry.snippet.substring(0, 50) + '...'
        : cmdEntry.snippet;

      if (isPinnedView) {
        this.description = `[${cmdEntry.scope}] ${snippetPreview}`;
      } else {
        this.description = snippetPreview;
      }

      this.contextValue = cmdEntry.pinned ? 'pinnedCommand' : 'command';
      this.iconPath = new vscode.ThemeIcon(
        cmdEntry.pinned ? 'pinned' : 'terminal',
        cmdEntry.pinned ? new vscode.ThemeColor('charts.yellow') : undefined
      );
      // Click/double-click copies the command
      this.command = {
        command: 'cmdClipboard.copyCommand',
        title: 'Copy Command',
        arguments: [this],
      };
    } else if (folder) {
      const cmdCount = folder._commandCount ?? 0;
      this.tooltip = new vscode.MarkdownString(`**Folder:** ${folder.label}\n\n${cmdCount} command${cmdCount !== 1 ? 's' : ''}`);
      this.description = `${cmdCount} cmd${cmdCount !== 1 ? 's' : ''}`;
      this.contextValue = 'folder';
      this.iconPath = new vscode.ThemeIcon('folder-opened', new vscode.ThemeColor('charts.blue'));
    } else if (projectGroup) {
      this.tooltip = projectGroup;
      this.description = projectGroup;
      this.contextValue = 'projectGroup';
      this.iconPath = new vscode.ThemeIcon('root-folder', new vscode.ThemeColor('charts.green'));
    }
  }
}

export class ScopedTreeProvider implements vscode.TreeDataProvider<CommandTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CommandTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private store: CommandStore,
    private scope: CommandScope,
    private getProjectPath: () => string | undefined
  ) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CommandTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandTreeItem): CommandTreeItem[] {
    const projectPath = this.getProjectPath();
    const commands = this.store.getCommands(this.scope, projectPath);
    const folders = this.store.getFolders(this.scope, projectPath);

    if (!element) {
      const folderItems = folders.map(f => {
        f._commandCount = commands.filter(c => c.folderId === f.id).length;
        return new CommandTreeItem(undefined, f);
      });
      const ungrouped = commands
        .filter(c => !c.folderId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(c => new CommandTreeItem(c));
      return [...folderItems, ...ungrouped];
    }

    if (element.folder) {
      return commands
        .filter(c => c.folderId === element.folder!.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(c => new CommandTreeItem(c));
    }

    return [];
  }
}

/**
 * Shows project commands grouped by project folder.
 * Root level: one node per project path (folder name shown, full path in description).
 * Under each project: its folders + ungrouped commands.
 */
export class ProjectTreeProvider implements vscode.TreeDataProvider<CommandTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CommandTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: CommandStore) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CommandTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandTreeItem): CommandTreeItem[] {
    if (!element) {
      const projectPaths = this.store.getProjectPaths();
      return projectPaths.map(p => new CommandTreeItem(undefined, undefined, undefined, p));
    }

    if (element.projectGroup) {
      const projectPath = element.projectGroup;
      const commands = this.store.getCommands('project', projectPath);
      const folders = this.store.getFolders('project', projectPath);

      const folderItems = folders.map(f => {
        f._commandCount = commands.filter(c => c.folderId === f.id).length;
        return new CommandTreeItem(undefined, f);
      });
      const ungrouped = commands
        .filter(c => !c.folderId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(c => new CommandTreeItem(c));
      return [...folderItems, ...ungrouped];
    }

    if (element.folder) {
      const projectPath = element.folder.projectPath;
      const commands = this.store.getCommands('project', projectPath);
      return commands
        .filter(c => c.folderId === element.folder!.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(c => new CommandTreeItem(c));
    }

    return [];
  }
}

export class PinnedTreeProvider implements vscode.TreeDataProvider<CommandTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CommandTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: CommandStore) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CommandTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): CommandTreeItem[] {
    return this.store
      .getPinnedCommands()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(c => new CommandTreeItem(c, undefined, true));
  }
}
