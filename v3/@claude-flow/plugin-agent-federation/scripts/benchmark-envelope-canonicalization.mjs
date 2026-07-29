import { performance } from 'node:perf_hooks';
import { canonicalizeEnvelopeForVerify } from '../dist/application/inbound-dispatcher.js';

const iterations = Number.parseInt(process.env.BENCH_ITERATIONS ?? '50000', 10);
if (!Number.isSafeInteger(iterations) || iterations < 1000) {
  throw new Error('BENCH_ITERATIONS must be a safe integer >= 1000');
}

const payload = {
  claim: {
    claimId: 'claim-136',
    owner: 'spiffe://cognitum.one/agent/coder-7',
    epoch: '42',
    resource: 'ruflo://repo/ruvnet/ruflo/issues/136',
  },
  evidence: Array.from({ length: 8 }, (_, index) => ({
    id: `ev-${index}`,
    digest: `sha256:${String(index).padStart(64, '0')}`,
    provenance: 'system_observation',
  })),
  limits: {
    actions: ['work.handoff'],
    resources: ['ruflo://repo/ruvnet/ruflo/issues/136'],
    maxConcurrency: 1,
  },
};

const message = {
  id: 'message-136',
  type: 'claim-event',
  payload,
  metadata: {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sessionId: 'session-1',
    signatureVersion: 'jcs-v1',
    grant: { id: 'grant-1', actions: ['work.handoff'] },
  },
};

for (let index = 0; index < 1000; index += 1) {
  canonicalizeEnvelopeForVerify(message);
}

const samples = [];
let bytes = 0;
for (let batch = 0; batch < 30; batch += 1) {
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    bytes += canonicalizeEnvelopeForVerify(message).length;
  }
  samples.push((performance.now() - started) / iterations);
}

samples.sort((a, b) => a - b);
const percentile = (value) => samples[Math.min(samples.length - 1, Math.floor(samples.length * value))];
const result = {
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  batches: samples.length,
  iterationsPerBatch: iterations,
  payloadBytes: Buffer.byteLength(JSON.stringify(message)),
  canonicalBytes: bytes / (samples.length * iterations),
  latencyMicroseconds: {
    p50: percentile(0.5) * 1000,
    p95: percentile(0.95) * 1000,
    p99: percentile(0.99) * 1000,
  },
  throughputPerSecond: 1000 / percentile(0.5),
};

console.log(JSON.stringify(result, null, 2));
