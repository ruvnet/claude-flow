/**
 * @claude-flow/browser - Session Capsule + Risk Classifier Tests (ADR-122 Phase 6)
 *
 * Acceptance criteria covered:
 *  - Capsule with PII in inline state is refused at creation
 *  - Clean capsule verifies, mounts, and increments replays
 *  - Capsule with maxReplays cap rejects further mounts past the limit
 *  - Expired capsule fails verification
 *  - Trust-list filter accepts/rejects by signer
 *  - Mount enforces allowedOrigins + allowedTaskClasses
 *  - Tampered capsule fails signature verification
 *  - RiskClassifier produces correct class for representative actions
 */

import { describe, it, expect } from 'vitest';
import { SessionCapsuleService, RiskClassifier } from '../src/application/session-capsule-service.js';
import { generateWitnessKey } from '../src/infrastructure/witness-signer.js';
import type { SessionCapsuleEnvelope } from '../src/domain/session-capsule.js';

const cleanState = {
  cookies: [{ name: 'sid', value: 'opaque-token-xyz', domain: 'example.com' }],
  localStorage: { theme: 'dark' },
  sessionStorage: {},
  indexedDbMeta: [],
};

const piiState = {
  cookies: [{ name: 'sid', value: 'name=John Doe ssn=123-45-6789', domain: 'example.com' }],
  localStorage: {},
  sessionStorage: {},
  indexedDbMeta: [],
};

describe('SessionCapsuleService', () => {
  describe('create', () => {
    it('seals a clean capsule with verifiable signature', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 'tenant-1',
        ownerId: 'owner-a',
        origins: [{ origin: 'https://example.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState,
        consentStatement: 'I consent to reuse this session for authenticated reads of example.com',
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.envelope.payload.capsuleId).toMatch(/^cap-/);
      expect(result.envelope.payload.replays).toBe(0);
      expect(result.envelope.payload.witnessChainHead).toMatch(/^[0-9a-f]{64}$/);
      const verification = svc.verify(result.envelope);
      expect(verification.valid).toBe(true);
      expect(verification.withinPolicy).toBe(true);
    });

    it('refuses a capsule whose inline state contains PII', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 'tenant-1',
        ownerId: 'owner-a',
        origins: [{ origin: 'https://example.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: piiState,
        consentStatement: 'test',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.piiCount).toBeGreaterThan(0);
    });

    it('defaults reusePolicy.allowedTaskClasses to safe defaults', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 'tenant-1', ownerId: 'o', origins: [{ origin: 'https://x.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok',
      });
      if (!result.success) throw new Error('expected success');
      expect(result.envelope.payload.reusePolicy.allowedTaskClasses).toContain('read-only');
      expect(result.envelope.payload.reusePolicy.allowedTaskClasses).not.toContain('destructive');
    });
  });

  describe('verify', () => {
    it('rejects expired capsules', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 't', ownerId: 'o',
        origins: [{ origin: 'https://x.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok', ttlMs: 100,
      });
      if (!result.success) throw new Error('expected success');
      const verification = svc.verify(result.envelope, { now: new Date(Date.now() + 60_000) });
      expect(verification.valid).toBe(false);
      expect(verification.reason).toMatch(/expired/);
    });

    it('rejects tampered capsules', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 't', ownerId: 'o',
        origins: [{ origin: 'https://x.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok',
      });
      if (!result.success) throw new Error('expected success');
      const forged: SessionCapsuleEnvelope = JSON.parse(JSON.stringify(result.envelope));
      forged.payload.reusePolicy.allowCrossInstallation = true; // escalate
      const verification = svc.verify(forged);
      expect(verification.valid).toBe(false);
      expect(verification.signatureValid).toBe(false);
    });

    it('rejects untrusted signers via trust list', async () => {
      const stranger = new SessionCapsuleService({ witnessKey: generateWitnessKey() });
      const result = await stranger.create({
        tenantId: 't', ownerId: 'o',
        origins: [{ origin: 'https://x.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok',
      });
      if (!result.success) throw new Error('expected success');
      const ourVault = new SessionCapsuleService();
      const verification = ourVault.verify(result.envelope, { trustedPublicKeys: ['00'.repeat(32)] });
      expect(verification.valid).toBe(false);
      expect(verification.reason).toMatch(/not in trusted list/);
    });
  });

  describe('mount', () => {
    it('increments replays and rolls the chain head', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 't', ownerId: 'o',
        origins: [{ origin: 'https://x.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok',
      });
      if (!result.success) throw new Error('expected success');
      const before = result.envelope.payload.witnessChainHead;
      const mounted = await svc.mount(result.capsuleId);
      expect(mounted.success).toBe(true);
      if (!mounted.success) return;
      expect(mounted.envelope.payload.replays).toBe(1);
      expect(mounted.envelope.payload.witnessChainHead).not.toBe(before);
    });

    it('rejects mounts past maxReplays', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 't', ownerId: 'o',
        origins: [{ origin: 'https://x.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok',
        reusePolicy: { maxReplays: 2 },
      });
      if (!result.success) throw new Error('expected success');
      const m1 = await svc.mount(result.capsuleId);
      expect(m1.success).toBe(true);
      const m2 = await svc.mount(result.capsuleId);
      expect(m2.success).toBe(true);
      const m3 = await svc.mount(result.capsuleId);
      expect(m3.success).toBe(false);
      if (m3.success) return;
      expect(m3.reason).toMatch(/maxReplays|replay count/);
    });

    it('rejects mount on origin not in allowedOrigins', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 't', ownerId: 'o',
        origins: [{ origin: 'https://example.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok',
        reusePolicy: { allowedOrigins: ['https://example.com'] },
      });
      if (!result.success) throw new Error('expected success');
      const mounted = await svc.mount(result.capsuleId, { targetOrigin: 'https://malicious.com' });
      expect(mounted.success).toBe(false);
      if (mounted.success) return;
      expect(mounted.reason).toMatch(/origin/);
    });

    it('rejects mount with a task class not in allowedTaskClasses', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 't', ownerId: 'o',
        origins: [{ origin: 'https://x.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok',
        reusePolicy: { allowedTaskClasses: ['read-only'] },
      });
      if (!result.success) throw new Error('expected success');
      const mounted = await svc.mount(result.capsuleId, { taskClass: 'destructive' });
      expect(mounted.success).toBe(false);
      if (mounted.success) return;
      expect(mounted.reason).toMatch(/task class/);
    });
  });

  describe('revoke', () => {
    it('drops the capsule from the registry', async () => {
      const svc = new SessionCapsuleService();
      const result = await svc.create({
        tenantId: 't', ownerId: 'o',
        origins: [{ origin: 'https://x.com', requireSecure: true, requireHttpOnly: false }],
        inlineState: cleanState, consentStatement: 'ok',
      });
      if (!result.success) throw new Error('expected success');
      expect(svc.revoke(result.capsuleId)).toBe(true);
      expect(svc.get(result.capsuleId)).toBeUndefined();
      const remount = await svc.mount(result.capsuleId);
      expect(remount.success).toBe(false);
    });
  });
});

