#!/usr/bin/env node
/**
 * ruflo-hook.cjs — cross-platform Node.js port of ruflo-hook.sh (#2132, #2721)
 *
 * The bash shim (ruflo-hook.sh) works on Mac/Linux but fails outright on
 * native Windows: hooks.json wrapped it in `/bin/bash -c '...'`, and
 * `/bin/bash` is not a valid Windows path — Codex/Claude Code report
 * "PreToolUse hook (failed) — exit code 1" on every tool call (#2721).
 *
 * This file is now the ONLY hook implementation `hooks.json` invokes, on
 * every OS (see the `node -e` bootstrap command in ../hooks/hooks.json).
 * It replicates, in pure Node with no shell/jq dependency:
 *   - modify-bash / modify-file  (PreToolUse)  — best-effort CLI call, then
 *     ALWAYS echo `{"permission":"allow"}` on stdout (Cursor's PreToolUse
 *     contract requires valid-JSON stdout; Claude Code ignores it).
 *   - post-command / post-edit  (PostToolUse)  — parse the hook event JSON
 *     from stdin (no jq), extract the same fields the bash version pulled
 *     with jq, and forward them as CLI flags.
 *   - precompact-manual / precompact-auto  (PreCompact) — static guidance
 *     text, no CLI call at all (matches the bash version's plain echoes).
 *   - session-end  (Stop) — forwarded as-is, same flags as before.
 *
 * Shared behaviour:
 *   1. Prefers a locally installed `ruflo` or `claude-flow` binary.
 *   2. Falls back to `npx --prefer-offline ruflo@latest`.
 *   3. ALWAYS exits 0 — hook subcommands are best-effort telemetry; a
 *      failure must never surface an error or block a turn.
 *   4. Swallows all stdout/stderr from the invoked CLI.
 *
 * Usage: node ruflo-hook.cjs <hook-subcommand>
 *   (invoked via the `node -e` bootstrap in hooks.json, which resolves
 *   this script's path from `process.env.CLAUDE_PLUGIN_ROOT` — no shell
 *   env-var expansion needed, so there is no `${VAR}` vs `%VAR%` split)
 */

'use strict';

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');

/** Exit 0 unconditionally — hooks must never block a turn */
function done() {
  process.exit(0);
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

/**
 * Spawn the CLI with the hook subcommand + args, forwarding stdinData.
 * Returns true on success (exit 0), false otherwise. Never throws.
 */
function invokeHook(bin, binArgs, hookSubcommand, hookArgs, stdinData) {
  const args = [...binArgs, 'hooks', hookSubcommand, ...hookArgs];
  // On Windows, shell: true is needed to resolve .cmd/.ps1 shims that npm
  // creates for globally-installed bins (`ruflo`, `claude-flow`, `npx`) —
  // CreateProcess cannot execute those directly. BUT shell:true hands the
  // whole command line to cmd.exe, which re-tokenizes it (no automatic
  // quoting of array elements), corrupting any argument containing spaces
  // or shell metacharacters — e.g. a `post-command` value of "echo hi"
  // silently truncates to "echo", and a heredoc value containing `<<`
  // errors outright. `node` itself is always a real .exe (never a shim),
  // so skip the shell entirely there — CreateProcess gets the argv array
  // verbatim, byte-for-byte, no re-tokenization possible. This covers the
  // common `node <cli.js>` invocation (test harness, npx-resolved runs).
  // A real global `ruflo`/`claude-flow` install still goes through the
  // shim path below and inherits cmd.exe's pre-existing argv-mangling
  // limitation for complex values — not a regression from this change,
  // just not fully solved by it; tracked as a follow-up.
  const useShell = process.platform === 'win32' && bin !== 'node' && bin !== process.execPath;
  // Test-only: RUFLO_HOOK_DEBUG_STDOUT surfaces the invoked CLI's own
  // stdout/stderr instead of swallowing them, so test-hooks.mjs can assert
  // on the CLI's actual recorded value (e.g. catching #1859/#1862-style
  // flag-wiring regressions). Production never sets this — hooks must
  // never leak CLI output into the host (Cursor's PreToolUse contract).
  const debug = process.env.RUFLO_HOOK_DEBUG_STDOUT === '1';
  try {
    const result = spawnSync(bin, args, {
      shell: useShell,
      input: stdinData || '',
      encoding: 'utf8',
      stdio: debug ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'ignore', 'ignore'],
      timeout: 30_000,
    });
    if (debug) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    return result.status === 0;
  } catch {
    return false;
  }
}

