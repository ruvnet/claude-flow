/**
 * Vector-memory DB backup.
 *
 * Snapshots `.swarm/memory.db` (the sqlite store holding memory_entries +
 * embeddings + the distilled reasoning_patterns) to a timestamped file using
 * better-sqlite3's ONLINE backup API — a consistent, WAL-safe copy that does not
 * block or corrupt a concurrently-written DB (unlike a naive file copy of a
 * WAL-mode DB). Rotates to keep the last N snapshots and, optionally, uploads
 * offsite to Google Cloud Storage.
 *
 * Used by `memory backup` (manual) and the daemon's nightly `backup` worker.
 * Best-effort + non-destructive: it only reads the source DB and writes new
 * files; it never mutates or deletes the live memory DB.
 */
import * as fs from 'fs';
import * as path from 'path';
import { existingFileIsEncrypted, readFileMaybeEncrypted } from '../fs-secure.js';
import { loadBetterSqlite3 } from '../memory/shared-sqlite.js';
import { resolveMemoryRoot } from '../memory/memory-root.js';

export interface BackupOptions {
  /** Source DB (default: <cwd>/.swarm/memory.db). */
  dbPath?: string;
  /** Destination dir (default: <db dir>/backups). */
  destDir?: string;
  /** Rotation: keep the newest N snapshots (default 7 = a week of nightlies). */
  keep?: number;
  /** Optional offsite: a gs://bucket/prefix to also upload the snapshot to. */
  gcs?: string;
  /** Injected epoch millis (tests pass a fixed value; avoids Date.now in logic). */
  timestamp?: number;
  verbose?: boolean;
  /** Test seam: inject a fake better-sqlite3-shaped constructor instead of importing the real module. */
  Database?: new (path: string, opts?: Record<string, unknown>) => any;
}

/** Which method actually produced the snapshot — downstream migration tooling
 * should require `native-online-backup` rather than trusting a blanket `backedUp: true`. */
export type BackupMethod = 'native-online-backup' | 'raw-copy-fallback';

export interface BackupResult {
  backedUp: boolean;
  path?: string;
  sizeBytes?: number;
  rotatedAway?: string[];
  gcsUri?: string;
  skipped?: string;
  method?: BackupMethod;
}

export function defaultMemoryDbPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.swarm', 'memory.db');
}

export interface ProjectBackupResult extends BackupResult {
  backups: Array<BackupResult & { dbPath: string }>;
}

/** Back up the active project stores; an explicit full-file override stays single-store. */
export async function backupProjectMemoryDbs(
  cwd: string,
  opts: Omit<BackupOptions, 'dbPath'> = {},
): Promise<ProjectBackupResult> {
  const override = process.env.CLAUDE_FLOW_DB_PATH;
  let sources: string[];
  if (override && override.trim().length > 0) {
    sources = [path.resolve(cwd, override)];
  } else {
    const root = resolveMemoryRoot(cwd);
    sources = [path.join(root, 'memory.db'), path.join(root, 'agentdb-memory.db')];
  }
  const backups: ProjectBackupResult['backups'] = [];
  for (const dbPath of sources) {
    backups.push({ ...await backupMemoryDb({ ...opts, dbPath }), dbPath });
  }
  const successful = backups.filter(result => result.backedUp);
  const failed = backups.find(result => !result.backedUp && result.skipped !== 'no-db');
  // Only report an aggregate `method` when every successful store agrees — a
  // mixed native/raw-copy result must not collapse to whichever store
  // happened to be first, the exact false-confidence #4287 is about.
  const methods = new Set(successful.map(result => result.method));
  const aggregateMethod = methods.size === 1 ? successful[0]?.method : undefined;
  return {
    ...successful[0],
    backedUp: successful.length > 0 && !failed,
    sizeBytes: successful.reduce((sum, result) => sum + (result.sizeBytes ?? 0), 0),
    rotatedAway: successful.flatMap(result => result.rotatedAway ?? []),
    skipped: failed?.skipped ?? (successful.length === 0 ? 'no-db' : undefined),
    method: aggregateMethod,
    backups,
  };
}

