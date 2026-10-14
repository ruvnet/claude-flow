#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#1859, #1862, #2721, #2816, #2856.
 *
 * Drives every hook command from `hooks/hooks.json` — PreToolUse,
 * PostToolUse, PostToolUseFailure, PreCompact, Stop — with synthetic Claude-Code-style stdin,
 * against a locally built CLI, executed EXACTLY as Claude Code/Codex would
 * run it: `spawnSync(command, { shell: true, ... })`, no bash wrapper of
 * our own. That's the point of this rewrite (#2721) — the old version
 * spawned `bash -c <cmd>` itself, which meant it could never have caught
 * the `/bin/bash` literal breaking on native Windows; `shell: true` uses
 * cmd.exe on Windows and /bin/sh elsewhere, matching the real hook runner.
 *
 * Two env vars steer the shim (see ../scripts/ruflo-hook.cjs) at the build
 * under test instead of whatever's on the runner's PATH:
 *   - CLAUDE_PLUGIN_ROOT       — resolves ruflo-hook.cjs's own path (real
 *                                per-hook-invocation env var, always set)
 *   - RUFLO_HOOK_CLI_OVERRIDE  — bypasses the ruflo/claude-flow/npx PATH
 *                                probe so the test exercises the exact
 *                                flag wiring users hit, pinned to the
 *                                build under test (test-only escape hatch)
 *
 * Asserts:
 *   - Exit code 0 (no parser errors like "Invalid value for --format")
 *   - Output records the *intended* value (the file path / command), not a
 *     stray boolean like "true" — the symptom that #1859 reported
 *   - Cursor PreToolUse hooks emit valid `{"permission":"allow"}` JSON
 *   - Codex PreToolUse hooks exit 0 with empty stdout, while both telemetry
 *     subcommands are still invoked (#2816)
 *   - PostToolUse hooks silently no-op (exit 0, no CLI call) when the
 *     expected field is missing from the event JSON
 *   - Malformed / empty stdin never causes a nonzero exit
 *
 * Usage (from repo root):
 *   node plugins/ruflo-core/scripts/test-hooks.mjs <path-to-cli-binary>
 *
 * Wired into .github/workflows/v3-ci.yml as the `plugin-hooks-smoke` job
 * (windows-latest, macos-latest, ubuntu-latest).
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PLUGIN_ROOT = join(__dirname, '..');
const HOOKS_JSON = join(PLUGIN_ROOT, 'hooks', 'hooks.json');
const HOOK_RECORDER = join(__dirname, 'fixtures', 'hook-cli-recorder.cjs');

// `cliInvoke` is the literal token-string that should run the CLI — caller
// passes the full thing so this script doesn't need to guess shebangs:
//   - local node script:   "node /abs/path/to/bin/cli.js"
//   - npx fallthrough:     "npx --yes @claude-flow/cli@latest"
const cliInvoke = process.argv[2];
if (!cliInvoke) {
  console.error('Usage: node test-hooks.mjs "<cli-invocation-string>"');
  console.error('Examples:');
  console.error('  node test-hooks.mjs "node $PWD/v3/@claude-flow/cli/bin/cli.js"');
  console.error('  node test-hooks.mjs "npx --yes @claude-flow/cli@latest"');
  process.exit(2);
}

const hooks = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));

const findHook = (event, matcher) => {
  const list = hooks.hooks?.[event] ?? [];
  const hit = matcher === undefined ? list[0] : list.find(h => h.matcher === matcher);
  if (!hit) throw new Error(`No ${event} hook with matcher=${matcher}`);
  return hit.hooks[0].command;
};

const cmdModifyBash = findHook('PreToolUse', 'Bash');
const cmdModifyFile = findHook('PreToolUse', 'Write|Edit|MultiEdit');
const cmdPostCommand = findHook('PostToolUse', 'Bash');
const cmdPostEdit = findHook('PostToolUse', 'Write|Edit|MultiEdit');
const cmdFailedCommand = findHook('PostToolUseFailure', 'Bash');
const cmdFailedEdit = findHook('PostToolUseFailure', 'Write|Edit|MultiEdit');
const cmdPrecompactManual = findHook('PreCompact', 'manual');
const cmdPrecompactAuto = findHook('PreCompact', 'auto');
const cmdStop = findHook('Stop', undefined);

