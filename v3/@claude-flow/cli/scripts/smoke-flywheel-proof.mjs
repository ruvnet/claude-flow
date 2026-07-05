#!/usr/bin/env node
/**
 * CI guard — the self-learning proof artifacts must stay valid (ADR-176/177).
 *
 * Protects, on every PR, the evidence that makes the flywheel claim honest:
 *   1. the generation-0 proof-of-mechanism bundle replays independently
 *      (rehash + re-run accept/v1+sig, no service logs),
 *   2. the committed REAL lineage (real-generation-{0,1}) replays AND
 *      reconstructs to >=2 promotions, lineage intact, back to the immutable
 *      root — i.e. 'the flywheel turned' can't silently rot,
 *   3. the shipped proven-config champion (.rvf) verifies against the BAKED
 *      RUFLO_CONFIG_PUBKEY — a tampered/unsigned champion can never ship.
 *
 * Pure, deterministic, $0. Needs dist/ built. Exit 1 on any failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const d = (p) => join(CLI_ROOT, 'dist/src', p);
const cl = (p) => join(CLI_ROOT, '.claude', p);
const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1; };
const ok = (m) => console.log(`✓ ${m}`);

const ep = await import(`file://${d('services/evolve-proof.js')}`);
const rvfa = await import(`file://${d('config/proven-config-rvfa.js')}`);
const pc = await import(`file://${d('config/proven-config.js')}`);

// 1. synthetic proof-of-mechanism fixture
const g0 = JSON.parse(readFileSync(cl('evolve-proof/generation-0.json'), 'utf-8'));
ep.verifyReceiptBundle(g0).valid ? ok('generation-0 proof-of-mechanism replays') : fail('generation-0 proof-of-mechanism NOT replayable');

// 2. real compounding lineage (the milestone evidence)
const reals = [];
for (const i of [0, 1]) {
  const p = cl(`evolve-proof/real-generation-${i}.json`);
  if (!existsSync(p)) { fail(`missing real-generation-${i}.json`); continue; }
  const b = JSON.parse(readFileSync(p, 'utf-8'));
  reals.push(b);
  ep.verifyReceiptBundle(b).valid ? ok(`real-generation-${i} replays independently`) : fail(`real-generation-${i} NOT replayable`);
}
if (reals.length === 2) {
  const lin = ep.reconstructLineage(reals);
  (lin.promotions >= 2 && lin.lineageIntact && lin.allReplayable)
    ? ok(`real lineage: ${lin.promotions} promotions, intact + replayable back to the immutable root`)
    : fail(`real lineage broken (promotions=${lin.promotions} intact=${lin.lineageIntact} replayable=${lin.allReplayable})`);
}

// 3. shipped config champion must be authentic against the baked pubkey
const rvfPath = cl('proven-config.signed.rvf');
if (existsSync(rvfPath)) {
  const signed = rvfa.unpackProvenConfigRvfa(readFileSync(rvfPath));
  const manifest = signed && pc.verifyProvenConfig(signed, pc.RUFLO_CONFIG_PUBKEY);
  manifest ? ok(`shipped champion .rvf verifies against baked RUFLO_CONFIG_PUBKEY (policy ${manifest.policy.ref.slice(0, 20)}…)`)
           : fail('shipped champion .rvf FAILED signature verification against the baked pubkey');
} else {
  ok('no config champion shipped (optional) — skipped');
}

console.log(process.exitCode ? '\nFLYWHEEL PROOF GUARD: FAILED' : '\nFLYWHEEL PROOF GUARD: PASSED');
