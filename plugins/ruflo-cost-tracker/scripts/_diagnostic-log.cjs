'use strict';

// _diagnostic-log.cjs — shared best-effort failure log for #3227.
//
// track.mjs's persistToMemory() and ruflo-hook.cjs's Stop-hook shim both run
// with TRACK_QUIET=1 / stdio:'ignore', so a write failure previously vanished
// with zero trace. This appends one JSON line per failure to a home-relative
// log so the failure is at least discoverable later. It is diagnostic only —
// never load-bearing — so every operation here is wrapped to never throw.
//
// .cjs (not .mjs) so both ruflo-hook.cjs (require) and track.mjs (import,
// via Node's CJS/ESM named-export interop) can share one implementation.

const { appendFileSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

const LOG_DIR = join(homedir(), '.claude-flow', 'logs');
const LOG_PATH = join(LOG_DIR, 'cost-tracker-failures.log');
const LOG_MAX_BYTES = 512 * 1024;
const LOG_KEEP_LINES = 200;

function rotateIfNeeded() {
  if (!existsSync(LOG_PATH)) return;
  if (statSync(LOG_PATH).size <= LOG_MAX_BYTES) return;
  const lines = readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const kept = lines.slice(-LOG_KEEP_LINES);
  writeFileSync(LOG_PATH, kept.length ? kept.join('\n') + '\n' : '');
}

/** Append one failure line. Never throws, never blocks the caller. */
function logFailure(opts = {}) {
  try {
    const { source, reason, sessionId } = opts || {};
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    const entry = {
      ts: new Date().toISOString(),
      source,
      reason: String(reason ?? 'unknown').slice(0, 500),
    };
    if (sessionId) entry.sessionId = sessionId;
    appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // Logging itself must never escalate — swallow and move on.
  }
}

module.exports = { logFailure, LOG_PATH };
