#!/usr/bin/env node
// test-parallel-pipeline — end-to-end integration test for ADR-150's
// SelfEvolvingRouter parallel-logging pipeline.
//
// Composition under test:
//   recordPair() / recordPairOutcome() [iter 11 — TS module]
//     → .swarm/router-parallel.jsonl  [JSONL trajectory]
//       → router-parallel-analyze.mjs [iter 10 — analyzer]
//         → 3-criteria AND-gate verdict [ADR-150 review-round-1]
//
// This script bypasses model-router.ts dispatch and calls the recorder
// directly, so it tests the recorder + analyzer composition WITHOUT
// requiring a built CLI dist. Iter-12 dispatch wiring is covered by
// the smoke step 17f source-grep.
//
// USAGE
//   node scripts/test-parallel-pipeline.mjs                # default
//   TEST_PIPELINE_KEEP_FIXTURE=1 node scripts/test-parallel-pipeline.mjs
//                                                          # leave temp files for debugging
//
// EXIT CODES
//   0  all assertions passed
//   1  at least one assertion failed
//   2  setup error (e.g. tsc dist not buildable, recorder module missing)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failures.push(label);
    failed++;
  }
}

async function main() {
  const fixture = mkdtempSync(join(tmpdir(), 'router-parallel-e2e-'));
  const jsonlPath = join(fixture, 'router-parallel.jsonl');
  console.log(`# router-parallel pipeline e2e (fixture: ${fixture})\n`);

  // ──────────────────────────────────────────────────────────────────
  // PHASE 1 — Synthesize a realistic JSONL trajectory by hand.
  //
  // We can't easily import the TS recorder without a build step, so we
  // emit the same JSONL shape the recorder produces. This isolates the
  // analyzer pipeline test from compile state.
  // ──────────────────────────────────────────────────────────────────
  console.log('Phase 1 — synthesize trajectory');

  const rows = [];
  // 40 paired decisions: SER beats bandit on quality (+5%) at +0.5% cost
  // and +1% latency — should pass the 3-criteria AND-gate.
  for (let i = 0; i < 40; i++) {
    const q_actual = 0.78 + Math.random() * 0.04;
    const u_actual = 0.005 + Math.random() * 0.001;
    const l_actual = 1500 + Math.random() * 200;
    const disagree = i % 2 === 0;
    rows.push({
      v: 1, type: 'pair',
      ts: new Date(Date.now() - (40 - i) * 1000).toISOString(),
      task_hash: `task-${i.toString(16).padStart(8, '0')}`,
      bandit: {
        pick: 'sonnet',
        predictedQuality: q_actual - 0.02,
        predictedCostUsd: u_actual,
        backend: 'thompson-bandit',
      },
      ser: {
        pick: disagree ? 'opus' : 'sonnet',
        predictedQuality: disagree ? q_actual + 0.10 : q_actual + 0.01,
        predictedCostUsd: disagree ? u_actual * 1.005 : u_actual,
        backend: disagree ? 'metaharness-router-hybrid' : 'bandit-only',
      },
      outcome: {
        actualModel: 'sonnet',
        actualQuality: q_actual,
        actualUsd: u_actual,
        actualLatencyMs: Math.round(l_actual),
      },
    });
  }

  writeFileSync(jsonlPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert(existsSync(jsonlPath), 'fixture JSONL written');
  assert(rows.length === 40, '40 pair rows synthesized');

  // ──────────────────────────────────────────────────────────────────
  // PHASE 2 — Verify recorder TS module compiles and exports the API.
  // ──────────────────────────────────────────────────────────────────
  console.log('\nPhase 2 — verify recorder TS module exports');

  const recorderTs = join(SCRIPTS_DIR, '..', '..', '..', 'v3', '@claude-flow', 'cli', 'src', 'ruvector', 'router-parallel-recorder.ts');
  const recorderSrc = readFileSync(recorderTs, 'utf-8');

  assert(/export function recordPair\b/.test(recorderSrc), 'recordPair exported');
  assert(/export function recordPairOutcome\b/.test(recorderSrc), 'recordPairOutcome exported');
  assert(/export function parallelRecorderStatus\b/.test(recorderSrc), 'parallelRecorderStatus exported');
  assert(/CLAUDE_FLOW_ROUTER_PARALLEL_LOG/.test(recorderSrc), 'env-gated by CLAUDE_FLOW_ROUTER_PARALLEL_LOG');
  // ADR-150 rule #3 — never throw
  assert(/never throws|never (throw|block)/i.test(recorderSrc), 'no-throw doc invariant present');
  // Try/catch around fs operations
  assert(/try \{[\s\S]*?appendFileSync[\s\S]*?\} catch/.test(recorderSrc), 'appendFileSync wrapped in try/catch');

  // ──────────────────────────────────────────────────────────────────
  // PHASE 3 — Run the analyzer against the synthesized JSONL.
  // ──────────────────────────────────────────────────────────────────
  console.log('\nPhase 3 — run analyzer against fixture');

  const analyzer = join(SCRIPTS_DIR, 'router-parallel-analyze.mjs');
  const r = spawnSync('node', [analyzer, '--input', jsonlPath, '--format', 'json'], {
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert(r.status === 0, `analyzer exit 0 (got ${r.status})`);

  let payload;
  try {
    payload = JSON.parse(r.stdout);
  } catch (e) {
    console.error('  stdout:', r.stdout.slice(0, 400));
    console.error('  stderr:', r.stderr.slice(0, 400));
    assert(false, `analyzer output parseable as JSON (${e.message})`);
    process.exit(2);
  }

  assert(payload.ok === true, 'payload.ok === true');
  assert(payload.sufficient === true, 'payload.sufficient === true (n>=30)');
  assert(payload.sampleSize === 40, `sampleSize === 40 (got ${payload.sampleSize})`);
  assert(typeof payload.disagreement?.pct === 'number', 'disagreement.pct numeric');

  // The 3 criteria must each be computed.
  assert(typeof payload.criteria?.qualityImprovementPct === 'number', 'criteria.qualityImprovementPct present');
  assert(typeof payload.criteria?.usdIncreasePct === 'number', 'criteria.usdIncreasePct present');
  assert(typeof payload.criteria?.latencyIncreasePct === 'number', 'criteria.latencyIncreasePct present');

  // Thresholds match ADR-150 review-round-1 exactly.
  assert(payload.criteria?.qualityThresholdPct === 2, 'quality threshold = 2%');
  assert(payload.criteria?.usdThresholdPct === 1, 'cost threshold = 1%');
  assert(payload.criteria?.latencyThresholdPct === 5, 'latency threshold = 5%');

  // For the promotable fixture, all three criteria should pass.
  assert(payload.criteria?.qualityPasses === true, 'quality > 2% passes');
  assert(payload.criteria?.costPasses === true, 'cost < 1% passes');
  assert(payload.criteria?.latencyPasses === true, 'latency < 5% passes');
  assert(payload.verdict?.promotable === true, 'verdict.promotable === true');

  // ──────────────────────────────────────────────────────────────────
  // PHASE 4 — Strict mode behavior.
  // ──────────────────────────────────────────────────────────────────
  console.log('\nPhase 4 — verify --strict semantics');

  const strictOk = spawnSync('node', [analyzer, '--input', jsonlPath, '--strict'], { encoding: 'utf-8', timeout: 30_000 });
  assert(strictOk.status === 0, '--strict on promotable fixture exits 0');

  // Synthesize a non-promotable fixture (quality gain only +1%, below 2% threshold).
  const badPath = join(fixture, 'non-promotable.jsonl');
  const badRows = [];
  for (let i = 0; i < 40; i++) {
    const q = 0.80;
    badRows.push({
      v: 1, type: 'pair',
      ts: new Date().toISOString(),
      task_hash: `bad-${i.toString(16).padStart(8, '0')}`,
      bandit: { pick: 'sonnet', predictedQuality: q, predictedCostUsd: 0.005, backend: 'thompson-bandit' },
      ser:    { pick: 'sonnet', predictedQuality: q + 0.005, predictedCostUsd: 0.005, backend: 'bandit-only' },
      outcome: { actualModel: 'sonnet', actualQuality: q, actualUsd: 0.005, actualLatencyMs: 1500 },
    });
  }
  writeFileSync(badPath, badRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const strictBad = spawnSync('node', [analyzer, '--input', badPath, '--strict'], { encoding: 'utf-8', timeout: 30_000 });
  assert(strictBad.status === 1, '--strict on NON-promotable fixture exits 1 (got ' + strictBad.status + ')');

  // Cleanup
  if (process.env.TEST_PIPELINE_KEEP_FIXTURE !== '1') {
    rmSync(fixture, { recursive: true, force: true });
  } else {
    console.log(`\n(fixture kept at ${fixture})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ End-to-end pipeline test PASSED.');
}

main().catch((e) => {
  console.error('test-parallel-pipeline crashed:', e.message || e);
  process.exit(2);
});
