/**
 * @claude-flow/browser - Session Capsule Service (ADR-122 Phase 6)
 *
 * Seal / verify / mount / refresh / revoke for Session Capsules.
 * Builds on Phase 1's witness signer + Phase 3's AIDefence-gated scanning.
 *
 * The capsule itself is signed and policy-enforced. Mounting in a browser
 * session is delegated to ruflo-browexec (Phase 6.5+) — this module is the
 * **substrate** sessiond that owns lifecycle and policy.
 */

import { createPublicKey, sign, verify } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { canonicalJSON, resolveWitnessKey, sha256Hex, type WitnessKey } from '../infrastructure/witness-signer.js';
import { getSecurityScanner, type BrowserSecurityScanner, type ThreatScanResult } from '../infrastructure/security-integration.js';
import {
  AUTONOMOUS_CLASSES,
  CAPSULE_ENVELOPE_KIND,
  CAPSULE_ENVELOPE_VERSION,
  SessionCapsuleEnvelopeSchema,
  SessionCapsulePayloadSchema,
  type SessionCapsuleEnvelope,
  type SessionCapsulePayload,
  type ConsentProof,
  type InlineState,
  type ReusePolicy,
  type BrowserProfile,
  type OriginPolicy,
  type CapsuleVerificationResult,
  type RiskClass,
  type RiskClassification,
} from '../domain/session-capsule.js';

export interface CreateCapsuleInput {
  tenantId: string;
  ownerId: string;
  origins: OriginPolicy[];
  browserProfile?: BrowserProfile;
  inlineState?: InlineState;
  reusePolicy?: Partial<ReusePolicy>;
  consentStatement: string;
  /** Capsule lifetime in ms. Default 24h. */
  ttlMs?: number;
  /** Override witness key. */
  witnessKey?: WitnessKey;
  /** Project / installation ID (federation trust boundary). */
  projectId?: string;
}

export class SessionCapsuleService {
  private readonly witnessKey: WitnessKey;
  private readonly scanner: BrowserSecurityScanner;
  private readonly capsules = new Map<string, SessionCapsuleEnvelope>();

  constructor(options: { witnessKey?: WitnessKey; scanner?: BrowserSecurityScanner } = {}) {
    this.witnessKey = options.witnessKey ?? resolveWitnessKey();
    this.scanner = options.scanner ?? getSecurityScanner();
  }

  /** Seal a new Session Capsule. PII-scans inline state before sealing. */
  async create(input: CreateCapsuleInput): Promise<
    | { success: true; envelope: SessionCapsuleEnvelope; capsuleId: string }
    | { success: false; reason: string; piiCount: number; threatCount: number }
  > {
    const key = input.witnessKey ?? this.witnessKey;
    const projectId = input.projectId ?? process.env.RUFLO_PROJECT_ID ?? 'unknown';

    // Inline state is scanned cookie-by-cookie + storage value by value
    if (input.inlineState) {
      const scan = scanInlineState(input.inlineState, this.scanner);
      if (!isClean(scan)) {
        return {
          success: false,
          reason: 'inline state contains PII or threats',
          piiCount: scan.pii.length,
          threatCount: scan.threats.length,
        };
      }
    }

    const capsuleId = 'cap-' + Date.now() + '-' + randomBytes(4).toString('hex');
    const now = new Date();
    const ttl = input.ttlMs ?? 24 * 60 * 60 * 1000;
    const reusePolicy: ReusePolicy = {
      allowedOrigins: input.reusePolicy?.allowedOrigins ?? input.origins.map(o => o.origin),
      allowedTaskClasses: input.reusePolicy?.allowedTaskClasses ?? ['read-only', 'authenticated-read'],
      maxReplays: input.reusePolicy?.maxReplays ?? 0,
      requireFreshMfa: input.reusePolicy?.requireFreshMfa ?? false,
      allowCrossDevice: input.reusePolicy?.allowCrossDevice ?? false,
      allowCrossInstallation: input.reusePolicy?.allowCrossInstallation ?? false,
    };

    const consentProof = signConsent(input.consentStatement, key);

    const initialChainHead = sha256Hex(canonicalJSON({ capsuleId, createdAt: now.toISOString(), tenantId: input.tenantId }));

    const payload: SessionCapsulePayload = SessionCapsulePayloadSchema.parse({
      envelopeVersion: CAPSULE_ENVELOPE_VERSION,
      kind: CAPSULE_ENVELOPE_KIND,
      capsuleId,
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      projectId,
      publicKey: key.publicKeyHex,
      origins: input.origins,
      browserProfile: input.browserProfile ?? {},
      inlineState: input.inlineState,
      stateRef: undefined,
      reusePolicy,
      consentProof,
      witnessChainHead: initialChainHead,
      replays: 0,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
    });

    const canonical = canonicalJSON(payload);
    const signature = sign(null, Buffer.from(canonical, 'utf8'), key.privateKey).toString('hex');
    const envelope: SessionCapsuleEnvelope = { payload, signature, algorithm: 'ed25519' };
    this.capsules.set(capsuleId, envelope);
    return { success: true, envelope, capsuleId };
  }

