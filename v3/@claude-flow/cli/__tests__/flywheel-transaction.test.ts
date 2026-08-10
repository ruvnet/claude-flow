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
  resetSequentialEvidence,
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

  it('refuses a size-inviable receipt WITHOUT spending alpha (ancillary refusal)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-size-inviable-'));
    const key = keyPair();
    // 5 pairs < 9 required at test 1: refused on sample size alone — no
    // evidence looked at, no alpha index allocated.
    const tinyDeltas = [0.1, 0.12, 0.2, 0.08, 0.15];
    const receipt = makeReceipt(key, {
      heldOutDeltas: tinyDeltas,
      pairedOutcomes: tinyDeltas.map((delta, i) => ({ taskId: `t${i}`, baselineScore: 0.5, candidateScore: 0.5 + delta })),
    });
    await registerFlywheelReceipt(root, receipt);
    const refused = await promoteFlywheelCandidate(root, receipt.payload.receiptId, {
      confirm: true,
      now: 1_700_000_000_100,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    });
    expect(refused.success).toBe(false);
    expect(refused.reason).toMatch(/cannot clear sequential evidence at test 1.*no alpha spent/);
    expect(readFlywheelTransactionState(root).sequentialTests ?? {}).toEqual({});
  });

  it('refuses weak paired evidence at the allocated alpha and records the spend once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-weak-evidence-'));
    const key = keyPair();
    // 10 pairs (size-viable at test 1) but 9 wins + 1 loss: the receipt's own
    // gate accepts (bootstrap still significant) while e = 1.5^9 · 0.5 ≈ 19.2
    // < 32.9 = 1/alpha_1 — the sequential gate must refuse AND record the
    // spend: this evidence was genuinely looked at.
    const weakDeltas = [0.1, 0.12, 0.2, 0.08, 0.15, 0.11, 0.09, 0.14, 0.13, -0.1];
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

    // Second candidate in the stream: judged at test 2's stricter threshold
    // (1/alpha_2 ≈ 131.6). 14 pairs keeps it size-viable (min 13 at test 2)
    // but 12 wins + 2 losses give e = 1.5^12 · 0.5^2 ≈ 32.4 < 131.6 — an
    // e-process refusal that spends index 2.
    const state = readFlywheelTransactionState(root);
    const secondDeltas = [0.1, 0.12, 0.2, 0.08, 0.15, 0.11, 0.09, 0.14, 0.13, 0.1, 0.12, 0.11, -0.05, -0.06];
    const second = makeReceipt(key, {
      evaluationRunId: '01900000-0000-7000-8000-000000000003',
      baselineRef: state.activeChampionRef!,
      expectedLedgerHead: state.ledgerHead,
      candidatePolicy: { alpha: 0.25 },
      heldOutDeltas: secondDeltas,
      pairedOutcomes: secondDeltas.map((delta, i) => ({ taskId: `s${i}`, baselineScore: 0.5, candidateScore: 0.5 + delta })),
    });
    await registerFlywheelReceipt(root, second);
    const refused = await promoteFlywheelCandidate(root, second.payload.receiptId, common);
    expect(refused.success).toBe(false);
    expect(refused.reason).toMatch(/insufficient sequential evidence/);
    const after = readFlywheelTransactionState(root);
    expect(after.sequentialTests?.[first.payload.receiptId]).toBe(1);
    expect(after.sequentialTests?.[second.payload.receiptId]).toBe(2);
  });

  it('evidence reset starts a new epoch: archives spend, expires outstanding receipts, and re-opens the budget (ADR-381)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-evidence-reset-'));
    const key = keyPair();
    const common = {
      confirm: true,
      now: 1_700_000_000_100,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    };

    // Spend alpha with a weak receipt (size-viable, e-process refused at
    // test 1), leaving it 'evaluated'.
    const weakDeltas = [0.1, 0.12, 0.2, 0.08, 0.15, 0.11, 0.09, 0.14, 0.13, -0.1];
    const weak = makeReceipt(key, {
      heldOutDeltas: weakDeltas,
      pairedOutcomes: weakDeltas.map((delta, i) => ({ taskId: `w${i}`, baselineScore: 0.5, candidateScore: 0.5 + delta })),
    });
    await registerFlywheelReceipt(root, weak);
    expect((await promoteFlywheelCandidate(root, weak.payload.receiptId, common)).reason).toMatch(/insufficient sequential evidence/);

    // Governance requirements: confirm + non-empty reason.
    expect((await resetSequentialEvidence(root, { confirm: false, reason: 'x' })).success).toBe(false);
    expect((await resetSequentialEvidence(root, { confirm: true, reason: '  ' })).success).toBe(false);

    const reset = await resetSequentialEvidence(root, { confirm: true, reason: 'baseline rollback — fresh campaign', now: 1_700_000_000_200 });
    expect(reset).toMatchObject({ success: true, closedEpoch: 0, newEpoch: 1, testsArchived: 1, receiptsExpired: 1 });

    const state = readFlywheelTransactionState(root);
    expect(state.evidenceEpoch).toBe(1);
    expect(state.sequentialTests).toEqual({});
    expect(state.sequentialResets).toHaveLength(1);
    expect(state.sequentialResets![0]).toMatchObject({
      epoch: 0,
      reason: 'baseline rollback — fresh campaign',
      testsSpent: { [weak.payload.receiptId]: 1 },
      expiredReceipts: [weak.payload.receiptId],
    });

    // The expired receipt cannot be promoted in the new epoch — fresh data only.
    expect((await promoteFlywheelCandidate(root, weak.payload.receiptId, common)).reason).toMatch(/receipt state is expired/);

    // A receipt evaluated AFTER the reset promotes from test 1 of the new epoch.
    // `now` here is the receipt's own evidence timestamp (payload.issuedAt),
    // not just its registration time — it must postdate the reset's
    // evidenceEpochStartedAt (1_700_000_000_200) for the epoch boundary check
    // to accept it as belonging to the new epoch.
    const fresh = makeReceipt(key, { evaluationRunId: '01900000-0000-7000-8000-000000000009', now: 1_700_000_000_250 });
    await registerFlywheelReceipt(root, fresh, 1_700_000_000_300);
    const promoted = await promoteFlywheelCandidate(root, fresh.payload.receiptId, common);
    expect(promoted.success).toBe(true);
    expect(readFlywheelTransactionState(root).sequentialTests?.[fresh.payload.receiptId]).toBe(1);
  });

  it('refuses to promote a receipt whose evidence predates the current evidence epoch, even if registered after the reset (ADR-381 §2 index-shopping guard)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flywheel-epoch-boundary-'));
    const key = keyPair();
    const common = {
      confirm: true,
      now: 1_700_000_000_400,
      trustedPublicKeys: new Set([key.publicKeyPem]),
      applyFn: apply,
    };
    await resetSequentialEvidence(root, { confirm: true, reason: 'fresh campaign', now: 1_700_000_000_200 });
    expect(readFlywheelTransactionState(root).evidenceEpochStartedAt).toBe(1_700_000_000_200);

    // Evidence issued BEFORE the reset, but registered AFTER it — simulates a
    // stale/cached evaluation or any path that decouples evaluation from
    // immediate registration. Registration order alone must not be enough to
    // admit it into the new, cheaper epoch.
    const stale = makeReceipt(key, { evaluationRunId: '01900000-0000-7000-8000-00000000000a', now: 1_700_000_000_100 });
    await registerFlywheelReceipt(root, stale, 1_700_000_000_350);
    const result = await promoteFlywheelCandidate(root, stale.payload.receiptId, common);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/predates the current evidence epoch/);
    expect(readFlywheelTransactionState(root).sequentialTests?.[stale.payload.receiptId]).toBeUndefined();
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
