#!/usr/bin/env node
/**
 * ruflo-hook.cjs — cross-platform Node.js port of ruflo-hook.sh (#2132)
 *
 * The bash shim (ruflo-hook.sh) works on Mac/Linux but fails on native
 * Windows (exit 126 — "cannot execute binary file"). This .cjs shim
 * provides identical behaviour via Node.js child_process so Windows users
 * get working hooks without WSL or Git Bash.
 *
 * As of #2272, hooks.json invokes this shim directly via `node` on all
 * platforms — Mac, Linux, and Windows. The old `/bin/bash -c` path is gone.
 *
 * Behaviour mirrors ruflo-hook.sh:
 *   1. Reads hook JSON payload from stdin.
 *   2. Prefers a locally installed `ruflo` or `claude-flow` binary.
 *   3. Falls back to `npx --prefer-offline ruflo@alpha`.
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
  const useShell = process.platform === 'win32';

  const result = spawnSync(bin, args, {
    shell: useShell,
    input: stdinData || '',
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 30_000,
  });

  return result.status === 0;
}

/**
 * Output PreCompact guidance text for the given mode.
 * Mirrors the echo calls that were previously in hooks.json /bin/bash -c blocks.
 * In 'manual' mode, also reads stdin for custom_instructions (matching old bash behaviour).
 */
function preCompact(mode) {
  if (mode === 'manual') {
    // Read stdin for custom_instructions (mirrors old bash: INPUT=$(cat); CUSTOM=$(echo "$INPUT" | jq -r ".custom_instructions // \"\"")`)
    let custom = '';
    try {
      const raw = fs.readFileSync(0, 'utf8').trim();
      if (raw) {
        const payload = JSON.parse(raw);
        custom = (payload && payload.custom_instructions) ? String(payload.custom_instructions).trim() : '';
      }
    } catch { /* best-effort */ }
    console.log('🔄 PreCompact Guidance:');
    console.log('📋 IMPORTANT: Review CLAUDE.md in project root for:');
    console.log('   • 54 available agents and concurrent usage patterns');
    console.log('   • Swarm coordination strategies (hierarchical, mesh, adaptive)');
    console.log('   • SPARC methodology workflows with batchtools optimization');
    console.log('   • Critical concurrent execution rules (GOLDEN RULE: 1 MESSAGE = ALL OPERATIONS)');
    if (custom) {
      console.log('🎯 Custom compact instructions: ' + custom);
    }
    console.log('✅ Ready for compact operation');
  } else {
    // auto (and default fallback)
    console.log('🔄 Auto-Compact Guidance (Context Window Full):');
    console.log('📋 CRITICAL: Before compacting, ensure you understand:');
    console.log('   • All 54 agents available in .claude/agents/ directory');
    console.log('   • Concurrent execution patterns from CLAUDE.md');
    console.log('   • Batchtools optimization for 300% performance gains');
    console.log('   • Swarm coordination strategies for complex tasks');
    console.log('⚡ Apply GOLDEN RULE: Always batch operations in single messages');
    console.log('✅ Auto-compact proceeding with full agent context');
  }
}

/**
 * Parse stdin JSON (the Claude Code hook event payload) and extract
 * the fields needed for post-command / post-edit hooks.
 * Mirrors the jq extraction that was previously in hooks.json bash blocks.
 */
function parseStdinPayload() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8').trim(); } catch { raw = ''; }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Mapping from hook subcommand → stdin JSON field paths to extract as args.
 * Matches the jq extractions from the old hooks.json bash blocks.
 * Each entry: { field: jq-style path, flag: CLI flag name, fallbackField?: alt path }
 * Special field '_echo' means echo-only, no CLI call.
 */
