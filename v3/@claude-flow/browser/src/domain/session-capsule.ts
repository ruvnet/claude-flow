/**
 * @claude-flow/browser - Session Capsule (ADR-122 Phase 6)
 *
 * The Session Capsule is the substrate primitive: a sealed bundle of browser
 * state with explicit origin policy, consent proof, expiry, reuse policy, and
 * a witness chain. NEVER treat cookies as raw reusable blobs — OWASP guidance
 * is unambiguous that session identifiers are security-critical.
 *
 * Phase 6 extends Phase 3's CookieVaultService into the full capsule model:
 *   - multi-store state (cookies + localStorage + sessionStorage + indexeddb metadata)
 *   - origin-scoped reuse policy
 *   - consent proof (signed by capsule owner)
 *   - cross-device / cross-installation flags
 *   - witness chain head (rolls forward on every refresh/rotate)
 */

import { z } from 'zod';

/** Reuse policy — what callers can do with this capsule. */
export const ReusePolicySchema = z.object({
  /** Origins where this capsule may be mounted. */
  allowedOrigins: z.array(z.string()).default([]),
  /** Task classes allowed to use this capsule (e.g. ['read-only', 'authenticated-read']). */
  allowedTaskClasses: z.array(z.string()).default(['read-only', 'authenticated-read']),
  /** Maximum number of replays before forced re-auth. 0 = unlimited within expiry. */
  maxReplays: z.number().int().nonnegative().default(0),
  /** Require a fresh MFA before each mount. */
  requireFreshMfa: z.boolean().default(false),
  /** Allow mounting on a different device than the one that captured. */
  allowCrossDevice: z.boolean().default(false),
  /** Allow mounting on a different ruflo installation. */
  allowCrossInstallation: z.boolean().default(false),
});
export type ReusePolicy = z.infer<typeof ReusePolicySchema>;

export const OriginPolicySchema = z.object({
  origin: z.string().min(1),
  /** Cookie-domain restriction for entries in this capsule. */
  cookieDomain: z.string().optional(),
  /** Whether secure flag is required on cookies bound to this origin. */
  requireSecure: z.boolean().default(true),
  /** Whether httpOnly is required. */
  requireHttpOnly: z.boolean().default(false),
});
export type OriginPolicy = z.infer<typeof OriginPolicySchema>;

/** Consent proof — owner signed approval for this capsule's reuse policy. */
export const ConsentProofSchema = z.object({
  /** Statement the owner consented to. */
  statement: z.string().min(1),
  /** When the consent was given. */
  signedAt: z.string(),
  /** Signature (hex) over canonicalized {statement, signedAt, ownerPublicKey}. */
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  /** Owner's public key (hex). May equal the witness key or be separate. */
  ownerPublicKey: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ConsentProof = z.infer<typeof ConsentProofSchema>;

/** Browser profile fingerprint — keeps capsule playback consistent. */
export const BrowserProfileSchema = z.object({
  userAgent: z.string().optional(),
  acceptLanguage: z.string().optional(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  timezone: z.string().optional(),
  /** Capsule-scoped device identifier; not a global device fingerprint. */
  capsuleDeviceId: z.string().optional(),
});
export type BrowserProfile = z.infer<typeof BrowserProfileSchema>;

/** Encrypted state blob reference — for state stored elsewhere (S3, RVF, disk). */
export const StateRefSchema = z.object({
  /** Storage scheme (e.g. 'file', 'rvf', 's3'). */
  scheme: z.string().min(1),
  /** Opaque locator within the scheme. */
  locator: z.string().min(1),
  /** SHA-256 of the encrypted blob for integrity. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Encryption identifier (algorithm + key reference). */
  encryption: z.string().min(1),
});
export type StateRef = z.infer<typeof StateRefSchema>;

/** Cookie+storage state inlined when small enough to skip the StateRef indirection. */
export const InlineStateSchema = z.object({
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  })),
  localStorage: z.record(z.string()).default({}),
  sessionStorage: z.record(z.string()).default({}),
  /** Metadata only — IndexedDB *contents* never leave the origin. */
  indexedDbMeta: z.array(z.object({ dbName: z.string(), version: z.number().int() })).default([]),
});
export type InlineState = z.infer<typeof InlineStateSchema>;

export const CAPSULE_ENVELOPE_VERSION = '1.0.0';
export const CAPSULE_ENVELOPE_KIND = 'session-capsule';

export const SessionCapsulePayloadSchema = z.object({
  envelopeVersion: z.literal(CAPSULE_ENVELOPE_VERSION),
  kind: z.literal(CAPSULE_ENVELOPE_KIND),
  capsuleId: z.string().min(1),
  tenantId: z.string().min(1),
  ownerId: z.string().min(1),
  /** Federation trust boundary (matches signed-trajectory `projectId`). */
  projectId: z.string().min(1),
  /** Witness public key (hex). */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  origins: z.array(OriginPolicySchema),
  browserProfile: BrowserProfileSchema,
  /** Either inline OR a StateRef — never both. */
  inlineState: InlineStateSchema.optional(),
  stateRef: StateRefSchema.optional(),
  reusePolicy: ReusePolicySchema,
  consentProof: ConsentProofSchema,
  /** Witness-chain head — rolls forward on every mutation (refresh/rotate). */
  witnessChainHead: z.string().regex(/^[0-9a-f]{64}$/),
  /** Replay counter — incremented on every successful mount. */
  replays: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type SessionCapsulePayload = z.infer<typeof SessionCapsulePayloadSchema>;

export const SessionCapsuleEnvelopeSchema = z.object({
  payload: SessionCapsulePayloadSchema,
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  algorithm: z.literal('ed25519'),
});
export type SessionCapsuleEnvelope = z.infer<typeof SessionCapsuleEnvelopeSchema>;

/** Risk classes for autonomous action gating. */
export const RiskClassSchema = z.enum([
  'read-only',           // Class 1
  'authenticated-read',  // Class 2
  'draft-write',         // Class 3 — autonomous OK
  'external-submission', // Class 4 — human approval
  'financial',           // Class 5 — human approval
  'account-mutation',    // Class 6 — human approval
  'destructive',         // Class 7 — human approval
]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const AUTONOMOUS_CLASSES: ReadonlySet<RiskClass> = new Set(['read-only', 'authenticated-read', 'draft-write']);

export interface RiskClassification {
  class: RiskClass;
  autonomousAllowed: boolean;
  rationale: string;
  /** Required additional consent if autonomousAllowed = false. */
  requiredConsent?: string[];
}

export interface CapsuleVerificationResult {
  valid: boolean;
  signatureValid: boolean;
  schemaValid: boolean;
  /** True iff capsule has not expired AND replay count is under maxReplays. */
  withinPolicy: boolean;
  reason?: string;
  publicKey?: string;
}
