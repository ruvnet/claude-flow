/**
 * Testgen MCP Tools — Test-Driven Repair surface.
 *
 * Exposes `ruflo-testgen` plugin scripts as first-class MCP tools so
 * agents (Claude Code, Codex, etc.) can invoke them programmatically.
 *
 * Current surface (one tool, narrow on purpose — Conformant mode follows
 * in a separate ADR):
 *
 *   - testgen_tdd_repair     Test-Driven Repair via headless `claude -p`
 *                            (read failing test → fix source → verify)
 *
 * Inspired by agent-harness-generator/packages/darwin-mode ADR-175.
 *
 * ARCHITECTURAL CONSTRAINT (mirrors metaharness-tools.ts)
 * Zero static `ruflo-testgen/*` imports. All script invocation stays
 * behind a subprocess bridge. When the plugin isn't reachable at
 * runtime, the tool returns `{success: true, degraded: true,
 * reason: 'plugin-not-found'}` and exits 0 — same posture as
 * metaharness-tools so callers see one contract.
 *
 * @module @claude-flow/cli/mcp-tools/testgen
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MCPTool } from './types.js';
import { getProjectCwd } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Locate the ruflo-testgen plugin's scripts directory.
 *
 * Mirrors `metaharness-tools.ts::locatePluginScripts()` strategy but
 * targets the testgen plugin. Walks up from this module's own location
 * (covers npx + global install) then falls back to cwd-walks. We probe
 * for `tdd-repair/tdd-repair.mjs` (the only script in this surface
 * today) — when that lands at a candidate path, we've found the dir.
 */
function locateTestgenScripts(): string | null {
  const candidates: string[] = [];
  let p = resolve(__dirname);
  for (let i = 0; i < 8; i++) {
    candidates.push(join(p, 'plugins', 'ruflo-testgen', 'scripts'));
    candidates.push(join(p, '..', 'plugins', 'ruflo-testgen', 'scripts'));
    p = dirname(p);
  }
  const cwd = getProjectCwd();
  candidates.push(join(cwd, 'plugins', 'ruflo-testgen', 'scripts'));
  candidates.push(join(cwd, 'node_modules', '@claude-flow', 'cli', 'plugins', 'ruflo-testgen', 'scripts'));
  for (const c of candidates) {
    if (existsSync(join(c, 'tdd-repair', 'tdd-repair.mjs'))) return c;
  }
  return null;
}

/**
 * Run a testgen plugin script with the same success-semantics contract
 * as metaharness-tools.ts (exit 0 ⇒ success: true even if degraded).
 */
function runTestgenScript(scriptName: string, args: string[]): Promise<{
  exitCode: number;
  json: unknown;
  degraded: boolean;
  success: boolean;
}> {
  return new Promise((resolve) => {
    const dir = locateTestgenScripts();
    if (!dir) {
      resolve({
        exitCode: 0,
        json: { degraded: true, reason: 'plugin-not-found' },
        degraded: true,
        success: true,
      });
      return;
    }
    const scriptPath = join(dir, scriptName);
    const p = spawn('node', [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    p.stdout?.on('data', (d) => { stdout += d.toString(); });
    p.stderr?.on('data', () => { /* swallow — graceful */ });
    // 20 min hard ceiling (tdd-repair has its own 15 min cap; we add 5 min slack)
    const timer = setTimeout(() => { try { p.kill('SIGTERM'); } catch { /* ignore */ } }, 20 * 60_000);
    p.on('close', (code) => {
      clearTimeout(timer);
      let json: unknown = null;
      const m = /\{[\s\S]*\}/.exec(stdout);
      if (m) { try { json = JSON.parse(m[0]); } catch { /* leave null */ } }
      const looksDegraded = !!(json && typeof json === 'object' && (json as { data?: { reason?: string } }).data?.reason === 'plugin-not-found');
      const exitCode = code ?? 0;
      resolve({
        exitCode,
        json,
        degraded: looksDegraded,
        success: exitCode === 0,
      });
    });
    p.on('error', () => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        json: { degraded: true, reason: 'spawn-failed' },
        degraded: true,
        success: false,
      });
    });
  });
}

const TESTGEN_SUCCESS_SEMANTIC =
  'Returns `{success, data, degraded, exitCode}`. success=true when the script ran as designed (including graceful-degradation payloads); ' +
  'success=false when the test could not be repaired within --max-attempts (exit 1) or on config error (exit 2). ' +
  'Reads data.repaired for the actual outcome — true means the test now passes, false means it does not.';

export const testgenTools: MCPTool[] = [
  {
    name: 'testgen_tdd_repair',
    description:
      'ADR-175-inspired Test-Driven Repair. Use when you have a failing test and want a verified, bounded-cost fix. Spawns a bounded headless `claude -p` (Read/Edit/Bash only, --max-budget-usd capped) ' +
      'that makes the test pass without modifying it. The test\'s exit code IS the fitness function — no LLM-as-judge. ' +
      'Use when you have a failing test and want a verified fix. Skipping this and asking an agent to "fix the bug" is wrong because (a) you lose the bounded-cost guarantee, ' +
      '(b) you lose the strict no-test-modification constraint, (c) you lose the verify-on-finish step. ' +
      'REQUIRES --confirm — without it returns a dry-run plan. Cost ladder: Haiku $0.02-0.20, Sonnet $0.30-2.00, Opus $1.50-8.00 per attempt. ' + TESTGEN_SUCCESS_SEMANTIC,
    category: 'testgen',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Absolute path to the repo root (default: cwd)', default: '.' },
        test: { type: 'string', description: 'Relative path (from repo root) to the failing test file. REQUIRED.' },
        testCommand: { type: 'string', description: 'Shell command to run the test (e.g. `npx vitest run tests/auth.test.ts`). REQUIRED.' },
        maxAttempts: { type: 'number', description: '1..5 (ruflo cap). Each attempt gets budgetUsd/maxAttempts of the total budget.', default: 1 },
        budgetUsd: { type: 'number', description: 'Total cost ceiling across all attempts. Hard cap — claude exits when reached.', default: 5.0 },
        model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: 'Claude model tier. Haiku for simple bugs (default); Sonnet for multi-file; Opus rarely worth it.', default: 'haiku' },
        confirm: { type: 'boolean', description: 'REQUIRED to actually run. Without it returns a dry-run plan.', default: false },
        noTestOracle: { type: 'boolean', description: 'Conformant mode (agent writes its own repro). NOT YET IMPLEMENTED — returns config error.', default: false },
        timeoutMs: { type: 'number', description: 'Hard wall-clock cap. Default 15 min.', default: 900000 },
      },
      required: ['test', 'testCommand'],
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.repo) args.push('--repo', String(input.repo));
      if (input.test) args.push('--test', String(input.test));
      if (input.testCommand) args.push('--test-command', String(input.testCommand));
      if (input.maxAttempts !== undefined) args.push('--max-attempts', String(input.maxAttempts));
      if (input.budgetUsd !== undefined) args.push('--budget', String(input.budgetUsd));
      if (input.model) args.push('--model', String(input.model));
      if (input.confirm === true) args.push('--confirm');
      if (input.noTestOracle === true) args.push('--no-test-oracle');
      if (input.timeoutMs !== undefined) args.push('--timeout-ms', String(input.timeoutMs));
      const r = await runTestgenScript('tdd-repair/tdd-repair.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
];
