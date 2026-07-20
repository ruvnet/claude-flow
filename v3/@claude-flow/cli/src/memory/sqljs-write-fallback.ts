/**
 * Safe sql.js write fallback — full WASM-host functionality without the
 * corruption class.
 *
 * The 2026-07 incident was never "sql.js is unsafe"; it was a WAL-blind
 * whole-image writer replacing a database that concurrent NATIVE WAL
 * connections had open (fds stranded on the dead inode, the live -wal
 * filename-paired with the foreign image — sqlite.org/howtocorrupt.html
 * §2.4/§2.5). On a genuinely WASM-only host none of those conditions exist:
 * no native module, no WAL mode, no -wal/-shm sidecars, no foreign holders.
 * A blanket "native or refuse" policy therefore threw away legitimate
 * capability to prevent a hazard that cannot occur there.
 *
 * This module restores the capability behind an evidence-based gate:
 *
 *   ALLOW sql.js mutation  ⇔  the database is provably not native-ATTACHED:
 *     - no -wal / -shm sidecar exists at the path (their presence means a
 *       native WAL connection has committed data the main image alone may
 *       not contain — the one state a WAL-blind writer must never touch), and
 *     - no other process holds the db open (where the platform can tell us).
 *
 *   Otherwise the caller refuses with a typed, reasoned error — mutating an
 *   attached database from a WAL-blind engine is the exact incident
 *   mechanism and there is no lock both engines honor.
 *
 * The main-header WAL flag (bytes 18/19) is deliberately NOT a refusal
 * condition: sql.js itself sets it when a schema runs `PRAGMA
 * journal_mode=WAL`, and a WAL-mode database AT REST (checkpointed, no
 * sidecars, no holders) has its complete content in the main image — image
 * mutation of it is sound. The residual assess-then-write race (a native
 * writer attaching in the window) requires a mixed-engine host actively
 * racing the rare native-import-failure path, and cannot occur at all on the
 * WASM-only hosts this path serves.
 *
 * Concurrent sql.js writers (two hook fires on a WASM host) are serialized
 * with the existing advisory O_EXCL `<db>.lock` held across the WHOLE
 * read-modify-persist cycle, so read-modify-rename cycles cannot drop each
 * other's writes. The adapter exposes the better-sqlite3 API subset the
 * memory mutators use (prepare().run/get/all, exec, transaction, pragma,
 * close), so every mutator runs unchanged on either engine.
 */

import * as fs from 'fs';
import * as path from 'path';
import { writeFileRestricted } from '../fs-secure.js';
import { scanForeignDbHandles, describeForeignHandles } from './db-handle-guard.js';

export interface SqljsWriteSafety {
  safe: boolean;
  /** 'fresh-db' | 'unowned-at-rest' when safe; 'wal-sidecars' | 'live-holders' when not. */
  reason: string;
  detail?: string;
}

/**
 * Decide whether a WAL-blind whole-image mutation of `dbPath` can be safe.
 * Every condition is an observable fact about native attachment, not a guess.
 */
export function assessSqljsWriteSafety(dbPath: string): SqljsWriteSafety {
  if (!fs.existsSync(dbPath)) return { safe: true, reason: 'fresh-db' };

  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(`${dbPath}${s}`)) {
      return {
        safe: false,
        reason: 'wal-sidecars',
        detail: `${path.basename(dbPath)}${s} exists — a native WAL engine has touched this database`,
      };
    }
  }
  const scan = scanForeignDbHandles(dbPath);
  if (scan.supported && scan.handles.length > 0) {
    return {
      safe: false,
      reason: 'live-holders',
      detail: describeForeignHandles(scan.handles),
    };
  }
  return { safe: true, reason: 'unowned-at-rest' };
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

function acquireDbLock(dbPath: string): () => void {
  const lockFile = `${dbPath}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(lockFile); } catch { /* already gone */ } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        const st = fs.lstatSync(lockFile);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lockFile); continue; }
      } catch { /* raced — retry */ }
      if (Date.now() > deadline) throw new Error(`timed out acquiring memory.db lock: ${lockFile}`);
      // Synchronous spin is acceptable: WASM-host hook writers are short-lived.
      const until = Date.now() + 25;
      while (Date.now() < until) { /* wait */ }
    }
  }
}

/**
 * Open a sql.js-backed writer for `dbPath` exposing the better-sqlite3 API
 * subset the memory mutators use. Holds the advisory db lock for the whole
 * open→mutate→close cycle; `close()` persists the image via atomic
 * temp+rename and releases the lock. Refuses (typed) when the safety gate
 * says a native engine owns the database.
 */
export async function openSqljsWriteAdapter(dbPath: string): Promise<any> {
  const gate = assessSqljsWriteSafety(dbPath);
  if (!gate.safe) {
    const err = new Error(
      `refusing WAL-blind sql.js mutation of a native-owned database (${gate.reason}: ${gate.detail}). ` +
      `Install better-sqlite3 for native WAL mutation, or stop the native owners first.`,
    ) as Error & { code: string; reason: string };
    err.code = 'ERR_MEMORY_SQLJS_UNSAFE';
    err.reason = gate.reason;
    throw err;
  }

  const releaseLock = acquireDbLock(dbPath);
  let SQL: any;
  let db: any;
  try {
    const initSqlJs = (await import('sql.js')).default;
    SQL = await initSqlJs();
    db = fs.existsSync(dbPath)
      ? new SQL.Database(fs.readFileSync(dbPath))
      : new SQL.Database();
  } catch (e) {
    releaseLock();
    throw e;
  }

  let closed = false;
  const persist = () => {
    const data = db.export();
    writeFileRestricted(dbPath, Buffer.from(data), { encrypt: true });
  };

  const adapt = (sql: string) => ({
    run: (...params: unknown[]) => {
      db.run(sql, params.length ? params : undefined);
      return { changes: db.getRowsModified() };
    },
    get: (...params: unknown[]) => {
      const stmt = db.prepare(sql);
      try {
        if (params.length) stmt.bind(params);
        return stmt.step() ? stmt.getAsObject() : undefined;
      } finally {
        stmt.free();
      }
    },
    all: (...params: unknown[]) => {
      const stmt = db.prepare(sql);
      const rows: unknown[] = [];
      try {
        if (params.length) stmt.bind(params);
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
      }
    },
  });

  return {
    /** Marks the engine for callers/tests that need to know. */
    engine: 'sql.js' as const,
    prepare: adapt,
    exec: (sql: string) => { db.exec(sql); },
    pragma: (_p: string, _o?: unknown) => undefined, // journal/busy pragmas are native concerns
    transaction: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
      db.exec('BEGIN');
      try {
        const out = fn(...args);
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      try {
        persist();
        db.close();
      } finally {
        releaseLock();
      }
    },
  };
}