let failed = 0;
const cases = [];

const run = (name, cmd, stdin, assertions, options = {}) => {
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    RUFLO_HOOK_CLI_OVERRIDE: options.cliOverride ?? cliInvoke,
    RUFLO_HOOK_SKIP_NPX: '1',
    ...options.env,
  };
  for (const key of options.unsetEnv ?? []) delete env[key];
  if (options.debug !== false) env.RUFLO_HOOK_DEBUG_STDOUT = '1';
  else delete env.RUFLO_HOOK_DEBUG_STDOUT;

  const r = spawnSync(cmd, {
    shell: true,
    input: stdin,
    encoding: 'utf8',
    env,
    // A clean CI runner may spend more than 15 seconds starting the CLI and
    // policy/memory backends for its first Edit hook. Keep a finite timeout,
    // but allow that measured cold-start path to complete.
    timeout: 30_000,
  });
  const combined = (r.stdout ?? '') + (r.stderr ?? '');
  const errors = [];
  if (r.error) errors.push(`spawn error: ${r.error.message}`);
  if (r.status !== 0) errors.push(`exit ${r.status} (expected 0)`);
  for (const a of assertions) {
    if (a.contains && !combined.includes(a.contains)) errors.push(`missing "${a.contains}" in output`);
    if (a.absent && combined.includes(a.absent)) errors.push(`unexpected "${a.absent}" in output`);
    if (Object.hasOwn(a, 'stdoutEquals') && (r.stdout ?? '') !== a.stdoutEquals) {
      errors.push(`stdout was ${JSON.stringify(r.stdout ?? '')}, expected ${JSON.stringify(a.stdoutEquals)}`);
    }
  }
  if (errors.length === 0) {
    console.log(`ok: ${name}`);
  } else {
    console.error(`FAIL: ${name}`);
    for (const e of errors) console.error(`     - ${e}`);
    if (combined.trim()) {
      console.error('     output:');
      for (const line of combined.split('\n').slice(0, 8)) console.error(`       ${line}`);
    }
    failed++;
  }
  cases.push(name);
};

// --- PreToolUse: modify-bash / modify-file ---
const cursorEnv = { unsetEnv: ['PLUGIN_ROOT', 'PLUGIN_DATA'] };
const codexEnv = {
  env: {
    PLUGIN_ROOT,
    PLUGIN_DATA: join(PLUGIN_ROOT, '.test-data'),
  },
  cliOverride: `"${process.execPath}" "${HOOK_RECORDER}"`,
};

run('Cursor PreToolUse (Bash) emits permission-allow JSON',
  cmdModifyBash,
  '{"tool_input":{"command":"echo hi"}}',
  [{ contains: '{"permission":"allow"}' }],
  cursorEnv);

run('Cursor PreToolUse (Edit) emits permission-allow JSON',
  cmdModifyFile,
  '{"tool_input":{"file_path":"/tmp/foo.ts"}}',
  [{ contains: '{"permission":"allow"}' }],
  cursorEnv);

run('Cursor PreToolUse (Bash) emits permission-allow even with empty stdin',
  cmdModifyBash,
  '',
  [{ contains: '{"permission":"allow"}' }],
  cursorEnv);

run('Cursor PreToolUse (Bash) emits permission-allow even with malformed JSON',
  cmdModifyBash,
  '{not json',
  [{ contains: '{"permission":"allow"}' }],
  cursorEnv);

run('Codex PreToolUse (Bash) exits 0 with empty stdout',
  cmdModifyBash,
  '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}',
  [{ stdoutEquals: '' }],
  { ...codexEnv, debug: false });

run('Codex PreToolUse (Edit) exits 0 with empty stdout',
  cmdModifyFile,
  '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch"}}',
  [{ stdoutEquals: '' }],
  { ...codexEnv, debug: false });

