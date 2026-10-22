/**
 * #3508: read-only memory route/peek.
 *
 * A health check needs to know which memory store files a cwd resolves to,
 * and what is in them, without changing anything to find out. `memory stats`
 * (even after #3463/#3448) still calls `ensureInitialized()` when no explicit
 * path is given, and answers for one file per call. This module reports
 * BOTH files — the sql.js `memory.db` the CLI writes and its native
 * `agentdb-memory.db` sibling the MCP/bridge path writes — in one read-only
 * pass, and says which resolution rule picked the root.
 *
 * Contract (do not relax without re-reading #3508):
 *   - never creates, initializes, or migrates anything;
 *   - never opens a file that does not exist (`existsSync` gated before any
 *     open attempt, for both engines);
 *   - every open is `readonly`/`fileMustExist` (native) or a one-shot byte
 *     buffer handed to sql.js, which is never written back to disk;
 *   - `rows: null` means "could not read" and is never a count of 0, so an
 *     empty store and an unreadable one never look the same;
 *   - an encrypted-at-rest `memory.db` reports `encrypted: true` and
 *     `rows: null`, but its size is still reported.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { getMemoryRoot, resolveDbPath } from './memory-initializer.js';
import { siblingAgentDbPath } from './memory-bridge.js';
import { isEncryptedBlob } from '../encryption/vault.js';

export type MemoryRootSource =
  | 'path'
  | 'CLAUDE_FLOW_DB_PATH'
  | 'CLAUDE_FLOW_MEMORY_PATH'
  | 'config'
  | 'default';

export interface MemoryPeekStore {
  role: 'cli' | 'mcp';
  path: string;
  exists: boolean;
  rows: number | null;
  lastWrite: string | null;
  sizeBytes: number | null;
  walBytes: number | null;
  encrypted?: boolean;
}

export interface MemoryPeekResult {
  cwd: string;
  root: { path: string; source: MemoryRootSource };
  stores: MemoryPeekStore[];
  sharedKeys: number | null;
}

// Mirrors the `ACTIVE_MEMORY_ROW_SQL` convention in memory-initializer.ts:
// legacy rows with a NULL status predate soft-delete semantics and count.
const ACTIVE_ROW_SQL = `(status = 'active' OR status IS NULL)`;
const ENCRYPTION_SNIFF_LEN = 64; // RFE1 magic(4)+iv(12)+tag(16); 64 gives headroom.

interface StoreProbe {
  rows: number | null;
  lastWrite: string | null;
  keys: Set<string> | null;
  encrypted?: boolean;
}

function safeStatSize(filePath: string): number | null {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

function readHeaderBytes(filePath: string, len: number): Buffer {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    const bytesRead = readSync(fd, buf, 0, len, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function latestMillis(values: Array<number | string | null | undefined>): number {
  let latest = -Infinity;
  for (const raw of values) {
    const millis = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(millis)) latest = Math.max(latest, millis);
  }
  return latest;
}

/** sql.js is read as a one-shot in-memory byte buffer — nothing is ever
 * written back, so reading this file has no on-disk side effect. */
async function probeSqlJsStore(dbPath: string): Promise<StoreProbe> {
  try {
    if (isEncryptedBlob(readHeaderBytes(dbPath, ENCRYPTION_SNIFF_LEN))) {
      return { rows: null, lastWrite: null, keys: null, encrypted: true };
    }
  } catch {
    /* header read failed (permissions/race) — fall through to the open attempt */
  }
  try {
    const initSqlJs: any = (await import('sql.js')).default ?? (await import('sql.js'));
    const SQL = await (typeof initSqlJs === 'function' ? initSqlJs() : initSqlJs.default());
    const buf = readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(buf));
    try {
      const tables = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entries'",
      );
      if (!tables.length) return { rows: null, lastWrite: null, keys: null };
      const result = db.exec(
        `SELECT namespace, key, created_at, updated_at FROM memory_entries WHERE ${ACTIVE_ROW_SQL}`,
      );
      const values: any[][] = result[0]?.values ?? [];
      const keys = new Set<string>();
      let last = -Infinity;
      for (const [namespace, key, createdAt, updatedAt] of values) {
        keys.add(`${String(namespace)}\u0000${String(key)}`);
        last = Math.max(last, latestMillis([createdAt, updatedAt]));
      }
      return {
        rows: values.length,
        lastWrite: Number.isFinite(last) ? new Date(last).toISOString() : null,
        keys,
      };
    } finally {
      try { db.close(); } catch { /* best effort */ }
    }
  } catch {
    return { rows: null, lastWrite: null, keys: null };
  }
}

