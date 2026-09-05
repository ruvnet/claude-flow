/**
 * @claude-flow/browser - Cookie Vault Tests (ADR-122 Phase 3)
 *
 * Acceptance criteria covered:
 *  - Cookie containing PII (AIDefence-flagged) never persists; audit event written
 *  - Sealed envelope verifyAttestation() round-trips for clean cookies
 *  - Tampered envelope (replaced cookie value) fails verification
 *  - Trust-list filtering accepts/rejects by signer public key
 *  - clean=false attestations are refused (defense in depth)
 *  - Handle lookup works after sealing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CookieVaultService,
} from '../src/application/cookie-vault-service.js';
import { generateWitnessKey, sha256Hex } from '../src/infrastructure/witness-signer.js';
import type { VaultEntryEnvelope, CookieValue } from '../src/domain/cookie-vault.js';

const CLEAN_COOKIE: CookieValue = {
  name: 'sid',
  value: 'opaque-session-token-XK29q8vN1uYJ',
  domain: 'example.com',
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
};

const PII_COOKIE: CookieValue = {
  name: 'user-info',
  value: 'name=John Doe email=john.doe@example.com ssn=123-45-6789',
  domain: 'example.com',
};

describe('CookieVaultService', () => {
  let vault: CookieVaultService;

  beforeEach(() => {
    vault = new CookieVaultService({ projectId: 'test-project' });
  });

  describe('clean cookie store', () => {
    it('seals a clean cookie into a verifiable envelope', async () => {
      const result = await vault.store({ cookie: CLEAN_COOKIE, origin: 'https://example.com' });
      expect(result.success).toBe(true);
      if (!result.success) return; // narrow
      expect(result.handleId).toMatch(/^vh-/);
      expect(result.envelope.payload.cookie.value).toBe(CLEAN_COOKIE.value);
      expect(result.envelope.payload.attestation.clean).toBe(true);
      expect(result.envelope.payload.attestation.contentHash).toBe(sha256Hex(CLEAN_COOKIE.value));
    });

    it('verifyAttestation succeeds for a freshly sealed clean cookie', async () => {
      const result = await vault.store({ cookie: CLEAN_COOKIE });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const verification = vault.verifyAttestation(result.envelope);
      expect(verification.valid).toBe(true);
      expect(verification.signatureValid).toBe(true);
      expect(verification.attestation?.clean).toBe(true);
    });

    it('round-trips through getByHandle()', async () => {
      const result = await vault.store({ cookie: CLEAN_COOKIE });
      if (!result.success) throw new Error('expected success');
      const retrieved = vault.getByHandle(result.handleId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.payload.cookie.name).toBe(CLEAN_COOKIE.name);
    });
  });

  describe('PII refusal', () => {
    it('refuses a cookie containing PII and writes a refusal audit', async () => {
      const result = await vault.store({ cookie: PII_COOKIE });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.refusal.cookieName).toBe('user-info');
      expect(result.refusal.piiCount).toBeGreaterThan(0);
      // Audit record visible to consumers
      expect(vault.listRefusals()).toHaveLength(1);
    });

    it('does NOT persist a PII cookie to the entries list', async () => {
      await vault.store({ cookie: PII_COOKIE });
      expect(vault.listEntries()).toHaveLength(0);
    });

    it('records the attempted cookie name + reason in the refusal', async () => {
      const result = await vault.store({ cookie: PII_COOKIE });
      if (result.success) return;
      expect(result.refusal.reason).toMatch(/PII/);
    });
  });

  describe('tamper detection', () => {
    it('rejects an envelope where the cookie value was replaced after sealing', async () => {
      const result = await vault.store({ cookie: CLEAN_COOKIE });
      if (!result.success) throw new Error('expected success');

      // Attacker swaps the value but forgets to update the hash
      const forged: VaultEntryEnvelope = JSON.parse(JSON.stringify(result.envelope));
      forged.payload.cookie.value = 'stolen-session-token-xxxxx';

      const verification = vault.verifyAttestation(forged);
      expect(verification.valid).toBe(false);
      expect(verification.reason).toMatch(/(hash mismatch|tampered|signature verification failed)/i);
    });

    it('rejects an envelope where the hash was updated but signature was not', async () => {
      const result = await vault.store({ cookie: CLEAN_COOKIE });
      if (!result.success) throw new Error('expected success');

      // Attacker updates both value and hash but can't re-sign
      const forged: VaultEntryEnvelope = JSON.parse(JSON.stringify(result.envelope));
      forged.payload.cookie.value = 'stolen';
      forged.payload.attestation.contentHash = sha256Hex('stolen');

      const verification = vault.verifyAttestation(forged);
      expect(verification.valid).toBe(false);
      expect(verification.reason).toMatch(/signature verification failed/i);
    });

    it('rejects schema-invalid envelopes', () => {
      const verification = vault.verifyAttestation({ payload: 'wrong', signature: 'x', algorithm: 'ed25519' });
      expect(verification.valid).toBe(false);
      expect(verification.schemaValid).toBe(false);
    });

    it('refuses attestation with clean=false even when signature is valid (defense in depth)', async () => {
      // Hand-craft an envelope with clean=false by signing it with a fresh key.
      // The vault would never produce this, but a hostile peer might.
      const key = generateWitnessKey();
      const adverseVault = new CookieVaultService({ witnessKey: key });

      // Seal a clean cookie first to learn the canonical shape...
      const ok = await adverseVault.store({ cookie: CLEAN_COOKIE });
      if (!ok.success) throw new Error('expected clean store to succeed');
      const original = ok.envelope;

      // Flip clean=false and resign with the same key.
      const { sign } = await import('node:crypto');
      const { canonicalJSON } = await import('../src/infrastructure/witness-signer.js');
      const tampered: VaultEntryEnvelope = JSON.parse(JSON.stringify(original));
      tampered.payload.attestation.clean = false;
      const canonical = canonicalJSON(tampered.payload);
      tampered.signature = sign(null, Buffer.from(canonical, 'utf8'), key.privateKey).toString('hex');

      const verification = adverseVault.verifyAttestation(tampered);
      expect(verification.valid).toBe(false);
      expect(verification.reason).toMatch(/clean=false/);
    });
  });

  describe('trust list', () => {
    it('rejects envelopes from untrusted signers', async () => {
      const stranger = new CookieVaultService({ witnessKey: generateWitnessKey() });
      const ok = await stranger.store({ cookie: CLEAN_COOKIE });
      if (!ok.success) throw new Error('expected success');
      const verification = vault.verifyAttestation(ok.envelope, { trustedPublicKeys: ['00'.repeat(32)] });
      expect(verification.valid).toBe(false);
      expect(verification.reason).toMatch(/not in trusted list/);
    });

    it('accepts envelopes from trusted signers', async () => {
      const friend = new CookieVaultService({ witnessKey: generateWitnessKey() });
      const ok = await friend.store({ cookie: CLEAN_COOKIE });
      if (!ok.success) throw new Error('expected success');
      const verification = vault.verifyAttestation(ok.envelope, {
        trustedPublicKeys: [friend.getWitnessKeyPublicHex()],
      });
      expect(verification.valid).toBe(true);
    });
  });

  describe('audit record', () => {
    it('refusal includes pii + threat counts', async () => {
      const result = await vault.store({ cookie: PII_COOKIE });
      if (result.success) return;
      expect(result.refusal.piiCount).toBeGreaterThan(0);
      expect(result.refusal.threatCount).toBeGreaterThanOrEqual(0);
    });

    it('refusal records origin when provided', async () => {
      const result = await vault.store({ cookie: PII_COOKIE, origin: 'https://example.com' });
      if (result.success) return;
      expect(result.refusal.origin).toBe('https://example.com');
    });
  });
});
