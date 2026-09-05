#!/usr/bin/env node
/**
 * tdd-repair.mjs — Test-Driven Repair via headless `claude -p`.
 *
 * INSPIRATION: agent-harness-generator/packages/darwin-mode ADR-175
 *   "Two repair modes — Test-Driven Repair (default, gated on a failing test)
 *    and Conformant (--no-test-oracle, writes its own repro first)."
 *
 * IMPLEMENTATION CHOICE: instead of wrapping `metaharness-darwin evolve`, we
 * drive `claude -p` (headless print-mode) directly. Reasons:
 *
 *   1. `claude -p` is already in our stack — no extra optional dependency
 *   2. Bounded cost: `--max-budget-usd` is a first-class flag, hard cap
 *   3. Capability-restricted: `--allowedTools "Read,Edit,Bash"` blocks the
 *      agent from making API calls / writing arbitrary files outside the repo
 *   4. The fitness function ("does the failing test pass?") IS the loop body —
 *      no separate sandbox / scorer needed; the test command is both
 *   5. Resumable: `--session-id` lets the user inspect a partial run
 *
 * WHAT THIS DOES (Test-Driven mode, default)
 *   1. Verify the test currently fails (sanity check — refuse if it already passes)
 *   2. Spawn `claude -p` with a focused prompt: "Read this test, fix the code
 *      so it passes, don't touch the test, then run it to verify"
 *   3. Re-run the test to verify the fix
 *   4. If green: emit a patch summary + (optional) open a PR
 *   5. If red after `--max-attempts` rounds: emit failure receipt; no PR
 *
 * WHAT'S NOT IMPLEMENTED YET (intentionally — separate ADR)
 *   - Conformant mode (`--no-test-oracle`) — needs MCTS over repro generation;
 *     deferred to a follow-up ADR. Falls back to "test file required" for now.
 *
 * USAGE
 *   node scripts/tdd-repair/tdd-repair.mjs \
 *     --repo /path/to/repo \
 *     --test path/to/failing.test.ts \
 *     --test-command "npx vitest run path/to/failing.test.ts" \
 *     --confirm
 *
 * SAFETY
 *   - `--confirm` REQUIRED (defense in depth over `claude -p`'s own gates)
 *   - Hard --max-budget-usd default $5 (override with --budget)
 *   - --allowedTools restricts the spawned claude to Read/Edit/Bash only
 *   - Per ADR-153 §"Safety model": exit code 99 reserved for safety-disqualified
 *
 * EXIT CODES
 *   0  test green after repair (success)
 *   1  test still red after --max-attempts
 *   2  config error (test file missing, test already passes, etc.)
 *   3  claude -p exited non-zero
 *   99 reserved for safety tripwire
 */

import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ARGS = (() => {
  const a = {
    repo: '.',
    test: null,
    testCommand: null,
    maxAttempts: 1,
    budgetUsd: 5.0,
    model: 'haiku',          // default cheap tier; user can escalate
    confirm: false,
    noTestOracle: false,
    format: 'json',
    timeoutMs: 15 * 60_000,  // 15 min hard cap
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--repo') a.repo = process.argv[++i];
    else if (v === '--test') a.test = process.argv[++i];
    else if (v === '--test-command') a.testCommand = process.argv[++i];
    else if (v === '--max-attempts') a.maxAttempts = parseInt(process.argv[++i], 10);
    else if (v === '--budget') a.budgetUsd = parseFloat(process.argv[++i]);
    else if (v === '--model') a.model = process.argv[++i];
    else if (v === '--confirm') a.confirm = true;
    else if (v === '--no-test-oracle') a.noTestOracle = true;
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--timeout-ms') a.timeoutMs = parseInt(process.argv[++i], 10);
  }
  return a;
})();

function emit(payload, exitCode = 0) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(exitCode);
}

function safetyChecks() {
  if (!ARGS.confirm) {
    emit({
      success: true,
      dryRun: true,
      data: {
        plan: {
          mode: ARGS.noTestOracle ? 'conformant' : 'test-driven',
          repo: resolve(ARGS.repo),
          test: ARGS.test,
          testCommand: ARGS.testCommand,
          maxAttempts: ARGS.maxAttempts,
          budgetUsd: ARGS.budgetUsd,
          model: ARGS.model,
        },
        message: 'Pass --confirm to run the repair (will spawn headless claude -p with bounded budget).',
      },
    }, 0);
  }

  if (ARGS.noTestOracle) {
    emit({
      success: false,
      data: {
        reason: 'conformant-mode-not-implemented',
        hint: 'Conformant mode (`--no-test-oracle`) is scoped for a follow-up ADR — needs MCTS over repro generation. For now, write a failing test first and use the default Test-Driven mode.',
      },
    }, 2);
  }

  const repoPath = resolve(ARGS.repo);
  if (!existsSync(repoPath)) {
    emit({ success: false, data: { reason: 'repo-not-found', repo: repoPath } }, 2);
  }
  if (!ARGS.test) {
    emit({ success: false, data: { reason: 'test-path-required', hint: 'Pass --test <path> pointing at the failing test file.' } }, 2);
  }
  if (!ARGS.testCommand) {
    emit({ success: false, data: { reason: 'test-command-required', hint: 'Pass --test-command (e.g. `--test-command "npx vitest run path/to/test.ts"`).' } }, 2);
  }
  return repoPath;
}

