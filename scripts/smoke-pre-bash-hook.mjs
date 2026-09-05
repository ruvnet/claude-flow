#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2017.
 *
 * The `pre-bash` PreToolUse hook in `.claude/helpers/hook-handler.cjs` reads
 * the command Claude Code is about to execute and refuses to run dangerous
 * ones (`rm -rf /`, `format c:`, etc.). In 3.6.30 the handler read the wrong
 * field — `toolInput` (the object) instead of `toolInput.command` (the
 * string) — so `.toLowerCase()` threw TypeError on every Bash call, was
 * swallowed by the global safety timer, and the handler exited 0 with a
 * misleading `[OK] Command validated`. Dangerous commands sailed through.
 *
 * This script pipes real-shaped Claude Code PreToolUse JSON into the
 * locally-built handler and asserts:
 *
 *   - dangerous command → exit 1 + `[BLOCKED] Dangerous command detected:`
 *   - innocuous command → exit 0 + `[OK] Command validated`
 *   - empty payload    → exit 0 (no crash, no false positive)
 *   - non-string command field → exit 0 (defensive String() wrap holds)
 *
 * Runs against BOTH copies of the handler in the repo:
 *   1. v3/@claude-flow/cli/.claude/helpers/hook-handler.cjs  (the published template)
 *   2. .claude/helpers/hook-handler.cjs                       (the dogfood copy)
 *
 * Failure of either fails the build.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const HANDLERS = [
  join(REPO_ROOT, 'v3', '@claude-flow', 'cli', '.claude', 'helpers', 'hook-handler.cjs'),
  join(REPO_ROOT, '.claude', 'helpers', 'hook-handler.cjs'),
];

const cases = [
  {
    name: 'dangerous rm -rf / → BLOCKED',
    input: { tool_name: 'Bash', tool_input: { command: 'rm -rf / --no-preserve-root' } },
    expectExit: 1,
    expectStderrIncludes: '[BLOCKED]',
  },
  {
    name: 'innocuous ls -la → OK',
    input: { tool_name: 'Bash', tool_input: { command: 'ls -la' } },
    expectExit: 0,
    expectStdoutIncludes: '[OK] Command validated',
  },
  {
    name: 'empty payload → no crash, no false block',
    input: {},
    expectExit: 0,
  },
  {
    // Defensive String() wrap: even if a future regression binds command to
    // null / undefined / an object, the handler must not throw and silently
    // exit 0 from the global safety catch.
    name: 'null command field → no crash',
    input: { tool_name: 'Bash', tool_input: { command: null } },
    expectExit: 0,
  },
  {
    // The exact #2017 shape: the handler reads `toolInput` (object) instead
    // of `toolInput.command` (string), so `.toLowerCase()` throws TypeError,
    // global try/catch swallows, exits 0. This case asserts the regression
    // CAN'T return: a dangerous command sent in real Claude Code's snake_case
    // shape must still BLOCK. If a future refactor binds command to a
    // non-string and the safety check no-ops, this case fails loudly.
    name: '#2017 shape: snake_case tool_input.command dangerous → BLOCKED',
    input: { tool_name: 'Bash', tool_input: { command: 'rm -rf / --no-preserve-root' } },
    expectExit: 1,
    expectStderrIncludes: '[BLOCKED]',
  },
  {
    name: 'fork-bomb signature → BLOCKED',
    input: { tool_name: 'Bash', tool_input: { command: ':(){:|:&};:' } },
    expectExit: 1,
    expectStderrIncludes: '[BLOCKED]',
  },
  {
    name: 'format c: → BLOCKED',
    input: { tool_name: 'Bash', tool_input: { command: 'format c: /q /y' } },
    expectExit: 1,
    expectStderrIncludes: '[BLOCKED]',
  },
];

function runOne(handlerPath, c) {
  const payload = JSON.stringify(c.input);
  const r = spawnSync('node', [handlerPath, 'pre-bash'], {
    input: payload,
    encoding: 'utf-8',
    timeout: 10_000,
  });
  const out = r.stdout || '';
  const err = r.stderr || '';
  const fails = [];
  if (r.status !== c.expectExit) {
    fails.push(`exit ${r.status} (expected ${c.expectExit})`);
  }
  if (c.expectStdoutIncludes && !out.includes(c.expectStdoutIncludes)) {
    fails.push(`stdout missing "${c.expectStdoutIncludes}"`);
  }
  if (c.expectStderrIncludes && !err.includes(c.expectStderrIncludes)) {
    fails.push(`stderr missing "${c.expectStderrIncludes}"`);
  }
  // Catch the #2017 silent-swallow shape: a [WARN] from the global try/catch
  // PLUS a 0 exit code means a real handler error was hidden. ANY case
  // (dangerous OR innocuous) where we see [WARN] ... encountered an error
  // is a real bug — the safety gate is no longer running its check.
  if (/\[WARN\] Hook .* encountered an error/.test(err)) {
    fails.push(`handler error swallowed by global catch (regression of #2017): ${err.trim().split('\n')[0]}`);
  }
  // Also catch the "[OK] Command validated" + dangerous input + exit 0 shape
  // directly — the form the published 3.6.30 actually printed before the
  // global-catch warning was added.
  if (c.expectExit === 1 && /\[OK\] Command validated/.test(out) && r.status === 0) {
    fails.push('dangerous command produced [OK] + exit 0 (regression of #2017)');
  }
  return { fails, out, err, status: r.status };
}

let failed = 0;
for (const handlerPath of HANDLERS) {
  if (!existsSync(handlerPath)) {
    console.error(`[skip] handler not found: ${handlerPath}`);
    continue;
  }
  console.log(`\n# ${handlerPath}`);
  for (const c of cases) {
    const r = runOne(handlerPath, c);
    if (r.fails.length === 0) {
      console.log(`  ok   ${c.name}`);
    } else {
      failed++;
      console.error(`  fail ${c.name}`);
      for (const f of r.fails) console.error(`         - ${f}`);
      if (r.out.trim()) console.error(`         stdout: ${r.out.trim().replace(/\n/g, ' | ')}`);
      if (r.err.trim()) console.error(`         stderr: ${r.err.trim().replace(/\n/g, ' | ')}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} pre-bash smoke case(s) failed — regression of #2017`);
  process.exit(1);
}
console.log('\nok: pre-bash hook gates dangerous commands across both handler copies');