const SUBCOMMAND_FIELDS = {
  'pre-edit':       { field: 'tool_input.file_path', flag: '--file', fallbackField: 'tool_input.path' },
  'pre-command':    { field: 'tool_input.command', flag: '--command' },
  'pre-task':       { field: 'tool_input.description', flag: '--description', maxLen: 200 },
  'pre-search':     { field: 'tool_input.pattern', flag: '--query', fallbackField: 'tool_input.query' },
  'mcp-pre':        { field: 'tool_name', flag: '--tool' },
  'post-command':   { field: null },
  'post-edit':      { field: null },
  'post-task':      { field: 'tool_response.agent_id', flag: '--task-id', fallbackField: 'tool_response.task_id', extraArgs: ['--analyze-performance'] },
  'post-search':    { field: 'tool_input.pattern', flag: '--query', fallbackField: 'tool_input.query', extraArgs: ['--cache-results'] },
  'mcp-post':       { field: 'tool_name', flag: '--tool' },
  'route':          { field: 'prompt', flag: '--task', extraArgs: ['--include-explanation'] },
  'session-start':  { field: 'session_id', flag: '--session-id', extraArgs: ['--load-context'] },
  'notify':         { field: 'message', flag: '--message', extraArgs: ['--swarm-status'] },
};

/** Get a nested value from an object by dot-separated path */
function getByPath(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    done();
  }

  const [subcommand, ...rest] = args;

  // pre-compact is handled locally (echo-only guidance, no CLI dispatch)
  if (subcommand === 'pre-compact') {
    const mode = rest.includes('--mode')
      ? rest[rest.indexOf('--mode') + 1]
      : 'auto';
    preCompact(mode);
    done();
  }

  let hookArgs;
  let stdinData = '';

  // post-command and post-edit have specialised arg extraction from stdin,
  // then merge any extra flags passed on the command line (e.g. --train-patterns,
  // --track-metrics, --store-results) so plugin/hooks/hooks.json can add them.
  if (subcommand === 'post-command') {
    const payload = parseStdinPayload();
    if (!payload) { done(); }
    const cmd = payload.tool_input?.command;
    if (!cmd) { done(); }
    const exitCode = payload.tool_response?.exit_code ?? 0;
    const success = exitCode === 0;
    hookArgs = ['hooks', subcommand, '-c', cmd, '-s', String(success), '-e', String(exitCode)];
    // Merge extra flags from command line (e.g. --track-metrics true --store-results true)
    if (rest.length > 0) hookArgs.push(...rest);
  } else if (subcommand === 'post-edit') {
    const payload = parseStdinPayload();
    if (!payload) { done(); }
    const file = payload.tool_input?.file_path || payload.tool_input?.path;
    if (!file) { done(); }
    hookArgs = ['hooks', subcommand, '-f', file, '-s', 'true'];
    // Merge extra flags from command line (e.g. --train-patterns)
    if (rest.length > 0) hookArgs.push(...rest);
  } else if (SUBCOMMAND_FIELDS[subcommand]) {
    // Generic stdin→arg extraction for known hook subcommands
    const payload = parseStdinPayload();
    if (!payload) { done(); }
    const cfg = SUBCOMMAND_FIELDS[subcommand];
    let value = getByPath(payload, cfg.field);
    if ((value == null || value === '') && cfg.fallbackField) {
      value = getByPath(payload, cfg.fallbackField);
    }
    if (value == null || value === '') { done(); }
    if (cfg.maxLen && typeof value === 'string' && value.length > cfg.maxLen) {
      value = value.slice(0, cfg.maxLen);
    }
    // xargs -0 -I safe quoting: wrap value in single quotes, escape internal single quotes
    const safeValue = typeof value === 'string'
      ? value.replace(/'/g, "'\\''")
      : String(value);
    hookArgs = ['hooks', subcommand, cfg.flag, safeValue];
    if (cfg.extraArgs && Array.isArray(cfg.extraArgs)) {
      hookArgs.push(...cfg.extraArgs);
    }
  } else {
    // modify-bash, modify-file, session-end, and any future subcommands
    hookArgs = buildArgs(subcommand, rest);
    try {
      stdinData = fs.readFileSync(0, 'utf8');
    } catch {
      stdinData = '';
    }
  }

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

  // Priority 3: npx --prefer-offline fallback
  if (process.env.RUFLO_HOOK_SKIP_NPX !== '1') {
    invokeHook('npx', ['--prefer-offline', '--yes', 'ruflo@alpha'], hookArgs, stdinData);
  }

  done();
}

main();
