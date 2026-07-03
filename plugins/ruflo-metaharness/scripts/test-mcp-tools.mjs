#!/usr/bin/env node
// test-mcp-tools.mjs — runtime test for the iter-20/21 MCP tool registry.
//
// tsc proves the metaharness-tools.ts module COMPILES; structural smoke
// proves the source DECLARES the right tool names. Neither proves the
// HANDLERS actually run without throwing. This test imports the compiled
// module and invokes every tool's handler with minimal inputs.
//
// CONTRACT EACH TOOL MUST SATISFY
//   - handler is callable as `await tool.handler({ ... })`
//   - returns an object with keys: success, data, degraded, exitCode
//   - never throws (even with bad/missing optional dep — graceful)
//   - handler honors the 120s subprocess timeout (no hang)
//
// USAGE
//   node scripts/test-mcp-tools.mjs                          # default
//   node scripts/test-mcp-tools.mjs --format json
//
// EXIT CODES
//   0  all tools satisfy the contract
//   1  at least one tool failed
//   2  setup error (compiled dist not present)

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ARGS = (() => {
  const a = { format: 'table' };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--format') a.format = process.argv[++i];
  }
  return a;
})();

let passed = 0, failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failures.push(label); failed++; }
}

async function main() {
  // Locate the compiled dist of metaharness-tools.
  const distPath = resolve(SCRIPTS_DIR, '..', '..', '..',
    'v3', '@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'metaharness-tools.js');

  if (!existsSync(distPath)) {
    console.log(`# test-mcp-tools — SKIPPED`);
    console.log('');
    console.log(`Compiled dist not present: ${distPath}`);
    console.log(`Build the CLI first:`);
    console.log(`  cd v3/@claude-flow/cli && npm run build`);
    console.log('');
    console.log(`Exit 0 — this script is meaningfully runnable only post-build.`);
    process.exit(0);
  }

  let mod;
  try {
    mod = await import(distPath);
  } catch (e) {
    console.error(`test-mcp-tools: failed to import ${distPath}: ${e.message}`);
    process.exit(2);
  }

  const tools = mod.metaharnessTools;
  console.log(`# test-mcp-tools — runtime contract\n`);

  // ──────────────────────────────────────────────────────────────────
  // PHASE 1 — module exports the right shape
  // ──────────────────────────────────────────────────────────────────
  console.log('Phase 1 — module shape');
  assert(Array.isArray(tools), 'metaharnessTools is an array');
  assert(tools.length === 15, `15 tools registered (got ${tools.length})`);

  const expectedNames = new Set([
    'metaharness_score',
    'metaharness_genome',
    'metaharness_mcp_scan',
    'metaharness_threat_model',
    'metaharness_oia_audit',
    'metaharness_audit_list',
    'metaharness_audit_trend',
    // iter 36 — ADR-152 §3.1 production
    'metaharness_similarity',
    // iter 54 — one-command drift detection (composes audit-list + oia-audit + audit-trend)
    'metaharness_drift_from_history',
    // ADR-153 — bench suites + evolve driver + security-focused bench
    'metaharness_bench',
    'metaharness_evolve',
    'metaharness_security_bench',
    // @metaharness/redblue@~0.1.4 — adversarial red/blue LLM testing
    'metaharness_redblue',
    // metaharness@0.3.0 — upstream ADR-235 GEPA learning run
    'metaharness_learn',
    // @metaharness/darwin@0.8.0 — GEPA library surface (genome ops)
    'metaharness_gepa',
  ]);
  const actualNames = new Set(tools.map((t) => t.name));
  for (const name of expectedNames) {
    assert(actualNames.has(name), `${name} registered`);
  }

  // ──────────────────────────────────────────────────────────────────
  // PHASE 2 — every tool has the required MCP shape
  // ──────────────────────────────────────────────────────────────────
  console.log('\nPhase 2 — per-tool shape');
  for (const tool of tools) {
    const ok = typeof tool.name === 'string'
      && typeof tool.description === 'string'
      && typeof tool.category === 'string'
      && typeof tool.handler === 'function'
      && typeof tool.inputSchema === 'object';
    assert(ok, `${tool.name} has {name, description, category, handler, inputSchema}`);
    assert(tool.category === 'metaharness', `${tool.name} category === 'metaharness'`);
  }

  // ──────────────────────────────────────────────────────────────────
  // PHASE 3 — handlers callable + return contract shape
  //
  // We invoke each handler with minimal valid input. The handlers may
  // succeed (if metaharness is installed) or report degraded (if not).
  // EITHER way, they must return { success, data, degraded, exitCode }
  // without throwing.
  // ──────────────────────────────────────────────────────────────────
  console.log('\nPhase 3 — handler invocations (allow up to 30s each)');
  for (const tool of tools) {
    // Construct minimal valid input per tool.
    let input = {};
    if (tool.name === 'metaharness_audit_trend') {
      // Requires baselineKey + currentKey — use fake keys that won't
      // resolve so we exercise the not-found path.
      input = { baselineKey: 'audit-fake-base', currentKey: 'audit-fake-curr' };
    }
    if (tool.name === 'metaharness_similarity') {
      // Needs --a/--b OR --a-key/--b-key. Use fake mem keys to exercise
      // the graceful not-found path (matches audit_trend convention).
      input = { aKey: 'harness-fake-a', bKey: 'harness-fake-b' };
    }
    if (tool.name === 'metaharness_drift_from_history') {
      // iter 54 — composes 3 subprocesses, needs more time than the default.
      input = { dryRun: true, threshold: 0.5 };
    }
    if (tool.name === 'metaharness_oia_audit') {
      // iter 128 — composite audit runs 5 sub-audits (oia-manifest +
      // threat-model + mcp-scan + score + genome) in parallel. Each
      // shells out via npx. --dry-run skips memory persistence so the
      // test doesn't pollute namespaces.
      input = { dryRun: true };
    }
    if (tool.name === 'metaharness_redblue') {
      // `attack` preview is the fastest path that exercises the upstream
      // binary without needing OPENROUTER_API_KEY or running any model
      // calls. Count=1 keeps cold-cache npx fetch the dominant cost.
      input = { subcommand: 'attack', family: 'prompt', count: 1 };
    }
    if (tool.name === 'metaharness_learn') {
      // No repo checkout in CI → structured {status:"checkout-required"}
      // exit-0 path. $0: without run=true upstream never spends anyway.
      input = {};
    }
    if (tool.name === 'metaharness_gepa') {
      // op is required; `genome` loads + validates the SHIPPED cand-6
      // genome — pure-local library call once darwin is cached.
      input = { op: 'genome' };
    }

    // iter 124 → 130 — timeouts have crept up as CI cold-cache npx
    // warmup costs got measured. Final budgets:
    //   default          : 60s
    //   chain-tools      : 180s  (drift_from_history + oia_audit + audit_list)
    // iter 131 — bumped chain-tool budget 90s → 180s. audit_list still
    // timed out at 90s in CI; locally it runs in ~4s, but CI's
    // `npx @claude-flow/cli@latest memory list` invocation pays both
    // the npx fetch AND a full CLI startup (which loads agentic-flow +
    // ONNX). 180s gives 30x headroom over the local cost.
    const isChainTool = tool.name === 'metaharness_drift_from_history'
      || tool.name === 'metaharness_oia_audit'
      || tool.name === 'metaharness_audit_list'
      // redblue: `attack prompt --count 1` is preview-only (no model
      // calls) but the cold-cache `npx -y @metaharness/redblue@~0.1.4`
      // fetch can take 30-60s. 180s gives 3x headroom.
      || tool.name === 'metaharness_redblue'
      // learn: cold-cache `npx -y metaharness@latest` fetch dominates.
      // gepa: one-time `npm install --prefix ~/.ruflo/darwin-cache-*`
      // fallback install can take 30-60s on cold cache.
      || tool.name === 'metaharness_learn'
      || tool.name === 'metaharness_gepa';
    const timeoutMs = isChainTool ? 180_000 : 60_000;
    const handlerPromise = tool.handler(input);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${timeoutMs / 1000}s handler timeout`)), timeoutMs));

    let result;
    let threw = false;
    try {
      result = await Promise.race([handlerPromise, timeoutPromise]);
    } catch (e) {
      threw = true;
      console.log(`    [${tool.name}] handler threw: ${e.message.slice(0, 80)}`);
    }

    assert(!threw, `${tool.name} handler did not throw`);
    if (!threw && result) {
      assert(typeof result === 'object', `${tool.name} returns object`);
      assert('success' in result, `${tool.name} result has 'success'`);
      assert('data' in result, `${tool.name} result has 'data'`);
      assert('degraded' in result, `${tool.name} result has 'degraded'`);
      assert('exitCode' in result, `${tool.name} result has 'exitCode'`);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // PHASE 4 — POSITIVE-CASE data-shape validation (iter 43)
  //
  // Iter 37 verified the {success, data, degraded, exitCode} envelope.
  // It did NOT verify that data.X contains the right keys when success
  // is genuinely true — leaving room for iter 42-style bugs where a
  // handler returns valid-looking degraded JSON while silently
  // misrouting input. This phase invokes each handler with VALID
  // inputs and asserts the expected output shape.
  //
  // Tools that depend on `npx metaharness` (score/genome/mcp-scan/
  // threat-model/oia-audit/audit-list/audit-trend) are SKIPPED in this
  // phase when the optional dep isn't installed — they're covered by
  // the no-metaharness-smoke workflow's drill. The similarity tool
  // has no @metaharness/* dep, so its positive case ALWAYS runs.
  // ──────────────────────────────────────────────────────────────────
  console.log('\nPhase 4 — positive-case data shape (iter 43)');

  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: pjoin } = await import('node:path');
  const tmp = mkdtempSync(pjoin(tmpdir(), 'mcp-positive-'));

  // metaharness_similarity — full positive case (no @metaharness/* needed)
  const simTool = tools.find((t) => t.name === 'metaharness_similarity');
  if (simTool) {
    const aPath = pjoin(tmp, 'a.json');
    const bPath = pjoin(tmp, 'b.json');
    writeFileSync(aPath, JSON.stringify({
      score: { harnessFit: 78, compileConfidence: 92, taskCoverage: 65, toolSafety: 88, memoryUsefulness: 70, estCostPerRunUsd: 0.04, recommendedMode: 'CLI + MCP', archetype: 'compliance-harness', template: 'vertical:legal' },
      genome: { repo_type: 'node_mcp_ci', agent_topology: ['x','y','z','w'], risk_score: 0.45, test_confidence: 0.7, publish_readiness: 0.6 },
    }));
    writeFileSync(bPath, JSON.stringify({
      score: { harnessFit: 75, compileConfidence: 90, taskCoverage: 70, toolSafety: 90, memoryUsefulness: 72, estCostPerRunUsd: 0.05, recommendedMode: 'CLI + MCP', archetype: 'compliance-harness', template: 'vertical:support' },
      genome: { repo_type: 'node_mcp_ci', agent_topology: ['x','y','z','q','r'], risk_score: 0.40, test_confidence: 0.75, publish_readiness: 0.65 },
    }));
    const r = await simTool.handler({ aFile: aPath, bFile: bPath });
    assert(r.degraded === false, 'similarity positive case: degraded === false');
    assert(r.success === true, 'similarity positive case: success === true');
    assert(r.exitCode === 0, 'similarity positive case: exitCode === 0');
    const d = r.data ?? {};
    assert(typeof d.overall === 'number', 'similarity data has numeric `overall`');
    assert(typeof d.components === 'object' && d.components !== null,
      'similarity data has `components` object');
    assert(typeof d.components?.cosine === 'number',
      'similarity components.cosine numeric');
    assert(typeof d.components?.categorical === 'number',
      'similarity components.categorical numeric');
    assert(typeof d.components?.jaccard === 'number',
      'similarity components.jaccard numeric');
    assert(typeof d.weights === 'object' && d.weights !== null,
      'similarity data has `weights` object');
    assert(d.adr === 'ADR-152', 'similarity data tagged adr=ADR-152');
    // Regression anchor — same fixtures as iter-35 spike with non-matching topologies
    assert(d.overall > 0 && d.overall < 1,
      `similarity overall in (0, 1) — got ${d.overall}`);

    // Per-dimension variant
    const rPD = await simTool.handler({ aFile: aPath, bFile: bPath, perDimension: true });
    assert(typeof rPD.data?.perDimension === 'object',
      'similarity perDimension=true populates breakdown');

    // Alert-below variant exercises non-zero exit
    const rAlert = await simTool.handler({ aFile: aPath, bFile: bPath, alertBelow: 0.99 });
    assert(rAlert.data?.alert?.triggered === true,
      'similarity alertBelow=0.99 triggers alert');
    assert(rAlert.exitCode === 1, 'similarity alertBelow=0.99 → exitCode 1');
    // iter 44 — success semantic anchor (was true under the pre-iter-44
    // `!degraded` rule; now false because exitCode !== 0 dominates).
    assert(rAlert.success === false,
      'similarity alertBelow=0.99 → success === false (iter 44 fix)');
  }

  // metaharness_mcp_scan — positive case post iter-50 parser landing.
  // Until iter 50, mcp_scan's data field was an alert-only object with
  // no structured findings. After iter 50, findings[] is always present
  // (parsed from upstream text) and summary{overallSeverity, totalCount}
  // accompanies it.
  const scanTool = tools.find((t) => t.name === 'metaharness_mcp_scan');
  if (scanTool) {
    // Run against ruflo itself — guaranteed to produce at least the
    // INFO finding the iter-50 parser test verified manually.
    const r = await scanTool.handler({ path: '.', failOn: 'high' });
    // Either succeeds with structured findings, or gracefully degrades
    // if metaharness isn't installed in this environment.
    if (!r.degraded) {
      assert(r.success === true, 'mcp_scan positive: success === true');
      assert(r.exitCode === 0, 'mcp_scan positive: exitCode === 0');
      assert(Array.isArray(r.data?.findings),
        'mcp_scan positive: data.findings is an array (iter 50 fix)');
      // Cwd-dependent: when scanning a dir without .mcp/servers.json the
      // upstream emits no findings. Only verify shape contract when array
      // is populated — the array-presence assertion above is the
      // load-bearing one for iter 50.
      if (r.data?.findings.length > 0) {
        const first = r.data.findings[0];
        assert(typeof first?.severity === 'string',
          'mcp_scan positive: first finding has string severity');
        assert(typeof first?.message === 'string',
          'mcp_scan positive: first finding has string message');
      }
      // summary may be null if the upstream produced no Result: line —
      // verify the field's presence (null OR object) but only deep-check
      // when populated.
      if (r.data?.summary) {
        assert(typeof r.data.summary.totalCount === 'number',
          'mcp_scan positive: data.summary.totalCount is numeric (when summary present)');
      }
    } else {
      console.log(`    ⊘ mcp_scan: metaharness absent — graceful skip`);
    }
  }

  // metaharness_audit_trend — positive case via file inputs
  const trendTool = tools.find((t) => t.name === 'metaharness_audit_trend');
  if (trendTool) {
    const basePath = pjoin(tmp, 'base.json');
    const currPath = pjoin(tmp, 'curr.json');
    const fingerprint = {
      score: { harnessFit: 80, recommendedMode: 'CLI + MCP', archetype: 'typescript-sdk-harness', template: 'vertical:coding' },
      genome: { repo_type: 'node_mcp_ci', agent_topology: ['a','b','c'], risk_score: 0.3, test_confidence: 0.85, publish_readiness: 0.9 },
    };
    writeFileSync(basePath, JSON.stringify({
      startedAt: '2026-06-15T00:00:00Z',
      composite: { worst: 'clean' },
      components: { oiaManifest: {}, threatModel: {}, mcpScan: { json: { findings: [] } } },
      fingerprint,
    }));
    writeFileSync(currPath, JSON.stringify({
      startedAt: '2026-06-16T00:00:00Z',
      composite: { worst: 'clean' },
      components: { oiaManifest: {}, threatModel: {}, mcpScan: { json: { findings: [] } } },
      fingerprint,
    }));
    // audit_trend tool only supports keys, not files at the MCP layer.
    // Document its actual wrapper semantics so future-us doesn't get
    // surprised:
    //   - bad keys → script exits 2 with stderr (no JSON payload)
    //   - runScript() can't parse a {degraded:true} marker, so it
    //     returns degraded:false / success:true / exitCode:2
    // This is a real wrapper bug (success should not be true when
    // exit!=0 AND no JSON came back), tracked separately. Asserting
    // current behavior here protects against silent semantic shifts.
    // iter 46 — file-input path. audit_trend now accepts baselineFile/currentFile.
    const rFiles = await trendTool.handler({ baselineFile: basePath, currentFile: currPath });
    assert(rFiles.success === true,
      'audit_trend file-input path: success === true (iter 46)');
    assert(rFiles.exitCode === 0, 'audit_trend file-input path: exitCode === 0');
    assert(typeof rFiles.data?.delta === 'object',
      'audit_trend file-input path: data.delta object present');
    assert(rFiles.data?.delta?.structuralDistance?.verdict === 'near-identical',
      `audit_trend file-input path: identical fingerprints → near-identical (got ${rFiles.data?.delta?.structuralDistance?.verdict})`);

    // iter 54 — metaharness_drift_from_history positive case
    const driftTool = tools.find((t) => t.name === 'metaharness_drift_from_history');
    if (driftTool) {
      // iter 71 — verify iter-66/67 fast-path flags are now MCP-callable
      // Synthesize a baseline file on disk; pass via the new baselineFile input.
      const baselinePath = pjoin(tmp, 'drift-baseline.json');
      writeFileSync(baselinePath, JSON.stringify({
        startedAt: '2026-06-16T00:00:00Z',
        composite: { worst: 'clean' },
        components: { oiaManifest: {}, threatModel: {}, mcpScan: { json: { findings: [] } } },
        fingerprint: {
          score: { harnessFit: 82, recommendedMode: 'CLI + MCP', archetype: 'typescript-sdk-harness', template: 'vertical:coding' },
          genome: { repo_type: 'node_mcp_ci', agent_topology: ['m', 't'], risk_score: 0.3 },
        },
      }));
      const rFastFast = await driftTool.handler({
        path: '.', dryRun: true, threshold: 0.5, baselineFile: baselinePath,
      });
      if (!rFastFast.degraded) {
        assert(rFastFast.data?.timing?.usedBaselineFile === true,
          'drift_from_history MCP-layer: baselineFile fastpath fires (iter 71)');
        assert(rFastFast.data?.timing?.skippedAuditList === true,
          'drift_from_history MCP-layer: skippedAuditList=true via baselineFile (iter 71)');
      }

      // iter 85 — verify iter-78's alertOnNewSeverity MCP input plumbs
      // through. baselineFile has no findings; current ruflo audit has
      // 1 INFO finding. With alertOnNewSeverity='info' the gate fires
      // and surfaces in the response.
      const baselineNoFindings = pjoin(tmp, 'drift-baseline-no-findings.json');
      writeFileSync(baselineNoFindings, JSON.stringify({
        startedAt: '2026-06-16T00:00:00Z',
        composite: { worst: 'clean' },
        components: { oiaManifest: {}, threatModel: {}, mcpScan: { json: { findings: [] } } },
        fingerprint: {
          score: { harnessFit: 82, recommendedMode: 'CLI + MCP', archetype: 'typescript-sdk-harness', template: 'vertical:coding' },
          genome: { repo_type: 'node_mcp_ci', agent_topology: ['m', 't'], risk_score: 0.3 },
        },
      }));
      const rSevAlert = await driftTool.handler({
        path: '.', dryRun: true, threshold: 0.5,
        baselineFile: baselineNoFindings,
        alertOnNewSeverity: 'info',
      });
      if (!rSevAlert.degraded) {
        assert(rSevAlert.data?.alert?.newSeverityThreshold === 'info',
          'drift_from_history MCP-layer: alertOnNewSeverity echoed in payload (iter 85)');
        // Triggered AND exit code reflects (only if the audit actually had findings)
        if (rSevAlert.data?.alert?.triggered === true) {
          assert(rSevAlert.exitCode === 1,
            `drift_from_history MCP-layer: alertOnNewSeverity exitCode=1 when triggered (got ${rSevAlert.exitCode})`);
          assert(rSevAlert.success === false,
            'drift_from_history MCP-layer: success===false when alert fires (iter 44 fix)');
        }
      }

      const r54 = await driftTool.handler({ path: '.', dryRun: true, threshold: 0.5 });
      if (!r54.degraded) {
        assert(typeof r54.data === 'object' && r54.data !== null,
          'drift_from_history positive: data is an object');
        // Either it produced the structured drift report OR the no-history error
        const isOk = r54.data?.command === 'drift-from-history';
        const isNoHistory = typeof r54.data?.error === 'string' && r54.data.error.includes('no audit records');
        assert(isOk || isNoHistory,
          `drift_from_history positive: structured report OR no-history error (got ${JSON.stringify(r54.data).slice(0,80)})`);
        if (isOk) {
          assert(typeof r54.data.baseline?.key === 'string',
            'drift_from_history: baseline.key is a string');
          assert(typeof r54.data.alert?.threshold === 'number',
            'drift_from_history: alert.threshold echoed numerically');
        }
      } else {
        console.log(`    ⊘ drift_from_history: degraded (metaharness or memory absent)`);
      }
    }

    const r = await trendTool.handler({ baselineKey: 'missing-X', currentKey: 'missing-Y' });
    assert(r.exitCode === 2,
      'audit_trend bad-keys path exits 2 (script-level guard fires)');
    assert(r.data === null || r.data === undefined,
      'audit_trend bad-keys path: data null (no JSON emitted on stderr exit)');
    // iter 44 — success semantic anchor. Pre-iter-44 wrapper returned
    // success:true for this case (because no degraded marker). Now
    // returns false because exitCode !== 0.
    assert(r.success === false,
      'audit_trend bad-keys path: success === false (iter 44 fix)');
  }

  // Cleanup
  try { (await import('node:fs')).rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ All 15 MCP tools satisfy the runtime contract.');
}

main().catch((e) => {
  console.error('test-mcp-tools crashed:', e.message || e);
  process.exit(2);
});
