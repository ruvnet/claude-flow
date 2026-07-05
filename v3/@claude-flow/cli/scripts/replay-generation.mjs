#!/usr/bin/env node
/**
 * Acceptance test (ADR-176) — clean-room replay of a promoted generation.
 *
 * From a clean install, replay ONE promoted generation bundle from
 * .claude/evolve-proof/ and verify the SAME candidate passes accept/v1+sig with
 * IDENTICAL hashes and NO NETWORK — i.e. the promotion is reproducible from the
 * receipt alone, without trusting any service log.
 *
 * Proves: (1) each embedded hash recomputes bit-identically, (2) re-running the
 * versioned rule on independently-recomputed inputs reproduces promoted=true,
 * (3) zero network access (fetch is trapped and any call fails the test).
 *
 * Usage: node scripts/replay-generation.mjs [--file <bundle.json>] [--dir <projectRoot>]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// ── Hard no-network guard: any network call during replay fails the test. ──
for (const name of ['fetch']) {
  globalThis[name] = () => { throw new Error(`NETWORK ACCESS during replay (${name}) — replay must be offline`); };
}

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ep = await import(`file://${join(CLI_ROOT, 'dist/src/services/evolve-proof.js')}`);

const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const root = resolve(arg('--dir') || CLI_ROOT);
const evalDir = join(root, '.claude', 'evolve-proof');

// pick a promoted generation: explicit --file, else the highest-numbered real-generation-*.
let file = arg('--file');
if (!file) {
  const reals = existsSync(evalDir) ? readdirSync(evalDir).filter((f) => /^real-generation-\d+\.json$/.test(f)).sort() : [];
  if (!reals.length) { console.error(`no promoted generation found in ${evalDir}`); process.exit(1); }
  file = join(evalDir, reals[reals.length - 1]);
} else if (!existsSync(file)) { file = join(evalDir, file); }

const bundle = JSON.parse(readFileSync(file, 'utf-8'));
console.log(`clean-room replay of ${file}`);
console.log('='.repeat(70));
if (!bundle.decisionReceipt?.promoted) { console.error('✗ bundle is not a PROMOTED generation'); process.exit(1); }

// (1) hashes recompute bit-identically
const sha = (s) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const cstr = (v) => JSON.stringify(canon(v));
// manifest hash mirrors evolve-proof.manifestHash (canonicalManifestBytes → sha256)
const { canonicalManifestBytes } = await import(`file://${join(CLI_ROOT, 'dist/src/config/proven-config.js')}`);
const mh = (m) => sha(canonicalManifestBytes(m).toString('utf-8'));

const checks = [
  ['input holdout hash', sha(cstr(bundle.holdout)), bundle.inputHoldoutHash],
  ['baseline manifest hash', mh(bundle.baselineManifest), bundle.baselineManifestHash],
  ['candidate manifest hash', mh(bundle.candidateManifest), bundle.candidateManifestHash],
];
let idOK = true;
for (const [label, got, want] of checks) {
  const same = got === want;
  idOK = idOK && same;
  console.log(`${same ? '✓' : '✗'} ${label}: ${same ? 'identical' : `MISMATCH\n    recomputed ${got}\n    recorded   ${want}`}`);
}

// (2) re-run accept/v1+sig on independently-recomputed inputs → promoted=true
const v = ep.verifyReceiptBundle(bundle);
console.log(`${v.valid ? '✓' : '✗'} independent verify: ${v.explanation}`);
console.log(`  decisionMatches=${v.decisionMatches} ruleVersion=${bundle.decisionReceipt.promotionRuleVersion} noAutoServe=${v.noAutoServe}`);
if (bundle.deltas?.humanRelevance !== undefined)
  console.log(`  human-relevance Δ (frozen eval ${(bundle.humanEvalHash||'').slice(0,18)}…): ${bundle.deltas.humanRelevance.toFixed(4)}`);

const pass = idOK && v.valid && v.decisionMatches;
console.log('='.repeat(70));
console.log(pass ? 'ACCEPTANCE TEST PASSED — promoted generation reproducible from its receipt, identical hashes, offline.'
                 : 'ACCEPTANCE TEST FAILED');
process.exit(pass ? 0 : 1);