run('Codex PreToolUse (Bash) still invokes telemetry',
  cmdModifyBash,
  '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}',
  [{ contains: 'hook-telemetry:modify-bash' }, { absent: '{"permission":"allow"}' }],
  codexEnv);

run('Codex PreToolUse (Edit) still invokes telemetry',
  cmdModifyFile,
  '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch"}}',
  [{ contains: 'hook-telemetry:modify-file' }, { absent: '{"permission":"allow"}' }],
  codexEnv);

// #2856 — Codex's PLUGIN_ROOT/PLUGIN_DATA env vars may not be present on
// every install/config path; the `turn_id` field Codex always includes in
// the hook event JSON is a documented Codex-only extension and must be
// enough on its own to suppress the Cursor-shaped permission object.
const codexTurnIdOnlyEnv = { unsetEnv: ['PLUGIN_ROOT', 'PLUGIN_DATA'] };

run('Codex PreToolUse (Bash) detected via turn_id alone (no PLUGIN_ROOT/PLUGIN_DATA) exits 0 with empty stdout',
  cmdModifyBash,
  '{"hook_event_name":"PreToolUse","turn_id":"turn_2856","model":"gpt-5.6-sol","tool_name":"Bash","tool_input":{"command":"echo hi"}}',
  [{ stdoutEquals: '' }],
  { ...codexTurnIdOnlyEnv, debug: false });

run('Cursor PreToolUse (Bash) without turn_id still emits permission-allow JSON',
  cmdModifyBash,
  '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}',
  [{ contains: '{"permission":"allow"}' }],
  codexTurnIdOnlyEnv);

// --- PostToolUse: post-edit ---
run('Edit hook records file_path (regression #1859: was "true")',
  cmdPostEdit,
  '{"tool_input":{"file_path":"/tmp/foo.ts"}}',
  [{ contains: '/tmp/foo.ts' }, { absent: 'Recording outcome for: true' }, { absent: 'Invalid value' }]);

run('Edit hook records legacy "path" field',
  cmdPostEdit,
  '{"tool_input":{"path":"/tmp/bar.ts"}}',
  [{ contains: '/tmp/bar.ts' }, { absent: 'Invalid value' }]);

run('Edit hook silently no-ops when no path present',
  cmdPostEdit,
  '{"tool_input":{}}',
  []);

run('Edit hook silently no-ops on malformed JSON',
  cmdPostEdit,
  '{not json',
  []);

// --- PostToolUse: post-command ---
run('Bash hook records simple command',
  cmdPostCommand,
  '{"tool_input":{"command":"echo hi"},"tool_response":{"exit_code":0}}',
  [{ contains: 'echo hi' }, { absent: 'Required option missing' }, { absent: 'Invalid value' }]);

run('Bash hook records multi-line heredoc (regression #1859)',
  cmdPostCommand,
  '{"tool_input":{"command":"cat <<EOF\\nline1\\nline2\\nEOF"},"tool_response":{"exit_code":0}}',
  [{ contains: 'cat <<EOF' }, { absent: 'Required option missing' }]);

run('Bash hook records non-zero exit (distinct from -s value)',
  cmdPostCommand,
  '{"tool_input":{"command":"echo failing-cmd"},"tool_response":{"exit_code":1}}',
  [{ contains: 'echo failing-cmd' }, { absent: 'Recording command outcome: false' }, { absent: 'Recording command outcome: true' }]);

run('Bash hook silently no-ops when no command present',
  cmdPostCommand,
  '{"tool_input":{},"tool_response":{}}',
  []);

run('Bash hook silently no-ops on empty stdin',
  cmdPostCommand,
  '',
  []);

// #4127: Claude Code sends failed tools to PostToolUseFailure, not PostToolUse.
// Verify actual plugin registration and the argv passed to the CLI; a hook
// returning 0 alone would miss the original false-success telemetry bug.
const recorderOverride = `"${process.execPath}" "${HOOK_RECORDER}"`;
const recordedArgs = {
  cliOverride: recorderOverride,
  // Deduplication is covered separately below; fixed event IDs would otherwise
  // make a repeated local run skip these argv assertions.
  env: { RUFLO_HOOK_RECORD_ARGS: '1', RUFLO_DISABLE_HOOK_DEDUP: '1' },
};