/** Best-effort: try ruflo, then claude-flow, then npx. Never throws. */
function invokeCli(hookSubcommand, hookArgs, stdinData) {
  // Test-only escape hatch: point at a specific local build instead of the
  // commandExists() PATH probe (used by test-hooks.mjs and the plugin-hooks
  // real-command smoke so tests exercise the build under test, not whatever
  // happens to be on the runner's PATH). Space-split — always a simple
  // "node /abs/path/cli.js" invocation in practice, never quoted args.
  const override = process.env.RUFLO_HOOK_CLI_OVERRIDE;
  if (override) {
    const [bin, ...binArgs] = override.split(' ').filter(Boolean);
    invokeHook(bin, binArgs, hookSubcommand, hookArgs, stdinData);
    return;
  }
  if (commandExists('ruflo')) {
    invokeHook('ruflo', [], hookSubcommand, hookArgs, stdinData);
    return;
  }
  if (commandExists('claude-flow')) {
    invokeHook('claude-flow', [], hookSubcommand, hookArgs, stdinData);
    return;
  }
  // SKIP npx when RUFLO_HOOK_SKIP_NPX=1 — used by CI smokes that test the
  // shim's *control flow* without exercising npm install network paths.
  // Without the skip, npx can take 30+s on a cold runner, exceeding a
  // smoke's timeout and producing a spurious failure even though the shim
  // itself works correctly. The bash version doesn't hit this because it
  // backgrounded the work.
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', 'ruflo@latest'], hookSubcommand, hookArgs, stdinData);
  }
}

/** Read all of stdin synchronously. Returns '' on any failure (best effort). */
function readStdinRaw() {
  try {
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
    return buf;
  } catch {
    return '';
  }
}

/** Parse stdinData as JSON, returning {} on any parse failure. */
function parseEventJson(stdinData) {
  try {
    const trimmed = (stdinData || '').trim();
    return trimmed ? JSON.parse(trimmed) : {};
  } catch {
    return {};
  }
}

/**
 * PreCompact guidance text — matches the bash `echo` lines verbatim.
 * Not a CLI call at all; pure stdout guidance for the transcript/context.
 */
function precompactManual(event) {
  const custom = typeof event?.custom_instructions === 'string' ? event.custom_instructions : '';
  const lines = [
    '🔄 PreCompact Guidance:',
    '📋 IMPORTANT: Review CLAUDE.md in project root for:',
    '   • 54 available agents and concurrent usage patterns',
    '   • Swarm coordination strategies (hierarchical, mesh, adaptive)',
    '   • SPARC methodology workflows with batchtools optimization',
    '   • Critical concurrent execution rules (GOLDEN RULE: 1 MESSAGE = ALL OPERATIONS)',
  ];
  if (custom) lines.push(`🎯 Custom compact instructions: ${custom}`);
  lines.push('✅ Ready for compact operation');
  process.stdout.write(lines.join('\n') + '\n');
}

function precompactAuto() {
  const lines = [
    '🔄 Auto-Compact Guidance (Context Window Full):',
    '📋 CRITICAL: Before compacting, ensure you understand:',
    '   • All 54 agents available in .claude/agents/ directory',
    '   • Concurrent execution patterns from CLAUDE.md',
    '   • Batchtools optimization for 300% performance gains',
    '   • Swarm coordination strategies for complex tasks',
    '⚡ Apply GOLDEN RULE: Always batch operations in single messages',
    '✅ Auto-compact proceeding with full agent context',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function main() {
  const [subcommand] = process.argv.slice(2);
  if (!subcommand) done(); // no subcommand — no-op, same as bash version

  // PreCompact: pure guidance text, no CLI call, no stdin required beyond
  // (optionally) custom_instructions for the manual variant.
  if (subcommand === 'precompact-manual') {
    precompactManual(parseEventJson(readStdinRaw()));
    done();
  }
  if (subcommand === 'precompact-auto') {
    precompactAuto();
    done();
  }

  const stdinData = readStdinRaw();

  // PostToolUse: derive CLI flags from the hook event JSON (replaces jq).
  if (subcommand === 'post-command') {
    const event = parseEventJson(stdinData);
    const cmd = event?.tool_input?.command;
    if (!cmd) done(); // bash version: `[ -z "$CMD" ] && exit 0`
    const exitCode = event?.tool_response?.exit_code ?? 0;
    invokeCli('post-command', ['-c', String(cmd), '-s', String(exitCode === 0), '-e', String(exitCode)], stdinData);
    done();
  }
  if (subcommand === 'post-edit') {
    const event = parseEventJson(stdinData);
    const file = event?.tool_input?.file_path ?? event?.tool_input?.path;
    if (!file) done(); // bash version: `[ -z "$FILE" ] && exit 0`
    invokeCli('post-edit', ['-f', String(file), '-s', 'true'], stdinData);
    done();
  }

  // PreToolUse: best-effort CLI call, then ALWAYS echo the permission verdict
  // (Cursor's stricter preToolUse contract requires valid-JSON stdout).
  if (subcommand === 'modify-bash' || subcommand === 'modify-file') {
    invokeCli(subcommand, [], stdinData);
    process.stdout.write('{"permission":"allow"}');
    done();
  }

  // Stop / session-end and anything else: forward remaining argv unchanged
  // (matches ruflo-hook.sh's generic `ruflo hooks "$@"` passthrough).
  const extraArgs = process.argv.slice(3);
  invokeCli(subcommand, extraArgs, stdinData);
  done();
}

main();