  /** Verify a capsule's signature, schema, expiry, and replay count. */
  verify(envelope: unknown, options: { trustedPublicKeys?: string[]; now?: Date } = {}): CapsuleVerificationResult {
    const parsed = SessionCapsuleEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: false,
        withinPolicy: false,
        reason: 'capsule schema validation failed: ' + parsed.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; '),
      };
    }

    const { payload, signature } = parsed.data;

    if (options.trustedPublicKeys && !options.trustedPublicKeys.includes(payload.publicKey)) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: true,
        withinPolicy: false,
        publicKey: payload.publicKey,
        reason: 'signer public key not in trusted list',
      };
    }

    let signatureValid = false;
    try {
      const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      const der = Buffer.concat([spkiPrefix, Buffer.from(payload.publicKey, 'hex')]);
      const publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
      const canonical = canonicalJSON(payload);
      signatureValid = verify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(signature, 'hex'));
    } catch (err) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: true,
        withinPolicy: false,
        publicKey: payload.publicKey,
        reason: 'signature verification threw: ' + (err instanceof Error ? err.message : String(err)),
      };
    }

    if (!signatureValid) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: true,
        withinPolicy: false,
        publicKey: payload.publicKey,
        reason: 'signature verification failed (capsule tampered)',
      };
    }

    // Policy check: expiry + replay count
    const now = options.now ?? new Date();
    const expiresAt = new Date(payload.expiresAt);
    if (now.getTime() >= expiresAt.getTime()) {
      return {
        valid: false,
        signatureValid: true,
        schemaValid: true,
        withinPolicy: false,
        publicKey: payload.publicKey,
        reason: 'capsule expired at ' + payload.expiresAt,
      };
    }

    if (payload.reusePolicy.maxReplays > 0 && payload.replays >= payload.reusePolicy.maxReplays) {
      return {
        valid: false,
        signatureValid: true,
        schemaValid: true,
        withinPolicy: false,
        publicKey: payload.publicKey,
        reason: 'replay count ' + payload.replays + ' ≥ maxReplays ' + payload.reusePolicy.maxReplays,
      };
    }

    return {
      valid: true,
      signatureValid: true,
      schemaValid: true,
      withinPolicy: true,
      publicKey: payload.publicKey,
    };
  }

  /** Mount a capsule — records a replay attempt and increments the chain head. */
  async mount(capsuleId: string, options: { taskClass?: RiskClass; targetOrigin?: string } = {}): Promise<
    | { success: true; envelope: SessionCapsuleEnvelope }
    | { success: false; reason: string }
  > {
    const envelope = this.capsules.get(capsuleId);
    if (!envelope) return { success: false, reason: 'capsule not found' };

    const verification = this.verify(envelope);
    if (!verification.valid) return { success: false, reason: verification.reason ?? 'verification failed' };

    if (options.targetOrigin && !envelope.payload.reusePolicy.allowedOrigins.includes(options.targetOrigin)) {
      return { success: false, reason: 'target origin ' + options.targetOrigin + ' not in allowedOrigins' };
    }
    if (options.taskClass && !envelope.payload.reusePolicy.allowedTaskClasses.includes(options.taskClass)) {
      return { success: false, reason: 'task class ' + options.taskClass + ' not in allowedTaskClasses' };
    }

    // Bump replays + chain head + re-sign.
    const newReplays = envelope.payload.replays + 1;
    const newChainHead = sha256Hex(envelope.payload.witnessChainHead + ':' + new Date().toISOString());
    const newPayload: SessionCapsulePayload = {
      ...envelope.payload,
      replays: newReplays,
      witnessChainHead: newChainHead,
    };
    const canonical = canonicalJSON(newPayload);
    const newSignature = sign(null, Buffer.from(canonical, 'utf8'), this.witnessKey.privateKey).toString('hex');
    const updated: SessionCapsuleEnvelope = { payload: newPayload, signature: newSignature, algorithm: 'ed25519' };
    this.capsules.set(capsuleId, updated);
    return { success: true, envelope: updated };
  }

  /** Revoke a capsule — drops it from the registry. */
  revoke(capsuleId: string): boolean {
    return this.capsules.delete(capsuleId);
  }

  get(capsuleId: string): SessionCapsuleEnvelope | undefined {
    return this.capsules.get(capsuleId);
  }

  list(): readonly SessionCapsuleEnvelope[] {
    return [...this.capsules.values()];
  }

  /** Test helper. */
  getWitnessKeyPublicHex(): string {
    return this.witnessKey.publicKeyHex;
  }
}