/** ISO timestamp safe for filenames (no ':' or '.'). */
function fileStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

/** Keep legacy memory.db names; give every other basename its own snapshot set. */
function snapshotPrefix(dbPath: string): string {
  const name = path.basename(dbPath);
  // A distinct namespace prevents an extensionless `memory` database from
  // colliding with the historical `memory.db` prefix. Encoding is injective
  // within the nondefault namespace, including names that contain `%`.
  return name === 'memory.db' ? 'memory-' : `store-${encodeURIComponent(name)}-`;
}

function isSnapshotFor(file: string, dbPath: string): boolean {
  const prefix = snapshotPrefix(dbPath);
  return file.startsWith(prefix)
    && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/.test(file.slice(prefix.length));
}

/**
 * A plain file copy of a live WAL-mode SQLite database is not a consistent
 * snapshot — committed data can live only in the `-wal` sidecar until it's
 * checkpointed back into the main file. We can't open an RFE1-encrypted
 * source natively to run a real `wal_checkpoint` probe (it isn't a SQLite
 * image), so for the raw-copy-fallback path the only signal available is
 * sidecar presence: a non-empty `-wal` file means there are frames that a
 * copy of the main file alone would silently drop. Fail closed on that.
 */
function hasActiveWal(dbPath: string): boolean {
  try {
    return fs.statSync(`${dbPath}-wal`).size > 0;
  } catch {
    return false;
  }
}

/** Shared tail: rotation + optional GCS offsite + verbose logging + the success receipt. */
async function finishBackup(
  destPath: string,
  dbPath: string,
  destDir: string,
  opts: BackupOptions,
  method: BackupMethod,
  sizeBytes: number,
): Promise<BackupResult> {
  // Rotation — ISO-stamped names sort chronologically, so keep the tail.
  const keep = typeof opts.keep === 'number' && opts.keep > 0 ? opts.keep : 7;
  const rotatedAway: string[] = [];
  try {
    const snaps = fs.readdirSync(destDir).filter(f => isSnapshotFor(f, dbPath)).sort();
    while (snaps.length > keep) {
      const old = snaps.shift()!;
      try { fs.rmSync(path.join(destDir, old), { force: true }); rotatedAway.push(old); } catch { /* */ }
    }
  } catch { /* */ }

  // Optional offsite to GCS (best-effort; local backup already succeeded).
  let gcsUri: string | undefined;
  if (opts.gcs) {
    try {
      const { execFileSync } = await import('child_process');
      const dest = opts.gcs.replace(/\/+$/, '') + '/' + path.basename(destPath);
      execFileSync('gcloud', ['storage', 'cp', destPath, dest], { stdio: ['ignore', 'ignore', 'inherit'] });
      gcsUri = dest;
    } catch { /* offsite failed — local snapshot stands */ }
  }

  if (opts.verbose) {
    const label = method === 'raw-copy-fallback' ? ' (byte-copy, encrypted-at-rest)' : '';
    console.log(
      `memory DB backed up${label} → ${destPath} (${Math.round(sizeBytes / 1024)} KB)` +
      (rotatedAway.length ? `, rotated ${rotatedAway.length} old` : '') +
      (gcsUri ? `, offsite ${gcsUri}` : ''),
    );
  }
  return { backedUp: true, path: destPath, sizeBytes, rotatedAway, gcsUri, method };
}