run('Failed Bash hook records non-zero exit and false success',
  cmdFailedCommand,
  JSON.stringify({
    hook_event_name: 'PostToolUseFailure', tool_use_id: 'toolu_failed_bash_4127',
    tool_input: { command: 'echo failed; exit 3' }, error: 'Exit code 3\nfailed',
  }),
  [{ contains: JSON.stringify(['hooks', 'post-command', '-c', 'echo failed; exit 3', '-s', 'false', '-e', '3']) }],
  recordedArgs);

run('Failed Bash hook without numeric exit is still a failure',
  cmdFailedCommand,
  JSON.stringify({
    hook_event_name: 'PostToolUseFailure', tool_use_id: 'toolu_failed_start_4127',
    tool_input: { command: 'missing-shell-command' }, error: 'Could not start shell',
  }),
  [{ contains: JSON.stringify(['hooks', 'post-command', '-c', 'missing-shell-command', '-s', 'false', '-e', '1']) }],
  recordedArgs);

run('Failed Edit hook records false success',
  cmdFailedEdit,
  JSON.stringify({
    hook_event_name: 'PostToolUseFailure', tool_use_id: 'toolu_failed_edit_4127',
    tool_input: { file_path: '/tmp/failed.ts' }, error: 'Permission denied',
  }),
  [{ contains: JSON.stringify(['hooks', 'post-edit', '-f', '/tmp/failed.ts', '-s', 'false']) }],
  recordedArgs);

run('Successful Edit hook still records true success',
  cmdPostEdit,
  JSON.stringify({
    hook_event_name: 'PostToolUse', tool_use_id: 'toolu_success_edit_4127',
    tool_input: { file_path: '/tmp/success.ts' }, tool_response: {},
  }),
  [{ contains: JSON.stringify(['hooks', 'post-edit', '-f', '/tmp/success.ts', '-s', 'true']) }],
  recordedArgs);

// --- PreCompact: pure guidance text, no CLI call ---
run('PreCompact (manual) prints guidance and includes custom instructions',
  cmdPrecompactManual,
  '{"custom_instructions":"focus on the auth module"}',
  [{ contains: 'PreCompact Guidance' }, { contains: 'focus on the auth module' }]);

run('PreCompact (manual) prints guidance with no custom instructions',
  cmdPrecompactManual,
  '{}',
  [{ contains: 'PreCompact Guidance' }, { absent: 'Custom compact instructions' }]);

run('PreCompact (auto) prints guidance',
  cmdPrecompactAuto,
  '',
  [{ contains: 'Auto-Compact Guidance' }]);

// --- Stop: session-end ---
run('Stop hook runs session-end without error',
  cmdStop,
  '{}',
  [{ absent: 'Required option missing' }, { absent: 'Invalid value' }]);

