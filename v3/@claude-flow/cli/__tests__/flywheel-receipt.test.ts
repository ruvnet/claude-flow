import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  GENESIS_LEDGER_HEAD,
  canonicalizeJcs,
  createFlywheelReceipt,
  policyCandidateId,
  verifyFlywheelReceipt,
} from '../src/services/flywheel-receipt.js';

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function acceptedReceipt(key = keys(), now = 1_700_000_000_000) {
  return {
    key,
    receipt: createFlywheelReceipt({
      baselineRef: policyCandidateId({ alpha: 0.5 }),
      expectedLedgerHead: GENESIS_LEDGER_HEAD,
      candidatePolicy: { alpha: 0.3 },
      safetyEnvelopeRef: 'sha256:safety',
      corpusVersion: 'corpus-v1',
      corpusHash: 'sha256:corpus',
      anchorRef: 'sha256:project-anchor',
      baselineScore: 0.5,
      candidateScore: 0.65,
      heldOutDeltas: [0.1, 0.12, 0.2, 0.08, 0.15, 0.11],
      frozenAnchorRegression: 0,
      gates: { heldOut: true, redblue: true, replay: true },
      now,
      bootstrapIterations: 1_000,
      ...key,
    }),
  };
}

describe('flywheel receipt protocol', () => {
  it('uses deterministic canonical JSON and rejects ambiguous numeric values', () => {
    expect(canonicalizeJcs({ z: 1, a: { c: 2, b: 1 } })).toBe('{"a":{"b":1,"c":2},"z":1}');
    expect(() => canonicalizeJcs({ value: -0 })).toThrow(/non-canonical number/);
    expect(() => canonicalizeJcs({ value: Number.NaN })).toThrow(/non-canonical number/);
  });

  it('signs an accepted receipt and verifies only against an approved key', () => {
    const { key, receipt } = acceptedReceipt();
    expect(receipt.payload.decision).toBe('accepted');
    expect(verifyFlywheelReceipt(receipt, new Set([key.publicKeyPem]))).toEqual({
      valid: true,
      signed: true,
      errors: [],
    });
    expect(verifyFlywheelReceipt(receipt, new Set([keys().publicKeyPem])).errors).toContain('receipt signer is not trusted');
  });

  it('detects one-byte-equivalent content changes and separates run identity from policy identity', () => {
    const { key, receipt } = acceptedReceipt();
    const tampered = structuredClone(receipt);
    tampered.payload.candidatePolicy.alpha = 0.31;
    expect(verifyFlywheelReceipt(tampered, new Set([key.publicKeyPem])).valid).toBe(false);

    const anchorTampered = structuredClone(receipt);
    anchorTampered.payload.anchorRef = 'sha256:different-project-anchor';
    expect(verifyFlywheelReceipt(anchorTampered, new Set([key.publicKeyPem])).valid).toBe(false);

    const second = acceptedReceipt(key, 1_700_000_000_001).receipt;
    expect(second.payload.candidateId).toBe(receipt.payload.candidateId);
    expect(second.payload.evaluationRunId).not.toBe(receipt.payload.evaluationRunId);
    expect(second.payload.receiptId).not.toBe(receipt.payload.receiptId);
  });

  it('recomputes the statistical verdict instead of trusting signed fields', () => {
    const { key, receipt } = acceptedReceipt();
    const forged = structuredClone(receipt);
    forged.payload.statistics.relativeLift = '99';
    expect(verifyFlywheelReceipt(forged, new Set([key.publicKeyPem])).errors).toContain(
      'statistical decision does not recompute',
    );
  });

  it('carries task-level paired outcomes and refuses ones that cannot reproduce their aggregate', () => {
    const key = keys();
    const heldOutDeltas = [0.1, 0.12, 0.2, 0.08];
    const receipt = createFlywheelReceipt({
      baselineRef: policyCandidateId({ alpha: 0.5 }),
      candidatePolicy: { alpha: 0.3 },
      safetyEnvelopeRef: 'sha256:safety',
      corpusVersion: 'corpus-v1',
      corpusHash: 'sha256:corpus',
      baselineScore: 0.5,
      candidateScore: 0.65,
      heldOutDeltas,
      pairedOutcomes: heldOutDeltas.map((delta, i) => ({
        taskId: `t${i}`,
        baselineScore: 0.5,
        candidateScore: 0.5 + delta,
      })),
      frozenAnchorRegression: 0,
      gates: { heldOut: true },
      bootstrapIterations: 500,
      ...key,
    });
    expect(receipt.payload.pairedOutcomes).toHaveLength(4);
    expect(verifyFlywheelReceipt(receipt, new Set([key.publicKeyPem])).valid).toBe(true);

    // Tampering with a per-task score breaks BOTH the content ID and the
    // delta-reproducibility check — the paired rows are evidence, not decoration.
    const tampered = structuredClone(receipt);
    tampered.payload.pairedOutcomes![0].candidateScore = '0.9';
    const verification = verifyFlywheelReceipt(tampered, new Set([key.publicKeyPem]));
    expect(verification.valid).toBe(false);
    expect(verification.errors.join(' ')).toMatch(/paired outcomes inconsistent/);
  });

  it('keeps receipts without paired outcomes verifiable (backward compatibility)', () => {
    const { key, receipt } = acceptedReceipt();
    expect(receipt.payload.pairedOutcomes).toBeUndefined();
    expect(verifyFlywheelReceipt(receipt, new Set([key.publicKeyPem])).valid).toBe(true);
  });

  it('rejects small relative lifts even when every held-out delta is positive', () => {
    const { privateKeyPem, publicKeyPem } = keys();
    const receipt = createFlywheelReceipt({
      baselineRef: policyCandidateId({ alpha: 0.5 }),
      candidatePolicy: { alpha: 0.49 },
      safetyEnvelopeRef: 'sha256:safety',
      corpusVersion: 'corpus-v1',
      corpusHash: 'sha256:corpus',
      baselineScore: 1,
      candidateScore: 1.01,
      heldOutDeltas: [0.01, 0.01, 0.01, 0.01],
      frozenAnchorRegression: 0,
      gates: { heldOut: true },
      bootstrapIterations: 500,
      privateKeyPem,
      publicKeyPem,
    });
    expect(receipt.payload.statistics.significant).toBe(true);
    expect(receipt.payload.decision).toBe('rejected');
  });
});
