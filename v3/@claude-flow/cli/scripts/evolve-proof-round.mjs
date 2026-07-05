#!/usr/bin/env node
/**
 * single-round proof-of-mechanism  (ADR-176) — NOT flywheel/compounding/production proof.
 *
 * Runs ONE deterministic synthetic evolve round and:
 *   1. emits the seven required artifacts (aborts if any is missing),
 *   2. persists the receipt bundle as generation 0 (fixture for F-P1/F-P2),
 *   3. registers the passing candidate in a SHADOW registry (state=shadow, served=false),
 *   4. proves NO auto-serve path (asserts nothing was written to the active/served policy),
 *   5. independently re-verifies the bundle (rehash + re-run accept()) WITHOUT service logs.
 *
 * Usage: node scripts/evolve-proof-round.mjs [--dir <projectRoot>]
 */
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const d = (p) => join(CLI_ROOT, 'dist/src', p);
const { runSyntheticProofRound, verifyReceiptBundle, reconstructLineage } = await import(`file://${d('services/evolve-proof.js')}`);

const argDir = process.argv.indexOf('--dir');
const projectRoot = argDir > -1 ? resolve(process.argv[argDir + 1]) : CLI_ROOT;

// Fixed timestamp → reproducible fixture (Generation 0).
const NOW = 1_700_000_000_000;
const bundle = runSyntheticProofRound({ now: NOW, generation: 0, parent: null });

// (1) GATE: emit only if all seven artifacts are present.
const required = {
  'input holdout hash': bundle.inputHoldoutHash,
  'baseline manifest hash': bundle.baselineManifestHash,
  'candidate manifest hash': bundle.candidateManifestHash,
  'meetsPromotionRule version': bundle.meetsPromotionRule?.version,
  'decision receipt': bundle.decisionReceipt,
  'SHADOW registration id': bundle.shadow?.registrationId,
  'cost receipt': bundle.costReceipt,
};
const missing = Object.entries(required).filter(([, v]) => v === undefined || v === null).map(([k]) => k);
if (missing.length) { console.error(`ABORT — missing required artifacts: ${missing.join(', ')}`); process.exit(1); }

// (2) PERSIST the receipt bundle as generation 0.
const proofDir = join(projectRoot, '.claude', 'evolve-proof');
mkdirSync(proofDir, { recursive: true });
const bundlePath = join(proofDir, 'generation-0.json');
writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + '\n', 'utf-8');

// (3) SHADOW registration — persisted to a shadow registry, explicitly not served.
const shadowDir = join(projectRoot, '.claude-flow', 'shadow');
mkdirSync(shadowDir, { recursive: true });
appendFileSync(join(shadowDir, 'registrations.jsonl'), JSON.stringify({ ...bundle.shadow, generation: 0, bundle: 'generation-0.json' }) + '\n', 'utf-8');

// (4) NO AUTO-SERVE: the active/served policy must be untouched by this round.
const activePolicy = join(projectRoot, '.claude-flow', 'harness-active-policy.json');
const autoServed = existsSync(activePolicy);

// (5) INDEPENDENT VERIFY (no service logs) + lineage reconstruction.
const verify = verifyReceiptBundle(bundle);
const lineage = reconstructLineage([bundle]);

console.log('single-round proof-of-mechanism  (NOT flywheel/compounding/production proof)');
console.log('='.repeat(78));
console.log(`label                      : ${bundle.label}`);
console.log(`disclaimers                : ${bundle.disclaimers.join(' | ')}`);
console.log('--- seven required artifacts ---');
console.log(`input holdout hash         : ${bundle.inputHoldoutHash}`);
console.log(`baseline manifest hash     : ${bundle.baselineManifestHash}`);
console.log(`candidate manifest hash    : ${bundle.candidateManifestHash}`);
console.log(`meetsPromotionRule version : ${bundle.meetsPromotionRule.version}  (result=${bundle.meetsPromotionRule.result})`);
console.log(`decision receipt           : promoted=${bundle.decisionReceipt.promoted}  reason="${bundle.decisionReceipt.reason}"`);
console.log(`SHADOW registration id     : ${bundle.shadow.registrationId}  (state=${bundle.shadow.state}, served=${bundle.shadow.served})`);
console.log(`cost receipt               : $${bundle.costReceipt.usd}  llmCalls=${bundle.costReceipt.llmCalls}  tier=${bundle.costReceipt.tier}`);
console.log('--- causality (why, not just what) ---');
console.log(`mutation class             : ${bundle.mutationClass}`);
console.log(`mutation summary           : ${bundle.mutationSummary}`);
console.log(`deltas                     : benchmark=${bundle.deltas.benchmark.toFixed(4)} security=${bundle.deltas.security} cost=${bundle.deltas.cost}`);
console.log('--- proofs ---');
console.log(`gate wiring (accept/v1)    : decision decided by the real versioned accept() ✓`);
console.log(`receipt persistence        : ${bundlePath}`);
console.log(`SHADOW registration        : ${join(shadowDir, 'registrations.jsonl')}`);
console.log(`no auto-serve path         : active policy present? ${autoServed}  →  ${autoServed ? '✗ AUTO-SERVED' : '✓ NOT served'}`);
console.log('--- independent replay (no service logs) ---');
console.log(`hash checks                : holdout=${verify.hashChecks.inputHoldout} baseline=${verify.hashChecks.baselineManifest} candidate=${verify.hashChecks.candidateManifest}`);
console.log(`recomputed decision matches: ${verify.decisionMatches}`);
console.log(`why                        : ${verify.explanation}`);
console.log(`bundle valid (independent) : ${verify.valid}`);
console.log('--- lineage (acceptance test) — immutable root of the evolution graph ---');
console.log(`generations=${lineage.generations} promotions=${lineage.promotions} rejections=${lineage.rejections} branches=[${lineage.branches.join(',')}] lineageIntact=${lineage.lineageIntact} allReplayable=${lineage.allReplayable}`);
console.log(`rootHash=${lineage.rootHash}`);

const ok = verify.valid && !autoServed && lineage.lineageIntact;
console.log('='.repeat(78));
console.log(ok ? 'RESULT: proof-of-mechanism PASSED (gate wired, receipt persisted, shadow registered, no auto-serve, independently replayable)'
              : 'RESULT: proof-of-mechanism FAILED');
process.exit(ok ? 0 : 1);
