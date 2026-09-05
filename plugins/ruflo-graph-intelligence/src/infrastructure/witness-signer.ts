/**
 * Witness Signer for PR Artifacts (Phase 7, ADR-123)
 *
 * Ed25519 sign / verify via node:crypto. Mirrors @claude-flow/browser's
 * ADR-122 Phase 1 witness signer — same canonical-JSON approach so a single
 * upstream-ADR-103 schema change cascades cleanly.
 */

import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  generateKeyPairSync,
  createHash,
  type KeyObject,
} from 'node:crypto';
import {
  ARTIFACT_ENVELOPE_KIND,
  ARTIFACT_ENVELOPE_VERSION,
  SignedPageRankEnvelopeSchema,
  SignedPageRankPayloadSchema,
  type SignedPageRankEnvelope,
  type SignedPageRankPayload,
  type ArtifactVerificationResult,
} from '../domain/signed-artifact.js';
import type { PageRankResult } from '../domain/types.js';

export interface WitnessKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyHex: string;
}

/** Canonical-JSON for deterministic signing — omits undefined keys, sorts. */
export function canonicalJSON(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generateWitnessKey(): WitnessKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey, publicKeyHex: extractPubkeyHex(publicKey) };
}

export function loadWitnessKey(privateKeyPem: string): WitnessKey {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, publicKeyHex: extractPubkeyHex(publicKey) };
}

function extractPubkeyHex(publicKey: KeyObject): string {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('hex');
}

export function resolveWitnessKey(): WitnessKey {
  const envKey = process.env.RUFLO_GRAPH_INTELLIGENCE_WITNESS_KEY;
  if (envKey) return loadWitnessKey(envKey);
  return generateWitnessKey();
}

export interface SealArtifactInput {
  installationId: string;
  witnessKeyId: string;
  graphId: string;
  graphHash: string;
  graphTimestamp: string;
  algorithm: SignedPageRankPayload['algorithm'];
  alpha: number;
  epsilon: number;
  queryNode?: string;
  seedNodes: readonly string[];
  result: PageRankResult;
  witnessKey?: WitnessKey;
  sealedAt?: string;
}

export function sealArtifact(input: SealArtifactInput): {
  envelope: SignedPageRankEnvelope;
  publicKeyHex: string;
} {
  const key = input.witnessKey ?? resolveWitnessKey();
  const payload: SignedPageRankPayload = SignedPageRankPayloadSchema.parse({
    envelopeVersion: ARTIFACT_ENVELOPE_VERSION,
    kind: ARTIFACT_ENVELOPE_KIND,
    installationId: input.installationId,
    witnessKeyId: input.witnessKeyId,
    publicKey: key.publicKeyHex,
    graphId: input.graphId,
    graphHash: input.graphHash,
    graphTimestamp: input.graphTimestamp,
    algorithm: input.algorithm,
    alpha: input.alpha,
    epsilon: input.epsilon,
    queryNode: input.queryNode,
    seedNodes: [...input.seedNodes],
    result: input.result,
    complexityClass: input.result.complexityClass,
    coherenceScore: input.result.coherence.score,
    resultHash: input.result.resultHash,
    sealedAt: input.sealedAt ?? new Date().toISOString(),
    solverVersion: 'sublinear-time-solver@1.7.0',
  });
  const canonical = canonicalJSON(payload);
  const sigBuf = sign(null, Buffer.from(canonical, 'utf8'), key.privateKey);
  return {
    envelope: { payload, signature: sigBuf.toString('hex'), algorithm: 'ed25519' },
    publicKeyHex: key.publicKeyHex,
  };
}

export function verifyArtifact(
  envelope: unknown,
  options: { trustedPublicKeys?: string[] } = {},
): ArtifactVerificationResult {
  const parsed = SignedPageRankEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: false,
      integrityValid: false,
      reason: 'schema: ' + parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '),
    };
  }
  const { payload, signature } = parsed.data;

  if (options.trustedPublicKeys && !options.trustedPublicKeys.includes(payload.publicKey)) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: true,
      integrityValid: false,
      publicKey: payload.publicKey,
      reason: 'signer not in trusted list',
    };
  }

  // Integrity: result.resultHash must match payload.resultHash
  if (payload.result.resultHash !== payload.resultHash) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: true,
      integrityValid: false,
      publicKey: payload.publicKey,
      reason: 'result.resultHash != payload.resultHash (tampered)',
    };
  }
  // Coherence echo must match
  if (Math.abs(payload.result.coherence.score - payload.coherenceScore) > 1e-9) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: true,
      integrityValid: false,
      publicKey: payload.publicKey,
      reason: 'coherenceScore echo mismatch (tampered)',
    };
  }
  // Complexity-class echo must match
  if (payload.result.complexityClass !== payload.complexityClass) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: true,
      integrityValid: false,
      publicKey: payload.publicKey,
      reason: 'complexityClass echo mismatch (tampered)',
    };
  }

  // Signature
  try {
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const der = Buffer.concat([spkiPrefix, Buffer.from(payload.publicKey, 'hex')]);
    const pk = createPublicKey({ key: der, format: 'der', type: 'spki' });
    const canonical = canonicalJSON(payload);
    const sigValid = verify(null, Buffer.from(canonical, 'utf8'), pk, Buffer.from(signature, 'hex'));
    return {
      valid: sigValid,
      signatureValid: sigValid,
      schemaValid: true,
      integrityValid: true,
      publicKey: payload.publicKey,
      complexityClass: payload.complexityClass,
      coherenceScore: payload.coherenceScore,
      reason: sigValid ? undefined : 'signature verification failed (envelope tampered)',
    };
  } catch (err) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: true,
      integrityValid: false,
      publicKey: payload.publicKey,
      reason: 'verify threw: ' + (err instanceof Error ? err.message : String(err)),
    };
  }
}
