#!/usr/bin/env node
// check-fingerprint-schema — protect _similarity.mjs from silent upstream
// schema drift in `metaharness score` / `metaharness genome`.
//
// iter 47 discovered that `harness score` and `metaharness score` have
// different output schemas — using the wrong one made similarity() return
// 0.8125 on self-roundtrip (should be 1.0). The fix routed score+genome
// through `runMetaharness` to get the correct shape.
//
// But there's still no test that ASSERTS the correct shape stays correct.
// If upstream renames `harnessFit` to `harness_fit` (or anything),
// _similarity.mjs::projectToVec reads `s.harnessFit` → undefined → 0 →
// all numerics collapse to 0 → similarity always returns the categorical
// + jaccard agreement, never the cosine. Drift detection silently breaks.
//
// This script runs the two `metaharness` subcommands and asserts the
// fields _similarity.mjs::projectToVec actually reads.
//
// USAGE
//   node scripts/check-fingerprint-schema.mjs               # exits 0 if intact
//   node scripts/check-fingerprint-schema.mjs --format json # CI-consumable
//
// EXIT CODES
//   0  fingerprint schemas intact (or metaharness not installed)
//   1  at least one expected field is missing
//   2  unexpected error

import { spawnSync } from 'node:child_process';

const ARGS = (() => {
  const a = { format: 'table' };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--format') a.format = process.argv[++i];
  }
  return a;
})();

// _similarity.mjs::projectToVec reads these EXACT field names. If
// upstream renames any of them, projectToVec returns 0 for that index
// and the cosine signal degrades silently.
const SCORE_FIELDS = [
  'harnessFit', 'compileConfidence', 'taskCoverage', 'toolSafety',
  'memoryUsefulness', 'estCostPerRunUsd', 'recommendedMode',
  'archetype', 'template',
];
const GENOME_FIELDS = [
  'repo_type', 'agent_topology', 'risk_score',
  'test_confidence', 'publish_readiness',
];

function emit(payload, code) {
  if (ARGS.format === 'json') console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`# check-fingerprint-schema\n`);
    if (payload.skipped) console.log(`⊘ ${payload.reason}`);
    else if (payload.ok) console.log(`✓ All ${payload.results.length} fields intact.`);
    else {
      console.log(`✗ ${payload.failedCount}/${payload.results.length} fields missing:`);
      for (const r of payload.results) {
        if (!r.ok) console.log(`  - ${r.subcommand}.${r.field} (${r.detail})`);
      }
    }
  }
  process.exit(code);
}

function runMeta(subcmd, path) {
  const r = spawnSync('npx', [
    '-y', 'metaharness@latest', subcmd, path, '--json',
  ], { encoding: 'utf-8', timeout: 90_000 });
  if (r.status === null
      || /could not determine executable|404|not installed|MODULE_NOT_FOUND|ENOTFOUND/i.test(r.stderr || '')) {
    return { degraded: true };
  }
  const m = /\{[\s\S]*\}/.exec(r.stdout || '');
  if (!m) return { degraded: false, json: null, raw: r.stdout?.slice(0, 200) };
  try { return { degraded: false, json: JSON.parse(m[0]) }; }
  catch (e) { return { degraded: false, json: null, error: e.message }; }
}

async function main() {
  const path = '.';

  // 1. metaharness score
  const scoreR = runMeta('score', path);
  if (scoreR.degraded) {
    emit({
      skipped: true,
      reason: 'metaharness-not-available — install with `npm i --include=optional` to verify schema',
      generatedAt: new Date().toISOString(),
    }, 0);
  }
  if (!scoreR.json) {
    emit({
      ok: false,
      results: [{ subcommand: 'score', field: '*', ok: false, detail: 'no JSON in output' }],
      failedCount: 1,
      generatedAt: new Date().toISOString(),
    }, 1);
  }

  // 2. metaharness genome
  const genomeR = runMeta('genome', path);
  if (!genomeR.json) {
    emit({
      ok: false,
      results: [{ subcommand: 'genome', field: '*', ok: false, detail: 'no JSON in output' }],
      failedCount: 1,
      generatedAt: new Date().toISOString(),
    }, 1);
  }

  // 3. Assert each expected field is present (i.e., key exists, even
  //    if value is null — we just care upstream didn't rename it).
  const results = [];
  for (const field of SCORE_FIELDS) {
    const present = scoreR.json[field] !== undefined;
    results.push({
      subcommand: 'score',
      field,
      ok: present,
      detail: present ? `value=${typeof scoreR.json[field]}` : 'MISSING — projectToVec defaults to 0',
    });
  }
  for (const field of GENOME_FIELDS) {
    const present = genomeR.json[field] !== undefined;
    results.push({
      subcommand: 'genome',
      field,
      ok: present,
      detail: present ? `value=${typeof genomeR.json[field]}` : 'MISSING — projectToVec defaults to 0',
    });
  }

  const failed = results.filter((r) => !r.ok);
  emit({
    ok: failed.length === 0,
    results,
    failedCount: failed.length,
    generatedAt: new Date().toISOString(),
  }, failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('check-fingerprint-schema crashed:', e?.message ?? e);
  process.exit(2);
});