export async function backupMemoryDb(opts: BackupOptions = {}): Promise<BackupResult> {
  const dbPath = opts.dbPath ?? defaultMemoryDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return { backedUp: false, skipped: 'no-db' };

  const destDir = opts.destDir ?? path.join(path.dirname(dbPath), 'backups');
  try { fs.mkdirSync(destDir, { recursive: true }); } catch { /* */ }
  const destPath = path.join(destDir, `${snapshotPrefix(dbPath)}${fileStamp(opts.timestamp ?? Date.now())}.db`);

  let Database: any = opts.Database;
  let nativeError: string | null = null;
  if (!Database) {
    try {
      const mod: string = 'better-sqlite3';
      Database = (await import(mod)).default;
    } catch {
      nativeError = 'better-sqlite3 unavailable';
    }
  }

  if (!nativeError) {
    // WAL-safe online backup: read-only source, consistent snapshot to destPath.
    let db: any;
    try {
      db = new Database(dbPath, { readonly: true });
      await db.backup(destPath);
      db.close();
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(destPath).size; } catch { /* */ }
      return await finishBackup(destPath, dbPath, destDir, opts, 'native-online-backup', sizeBytes);
    } catch (e) {
      try { db?.close(); } catch { /* */ }
      try { fs.rmSync(destPath, { force: true }); } catch { /* a native backup() that throws mid-write can leave a torn destPath */ }
      nativeError = (e as Error)?.message ?? String(e);
    }
  }

  // #2798 — under CLAUDE_FLOW_ENCRYPT_AT_REST the source is an RFE1 blob, not
  // native SQLite, so better-sqlite3's online-backup API throws "file is not
  // a database" (or isn't even importable on a WASM-only host). The
  // online-backup API exists to avoid tearing a live WAL-mode DB; that
  // concern doesn't apply to the encrypted file (sql.js rewrites it wholesale
  // per flush), so a plain byte copy IS a valid snapshot there.
  //
  // But this fallback must never fire for an ORDINARY (non-encrypted) source
  // just because the native backup threw — SQLITE_BUSY, a disk error, or any
  // other native-backup failure on a perfectly normal database must fail
  // closed, not silently report `backedUp: true` off a raw copy. Positively
  // verify encryption (4-byte RFE1 magic sniff) before ever taking this path;
  // "the native backup threw" is never by itself evidence the source is
  // encrypted.
  if (existingFileIsEncrypted(dbPath) !== true) {
    return { backedUp: false, skipped: `native backup failed: ${nativeError}` };
  }

  // Even for a confirmed-encrypted source, refuse the raw-copy fallback if
  // there's an active WAL — a plain copy of the main file alone would miss
  // uncommitted WAL frames and silently produce an inconsistent snapshot.
  if (hasActiveWal(dbPath)) {
    return { backedUp: false, skipped: 'active WAL present — refusing raw-copy fallback (would be inconsistent)' };
  }

  try {
    fs.copyFileSync(dbPath, destPath);
    const copiedBytes = fs.statSync(destPath).size;
    if (copiedBytes > 0) {
      return await finishBackup(destPath, dbPath, destDir, opts, 'raw-copy-fallback', copiedBytes);
    }
  } catch { /* byte-copy also failed — report the original native error below */ }
  try { fs.rmSync(destPath, { force: true }); } catch { /* */ }
  return { backedUp: false, skipped: `native backup failed: ${nativeError}` };
}

export interface RestoreResult {
  restored: boolean;
  /** The backup file that was restored. */
  from?: string;
  /** Verified memory_entries count in the restored DB. */
  rows?: number;
  /** Where the corrupt live DB was parked before the swap. */
  corruptBackupPath?: string;
  skipped?: string;
}

/** Verify a snapshot without modifying it, including RFE1 images and WASM-only hosts. */
async function verifiedBackupRows(file: string, Database: any): Promise<number | null> {
  if (Database) {
    let db: any;
    try {
      db = new Database(file, { readonly: true });
      if (String(db.pragma('integrity_check', { simple: true })).toLowerCase() !== 'ok') return null;
      const rows = Number(db.prepare('SELECT COUNT(*) AS c FROM memory_entries').get()?.c ?? 0);
      return rows > 0 ? rows : null;
    } catch {
      // Native SQLite cannot open encrypted RFE1 images. Verify the decrypted
      // bytes below; a failed native open is never evidence of a good backup.
    } finally {
      try { db?.close(); } catch { /* best effort */ }
    }
  }

  let db: any;
  try {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    db = new SQL.Database(readFileMaybeEncrypted(file, null));
    const integrity = db.exec('PRAGMA integrity_check')[0]?.values?.[0]?.[0];
    const rows = Number(db.exec('SELECT COUNT(*) FROM memory_entries')[0]?.values?.[0]?.[0] ?? 0);
    return String(integrity).toLowerCase() === 'ok' && rows > 0 ? rows : null;
  } catch {
    // No verifier, wrong key, failed authentication, or invalid SQLite image.
    return null;
  } finally {
    try { db?.close(); } catch { /* best effort */ }
  }
}