/** Risk-class classifier — maps a planned action to one of the 7 classes. */
export class RiskClassifier {
  classify(input: { action: string; target?: string; goal?: string }): RiskClassification {
    const verb = input.action;
    const haystack = `${input.action} ${input.target ?? ''} ${input.goal ?? ''}`.toLowerCase();

    // Class 7 — destructive
    if (/(delete|destroy|wipe|drop|truncate)/.test(haystack)) {
      return { class: 'destructive', autonomousAllowed: false, rationale: 'destructive verb detected', requiredConsent: ['destructive-action'] };
    }
    // Class 5 — financial
    if (/(pay|payment|charge|invoice|refund|transfer|wire|withdraw|deposit)/.test(haystack)) {
      return { class: 'financial', autonomousAllowed: false, rationale: 'financial action detected', requiredConsent: ['financial-action'] };
    }
    // Class 6 — account mutation
    if (/(change.*password|reset.*password|update.*email|change.*account|2fa|two.factor)/.test(haystack)) {
      return { class: 'account-mutation', autonomousAllowed: false, rationale: 'account mutation detected', requiredConsent: ['account-mutation'] };
    }
    // Class 4 — external submission
    if ((verb === 'click' && /submit|send|publish|post/.test(haystack)) || /submit form/.test(haystack)) {
      return { class: 'external-submission', autonomousAllowed: false, rationale: 'external submission detected', requiredConsent: ['external-submission'] };
    }
    // Class 3 — draft write
    if (verb === 'fill' || verb === 'type') {
      return { class: 'draft-write', autonomousAllowed: true, rationale: 'form-fill counts as draft write' };
    }
    // Class 2 — authenticated read
    if (/dashboard|account|profile|inbox|orders|invoices|admin/.test(haystack)) {
      return { class: 'authenticated-read', autonomousAllowed: true, rationale: 'authenticated read surface' };
    }
    // Class 1 — read-only default
    return { class: 'read-only', autonomousAllowed: true, rationale: 'no mutation indicators' };
  }

  /** True iff the planned action is allowed for autonomous execution. */
  isAutonomous(classification: RiskClassification): boolean {
    return AUTONOMOUS_CLASSES.has(classification.class);
  }
}

function isClean(scan: ThreatScanResult): boolean {
  return scan.pii.length === 0 && scan.threats.length === 0;
}

function scanInlineState(state: InlineState, scanner: BrowserSecurityScanner): ThreatScanResult {
  // Join cookie values + storage entries into one string for a single scanContent call.
  // Note: do NOT spread the result of .join() — that would split the string into individual chars
  // and the SSN/credit-card regexes (which need contiguous digits) would never match.
  const cookieValues = state.cookies.map(c => c.value).join(' ');
  const localKv = Object.entries(state.localStorage).map(([k, v]) => `${k}=${v}`).join(' ');
  const sessionKv = Object.entries(state.sessionStorage).map(([k, v]) => `${k}=${v}`).join(' ');
  const allValues = [cookieValues, localKv, sessionKv].join(' ');
  return scanner.scanContent(allValues, 'session-capsule');
}

function signConsent(statement: string, key: WitnessKey): ConsentProof {
  const now = new Date().toISOString();
  const canonical = canonicalJSON({ statement, signedAt: now, ownerPublicKey: key.publicKeyHex });
  const sig = sign(null, Buffer.from(canonical, 'utf8'), key.privateKey).toString('hex');
  return { statement, signedAt: now, signature: sig, ownerPublicKey: key.publicKeyHex };
}
