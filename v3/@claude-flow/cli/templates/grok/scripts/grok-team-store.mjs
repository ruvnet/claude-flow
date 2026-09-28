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
// A waiter must never give up before the lock it's waiting on can even be
// considered stale — otherwise every spawn attempted in the gap between
// "waiter gives up" and "lock is stale" fails outright even though nothing
// is actually stuck (ADR-402 round-2 review, N3). So LOCK_WAIT_MS >=
// LOCK_STALE_MS, always.
//
// Both are also sized to fit inside the SubagentStop hook's own 5s command
// timeout (templates/grok/hooks/subagent-stop-team.json): worst case, the
// hook waits out the full stale window, breaks the lock, and runs its (tiny,
// sub-millisecond) critical section — that must land comfortably under 5s
// including node startup. 4s stale / 4.5s wait leaves ~0.5s of margin for
// process startup and the break-then-acquire dance, while still being far
// longer than any legitimate holder ever needs (team.json read-modify-write
// is the only thing done under this lock).
const LOCK_WAIT_MS = 4_500;
const LOCK_STALE_MS = 4_000;

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

/**
 * Synchronous sleep via Atomics.wait — blocks this thread (and, in an MCP
 * server, every other in-flight request on it) for `ms`. Kept only for the
 * tiny (<=200ms worst case, ~20 attempts x 10ms), bounded Windows
 * rename-retry in writeJsonAtomic, which is a rare edge case and not worth
 * threading a Promise through every atomic write for. Anything that can
 * block for the length of a lock wait — potentially seconds — must use
 * sleepMsAsync instead (ADR-402 round-2 review, N3).
 */
export function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Non-blocking sleep: yields to the event loop instead of the whole thread. */
export function sleepMsAsync(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 *
 * Async: the wait loop yields via sleepMsAsync (setTimeout), not a blocking
 * Atomics.wait, so an MCP server (or any other caller) keeps serving other
 * requests while this call waits for the lock (ADR-402 round-2 review, N3).
 * `fn` itself still runs synchronously once the lock is held — team.json
 * read-modify-write is fast enough that yielding mid-critical-section isn't
 * worth the added complexity.
 */
export async function withTeamLock(projectRoot, team, fn) {
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
    await sleepMsAsync(wait + Math.floor(Math.random() * wait));
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

/** True when the lock token names a pid that still exists on this host. */
function lockHolderAlive(token) {
  const pid = Number(String(token).split('.')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists and we cannot signal it. ESRCH: it is gone.
    return err.code === 'EPERM';
  }
}

/**
 * Break `lock` if it's still stale. Re-verifies the token and mtime we
 * observed as stale immediately before renaming anything: without this, a
 * waiter that read a stale token, then got preempted while another waiter
 * broke the same lock and a fresh holder re-acquired it, would rename that
 * LIVE lock out from under its holder — and the window that opens between
 * the rename and the "put it back" recovery lets a fourth party grab the
 * vacated slot, leaving two holders at once (ADR-402 round-2 review, N2).
 * If anything has changed since our first observation, someone else already
 * handled it: back off without touching the file and let the caller's own
 * wait loop retry. A token whose pid is still alive is left alone even when
 * the file is older than LOCK_STALE_MS (round-3 review).
 */
export function breakStaleLock(lock, token) {
  let seen, mtime;
  try {
    mtime = fs.statSync(lock).mtimeMs;
    if (Date.now() - mtime <= LOCK_STALE_MS) return;
    seen = fs.readFileSync(lock, 'utf8');
  } catch {
    return; // released meanwhile
  }
  let mtime2, seen2;
  try {
    mtime2 = fs.statSync(lock).mtimeMs;
    seen2 = fs.readFileSync(lock, 'utf8');
  } catch {
    return; // released meanwhile
  }
  if (mtime2 !== mtime || seen2 !== seen) return; // changed underneath us — back off
  // A live holder is not stale, however old the file is. The lock is not
  // refreshed while held, so a stall longer than LOCK_STALE_MS (SIGSTOP,
  // sleep, a hook killed mid-update) used to let the next writer break it
  // and drop one of the two updates. The token starts with the holder's
  // pid; if that pid is still alive on this host, leave the lock alone
  // (ADR-402 round-3 review). A dead or unparsable pid keeps the mtime rule.
  if (lockHolderAlive(seen2)) return;

  const aside = `${lock}.stale.${token}`;
  try {
    fs.renameSync(lock, aside);
  } catch {
    return; // another waiter broke it first
  }
  try {
    if (fs.readFileSync(aside, 'utf8') !== seen) {
      // Same-millisecond collision the re-verify above couldn't rule out:
      // put the live lock back if the slot is still free.
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

/**
 * Active teams that list `agent` as a member. The SubagentStop hook uses this
 * when the spawn description carries no @team: exactly one match is used,
 * several matches are reported as ambiguous.
 */
export function teamsWithMember(projectRoot, agent) {
  const root = teamsRoot(projectRoot);
  if (!realDirExists(root)) return [];
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || !NAME_RE.test(ent.name)) continue;
    const t = readJson(path.join(root, ent.name, 'team.json'));
    if (t && t.status === 'active' && t.members && t.members[agent]) out.push(ent.name);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Input checks for the optional spawn / stop fields (exec hosts, runner)
// ---------------------------------------------------------------------------

const HOST_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Extra host entries from the caller (the CLI's exec-host adapters: codex and
 * command hosts), merged into plan.host after the grok and claude entries.
 */
export function parseHostPlans(hostPlans) {
  if (hostPlans === undefined || hostPlans === null) return {};
  if (typeof hostPlans !== 'object' || Array.isArray(hostPlans)) throw new Error('hostPlans must be an object');
  for (const [label, entry] of Object.entries(hostPlans)) {
    if (!HOST_LABEL_RE.test(label)) throw new Error(`Invalid host label "${label}"`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`hostPlans.${label} must be an object`);
  }
  return hostPlans;
}

const RUN_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

/** outcome ("done" default | "failed"), runId and reason for onStop. */
export function parseStopFields(opts) {
  const outcome = opts.outcome === undefined || opts.outcome === null ? 'done' : String(opts.outcome);
  if (outcome !== 'done' && outcome !== 'failed') throw new Error('outcome must be "done" or "failed"');
  const runId = opts.runId === undefined || opts.runId === null ? undefined : String(opts.runId);
  if (runId !== undefined && !RUN_ID_RE.test(runId)) throw new Error('Invalid runId');
  const reason = opts.reason === undefined || opts.reason === null ? undefined : String(opts.reason).slice(0, 4000);
  return { outcome, runId, reason };
}
