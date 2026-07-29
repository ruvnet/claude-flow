import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_ACTION_REQUIREMENTS,
  PRODUCT_ACTIONS,
  canonicalProductPlaneBytes,
  canonicalizeProductPlane,
  classifyProductAvailability,
  identityKey,
  isProductAction,
  sameIdentity,
  validateAuthoritativeReference,
  validateProductActionEnvelope,
  validateRuViewSemanticObservation,
  verifySignedProductActionEnvelope,
  type NamespacedIdentity,
  type ProductActionEnvelopeV1,
} from '../src/policy/product-plane.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'cognitum.action.v1',
    eventId: 'event-01',
    issuer: 'ruflo.policy',
    audience: 'meta-llm',
    subject: { namespace: 'firebase-subject', id: 'same-looking-id' },
    actor: { namespace: 'workload', id: 'spiffe://cognitum.example/agent/coder-1' },
    tenantRef: { namespace: 'meta-llm-account', id: 'tenant-01' },
    action: 'inference.invoke',
    resourceRefs: ['meta-llm://models/cognitum-auto'],
    requestDigest: DIGEST,
    idempotencyKey: 'idem-01',
    correlationId: 'corr-01',
    authoritativeSource: {
      authority: 'meta-llm',
      tenantRef: { namespace: 'meta-llm-account', id: 'tenant-01' },
      sourceType: 'meta-llm/inference',
      sourceId: 'request-01',
      sourceVersion: '1',
      sourceDigest: DIGEST,
    },
    sequence: '1',
    policyReceiptId: 'receipt-01',
    capabilityId: 'grant-01',
    occurredAt: '2026-07-28T12:00:00.000Z',
    expiresAt: '2026-07-28T12:05:00.000Z',
    privacyClass: 'P1',
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'ruview.semantic-observation.v1',
    spaceRef: { namespace: 'ruview-space', id: 'space-01' },
    observationType: 'occupancy.state',
    value: { occupied: true, zone: 'north', peopleEstimate: 2 },
    confidence: 0.93,
    uncertainty: 0.04,
    abstained: false,
    modelDigest: DIGEST,
    calibrationDigest: `sha256:${'b'.repeat(64)}`,
    hardwareRef: 'edge-node-01',
    privacyClass: 'P2',
    observedAt: '2026-07-28T12:00:00.000Z',
    expiresAt: '2026-07-28T12:00:10.000Z',
    sequence: '42',
    ...overrides,
  };
}

describe('product action vocabulary', () => {
  it('recognizes the complete closed vocabulary and rejects lookalikes', () => {
    expect(PRODUCT_ACTIONS).toHaveLength(31);
    for (const action of PRODUCT_ACTIONS) expect(isProductAction(action)).toBe(true);
    expect(isProductAction('cog.proposal.create ')).toBe(false);
    expect(isProductAction('ruview.raw.read')).toBe(false);
    expect(isProductAction('deployment.promote')).toBe(false);
    expect(isProductAction('memory.promote')).toBe(false);
    expect(isProductAction('policy.promote')).toBe(false);
  });

  it('makes self-learning actions narrow and validated memory commits content-bound', () => {
    expect(PRODUCT_ACTION_REQUIREMENTS['memory.recall']).toEqual(expect.objectContaining({
      requestDigest: true,
      capability: true,
      idempotencyKey: false,
    }));
    expect(PRODUCT_ACTION_REQUIREMENTS['memory.commit-validated']).toEqual({
      requestDigest: true,
      contentDigest: true,
      idempotencyKey: true,
      expiry: true,
      capability: true,
      validationReceipt: true,
    });

    const base = envelope({
      audience: 'ruflo.memory',
      action: 'memory.commit-validated',
      authoritativeSource: {
        authority: 'ruflo.memory',
        tenantRef: { namespace: 'meta-llm-account', id: 'tenant-01' },
        sourceType: 'ruflo.memory/validated-memory',
        sourceId: 'memory-01',
        sourceVersion: '1',
        sourceDigest: DIGEST,
      },
    });
    const unbound = validateProductActionEnvelope(base);
    expect(unbound.ok).toBe(false);
    if (!unbound.ok) {
      expect(unbound.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.contentDigest', code: 'missing' }),
        expect.objectContaining({ path: '$.validationReceiptId', code: 'missing' }),
      ]));
    }
    expect(validateProductActionEnvelope({
      ...base,
      contentDigest: `sha256:${'c'.repeat(64)}`,
      validationReceiptId: 'validation-01',
    }).ok).toBe(true);
  });
});

