import { performance } from 'node:perf_hooks';
import { AgenticPolicyEngine, evaluatePolicy } from '../dist/policy/index.js';

const iterations = Number(process.env.POLICY_BENCH_ITERATIONS ?? 50_000);
const request = {
  identity: { id: 'agent:benchmark', type: 'agent', roles: ['developer'] },
  action: { type: 'code.write', resource: 'src/app.ts', environment: 'development' },
  context: {
    envelope: {
      actions: ['code.*'],
      resources: ['src/*'],
      maxConcurrency: 4,
      network: false,
      destructive: false,
    },
  },
};
const rules = [
  { id: 'allow-dev-code', effect: 'allow', actions: ['code.*'], roles: ['developer'], environments: ['development'] },
  { id: 'deny-prod-write', effect: 'deny', actions: ['code.write'], environments: ['production'], priority: 100 },
];

const pureStarted = performance.now();
for (let i = 0; i < iterations; i++) evaluatePolicy(request, rules, 'enforce');
const pureMs = performance.now() - pureStarted;

const receiptIterations = Math.min(iterations, 5_000);
const engine = new AgenticPolicyEngine({ mode: 'enforce', rules });
const receiptStarted = performance.now();
for (let i = 0; i < receiptIterations; i++) engine.evaluate({ ...request, requestId: `bench-${i}` });
const receiptMs = performance.now() - receiptStarted;

const report = {
  schema: 'ruflo.policy-benchmark/v1',
  pure: {
    iterations,
    durationMs: Number(pureMs.toFixed(3)),
    opsPerSecond: Math.round(iterations / (pureMs / 1_000)),
    microsPerDecision: Number(((pureMs * 1_000) / iterations).toFixed(3)),
  },
  withReceipts: {
    iterations: receiptIterations,
    durationMs: Number(receiptMs.toFixed(3)),
    opsPerSecond: Math.round(receiptIterations / (receiptMs / 1_000)),
    microsPerDecision: Number(((receiptMs * 1_000) / receiptIterations).toFixed(3)),
    ledgerValid: engine.verifyLedger().valid,
  },
};

console.log(JSON.stringify(report, null, 2));
if (!report.withReceipts.ledgerValid) process.exitCode = 1;
