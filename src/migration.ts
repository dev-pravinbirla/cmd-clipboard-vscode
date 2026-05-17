import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { CmdEntry, CmdFolder } from './types';

/**
 * Legacy storage keys that may contain Command Clipboard data from older versions
 * published under different publisher ids. VS Code stores each extension's
 * Memento data under `<publisher>.<name>` in state.vscdb. When the publisher
 * field changed, the old entries became orphaned.
 */
const LEGACY_PUBLISHER_KEYS = ['pravinbirla.cmd-clipboard'];

export interface LegacyGlobalData {
  commands: CmdEntry[];
  folders: CmdFolder[];
}

export interface LegacyWorkspaceData {
  commands: CmdEntry[];
  folders: CmdFolder[];
}

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

function loadSqlJs(extensionPath: string): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: () =>
        path.join(extensionPath, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    });
  }
  return sqlJsPromise;
}

async function openDbReadonly(SQL: SqlJsStatic, dbPath: string): Promise<Database | undefined> {
  try {
    const buf = await fs.readFile(dbPath);
    return new SQL.Database(buf);
  } catch {
    return undefined;
  }
}

function readJsonValue(db: Database, key: string): any | undefined {
  try {
    const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = :k');
    stmt.bind({ ':k': key });
    let parsed: any | undefined;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      const raw = row.value;
      if (typeof raw === 'string') {
        parsed = JSON.parse(raw);
      }
    }
    stmt.free();
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Returns the location of VS Code's per-user data directory for the current
 * platform. We only support Code stable here — the migration is best-effort
 * and will silently no-op on flavours we can't locate.
 */
export function getVsCodeUserDir(): string | undefined {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User');
  }
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    return appdata ? path.join(appdata, 'Code', 'User') : undefined;
  }
  return path.join(home, '.config', 'Code', 'User');
}

/**
 * Look for orphaned global Command Clipboard data under any legacy publisher key.
 */
export async function discoverLegacyGlobal(extensionPath: string): Promise<LegacyGlobalData> {
  const empty: LegacyGlobalData = { commands: [], folders: [] };
  const userDir = getVsCodeUserDir();
  if (!userDir) { return empty; }

  const dbPath = path.join(userDir, 'globalStorage', 'state.vscdb');
  const SQL = await loadSqlJs(extensionPath);
  const db = await openDbReadonly(SQL, dbPath);
  if (!db) { return empty; }

  const out: LegacyGlobalData = { commands: [], folders: [] };
  try {
    for (const key of LEGACY_PUBLISHER_KEYS) {
      const value = readJsonValue(db, key);
      const data = value?.['cmdClipboard.globalData'];
      if (data?.commands) { out.commands.push(...data.commands); }
      if (data?.folders) {
        for (const f of data.folders as CmdFolder[]) {
          const { _commandCount, ...rest } = f;
          out.folders.push(rest as CmdFolder);
        }
      }
    }
  } finally {
    db.close();
  }
  return out;
}

/**
 * Look for orphaned workspace data in the SAME workspace's state.vscdb. We
 * intentionally don't touch other workspaces — those will auto-migrate when
 * the user opens them and the extension reactivates there.
 */
export async function discoverLegacyWorkspace(
  extensionPath: string,
  workspaceStateDbPath: string,
): Promise<LegacyWorkspaceData> {
  const empty: LegacyWorkspaceData = { commands: [], folders: [] };
  const SQL = await loadSqlJs(extensionPath);
  const db = await openDbReadonly(SQL, workspaceStateDbPath);
  if (!db) { return empty; }

  const out: LegacyWorkspaceData = { commands: [], folders: [] };
  try {
    for (const key of LEGACY_PUBLISHER_KEYS) {
      const value = readJsonValue(db, key);
      const data = value?.['cmdClipboard.workspaceData'];
      if (data?.commands) { out.commands.push(...data.commands); }
      if (data?.folders) {
        for (const f of data.folders as CmdFolder[]) {
          const { _commandCount, ...rest } = f;
          out.folders.push(rest as CmdFolder);
        }
      }
    }
  } finally {
    db.close();
  }
  return out;
}
