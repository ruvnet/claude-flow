/**
 * @claude-flow/browser - Witness Signer (ADR-122 Phase 1)
 *
 * Ed25519 signing/verification for browser trajectory envelopes.
 * Uses node:crypto (no new deps) which supports Ed25519 natively on node 20+.
 *
 * In Phase 3+ this delegates to the project-level witness manifest key
 * (ADR-103) so trajectories carry the same root-of-trust as the fix manifest.
 * For Phase 1 we accept either an explicit key (tests, ephemeral) or a
 * project-keyed witness via the `RUFLO_BROWSER_WITNESS_KEY` env var.
 */

import { createPrivateKey, createPublicKey, sign, verify, generateKeyPairSync } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import {
  SIGNED_TRAJECTORY_ENVELOPE_VERSION,
  SIGNED_TRAJECTORY_KIND,
  SignedTrajectoryEnvelopeSchema,
  SignedTrajectoryPayloadSchema,
  type SignedTrajectoryEnvelope,
  type SignedTrajectoryPayload,
  type VerificationResult,
} from '../domain/signed-trajectory.js';

export interface WitnessKey {
  /** Ed25519 private key (KeyObject). */
  privateKey: KeyObject;
  /** Ed25519 public key (KeyObject). */
  publicKey: KeyObject;
  /** Public key as hex (32 bytes / 64 hex chars). */
  publicKeyHex: string;
}

/**
 * Canonicalize an object for deterministic signing.
 *
 * Recursively sorts keys so two structurally-equal payloads produce
 * byte-identical strings. Without this, a signature would depend on
 * JSON key insertion order — i.e. would not survive a round-trip
 * through any well-meaning JSON parser.
 */
export function canonicalJSON(value: unknown): string {
  if (value === undefined) return 'null'; // never reached at the top level — child branch handles it
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const obj = value as Record<string, unknown>;
  // Drop undefined keys so canonicalization matches what survives JSON.stringify round-trips.
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

/** Generate a fresh Ed25519 keypair. Useful for tests and first-run setup. */
export function generateWitnessKey(): WitnessKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKey,
    publicKeyHex: extractPublicKeyHex(publicKey),
  };
}

/** Load a witness key from PEM-encoded strings. */
export function loadWitnessKey(privateKeyPem: string): WitnessKey {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyHex: extractPublicKeyHex(publicKey),
  };
}

/** Extract the raw 32-byte Ed25519 public key as hex. */
function extractPublicKeyHex(publicKey: KeyObject): string {
  // node's Ed25519 export gives a DER-wrapped key. The last 32 bytes are the
  // raw public key per RFC 8410.
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('hex');
}

/** SHA-256 hex digest of a buffer or string. */
export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Sign a payload, producing a verifiable envelope. */
export function signTrajectory(
  payload: Omit<SignedTrajectoryPayload, 'publicKey' | 'envelopeVersion' | 'kind' | 'sealedAt'>,
  key: WitnessKey,
  options: { sealedAt?: string } = {},
): SignedTrajectoryEnvelope {
  const fullPayload: SignedTrajectoryPayload = {
    envelopeVersion: SIGNED_TRAJECTORY_ENVELOPE_VERSION,
    kind: SIGNED_TRAJECTORY_KIND,
    sealedAt: options.sealedAt ?? new Date().toISOString(),
    publicKey: key.publicKeyHex,
    ...payload,
  };

  // Schema-validate before signing so we never produce a signed-but-malformed envelope.
  const validated = SignedTrajectoryPayloadSchema.parse(fullPayload);
  const canonical = canonicalJSON(validated);
  const signatureBuf = sign(null, Buffer.from(canonical, 'utf8'), key.privateKey);

  return {
    payload: validated,
    signature: signatureBuf.toString('hex'),
    algorithm: 'ed25519',
  };
}

/**
 * Verify an envelope.
 *
 * Returns a structured result rather than throwing — callers (CLI, MCP
 * tools, federation peer ingest) often need to act on the reason.
 */
export function verifyTrajectory(
  envelope: unknown,
  options: { trustedPublicKeys?: string[] } = {},
): VerificationResult {
  // Step 1 — schema check
  const parsed = SignedTrajectoryEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: false,
      reason: 'envelope schema validation failed: ' + parsed.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; '),
    };
  }

  const { payload, signature } = parsed.data;

  // Step 2 — trust check (if a trust list was supplied)
  if (options.trustedPublicKeys && !options.trustedPublicKeys.includes(payload.publicKey)) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: true,
      publicKey: payload.publicKey,
      reason: 'signer public key not in trusted list',
    };
  }

  // Step 3 — signature check
  try {
    // Reconstruct a SPKI-wrapped Ed25519 key from the bare 32-byte hex.
    // Ed25519 SPKI DER prefix per RFC 8410: 0x302a300506032b6570032100 (12 bytes), then the 32-byte key.
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const der = Buffer.concat([spkiPrefix, Buffer.from(payload.publicKey, 'hex')]);
    const publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });

    const canonical = canonicalJSON(payload);
    const signatureValid = verify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(signature, 'hex'));

    return {
      valid: signatureValid,
      signatureValid,
      schemaValid: true,
      publicKey: payload.publicKey,
      reason: signatureValid ? undefined : 'signature verification failed (payload may be tampered)',
    };
  } catch (err) {
    return {
      valid: false,
      signatureValid: false,
      schemaValid: true,
      publicKey: payload.publicKey,
      reason: 'signature verification threw: ' + (err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Resolve a witness key from environment or generate an ephemeral one.
 *
 * Phase 1 ergonomics — production callers should pass a key explicitly or
 * point this at the project witness manifest key.
 */
export function resolveWitnessKey(): WitnessKey {
  const envKey = process.env.RUFLO_BROWSER_WITNESS_KEY;
  if (envKey) return loadWitnessKey(envKey);
  return generateWitnessKey();
}
