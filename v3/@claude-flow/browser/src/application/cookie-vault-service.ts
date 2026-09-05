/**
 * @claude-flow/browser - Cookie Vault Service (ADR-122 Phase 3)
 *
 * Attested cookie vault: every write is gated by AIDefence PII scanning, then
 * sealed with an Ed25519 witness signature. Consumers MUST call
 * verifyAttestation() before attaching a sealed handle to a live session.
 *
 * Phase 3 implementation is in-memory with optional JSON-on-disk persistence;
 * Phase 3.5 swaps storage for an RVF cognitive container (`@ruvector/rvf`).
 * The public surface does not change.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  signTrajectory as _unused, // kept for backwards-compat with witness-signer import path
  verifyTrajectory as _unused2,
} from '../infrastructure/witness-signer.js';
import {
  generateWitnessKey,
  loadWitnessKey,
  resolveWitnessKey,
  sha256Hex,
  canonicalJSON,
  type WitnessKey,
} from '../infrastructure/witness-signer.js';
import { createPublicKey, sign, verify } from 'node:crypto';
import {
  BrowserSecurityScanner,
  getSecurityScanner,
  type ThreatScanResult,
} from '../infrastructure/security-integration.js';
import {
  VAULT_ENVELOPE_KIND,
  VAULT_ENVELOPE_VERSION,
  VaultEntryEnvelopeSchema,
  VaultEntryPayloadSchema,
  type CookieValue,
  type ScanAttestation,
  type VaultEntryEnvelope,
  type VaultEntryPayload,
  type VaultRefusal,
  type VaultVerificationResult,
} from '../domain/cookie-vault.js';

/** Where the attestation data came from. Default scanner is the bundled BrowserSecurityScanner. */
export interface CookieVaultScannerInfo {
  name: string;
  version: string;
}

export interface CookieVaultServiceOptions {
  /** Witness key to sign with. Default resolves from env or generates ephemeral. */
  witnessKey?: WitnessKey;
  /** Override the scanner. Default uses the package's BrowserSecurityScanner. */
  scanner?: BrowserSecurityScanner;
  /** Identity for the embedded scanner attestation (default: aidefence-bundled@2.3.0). */
  scannerInfo?: CookieVaultScannerInfo;
  /** Project ID (federation trust boundary). */
  projectId?: string;
  /** Persist refusals + entries to this path (JSON). */
  persistPath?: string;
}

interface VaultState {
  entries: VaultEntryEnvelope[];
  refusals: VaultRefusal[];
}

export class CookieVaultService {
  private readonly witnessKey: WitnessKey;
  private readonly scanner: BrowserSecurityScanner;
  private readonly scannerInfo: CookieVaultScannerInfo;
  private readonly projectId: string;
  private readonly persistPath?: string;
  private state: VaultState = { entries: [], refusals: [] };

  constructor(options: CookieVaultServiceOptions = {}) {
    this.witnessKey = options.witnessKey ?? resolveWitnessKey();
    this.scanner = options.scanner ?? getSecurityScanner();
    this.scannerInfo = options.scannerInfo ?? { name: 'aidefence-bundled', version: '2.3.0' };
    this.projectId = options.projectId ?? process.env.RUFLO_PROJECT_ID ?? 'unknown';
    this.persistPath = options.persistPath;
  }

