import { createMockMemento, TreeItemCollapsibleState } from './__mocks__/vscode';
import { CommandStore } from '../store';
import { CommandTreeItem, PinnedTreeProvider, ProjectTreeProvider, ScopedTreeProvider } from '../treeProvider';

function makeStore() {
  return new CommandStore(createMockMemento(), createMockMemento());
}

describe('CommandTreeItem', () => {
  describe('command item', () => {
    it('should render with terminal icon for unpinned command', () => {
      const item = new CommandTreeItem({
        id: '1', label: 'dev', snippet: 'npm run dev',
        pinned: false, scope: 'global', createdAt: 1,
      });

      expect(item.label).toBe('dev');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(item.contextValue).toBe('command');
      expect(item.iconPath).toBeDefined();
      expect((item.iconPath as any).id).toBe('terminal');
      expect(item.id).toBe('cmd-1');
    });

    it('should render with pinned icon for pinned command', () => {
      const item = new CommandTreeItem({
        id: '2', label: 'test', snippet: 'npm test',
        pinned: true, scope: 'global', createdAt: 1,
      });

      expect(item.contextValue).toBe('pinnedCommand');
      expect((item.iconPath as any).id).toBe('pinned');
    });

    it('should truncate long snippets in description', () => {
      const longSnippet = 'a'.repeat(100);
      const item = new CommandTreeItem({
        id: '3', label: 'long', snippet: longSnippet,
        pinned: false, scope: 'global', createdAt: 1,
      });

      expect((item.description as string).length).toBeLessThan(longSnippet.length);
      expect((item.description as string).endsWith('...')).toBe(true);
    });

    it('should show scope badge in pinned view', () => {
      const item = new CommandTreeItem(
        { id: '4', label: 'dev', snippet: 'npm run dev', pinned: true, scope: 'workspace', createdAt: 1 },
        undefined,
        true, // isPinnedView
      );

      expect((item.description as string)).toContain('[workspace]');
    });

    it('should NOT show scope badge in non-pinned view', () => {
      const item = new CommandTreeItem(
        { id: '5', label: 'dev', snippet: 'npm run dev', pinned: false, scope: 'global', createdAt: 1 },
        undefined,
        false,
      );

      expect((item.description as string)).not.toContain('[global]');
    });

    it('should set copy command as click handler', () => {
      const item = new CommandTreeItem({
        id: '6', label: 'dev', snippet: 'npm run dev',
        pinned: false, scope: 'global', createdAt: 1,
      });

      expect(item.command?.command).toBe('cmdClipboard.copyCommand');
    });
  });

  describe('folder item', () => {
    it('should render with folder icon and expanded state', () => {
      const item = new CommandTreeItem(undefined, {
        id: 'f1', label: 'Docker', scope: 'global',
      });

      expect(item.label).toBe('Docker');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
      expect(item.contextValue).toBe('folder');
      expect((item.iconPath as any).id).toBe('folder-opened');
      expect(item.id).toBe('folder-f1');
    });

    it('should show command count in description', () => {
      const item = new CommandTreeItem(undefined, {
        id: 'f2', label: 'Git', scope: 'global', _commandCount: 3,
      });

      expect(item.description).toBe('3 cmds');
    });

    it('should use singular "cmd" for count of 1', () => {
      const item = new CommandTreeItem(undefined, {
        id: 'f3', label: 'Git', scope: 'global', _commandCount: 1,
      });

      expect(item.description).toBe('1 cmd');
    });
  });

  describe('project group item', () => {
    it('should render with root-folder icon', () => {
      const item = new CommandTreeItem(undefined, undefined, undefined, '/my/project');

      expect(item.label).toBe('project');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
      expect(item.contextValue).toBe('projectGroup');
      expect((item.iconPath as any).id).toBe('root-folder');
      expect(item.id).toBe('project-/my/project');
    });
  });
});

describe('ScopedTreeProvider', () => {
  it('should return folders and ungrouped commands at root', async () => {
    const store = makeStore();
    const folder = await store.addFolder('Docker', 'global');
    await store.addCommand('grouped', 'x', 'global', folder.id);
    await store.addCommand('ungrouped', 'y', 'global');

    const provider = new ScopedTreeProvider(store, 'global', () => undefined);
    const root = provider.getChildren();

    // Should have: 1 folder + 1 ungrouped command
    expect(root).toHaveLength(2);
    expect(root[0].folder?.label).toBe('Docker');
    expect(root[1].cmdEntry?.label).toBe('ungrouped');
  });

  it('should return commands inside a folder', async () => {
    const store = makeStore();
    const folder = await store.addFolder('Docker', 'global');
    await store.addCommand('up', 'docker up', 'global', folder.id);
    await store.addCommand('down', 'docker down', 'global', folder.id);

    const provider = new ScopedTreeProvider(store, 'global', () => undefined);
    const root = provider.getChildren();
    const folderItem = root.find(r => r.folder)!;
    const children = provider.getChildren(folderItem);

    expect(children).toHaveLength(2);
    expect(children.every(c => c.cmdEntry !== undefined)).toBe(true);
  });

  it('should return empty array when no commands exist', () => {
    const store = makeStore();
    const provider = new ScopedTreeProvider(store, 'global', () => undefined);

    expect(provider.getChildren()).toEqual([]);
  });

  it('should sort ungrouped commands by createdAt', async () => {
    const store = makeStore();
    // Add in reverse order - "b" first, then "a"
    const b = await store.addCommand('b', 'b', 'global');
    const a = await store.addCommand('a', 'a', 'global');

    const provider = new ScopedTreeProvider(store, 'global', () => undefined);
    const root = provider.getChildren();

    // "b" was created first, so it should appear first
    expect(root[0].cmdEntry?.label).toBe('b');
    expect(root[1].cmdEntry?.label).toBe('a');
  });

  it('should populate _commandCount on folder items', async () => {
    const store = makeStore();
    const folder = await store.addFolder('Docker', 'global');
    await store.addCommand('up', 'up', 'global', folder.id);
    await store.addCommand('down', 'down', 'global', folder.id);

    const provider = new ScopedTreeProvider(store, 'global', () => undefined);
    const root = provider.getChildren();
    const folderItem = root.find(r => r.folder)!;

    expect(folderItem.folder!._commandCount).toBe(2);
  });

  it('should refresh when store changes', async () => {
    const store = makeStore();
    const provider = new ScopedTreeProvider(store, 'global', () => undefined);

    const listener = jest.fn();
    provider.onDidChangeTreeData(listener);

    await store.addCommand('x', 'x', 'global');

    expect(listener).toHaveBeenCalled();
  });
});

