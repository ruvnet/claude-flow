#!/usr/bin/env node
/**
 * ADR-321: cross-event foreground-window / PID snapshot cache.
 *
 * Hand-ported CJS twin of
 * v3/@claude-flow/cli/src/session/foreground-snapshot.ts — hook-handler.cjs
 * has no build step and can't require() compiled TS, so this file is kept
 * in manual sync with that module's schema/TTL/lock logic rather than
 * shared across the build boundary. Duplicated identically in both
 * `.claude/helpers/` locations (root + v3/@claude-flow/cli), same rule as
 * hook-handler.cjs.
 *
 * Project-relative storage (`.claude-flow/session/<session-id>/
 * foreground-snapshot.json`), NOT the `~/.ruflo` user-level convention
 * `funnel/state.ts` uses — scoped per session so two concurrent Claude Code
 * sessions in the same repo never share or corrupt each other's snapshot.
 */

const fs = require('fs');
const path = require('path');

// ADR-321 "Invalidation rules" #3 default.
const FOREGROUND_SNAPSHOT_TTL_MS = 2000;
// Dead-man TTL for the claim lock so a crashed holder can't wedge refreshes forever.
const LOCK_TTL_MS = 5000;

function sessionDir(projectRoot, sessionId) {
  return path.join(projectRoot, '.claude-flow', 'session', sessionId);
}

function snapshotPath(projectRoot, sessionId) {
  return path.join(sessionDir(projectRoot, sessionId), 'foreground-snapshot.json');
}

function lockPath(projectRoot, sessionId) {
  return path.join(sessionDir(projectRoot, sessionId), 'foreground-snapshot.json.lock');
}

// $0 liveness check (ADR-321 invalidation rule 4) — process.kill(pid, 0)
// throws ESRCH for a dead process and EPERM for a live one we can't signal;
// never spawns a tasklist/ps process-list command.
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

// Pure decision function — no fs access, no process spawns. pidAliveFn is
// injectable so tests can simulate a dead producer without a real process.
function isStale(snapshot, options) {
  options = options || {};
  if (!snapshot) return true;
  const nowMs = options.nowMs != null ? options.nowMs : Date.now();
  const ttlMs = options.ttlMs != null ? options.ttlMs : FOREGROUND_SNAPSHOT_TTL_MS;
  const pidAliveFn = options.pidAliveFn || isPidAlive;
  if (nowMs - snapshot._ts > ttlMs) return true;
  if (!pidAliveFn(snapshot._pid)) return true;
  return false;
}

function isLockStale(lock, options) {
  options = options || {};
  return isStale(lock, Object.assign({ ttlMs: LOCK_TTL_MS }, options));
}

function readSnapshot(sessionId, projectRoot) {
  try {
    const raw = fs.readFileSync(snapshotPath(projectRoot, sessionId), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Write-to-temp-then-rename (same atomicity convention as funnel/state.ts).
function writeSnapshot(sessionId, projectRoot, data) {
  try {
    const dir = sessionDir(projectRoot, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const target = snapshotPath(projectRoot, sessionId);
    const value = Object.assign({
      _ts: Date.now(),
      _pid: process.pid,
    }, data);
    const tmp = target + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    return false;
  }
}

// ADR-321 invalidation rules #1/#2 — session-start and session-end both delete.
function deleteSnapshot(sessionId, projectRoot) {
  try {
    fs.unlinkSync(snapshotPath(projectRoot, sessionId));
  } catch (e) {
    // already absent — fine
  }
}

// Claim the refresh lock (wx-flag exclusive create) so concurrent hooks
// seeing the same stale snapshot don't both spawn a redundant refresh. A
// stale (dead-man-expired or dead-holder) lock is stolen rather than
// honored forever.
function claimLock(sessionId, projectRoot) {
  const dir = sessionDir(projectRoot, sessionId);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* best-effort */ }
  const lp = lockPath(projectRoot, sessionId);
  const contents = JSON.stringify({ _ts: Date.now(), _pid: process.pid });
  try {
    fs.writeFileSync(lp, contents, { flag: 'wx' });
    return true;
  } catch (e) {
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(lp, 'utf8'));
    } catch (e2) {
      // unreadable / racing delete — treat as unknown, don't steal
    }
    if (existing && isLockStale(existing)) {
      try {
        fs.unlinkSync(lp);
        fs.writeFileSync(lp, contents, { flag: 'wx' });
        return true;
      } catch (e3) {
        return false;
      }
    }
    return false;
  }
}

function releaseLock(sessionId, projectRoot) {
  try {
    fs.unlinkSync(lockPath(projectRoot, sessionId));
  } catch (e) {
    // already absent — fine
  }
}

module.exports = {
  FOREGROUND_SNAPSHOT_TTL_MS,
  LOCK_TTL_MS,
  isPidAlive,
  isStale,
  isLockStale,
  readSnapshot,
  writeSnapshot,
  deleteSnapshot,
  claimLock,
  releaseLock,
};
