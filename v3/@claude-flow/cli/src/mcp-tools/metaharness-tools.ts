/**
 * MetaHarness MCP Tools — ADR-150 Phase-2 deep-integration surface.
 *
 * Exposes the static-analysis MetaHarness CLIs as first-class MCP tools
 * so Claude Code agents can call them programmatically without shelling
 * out themselves. Five tools, all read-only / subprocess-isolated:
 *
 *   - metaharness_score          5-dim readiness scorecard
 *   - metaharness_genome         7-section categorical report
 *   - metaharness_mcp_scan       static MCP security findings
 *   - metaharness_threat_model   enterprise-grade threat model
 *   - metaharness_oia_audit      composite audit (score + threat + mcp) → memory
 *
 * ADR-153 Darwin Mode integration adds three additional tools that target
 * the separate `@metaharness/darwin` npm package (not the umbrella):
 *
 *   - metaharness_evolve         mutate harness policy surfaces, sandbox-score, promote
 *   - metaharness_security_bench upstream's "Darwin Shield" (their own ADR-155)
 *   - metaharness_bench          create/verify bench suites used by evolve --bench
 *
 * @metaharness/redblue integration adds one tool that targets the standalone
 * `@metaharness/redblue` npm package — adversarial red/blue LLM testing
 * for the agents and apps you own:
 *
 *   - metaharness_redblue        red-team → judge → blue-patch → retest → report
 *
 * metaharness@0.3.0 + @metaharness/darwin@0.8.0 add two more:
 *
 *   - metaharness_learn          upstream ADR-235 GEPA learning run ($0 dry-run
 *                                default; run=true to spend; needs repo checkout)
 *   - metaharness_gepa           GEPA library surface — genome load/validate/
 *                                render + transcript failure analysis
 *
 * Every tool resolves the corresponding plugin script
 * (`plugins/ruflo-metaharness/scripts/<X>.mjs`) via the same locator
 * the commands/metaharness.ts dispatcher uses, then spawns it with
 * `--format json` and parses the response.
 *
 * ADR-150 ARCHITECTURAL CONSTRAINT
 * --------------------------------
 * This file has ZERO static `@metaharness/*` imports. All metaharness
 * invocation stays in the plugin scripts behind the `_harness.mjs`
 * subprocess bridge. When the plugin scripts aren't reachable at
 * runtime, each tool returns a structured `{ degraded: true }` payload
 * — never throws.
 *
 * @module @claude-flow/cli/mcp-tools/metaharness
 */

import type { MCPTool, getProjectCwd as _ } from './types.js';
import { getProjectCwd } from './types.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from this module to find plugins/ruflo-metaharness/scripts/.
 * Handles three install layouts (mirrors commands/metaharness.ts).
 *
 * `requiredScript`, if provided, narrows the match the same way the
 * commands dispatcher does — guards against the publish-artifact mirror
 * (`v3/@claude-flow/cli/plugins/ruflo-metaharness/scripts/`, regenerated
 * by `prepublishOnly`) shadowing the source when it's stale on a new
 * script.
 */
function locatePluginScripts(requiredScript?: string): string | null {
  const candidates: string[] = [];
  let p = resolve(__dirname);
  for (let i = 0; i < 8; i++) {
    candidates.push(join(p, 'plugins', 'ruflo-metaharness', 'scripts'));
    candidates.push(join(p, '..', 'plugins', 'ruflo-metaharness', 'scripts'));
    p = dirname(p);
  }
  const cwd = getProjectCwd();
  candidates.push(join(cwd, 'plugins', 'ruflo-metaharness', 'scripts'));
  candidates.push(join(cwd, 'node_modules', '@claude-flow', 'cli', 'plugins', 'ruflo-metaharness', 'scripts'));
  for (const c of candidates) {
    if (!existsSync(join(c, '_harness.mjs'))) continue;
    if (requiredScript && !existsSync(join(c, requiredScript))) continue;
    return c;
  }
  return null;
}

