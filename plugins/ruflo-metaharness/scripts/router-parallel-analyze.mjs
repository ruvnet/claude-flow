#!/usr/bin/env node
// router-parallel-analyze.mjs — ADR-150 Phase 2 SelfEvolvingRouter
// promotion gate.
//
// Reads paired routing decisions (Thompson bandit pick + SelfEvolvingRouter
// pick, both with measured outcomes) from a JSONL trajectory file and
// computes the THREE PROMOTION CRITERIA from ADR-150 review-round-1:
//
//   (a) qualityScore improvement > 2%           (relative)
//   (b) usdPerDecision increase < 1%             (relative)
//   (c) p95 routing-decision latency increase < 5%  (relative)
//
// ALL THREE must hold for promotion. AND, not OR — the OR form let
// quality gains mask cost regressions, exactly the failure mode ADR-149's
// Pareto framing was built to prevent.
//
// INPUT FORMAT (.swarm/router-parallel.jsonl, one JSON record per line):
//   {
//     "ts": "<iso>",
//     "task": { ... },
//     "bandit":  { "pick": "<modelId>", "predictedQuality": 0.84, "predictedCostUsd": 0.003 },
//     "ser":     { "pick": "<modelId>", "predictedQuality": 0.87, "predictedCostUsd": 0.004 },
//     "outcome": { "actualModel": "<modelId>", "actualQuality": 0.91, "actualUsd": 0.0035, "actualLatencyMs": 1240 }
//   }
//
// USAGE
//   node scripts/router-parallel-analyze.mjs --input .swarm/router-parallel.jsonl
//   node scripts/router-parallel-analyze.mjs --input <file> --format json
//   node scripts/router-parallel-analyze.mjs --input <file> --strict   # exit 1 if NOT promotable
//
// EXIT CODES
//   0  analysis complete; in --strict mode → all three criteria passed
//   1  --strict requested AND at least one criterion failed (NOT promotable)
//   2  config error or input file missing/malformed

import { readFileSync, existsSync } from 'node:fs';

const ARGS = (() => {
  const a = { input: '.swarm/router-parallel.jsonl', format: 'table', strict: false };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--input') a.input = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--strict') a.strict = true;
  }
  return a;
})();

function median(sorted) {
  if (sorted.length === 0) return 0;
  const n = sorted.length;
  return n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2];
}