describe('identity namespace separation', () => {
  it('does not equate equal-looking identifiers from different namespaces', () => {
    const firebase: NamespacedIdentity = { namespace: 'firebase-subject', id: 'same-looking-id' };
    const meta: NamespacedIdentity = { namespace: 'meta-llm-account', id: 'same-looking-id' };
    expect(identityKey(firebase)).not.toBe(identityKey(meta));
    expect(sameIdentity(firebase, meta)).toBe(false);
    expect(sameIdentity(firebase, { ...firebase })).toBe(true);
  });

  it('fails closed when a subject is unqualified or uses an unknown namespace', () => {
    const unqualified = validateProductActionEnvelope(envelope({ subject: 'same-looking-id' }));
    expect(unqualified.ok).toBe(false);
    if (!unqualified.ok) expect(unqualified.issues).toContainEqual(expect.objectContaining({
      path: '$.subject',
      code: 'invalid_type',
    }));

    const unknown = validateProductActionEnvelope(envelope({
      subject: { namespace: 'firebase', id: 'same-looking-id' },
    }));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues).toContainEqual(expect.objectContaining({
      path: '$.subject.namespace',
      code: 'identity_namespace_required',
    }));
  });
});

describe('authoritative references', () => {
  it('accepts an authority-owned, tenant-bound source', () => {
    const result = validateAuthoritativeReference(envelope().authoritativeSource, {
      action: 'inference.invoke',
      tenantRef: { namespace: 'meta-llm-account', id: 'tenant-01' },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects authority confusion, digest ambiguity, and tenant mismatch', () => {
    const confused = validateProductActionEnvelope(envelope({
      authoritativeSource: {
        authority: 'comms',
        tenantRef: { namespace: 'meta-llm-account', id: 'tenant-02' },
        sourceType: 'meta-llm/inference',
        sourceId: 'request-01',
        sourceVersion: '1',
        sourceDigest: 'sha256:not-a-digest',
      },
    }));
    expect(confused.ok).toBe(false);
    if (!confused.ok) {
      expect(confused.issues.map(({ code }) => code)).toContain('invalid_authority');
      expect(confused.issues.map(({ code }) => code)).toContain('tenant_mismatch');
      expect(confused.issues).toContainEqual(expect.objectContaining({
        path: '$.authoritativeSource.sourceDigest',
        code: 'invalid_format',
      }));
    }
  });
});

describe('product action envelope structural validation', () => {
  it('returns a typed value for a complete v1 envelope', () => {
    const result = validateProductActionEnvelope(envelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schemaVersion).toBe('cognitum.action.v1');
      expect(result.value.action).toBe('inference.invoke');
      expect(result.value.authoritativeSource.sourceId).toBe('request-01');
    }
  });

  it('rejects unknown versions, actions, fields, and non-canonical time', () => {
    const result = validateProductActionEnvelope(envelope({
      schemaVersion: 'cognitum.action.v2',
      action: 'inference.invoke.anything',
      occurredAt: '2026-07-28T12:00:00Z',
      injectedGrant: true,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.schemaVersion', code: 'unsupported_value' }),
        expect.objectContaining({ path: '$.action', code: 'unsupported_value' }),
        expect.objectContaining({ path: '$.occurredAt', code: 'invalid_format' }),
        expect.objectContaining({ path: '$.injectedGrant', code: 'unknown_field' }),
      ]));
    }
  });

  it('requires an action-owned source and exact source tenant', () => {
    const result = validateProductActionEnvelope(envelope({
      action: 'cog.deploy',
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({
      path: '$.authoritativeSource.authority',
      code: 'invalid_authority',
    }));
  });

  it('enforces the P2/P3 ceiling for RuView semantic events', () => {
    const base = envelope({
      audience: 'ruview.edge',
      tenantRef: { namespace: 'ruview-space', id: 'space-01' },
      action: 'ruview.semantic.publish',
      authoritativeSource: {
        authority: 'ruview.edge',
        tenantRef: { namespace: 'ruview-space', id: 'space-01' },
        sourceType: 'ruview.edge/semantic-observation',
        sourceId: 'observation-01',
        sourceVersion: '1',
        sourceDigest: DIGEST,
      },
    });
    expect(validateProductActionEnvelope({ ...base, privacyClass: 'P2' }).ok).toBe(true);
    expect(validateProductActionEnvelope({ ...base, privacyClass: 'P3' }).ok).toBe(true);
    const exposed = validateProductActionEnvelope({ ...base, privacyClass: 'P1' });
    expect(exposed.ok).toBe(false);
    if (!exposed.ok) expect(exposed.issues).toContainEqual(expect.objectContaining({
      path: '$.privacyClass',
      code: 'privacy_ceiling_exceeded',
    }));
  });
});

describe('RuView privacy-minimized semantic observations', () => {
  it('accepts bounded P2/P3 scalar semantic records', () => {
    expect(validateRuViewSemanticObservation(observation()).ok).toBe(true);
    expect(validateRuViewSemanticObservation(observation({
      observationType: 'vital.summary',
      privacyClass: 'P3',
      value: { state: 'normal', anomaly: false },
    })).ok).toBe(true);
  });

  it('rejects unknown observation types, unknown fields, and binary-like values', () => {
    const privacy = validateRuViewSemanticObservation(observation({
      privacyClass: 'P1',
      observationType: 'raw.csi.frame',
      value: { csi_samples: [1, 2, 3] },
    }));
    expect(privacy.ok).toBe(false);
    if (!privacy.ok) {
      expect(privacy.issues.map(({ code }) => code)).toContain('privacy_ceiling_exceeded');
      expect(privacy.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.observationType' }),
        expect.objectContaining({ path: '$.privacyClass' }),
      ]));
    }
    const unknownField = validateRuViewSemanticObservation(observation({
      value: { occupied: true, csi_samples: 'AAAA' },
    }));
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) expect(unknownField.issues).toContainEqual(expect.objectContaining({
      path: '$.value.csi_samples',
      code: 'unknown_field',
    }));
    const encoded = validateRuViewSemanticObservation(observation({
      value: { occupied: true, zone: 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB' },
    }));
    expect(encoded.ok).toBe(false);
    if (!encoded.ok) expect(encoded.issues).toContainEqual(expect.objectContaining({
      path: '$.value.zone',
      code: 'privacy_ceiling_exceeded',
    }));
    expect(validateRuViewSemanticObservation(observation({
      value: new Uint8Array([1, 2, 3]),
    })).ok).toBe(false);
  });

  it('rejects wrong space namespaces, invalid confidence, expiry, and sequence', () => {
    const result = validateRuViewSemanticObservation(observation({
      spaceRef: { namespace: 'cognitum-tenant', id: 'space-01' },
      confidence: Number.NaN,
      observedAt: '2026-07-28T12:00:10.000Z',
      expiresAt: '2026-07-28T12:00:00.000Z',
      sequence: '-1',
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.spaceRef.namespace' }),
        expect.objectContaining({ path: '$.confidence' }),
        expect.objectContaining({ path: '$.expiresAt' }),
        expect.objectContaining({ path: '$.sequence' }),
      ]));
    }
  });
});

