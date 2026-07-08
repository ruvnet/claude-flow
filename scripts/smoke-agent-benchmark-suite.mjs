#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2156 — Dream Cycle 2026-05-27 capabilities scan.
 *
 * The dream-cycle's capabilities scan flagged that ruflo had no agent
 * control-plane benchmark — only infrastructure benchmarks (HNSW, embeddings,
 * SONA adaptation, WASM Flash Attention). This script verifies that the new
 * `--suite agent` option is wired in and produces the four expected operation
 * rows in the benchmark output:
 *
 *   - Router Decide      (Q-Learning agent selection)
 *   - Pattern Search     (SONA / ReasoningBank prior-pattern lookup)
 *   - Step Record        (trajectory step recording with embedding)
 *   - Agent Round-Trip   (composite sum + overhead)
 *
 * No ANTHROPIC_API_KEY required — this is the agent control plane (router,
 * memory, hooks), not the model output. Real GAIA / SWE-bench evaluation is
 * a separate, gated path (out of scope for the initial landing).
 *
 * Failure of any check fails the build.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const CLI_BIN = join(REPO_ROOT, 'v3', '@claude-flow', 'cli', 'bin', 'cli.js');

if (!existsSync(CLI_BIN)) {
  console.error(`::error::smoke-agent-benchmark-suite: cli not built at ${CLI_BIN}`);
  console.error('run `pnpm --filter @claude-flow/cli build` first');
  process.exit(1);
}

const EXPECTED_OPS = [
  'Router Decide',
  'Pattern Search',
  'Step Record',
  'Agent Ctrl-Plane RTT',
];

function run(args) {
  return spawnSync('node', [CLI_BIN, 'performance', 'benchmark', ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

function fail(msg, extra) {
  console.error(`\n::error::smoke-agent-benchmark-suite: ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

// 1. `--suite agent` exits cleanly and emits all 4 operation rows
{
  console.log('[1/3] --suite agent exits 0 and emits all 4 operation rows');
  const r = run(['--suite', 'agent', '-i', '10', '-w', '2']);
  if (r.status !== 0) {
    fail(`--suite agent exited ${r.status}`, r.stdout + '\n---\n' + r.stderr);
  }
  const out = r.stdout || '';
  for (const op of EXPECTED_OPS) {
    if (!out.includes(op)) {
      fail(`--suite agent missing operation row: "${op}"`, out);
    }
  }
}

// 2. `--suite all` includes the agent operations (no regression of the cascade)
{
  console.log('[2/3] --suite all includes the agent operations');
  const r = run(['--suite', 'all', '-i', '5', '-w', '1']);
  if (r.status !== 0) {
    fail(`--suite all exited ${r.status}`, r.stdout + '\n---\n' + r.stderr);
  }
  const out = r.stdout || '';
  for (const op of EXPECTED_OPS) {
    if (!out.includes(op)) {
      fail(`--suite all missing agent operation row: "${op}"`, out);
    }
  }
}

// 3. Description in help mentions the agent suite (so users can discover it)
{
  console.log('[3/3] help text mentions the agent suite');
  const r = spawnSync('node', [CLI_BIN, 'performance', 'benchmark', '--help'], {
    encoding: 'utf-8',
    timeout: 15_000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (!/\bagent\b/.test(out)) {
    fail('benchmark --help does not mention the agent suite', out);
  }
}

console.log('\nsmoke-agent-benchmark-suite: PASS');
