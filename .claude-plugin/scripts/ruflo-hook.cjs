#!/usr/bin/env node
/**
 * ruflo-hook.cjs — cross-platform Node.js port of ruflo-hook.sh (#2132)
 *
 * The bash shim (ruflo-hook.sh) works on Mac/Linux but fails on native
 * Windows (exit 126 — "cannot execute binary file"). This .cjs shim
 * provides identical behaviour via Node.js child_process so Windows users
 * get working hooks without WSL or Git Bash.
 *
 * Mac/Linux continue to use ruflo-hook.sh via the plugin hooks.json files
 * (unchanged). On Windows, ruflo init writes a .claude/settings.json that
 * overrides those entries with node-based equivalents pointing here.
 *
 * Behaviour mirrors ruflo-hook.sh:
 *   1. Reads hook JSON payload from stdin.
 *   2. Prefers a locally installed `ruflo` or `claude-flow` binary.
 *   3. Falls back to `npx --prefer-offline ruflo@latest`.
 *   4. Always exits 0 — hook subcommands are best-effort telemetry.
 *   5. Swallows all stderr — nothing should surface to Claude Code.
 *
 * Usage: node ruflo-hook.cjs <hook-subcommand> [args...]
 *   e.g. node ruflo-hook.cjs post-edit --file "x.ts" --train-patterns
 */

'use strict';

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Exit 0 unconditionally — hooks must never block a turn */
function done() {
  process.exit(0);
}

/** Resolve stdin to a JSON object, or null if not parseable */
function readStdinJson() {
  try {
    let buf = '';
    // Read synchronously — hooks fire synchronously in Claude Code
    const fd = fs.openSync('/dev/stdin', 'r');
    const chunk = Buffer.alloc(64 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      buf += chunk.slice(0, bytesRead).toString('utf8');
    }
    fs.closeSync(fd);
    return buf.trim() ? JSON.parse(buf) : null;
  } catch {
    return null;
  }
}

/** Read stdin via process.stdin in sync mode (Windows-safe alternative) */
function readStdinSync() {
  try {
    // On Windows /dev/stdin doesn't exist; use fd 0 directly
    const chunk = Buffer.alloc(64 * 1024);
    let buf = '';
    let bytesRead;
    while (true) {
      try {
        bytesRead = fs.readSync(0 /* STDIN_FILENO */, chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        buf += chunk.slice(0, bytesRead).toString('utf8');
      } catch {
        break;
      }
    }
    return buf.trim() ? JSON.parse(buf) : null;
  } catch {
    return null;
  }
}

/** Check if a binary is available on PATH */
function commandExists(cmd) {
  try {
    const result = execSync(
      process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/** Build the argv for the ruflo/claude-flow/npx invocation */
function buildArgs(subcommand, extraArgs) {
  // The `hooks` word is prepended here, matching ruflo-hook.sh convention.
  return ['hooks', subcommand, ...extraArgs];
}

/**
 * Spawn the CLI with the hook subcommand.
 * Passes the raw stdin payload as the child's stdin so the CLI can read
 * the hook event JSON if needed (same as the bash pipe).
 *
 * Returns true on success (exit 0), false otherwise.
 */
function invokeHook(bin, binArgs, hookArgs, stdinData) {
  const args = [...binArgs, ...hookArgs];

  // On Windows, shell: true is needed to resolve .cmd shims in node_modules
  const useShell = process.platform === 'win32';

  const result = spawnSync(bin, args, {
    shell: useShell,
    input: stdinData || '',
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore'],  // swallow all output
    timeout: 30_000,
  });

  return result.status === 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // No subcommand — no-op, same as bash version
    done();
  }

  const [subcommand, ...rest] = args;

  // Read stdin (the hook event payload) — best effort
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0 /* fd 0 = stdin */, 'utf8');
  } catch {
    // stdin may not be available when invoked directly for testing
    stdinData = '';
  }

  const hookArgs = buildArgs(subcommand, rest);

  // Priority 1: locally installed ruflo binary
  if (commandExists('ruflo')) {
    invokeHook('ruflo', [], hookArgs, stdinData);
    done();
  }

  // Priority 2: locally installed claude-flow binary
  if (commandExists('claude-flow')) {
    invokeHook('claude-flow', [], hookArgs, stdinData);
    done();
  }

  // Priority 3: npx --prefer-offline fallback (avoids cold registry resolve).
  //
  // SKIP this when RUFLO_HOOK_SKIP_NPX=1 — used by CI smokes that test
  // the shim's *control flow* without exercising npm install network paths.
  // Without the skip, npx can take 30+s on a cold runner (no warm cache,
  // no offline tarball), exceeding the smoke's 15s timeout and producing
  // a spurious failure even though the shim itself works correctly.
  // The bash version doesn't hit this because it backgrounded the work.
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', 'ruflo@latest'], hookArgs, stdinData);
  }

  done();
}

main();