// #2640 — project settings + marketplace plugin can dispatch the same event.
// The shared atomic claim makes the second side-effecting invocation a no-op.
{
  const dedupDir = mkdtempSync(join(tmpdir(), 'ruflo-hook-dedup-test-'));
  const payload = '{"tool_use_id":"toolu_dedup_2640","tool_input":{"file_path":"/tmp/dedup.ts"}}';
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    CLAUDE_PROJECT_DIR: PLUGIN_ROOT,
    RUFLO_HOOK_CLI_OVERRIDE: `"${process.execPath}" "${HOOK_RECORDER}"`,
    RUFLO_HOOK_DEBUG_STDOUT: '1',
    RUFLO_HOOK_SKIP_NPX: '1',
    RUFLO_HOOK_DEDUP_DIR: dedupDir,
  };
  try {
    const first = spawnSync(cmdPostEdit, { shell: true, input: payload, encoding: 'utf8', env });
    const second = spawnSync(cmdPostEdit, { shell: true, input: payload, encoding: 'utf8', env });
    const ok = first.status === 0 && second.status === 0 &&
      (first.stdout || '').includes('hook-telemetry:post-edit') &&
      !(second.stdout || '').includes('hook-telemetry:post-edit');
    if (ok) {
      console.log('ok: duplicate post-edit event executes side effects exactly once');
    } else {
      console.error('FAIL: duplicate post-edit event was not deduplicated');
      failed++;
    }
    cases.push('duplicate post-edit event executes side effects exactly once');
  } finally {
    rmSync(dedupDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Windows argv integrity: hook-derived values must never be re-parsed as
// shell syntax. Extends the escaping added in #3322 to the remaining copies.
//
// This job runs on windows-latest as well as ubuntu/macos (see the "Plugin
// hooks smoke" matrix in .github/workflows/v3-ci.yml), which makes it the one
// place in the repo where the Windows behaviour can be executed for real
// rather than asserted as a string transform. PR #3322 could only be verified
// at the string level; this closes that gap.
//
// Layer 1 (all platforms): resolveInvocation() maps an npm .cmd shim to the
// .js entrypoint it wraps, so the spawn is `node <entry>` with shell:false and
// cmd.exe never runs. Driven with an injected { platform: 'win32', env }, so
// the Windows branch is exercised on every OS in the matrix.
//
// Layer 2 (windows only): a .cmd that is NOT an npm package layout cannot be
// resolved, so escapeCmdArg() + shell:true is used. On a real Windows runner
// this executes cmd.exe for real.
{
  globalThis.__RUFLO_HOOK_IMPORT_ONLY__ = true;
  process.env.RUFLO_HOOK_UNIT_TEST = '1';
  const hook = require('./ruflo-hook.cjs');
  delete globalThis.__RUFLO_HOOK_IMPORT_ONLY__;
  delete process.env.RUFLO_HOOK_UNIT_TEST;

  const secDir = mkdtempSync(join(tmpdir(), 'ruflo-hook-667-'));
  // Every metacharacter escapeCmdArg() claims to neutralise. %VAR% is
  // deliberately excluded here and probed separately below.
  const PAYLOAD = 'x & calc.exe | "q" ^ !v! <in >out; a,b (c)';

  try {
    // ---- Layer 1: npm shim resolves to the package entry, no shell ----
    for (const sc of [
      { cmd: 'ruflo', pkg: 'ruflo', entry: 'bin/ruflo.js', binArgs: [] },
      { cmd: 'claude-flow', pkg: 'claude-flow', entry: 'bin/cli.js', binArgs: [] },
      { cmd: 'npx', pkg: 'npm', entry: 'bin/npx-cli.js', binArgs: ['--prefer-offline', '--yes', 'ruflo@latest'] },
    ]) for (const layout of ['global', 'local']) {
      const prefix = join(secDir, `${sc.cmd}-${layout} with spaces`);
      const shimDir = layout === 'local' ? join(prefix, 'node_modules', '.bin') : prefix;
      const pkgDir = join(prefix, 'node_modules', sc.pkg);
      const entryPath = join(pkgDir, sc.entry);
      const argvFile = join(prefix, 'argv.json');
      mkdirSync(dirname(entryPath), { recursive: true });
      mkdirSync(shimDir, { recursive: true });
      // Sibling shims that must never execute — if one does, the resolver
      // took a shell path instead of the package entrypoint.
      writeFileSync(join(shimDir, `${sc.cmd}.cmd`), '@echo off\r\nexit /b 3\r\n');
      writeFileSync(join(shimDir, `${sc.cmd}.ps1`), 'throw "must not execute"\r\n');
      writeFileSync(join(shimDir, sc.cmd), '#!/bin/sh\nexit 99\n');
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: sc.pkg, bin: { [sc.cmd]: sc.entry } }));
      writeFileSync(entryPath, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.RUFLO_TEST_ARGV_FILE, JSON.stringify(process.argv.slice(2)));\n`);
      chmodSync(entryPath, 0o755);

      const ok = hook.invokeHook(sc.cmd, sc.binArgs, 'post-command', ['-c', PAYLOAD], '{}', {
        platform: 'win32',
        env: { ...process.env, PATH: shimDir, PATHEXT: '.COM;.EXE;.BAT;.CMD', RUFLO_TEST_ARGV_FILE: argvFile },
      });
      const argv = existsSync(argvFile) ? JSON.parse(readFileSync(argvFile, 'utf8')) : null;
      const want = [...sc.binArgs, 'hooks', 'post-command', '-c', PAYLOAD];
      const name = `win32 argv: ${layout} ${sc.cmd}.cmd resolves to the package entry and forwards argv intact`;
      if (ok && JSON.stringify(argv) === JSON.stringify(want)) {
        console.log(`ok: ${name}`);
      } else {
        console.error(`FAIL: ${name}\n     got: ${JSON.stringify(argv)}`);
        failed++;
      }
      cases.push(name);
    }

    // ---- Layer 2: unresolvable .cmd, escaped through real cmd.exe ----
    // Only meaningful where cmd.exe exists. On the windows-latest runner this
    // is the first real execution of the #3322 escaping.
    if (process.platform === 'win32') {
      const prefix = join(secDir, 'bare-shim');
      mkdirSync(prefix, { recursive: true });
      const argvFile = join(prefix, 'argv.json');
      const marker = join(prefix, 'INJECTED');
      const recorder = join(prefix, 'record.js');
      writeFileSync(recorder, `require('node:fs').writeFileSync(process.env.RUFLO_TEST_ARGV_FILE, JSON.stringify(process.argv.slice(2)));\n`);
      // No node_modules/<pkg> beside it, so resolveNpmShim() returns null and
      // invokeHook() must fall back to the escaped shell. `%*` re-expands the
      // arguments — the second cmd.exe parse the escaping exists to survive.
      writeFileSync(join(prefix, 'ruflo.cmd'), `@echo off\r\n"${process.execPath}" "${recorder}" %*\r\n`);

      const ok = hook.invokeHook('ruflo', [], 'post-command', ['-c', PAYLOAD], '{}', {
        env: { ...process.env, PATH: prefix, PATHEXT: '.COM;.EXE;.BAT;.CMD', RUFLO_TEST_ARGV_FILE: argvFile },
      });
      const argv = existsSync(argvFile) ? JSON.parse(readFileSync(argvFile, 'utf8')) : null;
      const want = ['hooks', 'post-command', '-c', PAYLOAD];
      const name = 'win32 argv: unresolvable .cmd — escaped argv survives a real cmd.exe round trip';
      if (ok && JSON.stringify(argv) === JSON.stringify(want) && !existsSync(marker)) {
        console.log(`ok: ${name}`);
      } else {
        console.error(`FAIL: ${name}\n     got: ${JSON.stringify(argv)}`);
        failed++;
      }
      cases.push(name);

      // Known residual: carets do not reliably escape %, and quoting does not
      // suppress percent expansion, so a %VAR% in a hook value may be
      // substituted on the shim's second parse. That is data corruption, not
      // injection — so the hard assertion is only that nothing extra executed.
      // The round-trip result is REPORTED so the Windows runner tells us what
      // actually happens; it does not fail the build on a documented residual.
      const pctFile = join(prefix, 'argv-pct.json');
      const pctMarker = join(prefix, 'PCT_INJECTED');
      hook.invokeHook('ruflo', [], 'post-command', ['-c', '%USERPROFILE% & echo pwned > "' + pctMarker + '"'], '{}', {
        env: { ...process.env, PATH: prefix, PATHEXT: '.COM;.EXE;.BAT;.CMD', RUFLO_TEST_ARGV_FILE: pctFile },
      });
      const pctArgv = existsSync(pctFile) ? JSON.parse(readFileSync(pctFile, 'utf8')) : null;
      const pctName = 'win32 argv: %VAR% in a hook value does not inject a command';
      if (!existsSync(pctMarker)) {
        console.log(`ok: ${pctName}`);
        console.log(`     note (known residual, not a failure) — %VAR% round trip: ${JSON.stringify(pctArgv?.[3])}`);
      } else {
        console.error(`FAIL: ${pctName} — a redirection executed`);
        failed++;
      }
      cases.push(pctName);
    }
  } finally {
    rmSync(secDir, { recursive: true, force: true });
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
