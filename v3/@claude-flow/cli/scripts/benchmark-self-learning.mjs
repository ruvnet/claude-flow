#!/usr/bin/env node
// benchmark-self-learning.mjs — proof harness for #2245.
//
// Replaces the "self-learning reports success but persists nothing" theater
// with measured deltas: actually runs each entry point N times and prints what
// each one moved (or didn't). Writes a run JSON to docs/benchmarks/runs/ so
// future regressions are visible against a committed baseline.
//
// Usage:
//   node scripts/benchmark-self-learning.mjs                  # default N=20 per surface
//   N=50 BENCH_JSON=1 node scripts/benchmark-self-learning.mjs
//   BENCH_NO_WRITE=1 node scripts/benchmark-self-learning.mjs
//
// Repro:
//   1. Clone ruvnet/ruflo, npm install, build the CLI:
//        npm install && (cd v3/@claude-flow/cli && npx tsc -b)
//   2. Run this script. It prints a "before/after" table per surface.
//   3. Inspect docs/benchmarks/runs/self-learning-<ts>.json for the persisted
//      proof — diff against previous runs to catch any future regression.

import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(REPO_ROOT, 'docs', 'benchmarks', 'runs');

const N = Number(process.env.N) || 20;

// Run in an isolated temp dir so we don't pollute the repo's neural store.
const SCRATCH = mkdtempSync(join(tmpdir(), 'learn-bench-'));
process.chdir(SCRATCH);