/**
 * Result of running a metaharness plugin script.
 *
 * SUCCESS SEMANTICS (iter 44 — fix for iter-43-flagged bug)
 * `success` is computed from the canonical signal: exitCode === 0.
 *
 * Three observable cases:
 *   1. exitCode 0 + valid JSON          → success: true, degraded: false
 *      (happy path; data is the script's JSON output)
 *
 *   2. exitCode 0 + degraded payload    → success: true, degraded: true
 *      (ADR-150 constraint #3 — upstream `@metaharness/*` absent, script
 *      emits `{degraded:true, reason:"metaharness-not-available"}` and
 *      exits 0 so ruflo stays operational. `success: true` because the
 *      script DID run as designed; the agent reads `degraded: true` to
 *      know the dep was missing.)
 *
 *   3. exitCode != 0                    → success: false
 *      Two sub-cases:
 *        a. exitCode 1 with alert.triggered JSON  → intentional alert
 *           failure (e.g. --alert-on-fit-below 70). Agents read
 *           `data.alert.triggered` for the reason.
 *        b. exitCode 2 with stderr-only           → user error (bad arg).
 *           `data` is null because no JSON was on stdout.
 *
 * BEFORE iter 44 `success` was computed as `!degraded`, which collapsed
 * case 3b into success: true / exitCode: 2 — contradictory.
 */
