/**
 * Phase 7 Tests — Witness-Signed PageRank Artifact (beyond-SOTA wedge)
 */

import { describe, it, expect } from 'vitest';
import {
  generateWitnessKey,
  sealArtifact,
  verifyArtifact,
  canonicalJSON,
  sha256Hex,
} from '../src/infrastructure/witness-signer.js';
import type { PageRankResult } from '../src/domain/types.js';
import type { SignedPageRankEnvelope } from '../src/domain/signed-artifact.js';

const SAMPLE_RESULT: PageRankResult = {
  graphId: 'test:dd',
  nodeId: 'n3',
  score: 0.123456,
  alpha: 0.85,
  epsilon: 1e-3,
  iterations: 4,
  complexityClass: 'logarithmic',
  coherence: { score: 0.42, passed: true, threshold: 0 },
  computedAt: '2026-05-19T01:00:00.000Z',
  resultHash: 'f'.repeat(64),
};

describe('canonicalJSON', () => {
  it('produces identical output for structurally-equal objects', () => {
    expect(canonicalJSON({ a: 1, b: 2 })).toBe(canonicalJSON({ b: 2, a: 1 }));
  });
  it('skips undefined keys', () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('sealArtifact + verifyArtifact', () => {
  it('round-trips on the happy path', () => {
    const key = generateWitnessKey();
    const { envelope } = sealArtifact({
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push',
      alpha: 0.85,
      epsilon: 1e-3,
      queryNode: 'n3',
      seedNodes: [],
      result: SAMPLE_RESULT,
      witnessKey: key,
    });
    const r = verifyArtifact(envelope);
    expect(r.valid).toBe(true);
    expect(r.signatureValid).toBe(true);
    expect(r.integrityValid).toBe(true);
    expect(r.publicKey).toBe(key.publicKeyHex);
    expect(r.complexityClass).toBe('logarithmic');
    expect(r.coherenceScore).toBe(0.42);
  });

  it('rejects tampering with the score (signature breaks)', () => {
    const key = generateWitnessKey();
    const { envelope } = sealArtifact({
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      result: SAMPLE_RESULT,
      witnessKey: key,
    });
    const forged: SignedPageRankEnvelope = JSON.parse(JSON.stringify(envelope));
    forged.payload.result.score = 0.99;
    const r = verifyArtifact(forged);
    expect(r.valid).toBe(false);
  });

  it('rejects an artifact where complexityClass echo was changed', () => {
    const key = generateWitnessKey();
    const { envelope } = sealArtifact({
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      result: SAMPLE_RESULT,
      witnessKey: key,
    });
    const forged: SignedPageRankEnvelope = JSON.parse(JSON.stringify(envelope));
    forged.payload.complexityClass = 'constant';
    const r = verifyArtifact(forged);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/complexityClass echo mismatch/);
  });

  it('rejects an artifact where coherenceScore echo was changed', () => {
    const key = generateWitnessKey();
    const { envelope } = sealArtifact({
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      result: SAMPLE_RESULT,
      witnessKey: key,
    });
    const forged: SignedPageRankEnvelope = JSON.parse(JSON.stringify(envelope));
    forged.payload.coherenceScore = 0.99;
    expect(verifyArtifact(forged).reason).toMatch(/coherenceScore echo mismatch/);
  });

  it('rejects an artifact where resultHash echo was changed', () => {
    const key = generateWitnessKey();
    const { envelope } = sealArtifact({
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      result: SAMPLE_RESULT,
      witnessKey: key,
    });
    const forged: SignedPageRankEnvelope = JSON.parse(JSON.stringify(envelope));
    forged.payload.resultHash = '0'.repeat(64);
    const r = verifyArtifact(forged);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/resultHash/);
  });

  it('rejects an envelope signed by an untrusted key when trust-list is set', () => {
    const stranger = generateWitnessKey();
    const { envelope } = sealArtifact({
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      result: SAMPLE_RESULT,
      witnessKey: stranger,
    });
    const r = verifyArtifact(envelope, { trustedPublicKeys: ['00'.repeat(32)] });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/not in trusted list/);
  });

  it('accepts an envelope signed by a trusted key', () => {
    const friend = generateWitnessKey();
    const { envelope } = sealArtifact({
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      result: SAMPLE_RESULT,
      witnessKey: friend,
    });
    const r = verifyArtifact(envelope, { trustedPublicKeys: [friend.publicKeyHex] });
    expect(r.valid).toBe(true);
  });

  it('is byte-deterministic for identical inputs + same key + same sealedAt', () => {
    const key = generateWitnessKey();
    const sealedAt = '2026-05-19T01:23:45.678Z';
    const inputs = {
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push' as const,
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [] as string[],
      result: SAMPLE_RESULT,
      witnessKey: key,
      sealedAt,
    };
    const a = sealArtifact(inputs).envelope;
    const b = sealArtifact(inputs).envelope;
    expect(a.signature).toBe(b.signature);
  });

  it('produces a different signature when score changes', () => {
    const key = generateWitnessKey();
    const sealedAt = '2026-05-19T01:23:45.678Z';
    const base = {
      installationId: 'inst-A',
      witnessKeyId: 'key-v1',
      graphId: 'test:dd',
      graphHash: 'a'.repeat(64),
      graphTimestamp: '2026-05-19T00:00:00.000Z',
      algorithm: 'forward-push' as const,
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [] as string[],
      witnessKey: key,
      sealedAt,
    };
    const a = sealArtifact({ ...base, result: SAMPLE_RESULT }).envelope;
    const altered: PageRankResult = { ...SAMPLE_RESULT, score: 0.5 };
    const b = sealArtifact({ ...base, result: altered }).envelope;
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('sha256Hex', () => {
  it('hashes consistently', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'));
    expect(sha256Hex('hello')).not.toBe(sha256Hex('world'));
  });
});
