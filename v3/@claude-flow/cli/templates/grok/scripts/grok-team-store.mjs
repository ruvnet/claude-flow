/**
 * Storage layer for the host-agnostic Agent Teams bus (ADR-402).
 * Imported by grok-team-bus.mjs; not a CLI.
 *
 * Layout (all under <project>/.claude-flow/teams/<team>/):
 *   team.json                 roster, plan, status   (lock + atomic rename)
 *   team.lock                 cross-process lock (O_EXCL file + token)
 *   mailbox/<agent>/*.json    pending messages, named <priority>_<id>.json
 *   mailbox/<agent>/archive/  drained messages
 */

import fs from 'node:fs';
import path from 'node:path';

export const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

// ---------------------------------------------------------------------------
// Names, paths, and filesystem safety
// ---------------------------------------------------------------------------

export function safeName(name, field = 'name') {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`Invalid ${field} "${name}" — use 1-64 alphanumeric, dash, underscore (must start alphanumeric)`);
  }
  return name;
}

export function teamsRoot(projectRoot) {
  return path.join(projectRoot, '.claude-flow', 'teams');
}

export function teamDir(projectRoot, team) {
  return path.join(teamsRoot(projectRoot), safeName(team, 'team'));
}

export function teamFile(projectRoot, team) {
  return path.join(teamDir(projectRoot, team), 'team.json');
}

export function mailboxDir(projectRoot, team, agent) {
  return path.join(teamDir(projectRoot, team), 'mailbox', safeName(agent, 'agent'));
}

/**
 * Create `dir` and every missing parent below `base`, refusing to pass through
 * a symlink. A planted symlink would otherwise redirect writes outside the
 * project.
 */
export function ensureRealDir(base, dir) {
  const rel = path.relative(base, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing path outside ${base}: ${dir}`);
  }
  let cur = base;
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  assertRealDir(cur);
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      fs.mkdirSync(cur, { mode: 0o700 });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    assertRealDir(cur);
  }
}

export function assertRealDir(dir) {
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`Refusing to use ${dir}: not a real directory (symlink?)`);
  }
}

/** Existing real directory → true; missing → false; symlink/file → throws. */
export function realDirExists(dir) {
  try {
    assertRealDir(dir);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Write via a unique temp file + rename so readers never see a torn file. */
export function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      // Windows can refuse a rename over a file another process has open.
      if (attempt >= 20 || (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES')) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
        throw err;
      }
      sleepMs(10);
    }
  }
}

export function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Lock: one team.json writer at a time, across processes
// ---------------------------------------------------------------------------

/**
 * Run `fn` holding the team lock: a `team.lock` file created with O_EXCL and
 * holding a random token. A lock older than LOCK_STALE_MS (a crashed holder)
 * is broken by renaming it aside and checking the token: if a live holder
 * re-took the lock in between, the rename caught theirs, so it is linked back
 * (link fails rather than overwrite) and this waiter keeps waiting. Release
 * removes the file only while it still holds our token.
 */
export function withTeamLock(projectRoot, team, fn) {
  const dir = teamDir(projectRoot, team);
  if (!realDirExists(dir)) throw new Error(`Team "${team}" not found — run create first`);
  const lock = path.join(dir, 'team.lock');
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let wait = 2; ; wait = Math.min(wait * 2, 50)) {
    try {
      fs.writeFileSync(lock, token, { flag: 'wx', mode: 0o600 });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    breakStaleLock(lock, token);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the lock on team "${team}"`);
    sleepMs(wait + Math.floor(Math.random() * wait));
  }
  try {
    return fn();
  } finally {
    try {
      if (fs.readFileSync(lock, 'utf8') === token) fs.rmSync(lock, { force: true });
    } catch {
      /* already gone */
    }
  }
}

function breakStaleLock(lock, token) {
  let seen;
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs <= LOCK_STALE_MS) return;
    seen = fs.readFileSync(lock, 'utf8');
  } catch {
    return; // released meanwhile
  }
  const aside = `${lock}.stale.${token}`;
  try {
    fs.renameSync(lock, aside);
  } catch {
    return; // another waiter broke it first
  }
  try {
    if (fs.readFileSync(aside, 'utf8') !== seen) {
      // We moved a live holder's fresh lock: put it back if the slot is free.
      try { fs.linkSync(aside, lock); } catch { /* slot taken; that holder's release is a no-op */ }
    }
  } finally {
    fs.rmSync(aside, { force: true });
  }
}

export function loadTeam(projectRoot, team) {
  const t = readJson(teamFile(projectRoot, team));
  if (!t) throw new Error(`Team "${team}" not found — run create first`);
  return t;
}

/** Read-modify-write team.json under the lock. `mutate` returns the result. */
export function updateTeam(projectRoot, team, mutate) {
  return withTeamLock(projectRoot, team, () => {
    const t = loadTeam(projectRoot, team);
    const result = mutate(t);
    writeJsonAtomic(teamFile(projectRoot, team), t);
    return result;
  });
}

export function assertActive(t) {
  if (t.status !== 'active') {
    throw new Error(`Team "${t.name}" is ${t.status}; create it again (force) to reuse the name`);
  }
}

