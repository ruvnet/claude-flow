import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFlywheelReceipt,
  policyCandidateId,
} from '../src/services/flywheel-receipt.js';
import {
  promoteFlywheelCandidate,
  readFlywheelTransactionState,
  recoverFlywheelMaterialization,
  registerFlywheelReceipt,
  verifyFlywheelLedger,
} from '../src/services/flywheel-transaction.js';

function keyPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

// 10 all-candidate-win paired tasks: enough sequential evidence to clear the
// e-process at test 1 (e = 1.5^10 ≈ 57.7 ≥ 1/alpha_1 ≈ 32.9).
const HELD_DELTAS = [0.1, 0.12, 0.2, 0.08, 0.15, 0.11, 0.09, 0.14, 0.13, 0.1];
const PAIRED = HELD_DELTAS.map((delta, i) => ({
  taskId: `t${i}`,
  baselineScore: 0.5,
  candidateScore: 0.5 + delta,
}));

function makeReceipt(
  key: ReturnType<typeof keyPair>,
  over: Partial<Parameters<typeof createFlywheelReceipt>[0]> = {},
) {
  return createFlywheelReceipt({
    baselineRef: policyCandidateId({ alpha: 0.5 }),
    candidatePolicy: { alpha: 0.3 },
    safetyEnvelopeRef: 'sha256:safety-envelope-v1',
    corpusVersion: 'corpus-v1',
    corpusHash: 'sha256:corpus-v1',
    baselineScore: 0.5,
    candidateScore: 0.65,
    heldOutDeltas: HELD_DELTAS,
    pairedOutcomes: PAIRED,
    frozenAnchorRegression: 0,
    gates: { heldOut: true, redblue: true, replay: true },
    termVerification: ['heldOut', 'redblue', 'replay'].map((term) => ({
      term,
      verification: 'recomputed' as const,
      evidenceRef: `sha256:${term}`,
    })),
    now: 1_700_000_000_000,
    ttlMs: 1_000_000,
    bootstrapIterations: 500,
    ...key,
    ...over,
  });
}

const apply = () => ({ applied: true, from: null, to: 'candidate' });