describe('availability dimensions', () => {
  it('does not infer configuration or health from authorization', () => {
    expect(classifyProductAvailability({
      identity: 'verified',
      configured: 'unknown',
      reachable: 'unknown',
      healthy: 'unknown',
      authorized: 'yes',
    })).toBe('degraded');
    expect(classifyProductAvailability({
      identity: 'verified',
      configured: 'yes',
      reachable: 'no',
      healthy: 'unknown',
      authorized: 'yes',
    })).toBe('unavailable');
    expect(classifyProductAvailability({
      identity: 'verified',
      configured: 'yes',
      reachable: 'yes',
      healthy: 'yes',
      authorized: 'yes',
    })).toBe('available');
    expect(classifyProductAvailability({
      identity: 'verified',
      configured: 'yes',
      reachable: 'yes',
      healthy: 'yes',
      authorized: 'no',
    })).toBe('blocked');
  });
});

describe('strict product-plane canonicalization', () => {
  it('recursively sorts keys and uses canonical ECMAScript number rendering', () => {
    expect(canonicalizeProductPlane({
      z: -0,
      a: { exponent: 1e30, fraction: 0.002, integer: 2 },
    })).toBe('{"a":{"exponent":1e+30,"fraction":0.002,"integer":2},"z":0}');
    expect(new TextDecoder().decode(canonicalProductPlaneBytes({ b: 2, a: 1 })))
      .toBe('{"a":1,"b":2}');
  });

  it('rejects invalid JCS numbers, invalid Unicode, sparse arrays, and undefined', () => {
    expect(() => canonicalizeProductPlane(Number.POSITIVE_INFINITY)).toThrow('non-finite');
    expect(() => canonicalizeProductPlane(Number.NaN)).toThrow('non-finite');
    expect(() => canonicalizeProductPlane('\ud800')).toThrow('unpaired high surrogate');
    expect(() => canonicalizeProductPlane(new Array(1))).toThrow('sparse arrays');
    expect(() => canonicalizeProductPlane({ omitted: undefined })).toThrow('undefined');
  });
});