  /**
   * Store a cookie in the vault. The value is scanned by AIDefence before
   * persistence; failures are recorded as audit refusals and the entry is
   * NOT persisted.
   *
   * Returns the sealed envelope on success or a structured failure result.
   */
  async store(input: {
    cookie: CookieValue;
    origin?: string;
    /** Override the witness key for this single store call (federation rotation). */
    witnessKey?: WitnessKey;
  }): Promise<
    | { success: true; envelope: VaultEntryEnvelope; handleId: string }
    | { success: false; refusal: VaultRefusal }
  > {
    const key = input.witnessKey ?? this.witnessKey;
    const scanResult = this.scanner.scanContent(input.cookie.value, 'cookie:' + input.cookie.name);

    if (!isClean(scanResult)) {
      const refusal: VaultRefusal = {
        attemptedAt: new Date().toISOString(),
        origin: input.origin ?? input.cookie.domain,
        cookieName: input.cookie.name,
        reason: 'AIDefence detected ' + scanResult.pii.length + ' PII + ' + scanResult.threats.length + ' threats',
        piiCount: scanResult.pii.length,
        threatCount: scanResult.threats.length,
      };
      this.state.refusals.push(refusal);
      await this.maybePersist();
      return { success: false, refusal };
    }

    const handleId = 'vh-' + Date.now() + '-' + randomBytes(3).toString('hex');
    const attestation: ScanAttestation = {
      scannerName: this.scannerInfo.name,
      scannerVersion: this.scannerInfo.version,
      scannedAt: new Date().toISOString(),
      clean: true,
      piiCount: 0,
      threatCount: 0,
      contentHash: sha256Hex(input.cookie.value),
    };

    const payload: VaultEntryPayload = VaultEntryPayloadSchema.parse({
      envelopeVersion: VAULT_ENVELOPE_VERSION,
      kind: VAULT_ENVELOPE_KIND,
      handleId,
      projectId: this.projectId,
      publicKey: key.publicKeyHex,
      cookie: input.cookie,
      attestation,
      sealedAt: new Date().toISOString(),
      origin: input.origin ?? input.cookie.domain,
    });

    const canonical = canonicalJSON(payload);
    const signature = sign(null, Buffer.from(canonical, 'utf8'), key.privateKey).toString('hex');

    const envelope: VaultEntryEnvelope = { payload, signature, algorithm: 'ed25519' };
    this.state.entries.push(envelope);
    await this.maybePersist();
    return { success: true, envelope, handleId };
  }

  /**
   * Verify a sealed envelope. Federation peers MUST call this before reusing
   * a foreign cookie handle. Optional `trustedPublicKeys` filters by signer.
   */
  verifyAttestation(envelope: unknown, options: { trustedPublicKeys?: string[] } = {}): VaultVerificationResult {
    const parsed = VaultEntryEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: false,
        reason: 'envelope schema validation failed: ' + parsed.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; '),
      };
    }

    const { payload, signature } = parsed.data;

    if (options.trustedPublicKeys && !options.trustedPublicKeys.includes(payload.publicKey)) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: true,
        publicKey: payload.publicKey,
        attestation: payload.attestation,
        reason: 'signer public key not in trusted list',
      };
    }

    // Attestation sanity: refuse anything claiming `clean: false` (the scanner
    // should never have produced a sealed envelope at all in that state).
    if (!payload.attestation.clean) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: true,
        publicKey: payload.publicKey,
        attestation: payload.attestation,
        reason: 'attestation declares unclean — entries with clean=false must never be sealed',
      };
    }

    // Content hash must still match the cookie value — protects against
    // someone replacing payload.cookie.value but forgetting to update the hash.
    const expectedHash = sha256Hex(payload.cookie.value);
    if (expectedHash !== payload.attestation.contentHash) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: true,
        publicKey: payload.publicKey,
        attestation: payload.attestation,
        reason: 'cookie value hash mismatch — cookie was tampered after attestation',
      };
    }

    try {
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
        attestation: payload.attestation,
        reason: signatureValid ? undefined : 'signature verification failed (envelope tampered)',
      };
    } catch (err) {
      return {
        valid: false,
        signatureValid: false,
        schemaValid: true,
        publicKey: payload.publicKey,
        attestation: payload.attestation,
        reason: 'signature verification threw: ' + (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  /** Look up a vault entry by handle ID; returns undefined when not found. */
  getByHandle(handleId: string): VaultEntryEnvelope | undefined {
    return this.state.entries.find(e => e.payload.handleId === handleId);
  }

  /** All sealed entries (read-only copy). */
  listEntries(): readonly VaultEntryEnvelope[] {
    return [...this.state.entries];
  }

  /** All audit refusals (read-only copy). */
  listRefusals(): readonly VaultRefusal[] {
    return [...this.state.refusals];
  }

  /** Replace internal state from a persisted snapshot. */
  async load(): Promise<void> {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = await readFile(this.persistPath, 'utf8');
      this.state = JSON.parse(raw) as VaultState;
    } catch {
      // Corrupt vault file — start fresh rather than crashing.
    }
  }

  /** Persist to disk if persistPath was configured. */
  private async maybePersist(): Promise<void> {
    if (!this.persistPath) return;
    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  /** Test helper: clear all state in memory. */
  clear(): void {
    this.state = { entries: [], refusals: [] };
  }

  /** Test helper: introspect the active witness key. */
  getWitnessKeyPublicHex(): string {
    return this.witnessKey.publicKeyHex;
  }
}

function isClean(result: ThreatScanResult): boolean {
  return result.threats.length === 0 && result.pii.length === 0;
}

// Re-exports — convenience for callers / tests.
export { generateWitnessKey, loadWitnessKey };
