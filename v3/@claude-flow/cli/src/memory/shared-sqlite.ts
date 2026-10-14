/**
 * #3693 — one better-sqlite3 identity per process.
 *
 * AgentDB (via @claude-flow/memory) owns a live native handle on memory.db. If
 * the CLI opens its own handle through a DIFFERENT installed copy of
 * better-sqlite3 (a nested `agentdb/node_modules/better-sqlite3` next to a
 * hoisted one is the common layout), the two copies each statically link their
 * own SQLite and keep separate per-process file bookkeeping. Closing the CLI's
 * handle (graph-edge idle release: wal_checkpoint(TRUNCATE) + close) then looks
 * like "last connection" to that copy and deletes the -wal/-shm sidecars out
 * from under AgentDB's still-open handle.
 *
 * Resolve the constructor from the same place AgentDB's handle is opened with,
 * so both share one SQLite instance (and its connection bookkeeping):
 *  - @claude-flow/memory >= 3.0.4 opens AgentDB with its own better-sqlite3
 *    (agentdb-native-driver.js, getHostSqliteDriver) to keep agentdb's nested
 *    11.x — compiled from source on Node 24, which aborts in Statement GC —
 *    out of the process. Resolve from memory's location then.
 *  - Older memory lets AgentDB load its own copy: resolve from agentdb.
 * Falls back to the CLI's own copy when neither can be resolved.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

type DbCtor = new (path: string, opts?: Record<string, unknown>) => any;

let cached: DbCtor | null | undefined;

/**
 * Entry file whose better-sqlite3 AgentDB's handle uses: @claude-flow/memory
 * when it routes AgentDB through its own driver, else agentdb.
 * Test seam: `memoryEntry` stands in for the resolved @claude-flow/memory entry.
 */
export function resolveSqliteOwnerEntry(memoryEntry?: string): string | null {
  const own = createRequire(import.meta.url);
  try {
    const entry = memoryEntry ?? own.resolve('@claude-flow/memory');
    if (existsSync(join(dirname(entry), 'agentdb-native-driver.js'))) return entry;
  } catch { /* memory not installed */ }
  try {
    return own.resolve('agentdb');
  } catch {
    return null;
  }
}

/** Test seam: pass `from` to resolve relative to another entry file. */
export function resolveAgentdbBetterSqlite3(from?: string): DbCtor | null {
  if (!from && cached !== undefined) return cached;
  let found: DbCtor | null = null;
  try {
    const ownerEntry = from ?? resolveSqliteOwnerEntry();
    if (ownerEntry) {
      const mod = createRequire(ownerEntry)('better-sqlite3');
      found = (mod?.default ?? mod) as DbCtor;
    }
  } catch {
    found = null;
  }
  if (!from) cached = found;
  return found;
}

/** Constructor shared with AgentDB when possible, else the CLI's own copy. */
export async function loadBetterSqlite3(): Promise<DbCtor> {
  const shared = resolveAgentdbBetterSqlite3();
  if (shared) return shared;
  const mod: string = 'better-sqlite3';
  return (await import(mod)).default as DbCtor;
}