describe('signed product action envelope verifier', () => {
  const keys = generateKeyPairSync('ed25519');
  const now = Date.parse('2026-07-28T12:01:00.000Z');

  function signed(payload: Record<string, unknown> = envelope()): Record<string, unknown> {
    return {
      envelope: payload,
      algorithm: 'Ed25519',
      keyId: 'issuer-key-01',
      signature: sign(null, canonicalProductPlaneBytes(payload), keys.privateKey).toString('base64url'),
    };
  }

  function options(
    reservation: 'reserved' | 'replay' | 'conflict' = 'reserved',
  ) {
    return {
      expectedAudience: 'meta-llm' as const,
      expectedTenantRef: { namespace: 'meta-llm-account' as const, id: 'tenant-01' },
      now: () => now,
      maxAgeMs: 5 * 60_000,
      resolveKey: (issuer: string, keyId: string) => (
        issuer === 'ruflo.policy' && keyId === 'issuer-key-01' ? keys.publicKey : undefined
      ),
      replayStore: {
        reserve: () => reservation,
      },
      policyVerifier: () => ({ allowed: true }),
      capabilityVerifier: () => ({ allowed: true }),
    };
  }

  it('accepts only after signature, audience, tenant, policy, capability, and replay reservation', async () => {
    const result = await verifySignedProductActionEnvelope(signed(), options());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.action).toBe('inference.invoke');
      expect(result.canonicalDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.replayKey).toContain('inference.invoke');
    }
  });

  it('supports an injected signature verifier without treating authorization as health', async () => {
    let observedBytes = '';
    const custom = options();
    delete (custom as { resolveKey?: unknown }).resolveKey;
    const result = await verifySignedProductActionEnvelope(signed(), {
      ...custom,
      verifySignature: ({ canonicalBytes }) => {
        observedBytes = new TextDecoder().decode(canonicalBytes);
        return true;
      },
    });
    expect(result.ok).toBe(true);
    expect(observedBytes).toBe(canonicalizeProductPlane(envelope()));
  });

  it('rejects signature tampering, wrong audience, wrong tenant, and missing verifier config', async () => {
    const tampered = signed();
    (tampered.envelope as Record<string, unknown>).correlationId = 'tampered';
    expect(await verifySignedProductActionEnvelope(tampered, options()))
      .toEqual(expect.objectContaining({ ok: false, code: 'signature_invalid' }));

    expect(await verifySignedProductActionEnvelope(signed(envelope({ audience: 'comms' })), options()))
      .toEqual(expect.objectContaining({ ok: false, code: 'audience_mismatch' }));

    expect(await verifySignedProductActionEnvelope(signed(), {
      ...options(),
      expectedTenantRef: { namespace: 'meta-llm-account', id: 'another-tenant' },
    })).toEqual(expect.objectContaining({ ok: false, code: 'tenant_mismatch' }));

    const noSignatureVerifier = options();
    delete (noSignatureVerifier as { resolveKey?: unknown }).resolveKey;
    expect(await verifySignedProductActionEnvelope(signed(), noSignatureVerifier))
      .toEqual(expect.objectContaining({ ok: false, code: 'signature_configuration_missing' }));
  });

  it('rejects stale, future, expired, replayed, and conflicting deliveries', async () => {
    expect(await verifySignedProductActionEnvelope(signed(envelope({
      occurredAt: '2026-07-28T11:50:00.000Z',
      expiresAt: '2026-07-28T12:05:00.000Z',
    })), options())).toEqual(expect.objectContaining({ ok: false, code: 'stale' }));

    expect(await verifySignedProductActionEnvelope(signed(envelope({
      occurredAt: '2026-07-28T12:02:00.000Z',
      expiresAt: '2026-07-28T12:05:00.000Z',
    })), options())).toEqual(expect.objectContaining({ ok: false, code: 'not_yet_valid' }));

    expect(await verifySignedProductActionEnvelope(signed(envelope({
      expiresAt: '2026-07-28T12:00:30.000Z',
    })), options())).toEqual(expect.objectContaining({ ok: false, code: 'expired' }));

    expect(await verifySignedProductActionEnvelope(signed(), options('replay')))
      .toEqual(expect.objectContaining({ ok: false, code: 'replay_detected' }));
    expect(await verifySignedProductActionEnvelope(signed(), options('conflict')))
      .toEqual(expect.objectContaining({ ok: false, code: 'idempotency_conflict' }));
  });

  it('fails closed on local policy, capability, key, and callback failures', async () => {
    expect(await verifySignedProductActionEnvelope(signed(), {
      ...options(),
      policyVerifier: () => ({ allowed: false, reason: 'tenant policy denied' }),
    })).toEqual(expect.objectContaining({ ok: false, code: 'policy_denied', reason: 'tenant policy denied' }));

    expect(await verifySignedProductActionEnvelope(signed(), {
      ...options(),
      capabilityVerifier: () => false,
    })).toEqual(expect.objectContaining({ ok: false, code: 'capability_denied' }));

    expect(await verifySignedProductActionEnvelope(signed(), {
      ...options(),
      resolveKey: () => undefined,
    })).toEqual(expect.objectContaining({ ok: false, code: 'key_not_found' }));

    expect(await verifySignedProductActionEnvelope(signed(), {
      ...options(),
      policyVerifier: () => {
        throw new Error('store unavailable');
      },
    })).toEqual(expect.objectContaining({ ok: false, code: 'verification_error' }));
  });

  it('requires exact timestamp round trips before signature evaluation', async () => {
    const invalidDate = envelope({
      occurredAt: '2026-02-30T12:00:00.000Z',
      expiresAt: '2026-07-28T12:05:00.000Z',
    });
    const result = await verifySignedProductActionEnvelope(signed(invalidDate), options());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_envelope' }));
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({
      path: '$.occurredAt',
      code: 'invalid_format',
    }));
  });
});
