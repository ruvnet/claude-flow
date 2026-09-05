#!/usr/bin/env node
// similarity.mjs — ADR-152 §3.1 CLI skill.
//
// Computes weighted similarity between two harness fingerprints (genome
// + score JSON). Production-grade companion to _spike-similarity.mjs.
//
// USAGE
//   node scripts/similarity.mjs --a a.json --b b.json
//   node scripts/similarity.mjs --a-key harness-X --b-key harness-Y         # memory lookup
//   node scripts/similarity.mjs --a a.json --b b.json --per-dimension       # breakdown
//   node scripts/similarity.mjs --a a.json --b b.json --format json
//   node scripts/similarity.mjs --a a.json --b b.json --alert-below 0.5     # exit 1 if low
//
// EXIT CODES
//   0  ok  (or overall ≥ alert-below threshold)
//   1  --alert-below AND overall < threshold
//   2  config / input error (missing args, file not found, malformed JSON)
//
// ADR-150 ARCHITECTURAL CONSTRAINTS PRESERVED
//   - Pure-TS function (`_similarity.mjs`), no `@metaharness/*` import
//   - No new dep; uses node:fs + node:child_process only for memory lookup
//   - Graceful degradation: missing keys / malformed JSON → exit 2 with
//     a structured `{ degraded: true, reason: ... }` payload on stdout
//   - CI-gate ready: smoke step 17y locks this contract

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { similarity } from './_similarity.mjs';

const NS = process.env.HARNESS_SIMILARITY_NAMESPACE || 'metaharness-audit';
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const ARGS = (() => {
  const a = {
    aFile: null, bFile: null,
    aKey: null, bKey: null,
    perDimension: false,
    format: 'table',
    alertBelow: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--a') a.aFile = process.argv[++i];
    else if (v === '--b') a.bFile = process.argv[++i];
    else if (v === '--a-key') a.aKey = process.argv[++i];
    else if (v === '--b-key') a.bKey = process.argv[++i];
    else if (v === '--per-dimension') a.perDimension = true;
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--alert-below') a.alertBelow = Number(process.argv[++i]);
  }
  return a;
})();

function emitDegradedAndExit(reason, code = 2) {
  const payload = {
    degraded: true,
    reason,
    adr: 'ADR-152',
    skill: 'harness-similarity',
    generatedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

function memRetrieve(key) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'retrieve',
    '--namespace', NS, '--key', key,
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return null;
  const m = /\{[\s\S]*\}/.exec(r.stdout || '');
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function loadHarness(label, filePath, memKey) {
  if (filePath) {
    if (!existsSync(filePath)) emitDegradedAndExit(`${label}: file not found: ${filePath}`);
    try { return JSON.parse(readFileSync(filePath, 'utf-8')); }
    catch (e) { emitDegradedAndExit(`${label}: invalid JSON: ${e.message}`); }
  }
  if (memKey) {
    const rec = memRetrieve(memKey);
    if (!rec) emitDegradedAndExit(`${label}: key not found in namespace ${NS}: ${memKey}`);
    return rec;
  }
  emitDegradedAndExit(`${label}: --${label} or --${label}-key required`);
  return null; // unreachable; emitDegradedAndExit exits
}

function main() {
  if (!ARGS.aFile && !ARGS.aKey) emitDegradedAndExit('--a <file> or --a-key <memkey> required');
  if (!ARGS.bFile && !ARGS.bKey) emitDegradedAndExit('--b <file> or --b-key <memkey> required');

  const a = loadHarness('a', ARGS.aFile, ARGS.aKey);
  const b = loadHarness('b', ARGS.bFile, ARGS.bKey);

  const result = similarity(a, b, { perDimension: ARGS.perDimension });

  const payload = {
    adr: 'ADR-152',
    skill: 'harness-similarity',
    inputs: {
      a: ARGS.aFile ?? `mem:${ARGS.aKey}`,
      b: ARGS.bFile ?? `mem:${ARGS.bKey}`,
    },
    ...result,
    alert: ARGS.alertBelow != null ? {
      threshold: ARGS.alertBelow,
      triggered: result.overall < ARGS.alertBelow,
      reason: result.overall < ARGS.alertBelow
        ? `overall ${result.overall} < threshold ${ARGS.alertBelow}`
        : `overall ${result.overall} ≥ threshold ${ARGS.alertBelow}`,
    } : null,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# harness similarity (ADR-152)\n`);
    console.log(`Inputs:`);
    console.log(`  a: ${payload.inputs.a}`);
    console.log(`  b: ${payload.inputs.b}`);
    console.log('');
    console.log(`| Component   | Score  | Weight | Contribution |`);
    console.log(`|-------------|-------:|-------:|-------------:|`);
    const { weights, components } = payload;
    console.log(`| cosine      | ${components.cosine.toFixed(4)} | ${weights.cosine}    | ${(components.cosine * weights.cosine).toFixed(4)} |`);
    console.log(`| categorical | ${components.categorical.toFixed(4)} | ${weights.categorical}   | ${(components.categorical * weights.categorical).toFixed(4)} |`);
    console.log(`| jaccard     | ${components.jaccard.toFixed(4)} | ${weights.jaccard}   | ${(components.jaccard * weights.jaccard).toFixed(4)} |`);
    console.log('');
    console.log(`**Overall:** ${payload.overall.toFixed(4)}`);
    if (payload.alert) {
      console.log('');
      console.log(payload.alert.triggered ? `⚠ ALERT: ${payload.alert.reason}` : `✓ ${payload.alert.reason}`);
    }
    if (ARGS.perDimension && payload.perDimension) {
      console.log('');
      console.log('## Per-dimension breakdown');
      console.log('');
      console.log('| Dimension | a | b | contribution |');
      console.log('|---|---|---|---:|');
      for (const [k, v] of Object.entries(payload.perDimension)) {
        const av = Array.isArray(v.a) ? `[${v.a.join(',')}]` : String(v.a ?? '-');
        const bv = Array.isArray(v.b) ? `[${v.b.join(',')}]` : String(v.b ?? '-');
        console.log(`| ${k} | ${av} | ${bv} | ${Number(v.contribution).toFixed(4)} |`);
      }
    }
  }

  if (payload.alert?.triggered) process.exit(1);
}

main();