describe('PinnedTreeProvider', () => {
  it('should return only pinned commands', async () => {
    const store = makeStore();
    const pinned = await store.addCommand('pinned', 'p', 'global');
    await store.addCommand('not-pinned', 'np', 'global');
    await store.togglePin(pinned.id);

    const provider = new PinnedTreeProvider(store);
    const items = provider.getChildren();

    expect(items).toHaveLength(1);
    expect(items[0].cmdEntry?.label).toBe('pinned');
    expect(items[0].isPinnedView).toBe(true);
  });

  it('should return pinned commands from all scopes', async () => {
    const store = makeStore();
    const g = await store.addCommand('global', 'g', 'global');
    const w = await store.addCommand('workspace', 'w', 'workspace');
    await store.togglePin(g.id);
    await store.togglePin(w.id);

    const provider = new PinnedTreeProvider(store);
    const items = provider.getChildren();

    expect(items).toHaveLength(2);
  });

  it('should return empty array when nothing is pinned', () => {
    const store = makeStore();
    const provider = new PinnedTreeProvider(store);

    expect(provider.getChildren()).toEqual([]);
  });

  it('should sort by createdAt', async () => {
    const store = makeStore();
    const first = await store.addCommand('first', 'f', 'global');
    const second = await store.addCommand('second', 's', 'global');
    await store.togglePin(second.id);
    await store.togglePin(first.id);

    const provider = new PinnedTreeProvider(store);
    const items = provider.getChildren();

    expect(items[0].cmdEntry?.label).toBe('first');
    expect(items[1].cmdEntry?.label).toBe('second');
  });
});

describe('ProjectTreeProvider', () => {
  it('should return project paths as root items', async () => {
    const store = makeStore();
    await store.addCommand('a', 'a', 'project', undefined, '/proj-a');
    await store.addCommand('b', 'b', 'project', undefined, '/proj-b');

    const provider = new ProjectTreeProvider(store);
    const root = provider.getChildren();

    expect(root).toHaveLength(2);
    expect(root.every(r => r.projectGroup !== undefined)).toBe(true);
  });

  it('should return folders and commands under a project group', async () => {
    const store = makeStore();
    const folder = await store.addFolder('Build', 'project', '/proj');
    await store.addCommand('grouped', 'x', 'project', folder.id, '/proj');
    await store.addCommand('ungrouped', 'y', 'project', undefined, '/proj');

    const provider = new ProjectTreeProvider(store);
    const root = provider.getChildren();
    const projectItem = root[0];
    const children = provider.getChildren(projectItem);

    // 1 folder + 1 ungrouped command
    expect(children).toHaveLength(2);
  });

  it('should return commands inside a project folder', async () => {
    const store = makeStore();
    const folder = await store.addFolder('Build', 'project', '/proj');
    await store.addCommand('cmd1', 'x', 'project', folder.id, '/proj');

    const provider = new ProjectTreeProvider(store);
    const root = provider.getChildren();
    const projectItem = root[0];
    const projectChildren = provider.getChildren(projectItem);
    const folderItem = projectChildren.find(c => c.folder)!;
    const folderChildren = provider.getChildren(folderItem);

    expect(folderChildren).toHaveLength(1);
    expect(folderChildren[0].cmdEntry?.label).toBe('cmd1');
  });

  it('should return empty array when no project commands', () => {
    const store = makeStore();
    const provider = new ProjectTreeProvider(store);

    expect(provider.getChildren()).toEqual([]);
  });

  it('should populate _commandCount on project folder items', async () => {
    const store = makeStore();
    const folder = await store.addFolder('Build', 'project', '/proj');
    await store.addCommand('a', 'a', 'project', folder.id, '/proj');
    await store.addCommand('b', 'b', 'project', folder.id, '/proj');

    const provider = new ProjectTreeProvider(store);
    const root = provider.getChildren();
    const children = provider.getChildren(root[0]);
    const folderItem = children.find(c => c.folder)!;

    expect(folderItem.folder!._commandCount).toBe(2);
  });
});
