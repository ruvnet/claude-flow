#!/usr/bin/env node
// security-bench.mjs — wrapper around `metaharness-darwin security bench`.
//
// "Darwin Shield" — upstream's own ADR-155 — evolves a champion harness
// on a 10-vuln/9-decoy corpus and measures it against four baselines
// (B0 static-only, B1 LLM single-pass, B2 fixed agent, B3 Darwin champion).
// The CHAMPION reaches TPR=1, FPR=0; the eight acceptance gates verify
// reproducibility, statistical significance, and unsafe-output=0.
//
// CONNECTION TO RUFLO ADR-155
// ===========================
// ruflo's ADR-155 (#2417) proposes a nightly self-learning security harness
// with three learning loops (per-dimension confidence weighting, severity
// calibration, auto-fix bid). The upstream Darwin Shield is the closest
// reference implementation — same shape, different scope (evolves a
// security-detection harness vs evaluates findings; both grade by realized
// TPR/FPR vs ground-truth corpus). Running `security bench` periodically
// gives us the empirical baseline that ruflo's Phase 2 loop A needs before
// training: if Darwin Shield converges on a known-good corpus, the loop A
// gradient signal is sound; if it doesn't, the corpus / sandbox is the
// gap, not the learning algorithm.
//
// USAGE
//   node scripts/security-bench.mjs                              # default population=2 cycles=1
//   node scripts/security-bench.mjs --population 4 --cycles 3    # deeper run
//   node scripts/security-bench.mjs --population 4 --cycles 3 --alert-on-fail
//
// EXIT CODES
//   0  bench passed all gates (or degraded — Darwin not available)
//   1  --alert-on-fail and any acceptance gate failed
//   2  config error or bench infrastructure failure

import { runDarwinAsync, emitDarwinDegradedJsonAndExit } from './_darwin.mjs';

const ARGS = (() => {
  const a = {
    population: 2,
    cycles: 1,
    seed: null,
    alertOnFail: false,
    format: 'json',
    timeoutMs: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--population') a.population = parseInt(process.argv[++i], 10);
    else if (v === '--cycles') a.cycles = parseInt(process.argv[++i], 10);
    else if (v === '--seed') a.seed = parseInt(process.argv[++i], 10);
    else if (v === '--alert-on-fail') a.alertOnFail = true;
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--timeout-ms') a.timeoutMs = parseInt(process.argv[++i], 10);
  }
  return a;
})();

function safetyChecks() {
  if (ARGS.population < 1 || ARGS.population > 20) {
    console.error('security-bench: --population must be 1..20 (ruflo cap)');
    process.exit(2);
  }
  if (ARGS.cycles < 1 || ARGS.cycles > 100) {
    console.error('security-bench: --cycles must be 1..100 (ruflo cap)');
    process.exit(2);
  }
}

function defaultTimeoutMs() {
  // Bench corpus has 10 vulns + 9 decoys = 19 evaluations per cycle.
  // Each evaluation runs the candidate detector + scores patches.
  // Rough budget: ~3s per evaluation × population × cycles + 30s overhead.
  return Math.max(60_000, 3_000 * 19 * ARGS.population * ARGS.cycles + 30_000);
}

// Parse the markdown report that `security bench` emits. The header
// "Overall: ✅ PASS" or "❌ FAIL" is the rolled-up gate. We also extract
// each acceptance gate's pass/fail line.
function parseSecurityBenchMarkdown(stdout) {
  const overallMatch = /\*\*Overall:\s*([✅❌])\s*(PASS|FAIL)\*\*/i.exec(stdout);
  const overall = overallMatch ? { ok: overallMatch[2].toUpperCase() === 'PASS', icon: overallMatch[1] } : null;

  const gates = [];
  // Match lines like: "- ✅ **TPR improvement ≥ 25% vs fixed harness** — +150%"
  const gateRx = /^-\s+([✅❌])\s+\*\*(.+?)\*\*\s*[—-]\s*(.+)$/gm;
  let m;
  while ((m = gateRx.exec(stdout)) !== null) {
    gates.push({
      ok: m[1] === '✅',
      criterion: m[2].trim(),
      measured: m[3].trim(),
    });
  }

  // Extract the baselines-vs-champion table — useful for diff over time.
  const baselines = [];
  const tableRx = /^\|\s*B[0-3]\s+([^|]+?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|/gm;
  while ((m = tableRx.exec(stdout)) !== null) {
    baselines.push({
      harness: m[1].trim(),
      fitness: parseFloat(m[2]),
      tpr: parseFloat(m[3]),
      fpr: parseFloat(m[4]),
      patchPass: parseFloat(m[5]),
      repro: parseFloat(m[6]),
      unsafe: parseInt(m[7], 10),
      cost: m[8].trim(),
    });
  }

  return { overall, gates, baselines };
}

async function main() {
  safetyChecks();

  const cliArgs = ['security', 'bench',
    '--population', String(ARGS.population),
    '--cycles', String(ARGS.cycles),
  ];
  if (ARGS.seed != null) cliArgs.push('--seed', String(ARGS.seed));

  const r = await runDarwinAsync(cliArgs, {
    timeoutMs: ARGS.timeoutMs ?? defaultTimeoutMs(),
    json: false, // bench output is markdown, not JSON
    onProgress: (line) => { if (line.trim()) process.stderr.write(`[security-bench] ${line}\n`); },
  });

  if (r.degraded) {
    emitDarwinDegradedJsonAndExit(r.reason);
    return;
  }

  if (r.exitCode !== 0 && r.exitCode !== 1) {
    // Exit 1 may be the bench's own "gates failed" signal; treat as data.
    // Anything else is infrastructure failure.
    const payload = {
      success: false,
      data: { exitCode: r.exitCode, stderrTail: r.stderr.slice(-400) },
      generatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(2);
  }

  const parsed = parseSecurityBenchMarkdown(r.stdout);
  const gatesPassed = parsed.gates.filter((g) => g.ok).length;
  const gatesFailed = parsed.gates.length - gatesPassed;

  const payload = {
    success: true,
    data: {
      overall: parsed.overall,
      gates: {
        total: parsed.gates.length,
        passed: gatesPassed,
        failed: gatesFailed,
        details: parsed.gates,
      },
      baselines: parsed.baselines,
      rawMarkdown: r.stdout,
      shape: { population: ARGS.population, cycles: ARGS.cycles, seed: ARGS.seed },
      durationMs: r.durationMs,
    },
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(payload, null, 2));
  if (ARGS.alertOnFail && parsed.overall && !parsed.overall.ok) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(`security-bench: unexpected failure: ${e?.message ?? e}`);
  process.exit(2);
});
