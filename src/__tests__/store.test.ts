import { createMockMemento } from './__mocks__/vscode';
import { CommandStore } from '../store';
import { CmdEntry, CmdFolder } from '../types';

function makeStore() {
  const globalState = createMockMemento();
  const workspaceState = createMockMemento();
  const store = new CommandStore(globalState, workspaceState);
  return { store, globalState, workspaceState };
}

describe('CommandStore', () => {
  // ─── addCommand ───────────────────────────────────────────────

  describe('addCommand', () => {
    it('should add a global command', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('dev', 'npm run dev', 'global');

      expect(cmd.id).toBeDefined();
      expect(cmd.label).toBe('dev');
      expect(cmd.snippet).toBe('npm run dev');
      expect(cmd.scope).toBe('global');
      expect(cmd.pinned).toBe(false);
      expect(cmd.createdAt).toBeGreaterThan(0);
    });

    it('should add a workspace command', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('build', 'npm run build', 'workspace');

      expect(cmd.scope).toBe('workspace');
      const commands = store.getCommands('workspace');
      expect(commands).toHaveLength(1);
      expect(commands[0].label).toBe('build');
    });

    it('should add a project command with projectPath', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('test', 'npm test', 'project', undefined, '/my/project');

      expect(cmd.scope).toBe('project');
      expect(cmd.projectPath).toBe('/my/project');
      const commands = store.getCommands('project', '/my/project');
      expect(commands).toHaveLength(1);
    });

    it('should add command with description and folderId', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Docker', 'global');
      const cmd = await store.addCommand('up', 'docker compose up', 'global', folder.id, undefined, 'Start containers');

      expect(cmd.folderId).toBe(folder.id);
      expect(cmd.description).toBe('Start containers');
    });

    it('should not set projectPath for non-project scope', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('test', 'npm test', 'global', undefined, '/some/path');

      expect(cmd.projectPath).toBeUndefined();
    });

    it('should generate unique IDs for multiple commands', async () => {
      const { store } = makeStore();
      const cmd1 = await store.addCommand('a', 'a', 'global');
      const cmd2 = await store.addCommand('b', 'b', 'global');

      expect(cmd1.id).not.toBe(cmd2.id);
    });
  });

  // ─── getCommands ──────────────────────────────────────────────

  describe('getCommands', () => {
    it('should return only commands for the requested scope', async () => {
      const { store } = makeStore();
      await store.addCommand('g1', 'g1', 'global');
      await store.addCommand('w1', 'w1', 'workspace');
      await store.addCommand('p1', 'p1', 'project', undefined, '/proj');

      expect(store.getCommands('global')).toHaveLength(1);
      expect(store.getCommands('workspace')).toHaveLength(1);
      expect(store.getCommands('project', '/proj')).toHaveLength(1);
    });

    it('should filter project commands by projectPath', async () => {
      const { store } = makeStore();
      await store.addCommand('a', 'a', 'project', undefined, '/proj-a');
      await store.addCommand('b', 'b', 'project', undefined, '/proj-b');

      expect(store.getCommands('project', '/proj-a')).toHaveLength(1);
      expect(store.getCommands('project', '/proj-b')).toHaveLength(1);
      expect(store.getCommands('project', '/proj-c')).toHaveLength(0);
    });

    it('should return empty array when no commands exist', () => {
      const { store } = makeStore();
      expect(store.getCommands('global')).toEqual([]);
      expect(store.getCommands('workspace')).toEqual([]);
      expect(store.getCommands('project', '/x')).toEqual([]);
    });
  });

  // ─── getAllCommands ───────────────────────────────────────────

  describe('getAllCommands', () => {
    it('should return commands from all scopes', async () => {
      const { store } = makeStore();
      await store.addCommand('g', 'g', 'global');
      await store.addCommand('w', 'w', 'workspace');
      await store.addCommand('p', 'p', 'project', undefined, '/proj');

      const all = store.getAllCommands();
      expect(all).toHaveLength(3);
    });
  });

  // ─── addFolder ────────────────────────────────────────────────

  describe('addFolder', () => {
    it('should add a global folder', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Docker', 'global');

      expect(folder.id).toBeDefined();
      expect(folder.label).toBe('Docker');
      expect(folder.scope).toBe('global');
    });

    it('should add a project folder with projectPath', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Build', 'project', '/my/proj');

      expect(folder.projectPath).toBe('/my/proj');
    });

    it('should not set projectPath for non-project scope', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Git', 'workspace', '/some/path');

      expect(folder.projectPath).toBeUndefined();
    });
  });

  // ─── getFolders ───────────────────────────────────────────────

  describe('getFolders', () => {
    it('should return folders filtered by scope', async () => {
      const { store } = makeStore();
      await store.addFolder('G', 'global');
      await store.addFolder('W', 'workspace');

      expect(store.getFolders('global')).toHaveLength(1);
      expect(store.getFolders('workspace')).toHaveLength(1);
    });

    it('should filter project folders by projectPath', async () => {
      const { store } = makeStore();
      await store.addFolder('A', 'project', '/a');
      await store.addFolder('B', 'project', '/b');

      expect(store.getFolders('project', '/a')).toHaveLength(1);
      expect(store.getFolders('project', '/a')[0].label).toBe('A');
    });
  });

  // ─── togglePin ────────────────────────────────────────────────

  describe('togglePin', () => {
    it('should pin an unpinned global command', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('dev', 'npm run dev', 'global');
      expect(cmd.pinned).toBe(false);

      await store.togglePin(cmd.id);

      const updated = store.getCommands('global').find(c => c.id === cmd.id)!;
      expect(updated.pinned).toBe(true);
    });

    it('should unpin a pinned command', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('dev', 'npm run dev', 'global');

      await store.togglePin(cmd.id);
      await store.togglePin(cmd.id);

      const updated = store.getCommands('global').find(c => c.id === cmd.id)!;
      expect(updated.pinned).toBe(false);
    });

    it('should toggle pin on workspace commands', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('test', 'npm test', 'workspace');

      await store.togglePin(cmd.id);

      const updated = store.getCommands('workspace').find(c => c.id === cmd.id)!;
      expect(updated.pinned).toBe(true);
    });
  });

  // ─── getPinnedCommands ────────────────────────────────────────

  describe('getPinnedCommands', () => {
    it('should return pinned commands from all scopes', async () => {
      const { store } = makeStore();
      const g = await store.addCommand('g', 'g', 'global');
      const w = await store.addCommand('w', 'w', 'workspace');
      await store.addCommand('unpinned', 'x', 'global');

      await store.togglePin(g.id);
      await store.togglePin(w.id);

      const pinned = store.getPinnedCommands();
      expect(pinned).toHaveLength(2);
      expect(pinned.map(c => c.label).sort()).toEqual(['g', 'w']);
    });

    it('should return empty array when nothing is pinned', () => {
      const { store } = makeStore();
      expect(store.getPinnedCommands()).toEqual([]);
    });
  });

  // ─── editCommand ──────────────────────────────────────────────

  describe('editCommand', () => {
    it('should update label, snippet, and description of global command', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('old', 'old-cmd', 'global', undefined, undefined, 'old desc');

      await store.editCommand(cmd.id, 'new', 'new-cmd', 'new desc');

      const updated = store.getCommands('global').find(c => c.id === cmd.id)!;
      expect(updated.label).toBe('new');
      expect(updated.snippet).toBe('new-cmd');
      expect(updated.description).toBe('new desc');
    });

    it('should update workspace command', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('old', 'old', 'workspace');

      await store.editCommand(cmd.id, 'new', 'new');

      const updated = store.getCommands('workspace').find(c => c.id === cmd.id)!;
      expect(updated.label).toBe('new');
    });

    it('should clear description when set to undefined', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('test', 'test', 'global', undefined, undefined, 'has desc');

      await store.editCommand(cmd.id, 'test', 'test', undefined);

      const updated = store.getCommands('global').find(c => c.id === cmd.id)!;
      expect(updated.description).toBeUndefined();
    });

    it('should be a no-op for non-existent command ID', async () => {
      const { store } = makeStore();
      await store.addCommand('x', 'x', 'global');

      // Should not throw
      await store.editCommand('non-existent-id', 'y', 'y');

      expect(store.getCommands('global')[0].label).toBe('x');
    });
  });

  // ─── deleteCommand ────────────────────────────────────────────

  describe('deleteCommand', () => {
    it('should delete a global command', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('del', 'del', 'global');

      await store.deleteCommand(cmd.id);

      expect(store.getCommands('global')).toHaveLength(0);
    });

    it('should delete a workspace command', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('del', 'del', 'workspace');

      await store.deleteCommand(cmd.id);

      expect(store.getCommands('workspace')).toHaveLength(0);
    });

    it('should not affect other commands when deleting', async () => {
      const { store } = makeStore();
      const cmd1 = await store.addCommand('keep', 'keep', 'global');
      const cmd2 = await store.addCommand('delete', 'delete', 'global');

      await store.deleteCommand(cmd2.id);

      const remaining = store.getCommands('global');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(cmd1.id);
    });

    it('should be a no-op for non-existent command ID', async () => {
      const { store } = makeStore();
      await store.addCommand('x', 'x', 'global');

      await store.deleteCommand('non-existent');

      expect(store.getCommands('global')).toHaveLength(1);
    });
  });

  // ─── deleteFolder ─────────────────────────────────────────────

  describe('deleteFolder', () => {
    it('should delete a global folder', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Docker', 'global');

      await store.deleteFolder(folder.id);

      expect(store.getFolders('global')).toHaveLength(0);
    });

    it('should ungroup commands when folder is deleted', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Docker', 'global');
      await store.addCommand('up', 'docker up', 'global', folder.id);

      await store.deleteFolder(folder.id);

      const cmds = store.getCommands('global');
      expect(cmds).toHaveLength(1);
      expect(cmds[0].folderId).toBeUndefined();
    });

    it('should delete workspace folder and ungroup its commands', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Git', 'workspace');
      await store.addCommand('status', 'git status', 'workspace', folder.id);

      await store.deleteFolder(folder.id);

      expect(store.getFolders('workspace')).toHaveLength(0);
      expect(store.getCommands('workspace')[0].folderId).toBeUndefined();
    });

    it('should not ungroup commands from other folders', async () => {
      const { store } = makeStore();
      const folder1 = await store.addFolder('A', 'global');
      const folder2 = await store.addFolder('B', 'global');
      await store.addCommand('in-a', 'a', 'global', folder1.id);
      await store.addCommand('in-b', 'b', 'global', folder2.id);

      await store.deleteFolder(folder1.id);

      const cmds = store.getCommands('global');
      const inB = cmds.find(c => c.label === 'in-b')!;
      expect(inB.folderId).toBe(folder2.id);
    });
  });

  // ─── moveToFolder ─────────────────────────────────────────────

  describe('moveToFolder', () => {
    it('should move a global command into a folder', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Docker', 'global');
      const cmd = await store.addCommand('up', 'docker up', 'global');

      await store.moveToFolder(cmd.id, folder.id);

      const updated = store.getCommands('global').find(c => c.id === cmd.id)!;
      expect(updated.folderId).toBe(folder.id);
    });

    it('should move a command to root (undefined folderId)', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Docker', 'global');
      const cmd = await store.addCommand('up', 'docker up', 'global', folder.id);

      await store.moveToFolder(cmd.id, undefined);

      const updated = store.getCommands('global').find(c => c.id === cmd.id)!;
      expect(updated.folderId).toBeUndefined();
    });

    it('should move workspace command between folders', async () => {
      const { store } = makeStore();
      const f1 = await store.addFolder('A', 'workspace');
      const f2 = await store.addFolder('B', 'workspace');
      const cmd = await store.addCommand('x', 'x', 'workspace', f1.id);

      await store.moveToFolder(cmd.id, f2.id);

      const updated = store.getCommands('workspace').find(c => c.id === cmd.id)!;
      expect(updated.folderId).toBe(f2.id);
    });
  });

  // ─── editFolder ───────────────────────────────────────────────

  describe('editFolder', () => {
    it('should rename a global folder', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Old Name', 'global');

      await store.editFolder(folder.id, 'New Name');

      const updated = store.getFolders('global').find(f => f.id === folder.id)!;
      expect(updated.label).toBe('New Name');
    });

    it('should rename a workspace folder', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Old', 'workspace');

      await store.editFolder(folder.id, 'New');

      const updated = store.getFolders('workspace').find(f => f.id === folder.id)!;
      expect(updated.label).toBe('New');
    });

    it('should be a no-op for non-existent folder ID', async () => {
      const { store } = makeStore();
      await store.addFolder('Keep', 'global');

      await store.editFolder('non-existent', 'Changed');

      expect(store.getFolders('global')[0].label).toBe('Keep');
    });
  });

  // ─── findCommand / findFolder ─────────────────────────────────

  describe('findCommand', () => {
    it('should find a global command by ID', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('find-me', 'x', 'global');

      expect(store.findCommand(cmd.id)?.label).toBe('find-me');
    });

    it('should find a workspace command by ID', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('find-me', 'x', 'workspace');

      expect(store.findCommand(cmd.id)?.label).toBe('find-me');
    });

    it('should return undefined for non-existent ID', () => {
      const { store } = makeStore();
      expect(store.findCommand('nope')).toBeUndefined();
    });
  });

  describe('findFolder', () => {
    it('should find a global folder by ID', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Find Me', 'global');

      expect(store.findFolder(folder.id)?.label).toBe('Find Me');
    });

    it('should find a workspace folder by ID', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('Find Me', 'workspace');

      expect(store.findFolder(folder.id)?.label).toBe('Find Me');
    });

    it('should return undefined for non-existent ID', () => {
      const { store } = makeStore();
      expect(store.findFolder('nope')).toBeUndefined();
    });
  });

  // ─── getProjectPaths ──────────────────────────────────────────

  describe('getProjectPaths', () => {
    it('should return unique sorted project paths', async () => {
      const { store } = makeStore();
      await store.addCommand('a', 'a', 'project', undefined, '/z-proj');
      await store.addCommand('b', 'b', 'project', undefined, '/a-proj');
      await store.addFolder('F', 'project', '/a-proj');

      const paths = store.getProjectPaths();
      expect(paths).toEqual(['/a-proj', '/z-proj']);
    });

    it('should return empty array when no project commands exist', () => {
      const { store } = makeStore();
      expect(store.getProjectPaths()).toEqual([]);
    });
  });

  // ─── onDidChange event ────────────────────────────────────────

  describe('onDidChange', () => {
    it('should fire when a command is added', async () => {
      const { store } = makeStore();
      const listener = jest.fn();
      store.onDidChange(listener);

      await store.addCommand('x', 'x', 'global');

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should fire when a command is deleted', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('x', 'x', 'global');
      const listener = jest.fn();
      store.onDidChange(listener);

      await store.deleteCommand(cmd.id);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should fire when a command is edited', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('x', 'x', 'global');
      const listener = jest.fn();
      store.onDidChange(listener);

      await store.editCommand(cmd.id, 'y', 'y');

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should fire when pin is toggled', async () => {
      const { store } = makeStore();
      const cmd = await store.addCommand('x', 'x', 'global');
      const listener = jest.fn();
      store.onDidChange(listener);

      await store.togglePin(cmd.id);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should fire when command is moved to folder', async () => {
      const { store } = makeStore();
      const folder = await store.addFolder('F', 'global');
      const cmd = await store.addCommand('x', 'x', 'global');
      const listener = jest.fn();
      store.onDidChange(listener);

      await store.moveToFolder(cmd.id, folder.id);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
