/**
 * Open AgentDB's native SQLite handle with this package's better-sqlite3.
 *
 * agentdb 3.0.0-alpha.x declares `better-sqlite3: ^11.8.1`, so npm gives it a
 * nested 11.x copy next to our 12.x one. better-sqlite3 11.x ships no prebuilt
 * binary for Node 24 (ABI 137), so on Node 24 that copy is compiled from
 * source against the local headers. Node 24.19+ headers carry a partial
 * backport of `node::ObjectWrap` cleanup hooks (nodejs/node#65446): a
 * Statement collected by an allocation-driven GC calls
 * RemoveEnvironmentCleanupHook() with no Environment and the process aborts
 * with `Assertion failed: (env) != nullptr` — exit 134 for the CLI, "Connection
 * closed" for the MCP server.
 *
 * The 12.x copy we depend on ships a Node 24 prebuild, so routing AgentDB's
 * handle through it keeps the source-built 11.x addon out of the process.
 * `overrides` cannot do this: npm ignores them in a dependency's package.json,
 * which is where ours sit for anyone installing ruflo.
 *
 * getHostSqliteDriver() is the single source of the constructor: the CLI's
 * shared-sqlite loader (#3693/#3883) resolves better-sqlite3 from this file's
 * location too, so every handle on memory.db shares one native copy.
 */
import { createRequire } from 'node:module';

type DbCtor = new (path: string, opts?: Record<string, unknown>) => { pragma(sql: string): unknown };

type AgentDBLike = {
  config?: { forceWasm?: boolean };
  usingWasm?: boolean;
  initializeDatabase?: (dbPath: string) => Promise<unknown>;
};

let hostDriver: DbCtor | null | undefined;

/** The better-sqlite3 constructor this package resolves, or null when it is not installed. */
export function getHostSqliteDriver(): DbCtor | null {
  if (hostDriver !== undefined) return hostDriver;
  try {
    const mod = createRequire(import.meta.url)('better-sqlite3');
    hostDriver = (mod?.default ?? mod) as DbCtor;
  } catch {
    hostDriver = null;
  }
  return hostDriver;
}

/**
 * Replace `agentdb.initializeDatabase` so `initialize()` opens the database
 * with getHostSqliteDriver(). Must be called before `agentdb.initialize()`.
 * Falls back to AgentDB's own loader when ours cannot open the file, and
 * leaves `forceWasm` instances alone. Returns whether the loader was replaced.
 */
export function useHostSqliteDriver(agentdb: AgentDBLike | null | undefined): boolean {
  if (!agentdb || typeof agentdb.initializeDatabase !== 'function') return false;
  if (agentdb.config?.forceWasm) return false;

  const agentdbLoader = agentdb.initializeDatabase.bind(agentdb);
  agentdb.initializeDatabase = async (dbPath: string) => {
    const Database = getHostSqliteDriver();
    if (!Database) return agentdbLoader(dbPath);
    let db: InstanceType<DbCtor>;
    try {
      db = new Database(dbPath);
    } catch {
      return agentdbLoader(dbPath);
    }
    // Same setup as AgentDB.initializeDatabase()'s native branch.
    db.pragma('journal_mode = WAL');
    agentdb.usingWasm = false;
    return db;
  };
  return true;
}