/** better-sqlite3 is an optional native dependency — absence must degrade
 * to "could not read", never throw. Opened `readonly`/`fileMustExist`, same
 * as `countSiblingStoreRows` in sibling-store.ts. */
async function probeNativeStore(dbPath: string): Promise<StoreProbe> {
  try {
    const require = (await import('node:module')).createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entries'")
        .get();
      if (!table) return { rows: null, lastWrite: null, keys: null };
      const rows = db
        .prepare(`SELECT namespace, key, created_at, updated_at FROM memory_entries WHERE ${ACTIVE_ROW_SQL}`)
        .all() as Array<{ namespace: unknown; key: unknown; created_at: unknown; updated_at: unknown }>;
      const keys = new Set<string>();
      let last = -Infinity;
      for (const row of rows) {
        keys.add(`${String(row.namespace)}\u0000${String(row.key)}`);
        last = Math.max(last, latestMillis([row.created_at as number, row.updated_at as number]));
      }
      return {
        rows: rows.length,
        lastWrite: Number.isFinite(last) ? new Date(last).toISOString() : null,
        keys,
      };
    } finally {
      try { db.close(); } catch { /* best effort */ }
    }
  } catch {
    return { rows: null, lastWrite: null, keys: null };
  }
}

/** Same precedence `getMemoryRoot()`/`resolveDbPath()` already own — this
 * only *labels* which rule decided, it never re-derives the path itself. */
function decideSource(cliFlag?: string): MemoryRootSource {
  if (cliFlag && cliFlag.trim().length > 0) return 'path';
  if (process.env.CLAUDE_FLOW_DB_PATH && process.env.CLAUDE_FLOW_DB_PATH.trim().length > 0) {
    return 'CLAUDE_FLOW_DB_PATH';
  }
  if (process.env.CLAUDE_FLOW_MEMORY_PATH && process.env.CLAUDE_FLOW_MEMORY_PATH.trim().length > 0) {
    return 'CLAUDE_FLOW_MEMORY_PATH';
  }
  const configCandidates = [
    path.resolve(process.cwd(), 'claude-flow.config.json'),
    path.resolve(process.cwd(), '.claude-flow', 'config.json'),
  ];
  for (const configPath of configCandidates) {
    if (!existsSync(configPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      const fromConfig: unknown = raw?.memory?.persistPath ?? raw?.memory?.path;
      if (typeof fromConfig === 'string' && fromConfig.trim().length > 0) return 'config';
    } catch {
      /* malformed config — getMemoryRoot() falls through to default too */
    }
  }
  return 'default';
}

async function describeStore(
  role: 'cli' | 'mcp',
  storePath: string,
  probe: (p: string) => Promise<StoreProbe>,
): Promise<{ store: MemoryPeekStore; keys: Set<string> | null }> {
  if (!existsSync(storePath)) {
    return {
      store: { role, path: storePath, exists: false, rows: null, lastWrite: null, sizeBytes: null, walBytes: null },
      keys: null,
    };
  }
  const result = await probe(storePath);
  const sizeBytes = safeStatSize(storePath);
  const walBytes = safeStatSize(`${storePath}-wal`) ?? 0;
  return {
    store: {
      role,
      path: storePath,
      exists: true,
      rows: result.rows,
      lastWrite: result.lastWrite,
      sizeBytes,
      walBytes,
      ...(result.encrypted ? { encrypted: true } : {}),
    },
    keys: result.keys,
  };
}

/**
 * Resolve the route and report both stores, read-only. Never creates,
 * initializes, or migrates anything, on an empty project or any other.
 */
export async function memoryPeek(opts?: { path?: string }): Promise<MemoryPeekResult> {
  const cliFlag = opts?.path;
  const cliPath = resolveDbPath(cliFlag);
  const mcpPath = siblingAgentDbPath(cliPath);
  const root = { path: cliFlag ? path.dirname(cliPath) : getMemoryRoot(), source: decideSource(cliFlag) };

  const cliDescribed = await describeStore('cli', cliPath, probeSqlJsStore);
  const stores: MemoryPeekStore[] = [cliDescribed.store];
  let mcpKeys: Set<string> | null = null;

  if (mcpPath) {
    const mcpDescribed = await describeStore('mcp', mcpPath, probeNativeStore);
    stores.push(mcpDescribed.store);
    mcpKeys = mcpDescribed.keys;
  }

  const cliKeys = cliDescribed.keys;
  const sharedKeys = cliKeys && mcpKeys
    ? [...cliKeys].filter((key) => mcpKeys!.has(key)).length
    : null;

  return { cwd: process.cwd(), root, stores, sharedKeys };
}