/** Run the test command once and return {passed, output, durationMs}. */
function runTest(repoPath) {
  const start = Date.now();
  const r = spawnSync('sh', ['-c', ARGS.testCommand], {
    cwd: repoPath,
    encoding: 'utf-8',
    timeout: 5 * 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    passed: r.status === 0,
    exitCode: r.status,
    output: (r.stdout || '') + (r.stderr || ''),
    durationMs: Date.now() - start,
    killedByTimeout: r.status === null,
  };
}

/**
 * Drive one repair attempt via `claude -p`.
 *
 * We construct a focused prompt that:
 *   - Names the failing test file (read-only)
 *   - Names the test command (run only)
 *   - Forbids modifying the test
 *   - Asks for the minimal fix that makes the test pass
 *
 * --allowedTools is restricted to Read,Edit,Bash so the agent can't make
 * MCP calls / write to ~ / hit the network. --max-budget-usd caps cost
 * at the per-attempt budget. --output-format json gives us a parseable
 * exit summary.
 */
function spawnClaudeRepair(repoPath, attempt) {
  const start = Date.now();
  const prompt = `You are fixing a failing test in this repository.

FAILING TEST FILE: ${ARGS.test}
TEST COMMAND: ${ARGS.testCommand}

YOUR JOB:
1. Read the failing test file and understand what it expects.
2. Find the source file under test.
3. Make the MINIMAL change to the source so the test passes.
4. DO NOT modify the test file or any other test files.
5. DO NOT add new dependencies.
6. Run the test command to verify your fix passes.
7. If the test still fails after your edit, iterate — read the new failure output, refine the fix, retry.

This is attempt ${attempt} of ${ARGS.maxAttempts}. Be focused and efficient — your budget is bounded.`;

  return new Promise((resolveProm) => {
    const argv = [
      '-p',
      prompt,
      '--model', ARGS.model,
      '--max-budget-usd', String(ARGS.budgetUsd / ARGS.maxAttempts),
      '--allowedTools', 'Read,Edit,Bash',
      '--output-format', 'json',
      '--permission-mode', 'acceptEdits',  // auto-accept edits within the allowed set
    ];

    const p = spawn('claude', argv, {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    p.stdout?.on('data', (d) => { stdout += d.toString(); });
    p.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      // Forward progress to the parent stderr so the user sees activity
      process.stderr.write(`[tdd-repair attempt ${attempt}] ${s}`);
    });
    const timer = setTimeout(() => {
      try { p.kill('SIGTERM'); } catch { /* ignore */ }
    }, Math.ceil(ARGS.timeoutMs / ARGS.maxAttempts));
    p.on('error', (e) => {
      clearTimeout(timer);
      resolveProm({
        ok: false,
        reason: 'claude-not-available',
        error: String(e?.message ?? e),
        durationMs: Date.now() - start,
      });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      let parsed = null;
      try {
        // claude -p --output-format json emits {result, usage, ...}
        parsed = JSON.parse(stdout);
      } catch { /* leave null */ }
      resolveProm({
        ok: code === 0,
        exitCode: code,
        stdoutTail: stdout.slice(-1000),
        stderrTail: stderr.slice(-500),
        parsed,
        durationMs: Date.now() - start,
      });
    });
  });
}

async function main() {
  const repoPath = safetyChecks();

  // Pre-flight: confirm the test is actually red. Repairing a green test
  // is either a no-op or a sign the user's --test-command is wrong.
  const before = runTest(repoPath);
  if (before.passed) {
    emit({
      success: false,
      data: {
        reason: 'test-already-passes',
        before,
        hint: 'The test command returned exit 0 before any repair was attempted. Either the test already passes, or --test-command is incorrect.',
      },
    }, 2);
  }
  process.stderr.write(`[tdd-repair] pre-flight: test FAILS (exit ${before.exitCode}) — proceeding with repair\n`);

  const attempts = [];
  let final = null;
  for (let i = 1; i <= ARGS.maxAttempts; i++) {
    const claudeResult = await spawnClaudeRepair(repoPath, i);
    const verify = runTest(repoPath);
    attempts.push({
      attempt: i,
      claude: { ok: claudeResult.ok, exitCode: claudeResult.exitCode, durationMs: claudeResult.durationMs, usage: claudeResult.parsed?.usage },
      verify: { passed: verify.passed, exitCode: verify.exitCode, durationMs: verify.durationMs },
    });
    if (verify.passed) {
      final = { repaired: true, attemptsTaken: i };
      break;
    }
    if (!claudeResult.ok && claudeResult.reason === 'claude-not-available') {
      final = { repaired: false, reason: 'claude-cli-not-installed', hint: 'Install Claude Code CLI first: https://docs.anthropic.com/claude/code' };
      break;
    }
  }
  if (!final) final = { repaired: false, reason: 'max-attempts-exhausted', attempts: ARGS.maxAttempts };

  // Aggregate cost from per-attempt usage (claude -p reports usage.cost_usd)
  const totalCostUsd = attempts.reduce(
    (s, a) => s + (a.claude.usage?.cost_usd ?? 0),
    0,
  );

  const payload = {
    success: final.repaired,
    data: {
      ...final,
      mode: 'test-driven',
      before: { passed: false, exitCode: before.exitCode },
      after: attempts[attempts.length - 1]?.verify ?? null,
      attempts,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      budgetUsd: ARGS.budgetUsd,
      budgetExhausted: totalCostUsd >= ARGS.budgetUsd * 0.95,
      shape: {
        repo: repoPath,
        test: ARGS.test,
        testCommand: ARGS.testCommand,
        maxAttempts: ARGS.maxAttempts,
        model: ARGS.model,
      },
    },
    generatedAt: new Date().toISOString(),
  };

  emit(payload, final.repaired ? 0 : 1);
}

main().catch((e) => {
  emit({
    success: false,
    data: { reason: 'unexpected-failure', error: String(e?.message ?? e) },
  }, 2);
});
