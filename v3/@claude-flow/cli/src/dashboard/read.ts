/** Bounded, project-confined, read-only file access: regular files only (no symlinks anywhere on the path), size-capped. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Resolve `rel` under `root`; null if it escapes the root or any component is a symlink. */
export function confine(root: string, rel: string): string | null {
  try {
    const r = realpathSync(root);
    const p = resolve(r, rel);
    if (p !== r && !p.startsWith(r + sep)) return null;
    let cur = r;
    for (const part of p.slice(r.length).split(sep).filter(Boolean)) { cur = join(cur, part); if (lstatSync(cur).isSymbolicLink()) return null; }
    return p;
  } catch { return null; }
}

/** Read up to `maxBytes` from the start (or the last `maxBytes` when `tail`). Null if missing, not a regular file, or unreadable. */
export function readRegular(root: string, rel: string, maxBytes: number, tail = false): { text: string; size: number } | null {
  const p = confine(root, rel);
  if (!p) return null;
  let fd: number | undefined;
  try {
    // lstat BEFORE open: opening a FIFO/device for read can block forever. O_NONBLOCK covers a swap between lstat and open.
    if (!lstatSync(p).isFile()) return null;
    fd = openSync(p, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const n = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, tail ? Math.max(0, st.size - n) : 0);
    return { text: buf.toString('utf8'), size: st.size };
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ } }
}

/** Like readRegular but returns the raw bytes and the stat signature (ino,size,mtime,ctime) the bytes were read under. */
export function readRegularBytes(root: string, rel: string, maxBytes: number): { buf: Buffer; size: number; sig: string } | null {
  const p = confine(root, rel);
  if (!p) return null;
  let fd: number | undefined;
  try {
    if (!lstatSync(p).isFile()) return null;
    fd = openSync(p, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) return st.isFile() ? { buf: Buffer.alloc(0), size: st.size, sig: '' } : null;
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, st.size, 0);
    return { buf, size: st.size, sig: `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}` };
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ } }
}

/** Names of regular entries in a confined directory (never follows symlinks), at most `max`. */
export function listDir(root: string, rel: string, max = 1000): { name: string; isDir: boolean }[] {
  const p = confine(root, rel);
  if (!p) return [];
  try {
    if (!lstatSync(p).isDirectory()) return [];
    const out: { name: string; isDir: boolean }[] = [];
    for (const e of readdirSync(p, { withFileTypes: true })) { if (e.isSymbolicLink()) continue; if (e.isFile() || e.isDirectory()) out.push({ name: e.name, isDir: e.isDirectory() }); if (out.length >= max) break; }
    return out;
  } catch { return []; }
}
