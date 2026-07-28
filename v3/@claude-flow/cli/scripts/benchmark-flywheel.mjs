#!/usr/bin/env node
/**
 * ADR-322 repeatable microbenchmark.
 *
 * Run after `pnpm build`:
 *   node scripts/benchmark-flywheel.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  computePromotionStatistics,
  createFlywheelReceipt,
  policyCandidateId,
} from '../dist/src/services/flywheel-receipt.js';
import {
  promoteFlywheelCandidate,
  registerFlywheelReceipt,
  verifyFlywheelLedger,
} from '../dist/src/services/flywheel-transaction.js';

const rounds = Number(process.env.FLYWHEEL_BENCH_ROUNDS || 250);
const deltas = [0.1, 0.12, 0.2, 0.08, 0.15, 0.11, 0.09, 0.13, 0.14, 0.07];
const statisticsStart = performance.now();
for (let i = 0; i < rounds; i++) {
  computePromotionStatistics({
    baselineScore: 0.5,
    candidateScore: 0.65,
    heldOutDeltas: deltas,
    frozenAnchorRegression: 0,
    corpusHash: 'sha256:benchmark-corpus',
    candidateId: 'sha256:benchmark-candidate',
    baselineRef: 'sha256:benchmark-baseline',
    evaluationRunId: `benchmark-${i}`,
  });
}
const statisticsMs = performance.now() - statisticsStart;

const pair = generateKeyPairSync('ed25519');
const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const root = mkdtempSync(join(tmpdir(), 'flywheel-benchmark-'));
const receipt = createFlywheelReceipt({
  baselineRef: policyCandidateId({ alpha: 0.5 }),
  candidatePolicy: { alpha: 0.3 },
  safetyEnvelopeRef: 'sha256:safety',
  corpusVersion: 'benchmark-v1',
  corpusHash: 'sha256:benchmark-corpus',
  baselineScore: 0.5,
  candidateScore: 0.65,
  heldOutDeltas: deltas,
  frozenAnchorRegression: 0,
  gates: { heldOut: true, redblue: true, replay: true },
  termVerification: ['heldOut', 'redblue', 'replay'].map((term) => ({
    term,
    verification: 'recomputed',
    evidenceRef: `sha256:${term}`,
  })),
  privateKeyPem,
  publicKeyPem,
});
await registerFlywheelReceipt(root, receipt);
const promotionStart = performance.now();
const promotions = await Promise.all(Array.from({ length: 100 }, () =>
  promoteFlywheelCandidate(root, receipt.payload.receiptId, {
    confirm: true,
    trustedPublicKeys: new Set([publicKeyPem]),
    applyFn: () => ({ applied: true }),
  }),
));
const promotionMs = performance.now() - promotionStart;
const ledger = verifyFlywheelLedger(root);

console.log(JSON.stringify({
  schema: 'ruflo.flywheel-benchmark/v1',
  node: process.version,
  statistics: {
    rounds,
    bootstrapIterationsPerRound: 10_000,
    totalMs: Number(statisticsMs.toFixed(3)),
    meanMs: Number((statisticsMs / rounds).toFixed(3)),
  },
  promotionContention: {
    attempts: promotions.length,
    commits: promotions.filter((result) => result.success && !result.idempotent).length,
    totalMs: Number(promotionMs.toFixed(3)),
    ledgerValid: ledger.valid,
  },
}, null, 2));