/**
 * Restore the newest integrity-ok backup over a corrupt/malformed memory DB
 * (issue #2584).
 *
 * The in-place rebuild path (`recoverMemoryDatabase`) rebuilds FROM the corrupt
 * image, so when the damage is bad enough that `sqlite3 .recover` salvages
 * nothing, that rebuild also salvages nothing and every `memory_store` keeps
 * erroring. This is the missing fallback: scan `<db dir>/backups/` newest-first,
 * pick the newest snapshot that passes `PRAGMA integrity_check` (and has rows),
 * park the corrupt live DB at `<db>.corrupt-<ts>.bak`, then ATOMICALLY install
 * the good backup (copy → fsync → rename, no full-image buffer in memory). Drops
 * stale -wal/-shm. Non-destructive on failure: the live DB is only replaced once
 * a verified backup is in hand.
 */
export async function restoreMemoryDbFromBackup(
  dbPath: string,
  opts: { destDir?: string; timestamp?: number; verbose?: boolean } = {},
): Promise<RestoreResult> {
  if (!dbPath) return { restored: false, skipped: 'no-db-path' };
  const destDir = opts.destDir ?? path.join(path.dirname(dbPath), 'backups');

  let snaps: string[];
  try {
    snaps = fs
      .readdirSync(destDir)
      .filter(f => isSnapshotFor(f, dbPath))
      .map(f => path.join(destDir, f))
      .sort()      // ISO-stamped names sort chronologically
      .reverse();  // newest first
  } catch {
    return { restored: false, skipped: 'no-backups-dir' };
  }
  if (!snaps.length) return { restored: false, skipped: 'no-backups' };

  // Prefer native verification for plaintext snapshots. sql.js verifies
  // encrypted snapshots and provides the same checks on WASM-only hosts.
  let Database: any = null;
  try {
    Database = await loadBetterSqlite3();
  } catch {
    /* use the sql.js verifier */
  }

  let chosen: { file: string; rows: number } | null = null;
  for (const file of snaps) {
    const rows = await verifiedBackupRows(file, Database);
    if (rows !== null) { chosen = { file, rows }; break; }
  }
  if (!chosen) return { restored: false, skipped: 'no-integrity-ok-backup' };

  const ts = opts.timestamp ?? Date.now();
  const corruptBackupPath = `${dbPath}.corrupt-${ts}.bak`;
  const tmp = `${dbPath}.restoring-${ts}`;
  try {
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, corruptBackupPath);
    fs.copyFileSync(chosen.file, tmp);            // stream copy — no 185MB buffer
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }  // durable before swap
    fs.renameSync(tmp, dbPath);                   // atomic install
    for (const s of ['-wal', '-shm']) { try { fs.rmSync(`${dbPath}${s}`, { force: true }); } catch { /* */ } }
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* */ }
    return { restored: false, skipped: `install failed: ${(e as Error)?.message ?? e}` };
  }

  if (opts.verbose) {
    console.log(
      `memory DB restored from backup ${path.basename(chosen.file)}` +
      (chosen.rows >= 0 ? ` (${chosen.rows} rows)` : ' (unverified)') +
      `. Corrupt original saved to ${corruptBackupPath}`,
    );
  }
  return { restored: true, from: chosen.file, rows: chosen.rows, corruptBackupPath };
}
