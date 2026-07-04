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
}

export interface BackupResult {
  backedUp: boolean;
  path?: string;
  sizeBytes?: number;
  rotatedAway?: string[];
  gcsUri?: string;
  skipped?: string;
}

export function defaultMemoryDbPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.swarm', 'memory.db');
}

/** ISO timestamp safe for filenames (no ':' or '.'). */
function fileStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

export async function backupMemoryDb(opts: BackupOptions = {}): Promise<BackupResult> {
  const dbPath = opts.dbPath ?? defaultMemoryDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return { backedUp: false, skipped: 'no-db' };

  let Database: any;
  try {
    const mod: string = 'better-sqlite3';
    Database = (await import(mod)).default;
  } catch {
    return { backedUp: false, skipped: 'better-sqlite3 unavailable' };
  }

  const destDir = opts.destDir ?? path.join(path.dirname(dbPath), 'backups');
  try { fs.mkdirSync(destDir, { recursive: true }); } catch { /* */ }
  const destPath = path.join(destDir, `memory-${fileStamp(opts.timestamp ?? Date.now())}.db`);

  // WAL-safe online backup: read-only source, consistent snapshot to destPath.
  let db: any;
  try {
    db = new Database(dbPath, { readonly: true });
    await db.backup(destPath);
    db.close();
  } catch (e) {
    try { db?.close(); } catch { /* */ }
    return { backedUp: false, skipped: `backup failed: ${(e as Error)?.message ?? e}` };
  }

  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(destPath).size; } catch { /* */ }

  // Rotation — ISO-stamped names sort chronologically, so keep the tail.
  const keep = typeof opts.keep === 'number' && opts.keep > 0 ? opts.keep : 7;
  const rotatedAway: string[] = [];
  try {
    const snaps = fs.readdirSync(destDir).filter(f => /^memory-.*\.db$/.test(f)).sort();
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
    console.log(
      `memory DB backed up → ${destPath} (${Math.round(sizeBytes / 1024)} KB)` +
      (rotatedAway.length ? `, rotated ${rotatedAway.length} old` : '') +
      (gcsUri ? `, offsite ${gcsUri}` : ''),
    );
  }
  return { backedUp: true, path: destPath, sizeBytes, rotatedAway, gcsUri };
}
