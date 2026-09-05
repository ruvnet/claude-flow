import { generateKeyPairSync, sign } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  canonicalProductPlaneBytes,
  canonicalizeProductPlane,
  verifySignedProductActionEnvelope,
} from '../dist/policy/product-plane.js';

const digest = `sha256:${'a'.repeat(64)}`;
const envelope = {
  schemaVersion: 'cognitum.action.v1',
  eventId: 'benchmark-event',
  issuer: 'ruflo.policy',
  audience: 'meta-llm',
  subject: { namespace: 'firebase-subject', id: 'benchmark-user' },
  actor: { namespace: 'workload', id: 'spiffe://cognitum.example/agent/benchmark' },
  tenantRef: { namespace: 'meta-llm-account', id: 'benchmark-tenant' },
  action: 'inference.invoke',
  resourceRefs: ['meta-llm://models/cognitum-auto'],
  requestDigest: digest,
  idempotencyKey: 'benchmark-idempotency',
  correlationId: 'benchmark-correlation',
  authoritativeSource: {
    authority: 'meta-llm',
    tenantRef: { namespace: 'meta-llm-account', id: 'benchmark-tenant' },
    sourceType: 'meta-llm/inference',
    sourceId: 'benchmark-request',
    sourceVersion: '1',
    sourceDigest: digest,
  },
  sequence: '1',
  policyReceiptId: 'benchmark-policy-receipt',
  capabilityId: 'benchmark-capability',
  occurredAt: '2026-07-28T12:00:00.000Z',
  expiresAt: '2026-07-28T12:05:00.000Z',
  privacyClass: 'P1',
};

const keys = generateKeyPairSync('ed25519');
const signed = {
  envelope,
  algorithm: 'Ed25519',
  keyId: 'benchmark-key',
  signature: sign(null, canonicalProductPlaneBytes(envelope), keys.privateKey).toString('base64url'),
};
const options = {
  expectedAudience: 'meta-llm',
  expectedTenantRef: { namespace: 'meta-llm-account', id: 'benchmark-tenant' },
  now: () => Date.parse('2026-07-28T12:01:00.000Z'),
  maxAgeMs: 5 * 60_000,
  resolveKey: () => keys.publicKey,
  replayStore: { reserve: () => 'reserved' },
  policyVerifier: () => ({ allowed: true }),
  capabilityVerifier: () => ({ allowed: true }),
};

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

async function measure(name, batches, iterations, operation) {
  const samples = [];
  for (let batch = 0; batch < batches; batch++) {
    const started = performance.now();
    for (let iteration = 0; iteration < iterations; iteration++) await operation();
    samples.push(((performance.now() - started) * 1000) / iterations);
  }
  return {
    name,
    batches,
    iterationsPerBatch: iterations,
    latencyMicroseconds: {
      p50: percentile(samples, 0.50),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
    },
    throughputPerSecond: 1_000_000 / percentile(samples, 0.50),
  };
}

const results = [
  await measure('canonicalize-product-envelope', 20, 10_000, () => {
    canonicalizeProductPlane(envelope);
  }),
  await measure('verify-ed25519-product-envelope', 20, 500, async () => {
    const result = await verifySignedProductActionEnvelope(signed, options);
    if (!result.ok) throw new Error(`benchmark verification failed: ${result.code}`);
  }),
];

console.log(JSON.stringify({
  schema: 'cognitum.product-plane-benchmark/v1',
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  canonicalBytes: canonicalProductPlaneBytes(envelope).length,
  results,
}, null, 2));
