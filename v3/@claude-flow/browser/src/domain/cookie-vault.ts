/**
 * @claude-flow/browser - Cookie Vault Types (ADR-122 Phase 3)
 *
 * Every cookie write goes through AIDefence PII scanning before persistence.
 * Vault entries are sealed with the same Ed25519 witness used for trajectories
 * (ADR-122 Phase 1) so peers can cryptographically attest that:
 *   "this cookie handle was scanned by SCANNER@VERSION at TIMESTAMP and
 *    contained no detected PII / no threats."
 *
 * No SOTA web agent (Surfer-H, Browser Use, Stagehand, Operator, Skyvern)
 * ships per-cookie attestation. Cross-installation cookie sharing is a known
 * open problem; the witness signature is the trust boundary.
 */

import { z } from 'zod';

export const CookieValueSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
});
export type CookieValue = z.infer<typeof CookieValueSchema>;

/** Scanner verdict — references what was scanned + by which AIDefence version. */
export const ScanAttestationSchema = z.object({
  scannerName: z.string().min(1),
  scannerVersion: z.string().min(1),
  scannedAt: z.string(),
  /** True iff the scan found neither PII nor threats. */
  clean: z.boolean(),
  /** Number of PII matches the scanner found (must be 0 for `clean`). */
  piiCount: z.number().int().nonnegative(),
  /** Number of threats the scanner found (must be 0 for `clean`). */
  threatCount: z.number().int().nonnegative(),
  /** Hash of the scanned cookie value (sha256 hex) — for replay verification. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ScanAttestation = z.infer<typeof ScanAttestationSchema>;

export const VAULT_ENVELOPE_VERSION = '1.0.0';
export const VAULT_ENVELOPE_KIND = 'cookie-vault-entry';

export const VaultEntryPayloadSchema = z.object({
  envelopeVersion: z.literal(VAULT_ENVELOPE_VERSION),
  kind: z.literal(VAULT_ENVELOPE_KIND),
  /** Vault handle ID — opaque, used by consumers to attach the cookie to a session. */
  handleId: z.string().min(1),
  /** Project / installation ID embedded for federation trust boundary. */
  projectId: z.string().min(1),
  /** Ed25519 public key of the signer (hex). */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  /** Cookie payload. Value is verbatim — attestation says it was scanned clean. */
  cookie: CookieValueSchema,
  /** AIDefence (or compatible) scan verdict. */
  attestation: ScanAttestationSchema,
  /** When the vault entry was sealed. */
  sealedAt: z.string(),
  /** Origin the cookie is bound to (e.g. https://example.com). Inferred from cookie.domain when absent. */
  origin: z.string().optional(),
});
export type VaultEntryPayload = z.infer<typeof VaultEntryPayloadSchema>;

export const VaultEntryEnvelopeSchema = z.object({
  payload: VaultEntryPayloadSchema,
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  algorithm: z.literal('ed25519'),
});
export type VaultEntryEnvelope = z.infer<typeof VaultEntryEnvelopeSchema>;

export interface VaultVerificationResult {
  valid: boolean;
  signatureValid: boolean;
  schemaValid: boolean;
  /** Scanner attestation embedded in the envelope (populated even on failure for diagnostics). */
  attestation?: ScanAttestation;
  publicKey?: string;
  reason?: string;
}

/** Audit record written when a write is refused due to PII/threat. */
export const VaultRefusalSchema = z.object({
  attemptedAt: z.string(),
  origin: z.string().optional(),
  cookieName: z.string(),
  reason: z.string(),
  piiCount: z.number().int().nonnegative(),
  threatCount: z.number().int().nonnegative(),
});
export type VaultRefusal = z.infer<typeof VaultRefusalSchema>;
