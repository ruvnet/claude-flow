/**
 * Foreign-handle guard for whole-file replacement of a live SQLite database.
 *
 * Renaming a fresh image over a database path while other processes hold open
 * connections strands those connections on the deleted old inode while the
 * `-wal`/`-shm` files stay paired BY FILENAME with the new image — SQLite never
 * cross-checks WAL salts against the main image, so the old WAL's frames are
 * silently applied to the replacement and both generations corrupt each other
 * (sqlite.org/howtocorrupt.html §2.5, fileformat2.html §WAL). A whole-file
 * install is therefore only safe when NO other process has the DB, its WAL, or
 * its SHM open. SQLite's own locks cannot prove that: an idle connection holds
 * no lock but still holds the fd that goes stale after the rename.
 *
 * This module answers "who else has this database open?" from the OS:
 *   - Linux: scan /proc/<pid>/fd symlinks (no extra tooling, no elevated
 *     rights needed for same-user processes — which is exactly the workspace
 *     daemon / MCP-server population we must detect).
 *   - Other POSIX (darwin): `lsof` when available.
 *   - Unknown platform / no tooling: scan is reported unsupported; callers
 *     proceed (matching historical behavior there) but must say so loudly.
 */

import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export interface ForeignDbHandle {
  pid: number;
  /** Process name (comm) when resolvable, '?' otherwise. */
  command: string;
  /** Which of the db / -wal / -shm paths the process holds open. */
  file: string;
}

export interface HandleScanResult {
  /** false → the platform gave us no way to enumerate handles. */
  supported: boolean;
  handles: ForeignDbHandle[];
}

/** The db path plus its WAL sidecars, realpath-resolved where possible. */
function targetPaths(dbPath: string): string[] {
  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  const resolved = new Set<string>();
  for (const p of candidates) {
    try {
      resolved.add(fs.realpathSync(p));
    } catch {
      /* sidecar absent — nothing can hold it open */
    }
  }
  return [...resolved];
}

function scanViaProc(targets: Set<string>): HandleScanResult {
  let pids: string[];
  try {
    pids = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d));
  } catch {
    return { supported: false, handles: [] };
  }
  const handles: ForeignDbHandle[] = [];
  for (const pidStr of pids) {
    const pid = Number(pidStr);
    if (pid === process.pid) continue;
    let fds: string[];
    try {
      fds = fs.readdirSync(`/proc/${pidStr}/fd`);
    } catch {
      continue; // gone, or another user's process we cannot inspect
    }
    for (const fd of fds) {
      let link: string;
      try {
        link = fs.readlinkSync(`/proc/${pidStr}/fd/${fd}`);
      } catch {
        continue;
      }
      // A replaced-but-still-open inode reads as "<path> (deleted)" — that is
      // still a live handle on one of our targets and must count.
      const linkPath = link.endsWith(' (deleted)') ? link.slice(0, -' (deleted)'.length) : link;
      if (targets.has(linkPath)) {
        let command = '?';
        try {
          command = fs.readFileSync(`/proc/${pidStr}/comm`, 'utf-8').trim();
        } catch {
          /* comm unreadable — keep '?' */
        }
        handles.push({ pid, command, file: linkPath });
        break; // one hit per process is enough to disqualify the swap
      }
    }
  }
  return { supported: true, handles };
}

function scanViaLsof(targets: string[]): HandleScanResult {
  let out: string;
  try {
    // -F pcn → machine-parsable pid / command / name records. lsof exits 1
    // when no process holds the files — with empty output that means "none".
    out = execFileSync('lsof', ['-F', 'pcn', '--', ...targets], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    const stdout = (e as { stdout?: string })?.stdout ?? '';
    if (typeof stdout === 'string' && stdout.trim() === '') {
      const code = (e as { code?: string })?.code;
      if (code === 'ENOENT') return { supported: false, handles: [] }; // no lsof
      return { supported: true, handles: [] }; // lsof ran: nothing holds them
    }
    out = stdout;
  }
  const handles: ForeignDbHandle[] = [];
  let pid = 0;
  let command = '?';
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) { pid = Number(line.slice(1)); command = '?'; }
    else if (line.startsWith('c')) { command = line.slice(1); }
    else if (line.startsWith('n') && pid !== process.pid) {
      handles.push({ pid, command, file: line.slice(1) });
    }
  }
  // Collapse to one record per pid (mirrors the /proc scanner).
  const byPid = new Map<number, ForeignDbHandle>();
  for (const h of handles) if (!byPid.has(h.pid)) byPid.set(h.pid, h);
  return { supported: true, handles: [...byPid.values()] };
}