describe('RiskClassifier', () => {
  const classifier = new RiskClassifier();

  it('classifies destructive verbs as Class 7', () => {
    expect(classifier.classify({ action: 'click', target: 'Delete account', goal: 'delete user' }).class).toBe('destructive');
  });

  it('classifies financial actions as Class 5', () => {
    expect(classifier.classify({ action: 'click', target: 'Pay invoice', goal: 'submit payment' }).class).toBe('financial');
  });

  it('classifies account mutation as Class 6', () => {
    expect(classifier.classify({ action: 'fill', target: 'New password', goal: 'change password' }).class).toBe('account-mutation');
  });

  it('classifies submit clicks as Class 4 external submission', () => {
    expect(classifier.classify({ action: 'click', target: 'Submit form', goal: 'send' }).class).toBe('external-submission');
  });

  it('classifies fill/type as Class 3 draft write', () => {
    expect(classifier.classify({ action: 'fill', target: '@e1', goal: 'enter email' }).class).toBe('draft-write');
  });

  it('classifies dashboard reads as Class 2', () => {
    expect(classifier.classify({ action: 'open', target: '/dashboard', goal: 'view dashboard' }).class).toBe('authenticated-read');
  });

  it('defaults to Class 1 read-only', () => {
    expect(classifier.classify({ action: 'snapshot' }).class).toBe('read-only');
  });

  it('blocks autonomous execution for Class 4+', () => {
    expect(classifier.isAutonomous(classifier.classify({ action: 'click', target: 'Submit', goal: 'submit form' }))).toBe(false);
    expect(classifier.isAutonomous(classifier.classify({ action: 'click', target: 'Pay', goal: 'pay invoice' }))).toBe(false);
  });

  it('allows autonomous execution for Class 1-3', () => {
    expect(classifier.isAutonomous(classifier.classify({ action: 'snapshot' }))).toBe(true);
    expect(classifier.isAutonomous(classifier.classify({ action: 'fill', target: '@e1' }))).toBe(true);
  });
});
