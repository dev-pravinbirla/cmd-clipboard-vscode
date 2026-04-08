/**
 * Minimal VS Code API mock for unit testing.
 */

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };

  fire(data: T): void {
    this.listeners.forEach(l => l(data));
  }

  dispose(): void {
    this.listeners = [];
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label: string;
  collapsibleState: TreeItemCollapsibleState;
  id?: string;
  description?: string;
  tooltip?: string | MarkdownString;
  contextValue?: string;
  iconPath?: any;
  command?: any;

  constructor(label: string, collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: ThemeColor) {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class MarkdownString {
  value = '';

  appendCodeblock(code: string, language?: string): this {
    this.value += `\`\`\`${language ?? ''}\n${code}\n\`\`\`\n`;
    return this;
  }

  appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }
}

/**
 * Creates a mock Memento (globalState / workspaceState) backed by a plain object.
 */
export function createMockMemento(): any {
  const storage: Record<string, any> = {};
  return {
    get<T>(key: string, defaultValue?: T): T {
      return key in storage ? storage[key] : (defaultValue as T);
    },
    async update(key: string, value: any): Promise<void> {
      storage[key] = value;
    },
    /** Test helper: peek at raw storage */
    _storage: storage,
  };
}

export const window = {
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showQuickPick: jest.fn(),
  showInputBox: jest.fn(),
  createStatusBarItem: jest.fn(() => ({ show: jest.fn(), dispose: jest.fn() })),
  activeTerminal: undefined,
  createTerminal: jest.fn(() => ({ show: jest.fn(), sendText: jest.fn() })),
  registerTreeDataProvider: jest.fn(),
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export const env = {
  clipboard: {
    writeText: jest.fn(),
    readText: jest.fn(),
  },
};

export const workspace = {
  workspaceFolders: undefined as any,
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, path }),
};
