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
    heldOutDeltas: [0.1, 0.12, 0.2, 0.08, 0.15, 0.11],
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