describe('flywheel promotion transaction', () => {
  it('commits exactly once under 100 concurrent promotion attempts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-cas-'));
    const key = keyPair();
    const receipt = makeReceipt(key);
    await registerFlywheelReceipt(root, receipt, 1_700_000_000_001);

    const results = await Promise.all(Array.from({ length: 100 }, () =>
      promoteFlywheelCandidate(root, receipt.payload.receiptId, {
        confirm: true,
        now: 1_700_000_000_100,
        trustedPublicKeys: new Set([key.publicKeyPem]),
        applyFn: apply,
      }),
    ));

    expect(results.filter((result) => result.success && !result.idempotent)).toHaveLength(1);
    expect(results.every((result) => result.success)).toBe(true);
    const state = readFlywheelTransactionState(root);
    expect(state.commits).toHaveLength(1);
    expect(state.activeChampionRef).toBe(receipt.payload.candidateId);
    expect(state.servingEpoch).toBe(1);
    expect(state.materializedServingEpoch).toBe(1);
    expect(verifyFlywheelLedger(root)).toMatchObject({ valid: true, commits: 1 });
  });

  it('requires explicit signer trust and rejects stale baselines', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-trust-'));
    const key = keyPair();
    const first = makeReceipt(key);
    await registerFlywheelReceipt(root, first);
    expect((await promoteFlywheelCandidate(root, first.payload.receiptId, {
      confirm: true,
      now: 1_700_000_000_100,
      applyFn: apply,
    })).reason).toMatch(/trusted receipt signer/);

    const promoted = await promoteFlywheelCandidate(root, first.payload.receiptId, {
      confirm: true,
      now: 1_700_000_000_100,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    });
    expect(promoted.success).toBe(true);

    const stale = makeReceipt(key, {
      evaluationRunId: '01900000-0000-7000-8000-000000000002',
      candidatePolicy: { alpha: 0.2 },
    });
    await registerFlywheelReceipt(root, stale);
    const rejected = await promoteFlywheelCandidate(root, stale.payload.receiptId, {
      confirm: true,
      now: 1_700_000_000_200,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    });
    expect(rejected).toMatchObject({ success: false, reason: 'stale baseline' });
  });

  it('rejects an accepted receipt whose promotion gate lacks classified evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-evidence-'));
    const key = keyPair();
    const receipt = makeReceipt(key, { termVerification: [] });
    await registerFlywheelReceipt(root, receipt);
    const rejected = await promoteFlywheelCandidate(root, receipt.payload.receiptId, {
      confirm: true,
      now: 1_700_000_000_100,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    });
    expect(rejected.reason).toMatch(/missing verification for gate/);
    expect(readFlywheelTransactionState(root).commits).toHaveLength(0);
  });

  it('refuses aggregate-only receipts by default and honors the explicit escape hatch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-aggregate-'));
    const key = keyPair();
    const receipt = makeReceipt(key, { pairedOutcomes: undefined });
    await registerFlywheelReceipt(root, receipt);
    const common = {
      confirm: true,
      now: 1_700_000_000_100,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    };

    const refused = await promoteFlywheelCandidate(root, receipt.payload.receiptId, common);
    expect(refused.success).toBe(false);
    expect(refused.reason).toMatch(/aggregate-only evidence/);
    expect(readFlywheelTransactionState(root).commits).toHaveLength(0);

    const allowed = await promoteFlywheelCandidate(root, receipt.payload.receiptId, {
      ...common,
      requirePairedEvidence: false,
    });
    expect(allowed.success).toBe(true);
  });

  it('refuses weak paired evidence at the allocated alpha and records the spend once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-weak-evidence-'));
    const key = keyPair();
    // 5 all-win pairs: the receipt's own gate accepts (bootstrap over 5
    // positive deltas is significant) but e = 1.5^5 ≈ 7.6 < 32.9 = 1/alpha_1,
    // so the sequential gate must refuse — the exact divergence between
    // per-candidate significance and stream-level evidence.
    const weakDeltas = [0.1, 0.12, 0.2, 0.08, 0.15];
    const receipt = makeReceipt(key, {
      heldOutDeltas: weakDeltas,
      pairedOutcomes: weakDeltas.map((delta, i) => ({
        taskId: `w${i}`,
        baselineScore: 0.5,
        candidateScore: 0.5 + delta,
      })),
    });
    expect(receipt.payload.decision).toBe('accepted');
    await registerFlywheelReceipt(root, receipt);
    const common = {
      confirm: true,
      now: 1_700_000_000_100,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    };

    const refused = await promoteFlywheelCandidate(root, receipt.payload.receiptId, common);
    expect(refused.success).toBe(false);
    expect(refused.reason).toMatch(/insufficient sequential evidence/);

    // Alpha was spent by looking: the allocation is persisted, and a retry
    // reuses the same test index instead of shopping for a fresh one.
    let state = readFlywheelTransactionState(root);
    expect(state.sequentialTests?.[receipt.payload.receiptId]).toBe(1);
    await promoteFlywheelCandidate(root, receipt.payload.receiptId, common);
    state = readFlywheelTransactionState(root);
    expect(state.sequentialTests?.[receipt.payload.receiptId]).toBe(1);
    expect(Object.keys(state.sequentialTests ?? {})).toHaveLength(1);
    expect(state.commits).toHaveLength(0);
  });

  it('allocates successive test indices to distinct receipts (alpha allocation across the stream)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-alpha-stream-'));
    const key = keyPair();
    const first = makeReceipt(key);
    await registerFlywheelReceipt(root, first);
    const common = {
      confirm: true,
      now: 1_700_000_000_100,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    };
    const promoted = await promoteFlywheelCandidate(root, first.payload.receiptId, common);
    expect(promoted.success).toBe(true);

    // Second candidate in the stream: evidence that cleared test 1 is judged
    // at test 2's stricter threshold (1/alpha_2 ≈ 131.6 > 57.7 = 1.5^10).
    const state = readFlywheelTransactionState(root);
    const second = makeReceipt(key, {
      evaluationRunId: '01900000-0000-7000-8000-000000000003',
      baselineRef: state.activeChampionRef!,
      expectedLedgerHead: state.ledgerHead,
      candidatePolicy: { alpha: 0.25 },
    });
    await registerFlywheelReceipt(root, second);
    const refused = await promoteFlywheelCandidate(root, second.payload.receiptId, common);
    expect(refused.success).toBe(false);
    expect(refused.reason).toMatch(/insufficient sequential evidence/);
    const after = readFlywheelTransactionState(root);
    expect(after.sequentialTests?.[first.payload.receiptId]).toBe(1);
    expect(after.sequentialTests?.[second.payload.receiptId]).toBe(2);
  });

  it('recovers consistently from faults before and after the atomic commit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-fault-'));
    const key = keyPair();
    const receipt = makeReceipt(key);
    await registerFlywheelReceipt(root, receipt);
    const common = {
      confirm: true,
      now: 1_700_000_000_100,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    };

    await expect(promoteFlywheelCandidate(root, receipt.payload.receiptId, {
      ...common,
      faultAt: 'before-commit',
    })).rejects.toThrow(/before-commit/);
    expect(readFlywheelTransactionState(root).commits).toHaveLength(0);

    await expect(promoteFlywheelCandidate(root, receipt.payload.receiptId, {
      ...common,
      faultAt: 'after-commit-before-materialize',
    })).rejects.toThrow(/after-commit/);
    let state = readFlywheelTransactionState(root);
    expect(state.commits).toHaveLength(1);
    expect(state.materializedServingEpoch).toBe(0);

    const recovered = await recoverFlywheelMaterialization(root, common);
    expect(recovered).toMatchObject({ success: true, materialized: true });
    state = readFlywheelTransactionState(root);
    expect(state.materializedServingEpoch).toBe(state.servingEpoch);
    expect(verifyFlywheelLedger(root).valid).toBe(true);
  });
});