function pctile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(q * (sorted.length - 1));
  return sorted[idx];
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function main() {
  if (!existsSync(ARGS.input)) {
    if (ARGS.format === 'json') {
      console.log(JSON.stringify({
        ok: true,
        sufficient: false,
        reason: 'input-file-not-found',
        input: ARGS.input,
        hint: 'Enable parallel logging (CLAUDE_FLOW_ROUTER_PARALLEL_LOG=1) and run a workload first.',
      }, null, 2));
    } else {
      console.log(`# router-parallel-analyze`);
      console.log('');
      console.log(`_Input file not found: ${ARGS.input}_`);
      console.log('');
      console.log('Enable parallel logging by setting `CLAUDE_FLOW_ROUTER_PARALLEL_LOG=1`');
      console.log('and running a real workload, then re-run this analyzer.');
    }
    process.exit(ARGS.strict ? 1 : 0);
  }

  let rows = [];
  try {
    rows = readFileSync(ARGS.input, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch (e) {
    console.error(`router-parallel-analyze: cannot parse ${ARGS.input}: ${e.message}`);
    process.exit(2);
  }

  // Filter to records with both predictions + outcome present.
  const usable = rows.filter((r) => r.bandit && r.ser && r.outcome);

  if (usable.length < 30) {
    const payload = {
      ok: true,
      sufficient: false,
      reason: `n=${usable.length} < 30 (insufficient sample for AND-gate evaluation)`,
      hint: 'Continue collecting parallel-routing data; statistical significance needs ≥30 paired decisions per arm.',
      sampleSize: usable.length,
      generatedAt: new Date().toISOString(),
    };
    if (ARGS.format === 'json') console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`# router-parallel-analyze`);
      console.log('');
      console.log(`Sample size: **${usable.length}** paired decisions`);
      console.log('');
      console.log(`_Insufficient — need ≥30 for the 3-criteria AND-gate._`);
    }
    process.exit(ARGS.strict ? 1 : 0);
  }

  // For each record, attribute the outcome to BOTH arms when they
  // agreed on the model pick; when they disagreed, the actual outcome
  // belongs only to the bandit (which was the executing arm). The SER
  // arm gets its PREDICTED metrics for the counterfactual.
  const banditOutcomes = usable.map((r) => ({
    qualityActual: r.outcome.actualQuality,
    usdActual: r.outcome.actualUsd,
    latencyActual: r.outcome.actualLatencyMs,
  }));

  // SER counterfactual: use ser.predictedQuality / predictedCostUsd
  // when picks disagreed; use actual when they agreed. Latency: when
  // they agreed, both saw the same actual latency; when they
  // disagreed, the SER pick's latency is unknown — fall back to the
  // mean of agreed-decision latencies for that model.
  const agreedLatencyByModel = {};
  for (const r of usable) {
    if (r.bandit.pick === r.ser.pick) {
      const m = r.outcome.actualModel || r.bandit.pick;
      (agreedLatencyByModel[m] = agreedLatencyByModel[m] || []).push(r.outcome.actualLatencyMs);
    }
  }
  const modelMeanLatency = {};
  for (const [m, arr] of Object.entries(agreedLatencyByModel)) {
    modelMeanLatency[m] = mean(arr);
  }

  const serOutcomes = usable.map((r) => {
    const agreed = r.bandit.pick === r.ser.pick;
    return {
      qualityActual: agreed ? r.outcome.actualQuality : r.ser.predictedQuality,
      usdActual: agreed ? r.outcome.actualUsd : r.ser.predictedCostUsd,
      latencyActual: agreed
        ? r.outcome.actualLatencyMs
        : (modelMeanLatency[r.ser.pick] ?? r.outcome.actualLatencyMs),
    };
  });

  // Compute the three criteria.
  const banditQuality = mean(banditOutcomes.map((o) => o.qualityActual));
  const serQuality    = mean(serOutcomes.map((o) => o.qualityActual));
  const qualityImprovementPct =
    banditQuality > 0 ? ((serQuality - banditQuality) / banditQuality) * 100 : 0;

  const banditUsd = mean(banditOutcomes.map((o) => o.usdActual));
  const serUsd    = mean(serOutcomes.map((o) => o.usdActual));
  const usdIncreasePct = banditUsd > 0 ? ((serUsd - banditUsd) / banditUsd) * 100 : 0;

  const banditLatencyP95 = pctile(banditOutcomes.map((o) => o.latencyActual).sort((a, b) => a - b), 0.95);
  const serLatencyP95    = pctile(serOutcomes.map((o) => o.latencyActual).sort((a, b) => a - b), 0.95);
  const latencyIncreasePct =
    banditLatencyP95 > 0 ? ((serLatencyP95 - banditLatencyP95) / banditLatencyP95) * 100 : 0;

  const passes = {
    quality: qualityImprovementPct > 2,
    cost: usdIncreasePct < 1,
    latency: latencyIncreasePct < 5,
  };
  const allPass = passes.quality && passes.cost && passes.latency;

  // Disagreement rate (informational; not part of the gate).
  const disagreements = usable.filter((r) => r.bandit.pick !== r.ser.pick).length;
  const disagreementPct = (disagreements / usable.length) * 100;

  const payload = {
    ok: true,
    sufficient: true,
    sampleSize: usable.length,
    disagreement: {
      count: disagreements,
      pct: Math.round(disagreementPct * 100) / 100,
    },
    bandit: {
      meanQuality: Math.round(banditQuality * 10000) / 10000,
      meanUsd: Math.round(banditUsd * 1e6) / 1e6,
      p95LatencyMs: Math.round(banditLatencyP95),
    },
    ser: {
      meanQuality: Math.round(serQuality * 10000) / 10000,
      meanUsd: Math.round(serUsd * 1e6) / 1e6,
      p95LatencyMs: Math.round(serLatencyP95),
    },
    criteria: {
      qualityImprovementPct: Math.round(qualityImprovementPct * 100) / 100,
      qualityThresholdPct: 2,
      qualityPasses: passes.quality,
      usdIncreasePct: Math.round(usdIncreasePct * 100) / 100,
      usdThresholdPct: 1,
      costPasses: passes.cost,
      latencyIncreasePct: Math.round(latencyIncreasePct * 100) / 100,
      latencyThresholdPct: 5,
      latencyPasses: passes.latency,
    },
    verdict: {
      promotable: allPass,
      reason: allPass
        ? 'All three criteria met (quality > 2% AND cost < 1% AND latency < 5%)'
        : `Blocked by: ${[
            !passes.quality && `quality only +${(qualityImprovementPct).toFixed(2)}% (need >2%)`,
            !passes.cost && `cost +${(usdIncreasePct).toFixed(2)}% (need <1%)`,
            !passes.latency && `latency +${(latencyIncreasePct).toFixed(2)}% (need <5%)`,
          ].filter(Boolean).join(', ')}`,
    },
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('# router-parallel-analyze (ADR-150 SelfEvolvingRouter promotion gate)');
    console.log('');
    console.log(`Sample size: **${payload.sampleSize}** paired decisions`);
    console.log(`Disagreement rate: ${payload.disagreement.pct}% (${payload.disagreement.count} / ${payload.sampleSize})`);
    console.log('');
    console.log(`| Metric | Bandit | SER | Delta | Threshold | Passes |`);
    console.log(`|---|---:|---:|---:|---:|:---:|`);
    console.log(`| Mean quality | ${payload.bandit.meanQuality} | ${payload.ser.meanQuality} | ${payload.criteria.qualityImprovementPct >= 0 ? '+' : ''}${payload.criteria.qualityImprovementPct}% | >+2% | ${passes.quality ? '✓' : '⚠'} |`);
    console.log(`| Mean $/decision | $${payload.bandit.meanUsd.toFixed(6)} | $${payload.ser.meanUsd.toFixed(6)} | ${payload.criteria.usdIncreasePct >= 0 ? '+' : ''}${payload.criteria.usdIncreasePct}% | <+1% | ${passes.cost ? '✓' : '⚠'} |`);
    console.log(`| p95 latency | ${payload.bandit.p95LatencyMs}ms | ${payload.ser.p95LatencyMs}ms | ${payload.criteria.latencyIncreasePct >= 0 ? '+' : ''}${payload.criteria.latencyIncreasePct}% | <+5% | ${passes.latency ? '✓' : '⚠'} |`);
    console.log('');
    console.log(`**Verdict**: ${allPass ? '✓ PROMOTABLE' : '⚠ NOT promotable'}`);
    console.log('');
    console.log(`_${payload.verdict.reason}_`);
  }

  if (ARGS.strict && !allPass) process.exit(1);
  process.exit(0);
}

main();
