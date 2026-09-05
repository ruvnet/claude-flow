#!/usr/bin/env node
/**
 * ruflo-hook.cjs — cross-platform Windows shim for cost-tracker's Stop hook (#2132)
 *
 * The cost-tracker hooks.json declares `"_platform": "posix"` because its
 * Stop hook uses bash:
 *
 *   /bin/bash -c 'TRACK_QUIET=1 node "${CLAUDE_PLUGIN_ROOT}/scripts/track.mjs" >/dev/null 2>&1 || true'
 *
 * On Windows, `ruflo init` writes a `.claude/settings.json` that overrides
 * the Stop hook to invoke this shim instead — `node ruflo-hook.cjs` —
 * so cost tracking continues to capture session data without bash.
 *
 * Behaviour mirrors the bash hook:
 *   1. Reads hook event payload from stdin (best effort — discarded).
 *   2. Spawns track.mjs with TRACK_QUIET=1 and swallows all output.
 *   3. Always exits 0 — telemetry is best-effort, must NEVER block a turn.
 *   4. Times out at 30s so a hung track.mjs can't stall session shutdown.
 *
 * Usage: node ruflo-hook.cjs [hook-args ignored]
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function done() {
  process.exit(0);
}

// Best-effort drain of stdin so the pipe doesn't EPIPE on the parent
try {
  fs.readFileSync(0);
} catch {
  /* ignore */
}

// CLAUDE_PLUGIN_ROOT is set by Claude Code; fall back to this script's parent
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
  || path.resolve(__dirname, '..');
const trackScript = path.join(pluginRoot, 'scripts', 'track.mjs');

if (!fs.existsSync(trackScript)) {
  // Plugin layout drifted — exit clean, never block the turn
  done();
}

spawnSync(process.execPath, [trackScript], {
  env: { ...process.env, TRACK_QUIET: '1' },
  stdio: 'ignore',
  timeout: 30_000,
});

done();