function runScript(scriptName: string, args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  json: unknown;
  degraded: boolean;
  success: boolean;
}> {
  return new Promise((resolve) => {
    const dir = locatePluginScripts(scriptName);
    if (!dir) {
      resolve({
        exitCode: 0, stdout: '', json: { degraded: true, reason: 'plugin-not-found' },
        degraded: true, success: true,  // plugin absent → equivalent to case 2
      });
      return;
    }
    const scriptPath = join(dir, scriptName);
    const argv = [...args];
    if (!argv.includes('--format')) argv.push('--format', 'json');
    const p = spawn('node', [scriptPath, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    p.stdout?.on('data', (d) => { stdout += d.toString(); });
    p.stderr?.on('data', () => { /* swallow — graceful */ });
    const timer = setTimeout(() => { try { p.kill('SIGTERM'); } catch { /* ignore */ } }, 120_000);
    p.on('close', (code) => {
      clearTimeout(timer);
      let json: unknown = null;
      const m = /\{[\s\S]*\}/.exec(stdout);
      if (m) { try { json = JSON.parse(m[0]); } catch { /* leave null */ } }
      const looksDegraded = !!(json && typeof json === 'object' && (json as { degraded?: unknown }).degraded === true);
      const exitCode = code ?? 0;
      // iter 44 — success now reflects exit code, not the degraded marker.
      // exit 0 = script ran as designed (whether the result was happy
      // data or a graceful-degradation payload). exit != 0 = something
      // went wrong (intentional alert OR user/system error).
      const success = exitCode === 0;
      resolve({ exitCode, stdout, json, degraded: looksDegraded, success });
    });
    p.on('error', () => {
      clearTimeout(timer);
      resolve({
        exitCode: 127, stdout, json: { degraded: true, reason: 'spawn-failed' },
        degraded: true, success: false,
      });
    });
  });
}

/**
 * iter 46 — success-semantic footnote appended to every tool description
 * so agents reading the registry know how to interpret the return shape.
 * Reflects the iter-44 fix: `success` derives from exitCode, not from the
 * degraded marker. Three observable cases an agent can branch on.
 */
const MCP_SUCCESS_SEMANTIC =
  '[Return shape: {success, data, degraded, exitCode}. success===true iff exitCode===0 ' +
  '(includes graceful-degradation path where dep is absent — check degraded for that). ' +
  'success===false with exitCode===1 = intentional alert exit (read data.alert.triggered). ' +
  'success===false with exitCode===2 = input error (data is null).]';

export const metaharnessTools: MCPTool[] = [
  {
    name: 'metaharness_score',
    description: 'ADR-150 — 5-dimension harness readiness scorecard from `metaharness score <path>` (harnessFit / compileConfidence / taskCoverage / toolSafety / memoryUsefulness + estCostPerRunUsd). Pure-read subprocess; graceful degradation when metaharness optional dep absent. Use when you need an evidence-based readiness signal before recommending the user run `ruflo metaharness mint`; reading the repo manually is wrong because the 5-dim score includes signals (cost-per-run, MCP surface safety) that aren\'t obvious from source. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path to score (default: cwd)', default: '.' },
        alertOnFitBelow: { type: 'number', description: 'Set to make the tool flag harnessFit < N (informational only; tool result has alert.triggered field)' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const args = ['--path', path];
      if (input.alertOnFitBelow !== undefined) args.push('--alert-on-fit-below', String(input.alertOnFitBelow));
      const r = await runScript('score.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_genome',
    description: 'ADR-150 — 7-section categorical readiness report from `metaharness genome <path>` (repo_type / agent_topology / risk_score / mcp_surface / test_confidence / publish_readiness). Use when you need the categorical view (vs numeric score). Pair with metaharness_score for the full readiness picture — score-alone is wrong because two harnesses with the same harnessFit can have very different agent_topology and mcp_surface. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path to analyze (default: cwd)', default: '.' },
        alertOnRiskAbove: { type: 'number', description: 'Set to flag risk_score > N' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const args = ['--path', path];
      if (input.alertOnRiskAbove !== undefined) args.push('--alert-on-risk-above', String(input.alertOnRiskAbove));
      const r = await runScript('genome.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_mcp_scan',
    description: 'ADR-150 — static security scan of `.mcp/servers.json` + `.harness/claims.json` via `harness mcp-scan <path>`. Reads only; no dispatch. Use when you are about to expose a new MCP server config to humans/agents. Eyeballing the JSON is wrong because the scan catches policy regressions (capability grants, audit gaps) that humans miss. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path with .mcp/servers.json (default: cwd)', default: '.' },
        failOn: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Severity floor for tool.alert.triggered (default: high)', default: 'high' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const failOn = (input.failOn as string) || 'high';
      const r = await runScript('mcp-scan.mjs', ['--path', path, '--fail-on', failOn]);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_threat_model',
    description: 'ADR-150 — enterprise-grade threat model from `harness threat-model <path>`. Returns worst-severity verdict (clean/low/medium/high) + categorized findings suitable for sharing with infosec. Use when you need a sharable infosec-grade verdict; a one-line summary is wrong because compliance reviewers want the per-category breakdown. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path (default: cwd)', default: '.' },
        failOn: { type: 'string', enum: ['clean', 'low', 'medium', 'high'], description: 'Severity floor for tool.alert.triggered (default: high)', default: 'high' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const failOn = (input.failOn as string) || 'high';
      const r = await runScript('threat-model.mjs', ['--path', path, '--fail-on', failOn]);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_oia_audit',
    description: 'ADR-150 — composite weekly audit. Bundles oia-manifest + threat-model + mcp-scan into one timestamped record persisted to `metaharness-audit` memory namespace (or --dry-run to skip persistence). Use when you want to seed periodic drift detection (pair with metaharness_drift_from_history). Running the 3 sub-audits separately is wrong because you lose the composite worst-severity rollup and the timestamped record that drift detection needs to compare against. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path (default: cwd)', default: '.' },
        dryRun: { type: 'boolean', description: 'Skip memory persistence — local-only run', default: false },
        alertOnWorst: { type: 'string', enum: ['clean', 'low', 'medium', 'high'], description: 'Composite worst-severity floor for tool.alert.triggered' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const args = ['--path', path];
      if (input.dryRun === true) args.push('--dry-run');
      if (input.alertOnWorst !== undefined) args.push('--alert-on-worst', String(input.alertOnWorst));
      const r = await runScript('oia-audit.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_audit_list',
    description: 'ADR-150 iter 16 — list timestamped records from the `metaharness-audit` memory namespace. Use when you need to discover which audit keys exist before running metaharness_audit_trend. Guessing key names is wrong because timestamps include sub-second precision; pair with metaharness_audit_trend by passing the returned key. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max records to return, newest first (default: 20)', default: 20 },
        since: { type: 'string', description: 'Filter to last N(h|d|w|m), e.g. "30d" for last 30 days' },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.limit !== undefined) args.push('--limit', String(input.limit));
      if (input.since !== undefined) args.push('--since', String(input.since));
      const r = await runScript('audit-list.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_similarity',
    description: 'ADR-152 §3.1 — weighted similarity between two harness fingerprints (genome + score JSON). Returns overall ∈ [0,1] plus per-component breakdown (cosine over 9 numerics, categorical over 4 enums, jaccard over agent_topology). Pure-TS, zero `@metaharness/*` dep. Use when you need to (a) rank candidate templates against a target repo, (b) decide fork-vs-scaffold, or (c) feed ADR-151 §3.2 Recommender / §3.3 Drift / §3.5 Plugin Compat. Hand-comparing genome fields is wrong because the weighted blend (cosine + categorical + jaccard) reproduces human judgment on the spike-similarity invariants. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        aFile: { type: 'string', description: 'Path to harness A genome+score JSON file (mutually exclusive with aKey)' },
        bFile: { type: 'string', description: 'Path to harness B genome+score JSON file (mutually exclusive with bKey)' },
        aKey: { type: 'string', description: 'Memory key for harness A in `metaharness-audit` namespace (mutually exclusive with aFile)' },
        bKey: { type: 'string', description: 'Memory key for harness B in `metaharness-audit` namespace (mutually exclusive with bFile)' },
        perDimension: { type: 'boolean', description: 'Include per-dimension contribution breakdown (used by ADR-151 §3.2 Recommender)', default: false },
        alertBelow: { type: 'number', description: 'Set tool.alert.triggered when overall < N (used by ADR-151 §3.3 Drift Detection)' },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.aFile) args.push('--a', String(input.aFile));
      if (input.bFile) args.push('--b', String(input.bFile));
      if (input.aKey) args.push('--a-key', String(input.aKey));
      if (input.bKey) args.push('--b-key', String(input.bKey));
      if (input.perDimension === true) args.push('--per-dimension');
      if (input.alertBelow !== undefined) args.push('--alert-below', String(input.alertBelow));
      const r = await runScript('similarity.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_drift_from_history',
    description: 'iter 53 — one-command drift detection. Composes audit-list + oia-audit + audit-trend: finds the most recent record in `metaharness-audit` namespace (or skips that with `baselineKey`/`baselineFile`), runs a fresh audit against the current path, diffs via ADR-152 §3.1 similarity, alerts when structural similarity falls below `threshold`. Use when you need a structured drift report before recommending the user act on regressions; calling the 3 sub-tools separately is wrong because you lose the composed alert ladder + fastpath optimization (iter 66/67: `baselineKey` ~14x faster, `baselineFile` ~19x faster, ideal for CI artifact pipelines). ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path to audit (default: cwd)', default: '.' },
        baselineSince: { type: 'string', description: 'Use a baseline at least N(h|d|w) old, e.g. "7d" — skips drift against ultra-recent audits' },
        baselineKey: { type: 'string', description: 'iter 66 — explicit memory key for the baseline audit. Skips audit-list (no ONNX warmup). Get from `metaharness_audit_list` first.' },
        baselineFile: { type: 'string', description: 'iter 67 — file path to a saved oia-audit JSON. Skips audit-list AND memory roundtrip. Ideal for CI artifact pipelines (e.g., comparing this run vs a downloaded prior-run artifact).' },
        threshold: { type: 'number', description: 'Alert when structural similarity < N. Default 0.95.', default: 0.95 },
        alertOnNewSeverity: { type: 'string', enum: ['info', 'low', 'medium', 'warn', 'high', 'error', 'critical'], description: 'iter 78 — ALSO alert when any introduced finding meets or exceeds this severity. Orthogonal to `threshold`: a CRITICAL finding triggers even if structural similarity > threshold.' },
        dryRun: { type: 'boolean', description: 'Skip persisting the fresh audit to memory', default: false },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      args.push('--path', String(input.path ?? '.'));
      if (input.baselineSince) args.push('--baseline-since', String(input.baselineSince));
      if (input.baselineKey) args.push('--baseline-key', String(input.baselineKey));
      if (input.baselineFile) args.push('--baseline-file', String(input.baselineFile));
      if (input.threshold !== undefined) args.push('--threshold', String(input.threshold));
      if (input.alertOnNewSeverity) args.push('--alert-on-new-severity', String(input.alertOnNewSeverity));
      if (input.dryRun === true) args.push('--dry-run');
      const r = await runScript('drift-from-history.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_audit_trend',
    description: 'ADR-150 iter 15 — diff two oia-audit records (drift detection). Accepts EITHER memory keys (run metaharness_audit_list first to discover them) OR direct file paths (useful for diffing CI artifacts). Surfaces composite worst-severity delta + per-component status change + introduced/cleared findings + (iter 38) ADR-152 §3.1 structural distance when both records carry a fingerprint. Use when you have two specific audits to compare; pair with metaharness_audit_list for key discovery. Skipping this tool and eyeballing two JSONs is wrong because the structural-distance verdict (near-identical / minor-drift / moderate-drift / major-drift) is the operationally-useful summary. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        baselineKey: { type: 'string', description: 'Memory key for the older audit (mutually exclusive with baselineFile)' },
        currentKey: { type: 'string', description: 'Memory key for the newer audit (mutually exclusive with currentFile)' },
        baselineFile: { type: 'string', description: 'iter 46 — file path to older audit JSON (mutually exclusive with baselineKey)' },
        currentFile: { type: 'string', description: 'iter 46 — file path to newer audit JSON (mutually exclusive with currentKey)' },
        alertOnWorsening: { type: 'boolean', description: 'Set tool.alert.triggered when composite worst severity worsened', default: false },
        alertOnDistanceBelow: { type: 'number', description: 'iter 38 — set tool.alert.triggered when structural similarity falls below N (uses fingerprint field added in iter 38; older records emit verdict=unavailable)' },
      },
      // No required[] — caller picks key OR file inputs. The script
      // emits a graceful degraded payload if neither is supplied.
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.baselineKey) args.push('--baseline-key', String(input.baselineKey));
      if (input.currentKey) args.push('--current-key', String(input.currentKey));
      if (input.baselineFile) args.push('--baseline', String(input.baselineFile));
      if (input.currentFile) args.push('--current', String(input.currentFile));
      if (input.alertOnWorsening === true) args.push('--alert-on-worsening');
      if (input.alertOnDistanceBelow !== undefined) args.push('--alert-on-distance-below', String(input.alertOnDistanceBelow));
      const r = await runScript('audit-trend.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  // ───────────────────────────────────────────────────────────────────────
  // ADR-153 — @metaharness/darwin integration (3 tools).
  // Backed by the separate `@metaharness/darwin@~0.3.1` npm package, NOT
  // the umbrella `metaharness`. Plugin scripts shell out via _darwin.mjs.
  // Same {success, data, degraded, exitCode} contract.
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'metaharness_evolve',
    description: 'ADR-153 — Darwin Mode: mutate one of seven harness policy surfaces (planner/contextBuilder/reviewer/retryPolicy/toolPolicy/memoryPolicy/scorePolicy), sandbox-score each variant, promote only measured wins. The WRITE layer that closes the loop ADR-150 opens (score+genome describe; evolve changes). Use when readiness scores are flat and you want to discover WHICH surface mutation moves them, without retraining the foundation model. Bypassing this tool and hand-tuning is wrong because (a) single-degree-of-freedom mutations keep causal attribution clean, (b) the upstream safety layer catches secret/shell-out/network/dynamic-eval patterns before any variant runs (exit 99 = safety-disqualified, propagated verbatim). REQUIRES --confirm; defaults to dry-run plan output. Long-running: timeout scales with generations×children×sandbox-cost. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repo path to evolve (default: cwd)', default: '.' },
        generations: { type: 'number', description: '1..50 (ruflo cap)', default: 3 },
        children: { type: 'number', description: '1..20 (ruflo cap) — variants per generation', default: 3 },
        concurrency: { type: 'number', description: '1..8 (ruflo cap)', default: 2 },
        seed: { type: 'number', description: 'PRNG seed for reproducibility' },
        sandbox: { type: 'string', enum: ['real', 'mock', 'agent'], description: 'real = run npm test; mock = scoring stub; agent = LLM judge', default: 'real' },
        selection: { type: 'string', enum: ['quality-diversity', 'behavioral-diversity', 'niche-steering', 'clade', 'pareto'], description: 'Next-generation sampling strategy from the archive tree' },
        crossover: { type: 'boolean', description: 'Enable crossover (2-parent) mutations alongside the default 1-parent path', default: false },
        epistasis: { type: 'boolean', description: 'Detect epistatic surface interactions before mutating', default: false },
        curriculum: { type: 'boolean', description: 'Schedule increasing-difficulty bench tasks across generations', default: false },
        riskBudget: { type: 'number', description: 'Max number of safety-near-miss variants allowed before halting' },
        fdr: { type: 'number', description: 'Benjamini-Hochberg FDR threshold for accepting variant fitness as significant' },
        tie: { type: 'string', enum: ['faster'], description: 'Tiebreaker when champions are within noise — "faster" prefers lower sandbox cost' },
        bench: { type: 'string', description: 'Path to a bench suite JSON (use metaharness_bench --op create to scaffold)' },
        mutator: { type: 'string', enum: ['deterministic', 'ruvllm'], description: 'deterministic = template-based; ruvllm = local LLM-driven', default: 'deterministic' },
        ruvllmUrl: { type: 'string', description: 'RuVLLM endpoint URL (only used when mutator=ruvllm)' },
        ruvllmModel: { type: 'string', description: 'RuVLLM model id (only used when mutator=ruvllm)' },
        confirm: { type: 'boolean', description: 'REQUIRED to actually evolve; without it, returns a dry-run plan', default: false },
        alertOnNoImprovement: { type: 'boolean', description: 'Exit 1 when champion ≤ parent', default: false },
        timeoutMs: { type: 'number', description: 'Override the computed timeout (default = generations×children×per-variant)' },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.repo) args.push('--repo', String(input.repo));
      if (input.generations !== undefined) args.push('--generations', String(input.generations));
      if (input.children !== undefined) args.push('--children', String(input.children));
      if (input.concurrency !== undefined) args.push('--concurrency', String(input.concurrency));
      if (input.seed !== undefined) args.push('--seed', String(input.seed));
      if (input.sandbox) args.push('--sandbox', String(input.sandbox));
      if (input.selection) args.push('--selection', String(input.selection));
      if (input.crossover === true) args.push('--crossover');
      if (input.epistasis === true) args.push('--epistasis');
      if (input.curriculum === true) args.push('--curriculum');
      if (input.riskBudget !== undefined) args.push('--risk-budget', String(input.riskBudget));
      if (input.fdr !== undefined) args.push('--fdr', String(input.fdr));
      if (input.tie) args.push('--tie', String(input.tie));
      if (input.bench) args.push('--bench', String(input.bench));
      if (input.mutator) args.push('--mutator', String(input.mutator));
      if (input.ruvllmUrl) args.push('--ruvllm-url', String(input.ruvllmUrl));
      if (input.ruvllmModel) args.push('--ruvllm-model', String(input.ruvllmModel));
      if (input.confirm === true) args.push('--confirm');
      if (input.alertOnNoImprovement === true) args.push('--alert-on-no-improvement');
      if (input.timeoutMs !== undefined) args.push('--timeout-ms', String(input.timeoutMs));
      const r = await runScript('evolve.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_security_bench',
    description: 'ADR-153 — upstream Darwin Shield (their own ADR-155): evolves a champion security-detection harness against a 10-vuln/9-decoy ground-truth corpus and grades on TPR/FPR/patch-pass/repro/unsafe vs four baselines (B0 static, B1 LLM-single-pass, B2 fixed-agent, B3 Darwin-champion). Closest reference implementation for ruflo ADR-155 nightly self-learning security harness (#2417). Use when you need an empirical floor for Loop A reward-signal soundness; running this periodically gives baseline diversity and week-over-week champion-fitness drift. Bypassing this and just running the static MCP scan is wrong because static-only baseline (B0) reaches TPR=0.3/FPR=1 — proving static-alone has a measured detection ceiling. Parses overall PASS/FAIL + per-gate verdicts + baselines table from markdown. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        population: { type: 'number', description: '1..20 (ruflo cap) — candidate detectors per cycle', default: 2 },
        cycles: { type: 'number', description: '1..100 (ruflo cap) — evolution cycles', default: 1 },
        seed: { type: 'number', description: 'PRNG seed for reproducibility' },
        alertOnFail: { type: 'boolean', description: 'Exit 1 when overall verdict is FAIL', default: false },
        timeoutMs: { type: 'number', description: 'Override the computed timeout (default = 3s × 19 evals × population × cycles + 30s)' },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.population !== undefined) args.push('--population', String(input.population));
      if (input.cycles !== undefined) args.push('--cycles', String(input.cycles));
      if (input.seed !== undefined) args.push('--seed', String(input.seed));
      if (input.alertOnFail === true) args.push('--alert-on-fail');
      if (input.timeoutMs !== undefined) args.push('--timeout-ms', String(input.timeoutMs));
      const r = await runScript('security-bench.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_bench',
    description: 'ADR-153 supporting verb — create or verify bench suites used by metaharness_evolve --bench. Bench suites are JSON files of {input, expectedOutput, weight} tasks; scoring against a fixed corpus decouples evolution from flaky/slow/undersized `npm test`. Use when iterating on the same harness across commits and `npm test` is too noisy/slow to drive evolution — use --op create to scaffold from a repo, --op verify (cheap, ~5s) to gate suite changes in CI. Native test runners are wrong here because per-run noise drowns out champion-fitness deltas; bench gives you a stable baseline. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['create', 'verify'], description: 'create scaffolds suite.json from a repo; verify validates an existing suite' },
        repo: { type: 'string', description: 'Repo path (required for --op create)' },
        suite: { type: 'string', description: 'Suite JSON path (required for --op verify)' },
        out: { type: 'string', description: 'Override default output path for --op create (default: <repo>/.metaharness/bench/suite.json)' },
      },
      required: ['op'],
    },
    handler: async (input) => {
      const args: string[] = ['--op', String(input.op)];
      if (input.repo) args.push('--repo', String(input.repo));
      if (input.suite) args.push('--suite', String(input.suite));
      if (input.out) args.push('--out', String(input.out));
      const r = await runScript('bench.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  // ───────────────────────────────────────────────────────────────────────
  // @metaharness/redblue integration (1 tool).
  // Backed by `@metaharness/redblue@~0.1.1`. Plugin script shells out via
  // _redblue.mjs. Same {success, data, degraded, exitCode} contract.
  //
  // SAFETY: redblue itself enforces hard boundaries (no real creds, no live
  // targets, no shell, no arbitrary network, no eval) in upstream's
  // src/config/safety.ts at config-load time. The wrapper does NOT relax
  // those — it only forwards argv with shell:false. `--mock-judge` is the
  // $0 marker-fixture CI path; the real model judge requires
  // $OPENROUTER_API_KEY which we never inject.
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'metaharness_redblue',
    description: 'Adversarial red/blue LLM testing via @metaharness/redblue — generates attacks across OWASP LLM Top-10 / NIST AI RMF families (prompt injection, tool misuse, data leakage, jailbreaks, denial-of-wallet), runs them against an LLM target YOU OWN, judges compromise, optionally applies declarative blue-team patches, retests, and emits a board-readable report with measured failure reduction. Use when shipping an LLM-powered product and you need a repeatable security gate before exposing it to users — eyeballing prompts is wrong because attack surface coverage requires the OWASP/NIST taxonomy and the judge has to be model-driven for jailbreak detection. SAFETY: upstream hard-enforces no-creds / no-live-targets / no-shell / no-network / no-eval at config-load time; cannot be relaxed via flags. For CI / offline use --mockJudge=true ($0 marker fixture). For real model judging set $OPENROUTER_API_KEY and accept the per-run cost capped by max_cost_usd (default $3). ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        subcommand: {
          type: 'string',
          enum: ['init', 'run', 'patch', 'attack', 'report'],
          description: 'init = scaffold redblue.yaml; run = baseline (+ optional --patch); patch = baseline → patch → retest delta; attack = preview attacks; report = render existing report.json',
          default: 'run',
        },
        config: { type: 'string', description: 'Path to redblue.yaml (default: ./redblue.yaml)' },
        out: { type: 'string', description: 'Output report path for run/patch (default: temp file we read back inline)' },
        in: { type: 'string', description: 'Input report path for `report` subcommand' },
        tests: { type: 'number', description: 'How many test cases (run/patch only)' },
        patch: { type: 'boolean', description: '`run` only — after baseline, apply blue-team patches and retest', default: false },
        mockJudge: { type: 'boolean', description: '$0 TEST-ONLY marker fixture (no model calls). Use for CI / offline. Real judging requires OPENROUTER_API_KEY.', default: false },
        family: { type: 'string', enum: ['prompt', 'tools', 'data', 'all'], description: '`attack` subcommand only — which attack family to preview' },
        count: { type: 'number', description: '`attack` only — how many cases to preview' },
        alertOnFail: { type: 'boolean', description: 'Exit 1 when post-patch verdict is FAIL (gate-style)', default: false },
        timeoutMs: { type: 'number', description: 'Subprocess hard timeout (default 120000; mock-judge runs complete in seconds)' },
      },
    },
    handler: async (input) => {
      const args: string[] = [String(input.subcommand ?? 'run')];
      // attack family is positional
      if (input.subcommand === 'attack' && input.family) args.push(String(input.family));
      if (input.config) args.push('--config', String(input.config));
      if (input.out) args.push('--out', String(input.out));
      if (input.in) args.push('--in', String(input.in));
      if (input.tests !== undefined) args.push('--tests', String(input.tests));
      if (input.patch === true) args.push('--patch');
      if (input.mockJudge === true) args.push('--mock-judge');
      if (input.count !== undefined) args.push('--count', String(input.count));
      if (input.alertOnFail === true) args.push('--alert-on-fail');
      if (input.timeoutMs !== undefined) args.push('--timeout-ms', String(input.timeoutMs));
      const r = await runScript('redblue.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  // ───────────────────────────────────────────────────────────────────────
  // metaharness@0.3.0 `learn` + @metaharness/darwin@0.8.0 GEPA (2 tools).
  //
  // learn — upstream ADR-235 GEPA learning run. $0 dry-run by default;
  // spending requires the explicit `run: true` opt-in, forwarded as --run.
  // Requires a metaharness repo checkout (the learning harness is too heavy
  // for the npm package) — absent checkout returns a structured
  // {status: "checkout-required"} payload, distinct from degraded.
  //
  // gepa — the darwin GEPA *library* surface (genome load/validate/render,
  // transcript analysis). gepaOptimize itself is deliberately NOT exposed:
  // it takes an in-process evaluate() callback that cannot cross the
  // subprocess boundary; optimization runs live behind metaharness_evolve.
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'metaharness_learn',
    description: 'ADR-235 (upstream) — GEPA learning run via `metaharness learn`: optimizes a harness genome against a SWE-bench-style slice manifest. $0 DRY-RUN BY DEFAULT — it resolves the slice and prices the run without model calls; pass run=true to actually spend (model calls + Docker sandboxes). Requires a local metaharness repo checkout (repo param or $METAHARNESS_REPO); without one the tool returns {status:"checkout-required"} with clone instructions — that is a precondition report, not an error. Use when you want the harness policy to LEARN from a task corpus rather than hand-editing prompts; manual prompt tweaking is wrong because GEPA scores candidates against held-out slices and only promotes measured winners. Long real runs exceed the 120s MCP subprocess budget — run those via `ruflo metaharness learn` in a terminal instead. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Target host harness (e.g. claude-code, codex, pi-dev, hermes)' },
        model: { type: 'string', description: 'Model to learn against (upstream model id)' },
        slice: { type: 'string', description: 'Path to a slice manifest JSON' },
        repo: { type: 'string', description: 'Path to a metaharness repo checkout (sets $METAHARNESS_REPO)' },
        run: { type: 'boolean', description: 'EXPLICIT SPEND OPT-IN — without this the run is a $0 dry-run', default: false },
        alertOnFail: { type: 'boolean', description: 'Exit 1 when the learn run reports failure', default: false },
        timeoutMs: { type: 'number', description: 'Subprocess hard timeout override' },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.host) args.push('--host', String(input.host));
      if (input.model) args.push('--model', String(input.model));
      if (input.slice) args.push('--slice', String(input.slice));
      if (input.repo) args.push('--repo', String(input.repo));
      if (input.run === true) args.push('--run');
      if (input.alertOnFail === true) args.push('--alert-on-fail');
      if (input.timeoutMs !== undefined) args.push('--timeout-ms', String(input.timeoutMs));
      const r = await runScript('learn.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_gepa',
    description: 'GEPA genome operations from the `@metaharness/darwin/gepa` library entry (darwin 0.8.0). op=genome loads + validates a genome (default: the shipped cand-6 — first holdout-confirmed cheap-tier policy promotion, provenance in the package); op=validate returns structural errors for a genome JSON; op=render compiles a genome to the system prompt it encodes (inspect what a policy actually says before adopting it); op=analyze classifies failure modes in a transcript JSON array. Use when adopting/auditing/debugging evolved harness policies — reading genome JSON by eye is wrong because the behavior lives in the rendered system prompt and the component interactions, not the raw fields. NOTE: gepaOptimize (bring-your-own-evaluator optimization) is library-only — import @metaharness/darwin/gepa directly, or use metaharness_evolve for sandbox-scored evolution. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['genome', 'validate', 'render', 'analyze'], description: 'genome = load + validate; validate = structural errors only; render = genome → system prompt; analyze = transcript failure classes' },
        path: { type: 'string', description: 'Genome JSON path (genome/validate/render; default: shipped cand-6)' },
        transcript: { type: 'string', description: 'Transcript JSON array path (required for op=analyze)' },
        ext: { type: 'string', description: 'render only — target file extension hint' },
        glob: { type: 'string', description: 'render only — target glob hint' },
        alertOnInvalid: { type: 'boolean', description: 'Exit 1 when validation finds errors (gate-style)', default: false },
      },
      required: ['op'],
    },
    handler: async (input) => {
      const args: string[] = ['--op', String(input.op)];
      if (input.path) args.push('--path', String(input.path));
      if (input.transcript) args.push('--transcript', String(input.transcript));
      if (input.ext) args.push('--ext', String(input.ext));
      if (input.glob) args.push('--glob', String(input.glob));
      if (input.alertOnInvalid === true) args.push('--alert-on-invalid');
      const r = await runScript('gepa.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
];