async function main() {
  const intel = await import(join(CLI_ROOT, 'dist/src/memory/intelligence.js'));
  const hooks = await import(join(CLI_ROOT, 'dist/src/mcp-tools/hooks-tools.js'));
  const neural = await import(join(CLI_ROOT, 'dist/src/mcp-tools/neural-tools.js'));

  intel.clearIntelligence();

  // -------------------------------------------------------------------------
  // §A — recordSignalProcessed
  // -------------------------------------------------------------------------
  const A_before = intel.getIntelligenceStats();
  const tA = performance.now();
  for (let i = 0; i < N; i++) intel.recordSignalProcessed();
  intel.flushIntelligenceStats();
  const dtA = performance.now() - tA;
  const A_after = intel.getIntelligenceStats();
  const A_delta = A_after.signalsProcessed - A_before.signalsProcessed;

  // -------------------------------------------------------------------------
  // §B — hooks_task-completed (trainPatterns:true) → trajectory pipeline
  // -------------------------------------------------------------------------
  const taskCompleted = hooks.hooksTools.find((t) => t.name === 'hooks_task-completed');
  const B_before = intel.getIntelligenceStats();
  const tB = performance.now();
  let B_trained = 0;
  for (let i = 0; i < N; i++) {
    const r = await taskCompleted.handler({
      taskId: `bench-${i}`,
      success: i % 5 !== 4, // 80% success, 20% failure — mixed verdict
      quality: 0.5 + (i % 5) * 0.1,
      trainPatterns: true,
      content: `Benchmark task ${i}: refactor or test or fix`,
    });
    if (r.learningPath === 'trajectory-pipeline') B_trained++;
  }
  const dtB = performance.now() - tB;
  const B_after = intel.getIntelligenceStats();

  // -------------------------------------------------------------------------
  // §C — hooks_task-completed recorded-only (negative control)
  // -------------------------------------------------------------------------
  const C_before = intel.getIntelligenceStats();
  const tC = performance.now();
  for (let i = 0; i < N; i++) {
    await taskCompleted.handler({ taskId: `bench-no-train-${i}`, success: true, quality: 0.8 });
  }
  const dtC = performance.now() - tC;
  const C_after = intel.getIntelligenceStats();

  // -------------------------------------------------------------------------
  // §D — storeNeuralPatterns + neural_patterns list reflects them
  // -------------------------------------------------------------------------
  const items = Array.from({ length: N }, (_, i) => ({
    name: `pattern-${i}`,
    type: 'bench-pattern',
    content: `import { thing${i} } from 'module${i}'`,
  }));
  const tD = performance.now();
  const D_store = await neural.storeNeuralPatterns(items);
  const dtD = performance.now() - tD;
  const listTool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
  const D_list = await listTool.handler({ action: 'list' });

  // -------------------------------------------------------------------------
  // §E — multi-step trajectory pipeline (end-to-end)
  // -------------------------------------------------------------------------
  const trajStart = hooks.hooksTools.find((t) => t.name === 'hooks_intelligence_trajectory-start');
  const trajStep  = hooks.hooksTools.find((t) => t.name === 'hooks_intelligence_trajectory-step');
  const trajEnd   = hooks.hooksTools.find((t) => t.name === 'hooks_intelligence_trajectory-end');
  // NOTE: the MCP trajectory tools feed sonaCoordinator (queryable via
  // hooks_intelligence_stats), NOT globalStats. That's part of the broader
  // store-fragmentation problem #2245 identifies; we check observable
  // outcomes (persisted + sonaUpdate) instead of a globalStats delta.
  const tE = performance.now();
  let persistedCount = 0;
  let sonaUpdateCount = 0;
  if (trajStart && trajStep && trajEnd) {
    for (let i = 0; i < Math.min(5, N); i++) {
      const s = await trajStart.handler({ task: `multi-step bench ${i}`, agent: 'bench' });
      const id = s.trajectoryId;
      await trajStep.handler({ trajectoryId: id, type: 'observation', content: `obs ${i}` });
      await trajStep.handler({ trajectoryId: id, type: 'action',      content: `act ${i}` });
      await trajStep.handler({ trajectoryId: id, type: 'result',      content: `done ${i}` });
      const endRes = await trajEnd.handler({ trajectoryId: id, success: true });
      if (endRes.persisted) persistedCount++;
      if (endRes.learning?.sonaUpdate) sonaUpdateCount++;
    }
  }
  const dtE = performance.now() - tE;

  // -------------------------------------------------------------------------
  // §F — getUnifiedLearningStats (ADR-075)
  // -------------------------------------------------------------------------
  const tF = performance.now();
  const unified = await intel.getUnifiedLearningStats();
  const dtF = performance.now() - tF;
  const unifiedOk = unified.global && unified.sona && unified.memoryBridge && unified.neuralPatterns && unified.consistency;

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const summary = {
    runAt: new Date().toISOString(),
    benchmark: 'self-learning-2245',
    n: N,
    sections: {
      A_recordSignalProcessed: {
        calls: N,
        signalsProcessedDelta: A_delta,
        passed: A_delta === N,
        elapsedMs: Number(dtA.toFixed(2)),
      },
      B_taskCompleted_trainPatterns: {
        calls: N,
        trainedViaPipeline: B_trained,
        trajectoriesDelta: B_after.trajectoriesRecorded - B_before.trajectoriesRecorded,
        patternsLearnedDelta: B_after.patternsLearned - B_before.patternsLearned,
        passed: B_trained === N,
        elapsedMs: Number(dtB.toFixed(2)),
        avgLatencyMsPerCall: Number((dtB / N).toFixed(2)),
      },
      C_taskCompleted_recordedOnly: {
        calls: N,
        trajectoriesDelta: C_after.trajectoriesRecorded - C_before.trajectoriesRecorded,
        passed: (C_after.trajectoriesRecorded - C_before.trajectoriesRecorded) === 0,
        note: 'negative control — should NOT touch trajectories',
        elapsedMs: Number(dtC.toFixed(2)),
      },
      D_pretrain_neuralPatterns: {
        attempted: items.length,
        stored: D_store.stored,
        listTotal: D_list.total,
        passed: D_store.stored === items.length && D_list.total >= items.length,
        elapsedMs: Number(dtD.toFixed(2)),
      },
      E_multiStepTrajectory: {
        cycles: Math.min(5, N),
        persistedCount,
        sonaUpdateCount,
        passed: persistedCount === Math.min(5, N), // persistence is the must-pass; SONA depends on env
        note: 'MCP trajectory tools feed sonaCoordinator (see hooks_intelligence_stats), not globalStats — observable outcomes checked here',
        elapsedMs: Number(dtE.toFixed(2)),
      },
      F_unifiedStats: {
        shape: ['global', 'sona', 'memoryBridge', 'neuralPatterns', 'consistency'],
        observed: {
          'global.patternsLearned': unified.global.patternsLearned,
          'global.trajectoriesRecorded': unified.global.trajectoriesRecorded,
          'global.signalsProcessed': unified.global.signalsProcessed,
          'memoryBridge.totalEntries': unified.memoryBridge.totalEntries,
          'memoryBridge.reachable': unified.memoryBridge.reachable,
          'neuralPatterns.patternCount': unified.neuralPatterns.patternCount,
          'sona.available': unified.sona.available,
          'consistency.notes': unified.consistency.notes.length,
        },
        passed: !!unifiedOk,
        note: 'ADR-075 — one aggregator across the 4 stores. Each sub-view names its source.',
        elapsedMs: Number(dtF.toFixed(2)),
      },
    },
    finalState: {
      signalsProcessed: A_after.signalsProcessed,
      trajectoriesRecorded: intel.getIntelligenceStats().trajectoriesRecorded,
      patternsLearned: intel.getIntelligenceStats().patternsLearned,
    },
    scratch: SCRATCH,
  };

  const allPassed = Object.values(summary.sections).every((s) => s.passed);
  summary.passed = allPassed;

  if (process.env.BENCH_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`# Self-learning benchmark (#2245) — N=${N}`);
    console.log('');
    console.log('| Section | Calls | Delta | Passed | Latency (ms) |');
    console.log('|---|---:|---:|:---:|---:|');
    console.log(`| A recordSignalProcessed | ${N} | +${summary.sections.A_recordSignalProcessed.signalsProcessedDelta} | ${summary.sections.A_recordSignalProcessed.passed ? '✅' : '❌'} | ${summary.sections.A_recordSignalProcessed.elapsedMs} |`);
    console.log(`| B task-completed (train) | ${N} | trained=${summary.sections.B_taskCompleted_trainPatterns.trainedViaPipeline}, trajectories+${summary.sections.B_taskCompleted_trainPatterns.trajectoriesDelta} | ${summary.sections.B_taskCompleted_trainPatterns.passed ? '✅' : '❌'} | ${summary.sections.B_taskCompleted_trainPatterns.elapsedMs} (${summary.sections.B_taskCompleted_trainPatterns.avgLatencyMsPerCall}/call) |`);
    console.log(`| C task-completed (record-only) | ${N} | trajectories+${summary.sections.C_taskCompleted_recordedOnly.trajectoriesDelta} (expected 0) | ${summary.sections.C_taskCompleted_recordedOnly.passed ? '✅' : '❌'} | ${summary.sections.C_taskCompleted_recordedOnly.elapsedMs} |`);
    console.log(`| D pretrain → neural_patterns | ${items.length} | stored=${summary.sections.D_pretrain_neuralPatterns.stored}, listed=${summary.sections.D_pretrain_neuralPatterns.listTotal} | ${summary.sections.D_pretrain_neuralPatterns.passed ? '✅' : '❌'} | ${summary.sections.D_pretrain_neuralPatterns.elapsedMs} |`);
    console.log(`| E multi-step trajectory | ${summary.sections.E_multiStepTrajectory.cycles} | persisted=${summary.sections.E_multiStepTrajectory.persistedCount}, sonaUpdate=${summary.sections.E_multiStepTrajectory.sonaUpdateCount} | ${summary.sections.E_multiStepTrajectory.passed ? '✅' : '❌'} | ${summary.sections.E_multiStepTrajectory.elapsedMs} |`);
    const f = summary.sections.F_unifiedStats;
    console.log(`| F unified-stats | 4 stores | bridge.reachable=${f.observed['memoryBridge.reachable']}, sona.available=${f.observed['sona.available']}, neural.count=${f.observed['neuralPatterns.patternCount']}, notes=${f.observed['consistency.notes']} | ${f.passed ? '✅' : '❌'} | ${f.elapsedMs} |`);
    console.log('');
    console.log(`Final state: signalsProcessed=${summary.finalState.signalsProcessed}, trajectoriesRecorded=${summary.finalState.trajectoriesRecorded}, patternsLearned=${summary.finalState.patternsLearned}`);
    console.log(`Overall: ${allPassed ? '✅ ALL PASSED' : '❌ FAILED'}`);
  }

  if (!process.env.BENCH_NO_WRITE) {
    mkdirSync(RUNS_DIR, { recursive: true });
    const stamp = summary.runAt.replace(/[:.]/g, '-');
    writeFileSync(join(RUNS_DIR, `self-learning-${stamp}.json`), JSON.stringify(summary, null, 2));
    writeFileSync(join(RUNS_DIR, 'self-learning-latest.json'), JSON.stringify(summary, null, 2));
    if (!process.env.BENCH_JSON) console.log(`\nWrote ${join(RUNS_DIR, `self-learning-${stamp}.json`)}`);
  }

  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch {}

  if (!allPassed) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