/**
 * Enumerate processes other than this one holding the database, its WAL, or
 * its SHM open. `supported: false` means the platform could not be scanned —
 * callers must distinguish "verified none" from "could not verify".
 */
export function scanForeignDbHandles(dbPath: string): HandleScanResult {
  const targets = targetPaths(dbPath);
  if (targets.length === 0) return { supported: true, handles: [] };
  if (process.platform === 'linux') return scanViaProc(new Set(targets));
  return scanViaLsof(targets);
}

/** Formats a scan result for operator-facing refusal messages. */
export function describeForeignHandles(handles: ForeignDbHandle[]): string {
  return handles
    .map(h => `pid ${h.pid} (${h.command}) → ${h.file}`)
    .join('; ');
}

// ===== Cooperative recovery protocol =====
//
// Whole-file replacement is only safe with zero attached processes — but
// post-incident every accessor is the same build, so instead of refusing
// while holders exist, recovery can ASK them to detach: it posts a marker
// (`<db>.recovery-pending`), cooperating connections close on sight and hold
// new opens until it clears, and recovery drains the holder set with a
// bounded wait before swapping. The typed refusal remains as the fallback
// for holders that do not drain (foreign/unpinned processes) — exactly the
// case where proceeding would corrupt.

const RECOVERY_MARKER_STALE_MS = 60_000;

export function recoveryMarkerPath(dbPath: string): string {
  return `${dbPath}.recovery-pending`;
}

/** True when a NON-stale marker exists (stale = crashed recovery; cleaned). */
export function isRecoveryPending(dbPath: string): boolean {
  const marker = recoveryMarkerPath(dbPath);
  try {
    const st = fs.statSync(marker);
    if (Date.now() - st.mtimeMs > RECOVERY_MARKER_STALE_MS) {
      try { fs.unlinkSync(marker); } catch { /* raced */ }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function postRecoveryMarker(dbPath: string, reason: string): void {
  fs.writeFileSync(
    recoveryMarkerPath(dbPath),
    JSON.stringify({ pid: process.pid, reason, postedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
}

/** Refresh mtime so long recoveries don't go stale mid-drain. */
export function touchRecoveryMarker(dbPath: string): void {
  const now = new Date();
  try { fs.utimesSync(recoveryMarkerPath(dbPath), now, now); } catch { /* gone */ }
}

export function clearRecoveryMarker(dbPath: string): void {
  try { fs.unlinkSync(recoveryMarkerPath(dbPath)); } catch { /* already gone */ }
}

/** Cooperating openers call this before attaching: bounded wait for a clear. */
export async function waitForRecoveryClear(dbPath: string, timeoutMs = 45_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isRecoveryPending(dbPath)) {
    if (Date.now() > deadline) return false;
    await new Promise(r => setTimeout(r, 250));
  }
  return true;
}

/**
 * Recovery-side drain: keep the marker fresh and poll until no foreign
 * process holds the db, or the deadline passes. Returns the final scan.
 */
export async function drainForeignHandles(dbPath: string, timeoutMs = 30_000): Promise<HandleScanResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const scan = scanForeignDbHandles(dbPath);
    if (!scan.supported || scan.handles.length === 0) return scan;
    if (Date.now() > deadline) return scan;
    touchRecoveryMarker(dbPath);
    await new Promise(r => setTimeout(r, 500));
  }
}
