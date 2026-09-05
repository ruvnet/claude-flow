#!/usr/bin/env node
/**
 * @claude-flow/browser - Substrate benchmarks (ADR-122 Phase 7)
 *
 * Measures throughput of the substrate primitives:
 *   - sign/verify trajectories (Phase 1)
 *   - report break + annotate snapshot (Phase 2)
 *   - cookie vault store + verify (Phase 3)
 *   - production-aware UCT scoring (Phase 7)
 *   - workflow compile (Phase 7)
 *
 * Result: published as a markdown table in the announcement gist.
 *
 * Usage: node scripts/benchmark-substrate.mjs
 */

import {
  sealTrajectory,
  verifySealedTrajectory,
  generateWitnessKey,
  CausalRecoveryService,
  CookieVaultService,
  ActionRouter,
  WorkflowCompiler,
  productionUct,
  DEFAULT_PRODUCTION_UCT_WEIGHTS,
} from '../dist/index.js';

const ITER = 1000;

function bench(label, fn) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITER; i++) fn(i);
  const ns = Number(process.hrtime.bigint() - start);
  const usPerOp = ns / ITER / 1000;
  const opsPerSec = (1_000_000_000 / (ns / ITER));
  return { label, usPerOp, opsPerSec };
}

const key = generateWitnessKey();

function makeTraj(i) {
  return {
    id: `t-${i}`,
    sessionId: 'bench',
    goal: 'Sign in',
    startedAt: '2026-05-18T20:00:00Z',
    completedAt: '2026-05-18T20:00:05Z',
    success: true,
    verdict: 'ok',
    steps: [
      { action: 'open', input: { url: 'https://example.com' }, result: { success: true }, timestamp: 't' },
      { action: 'fill', input: { target: '@e1', value: 'a@b.com' }, result: { success: true }, timestamp: 't' },
      { action: 'click', input: { target: '@e2' }, result: { success: true }, timestamp: 't' },
    ],
  };
}

const trajectories = Array.from({ length: ITER }, (_, i) => makeTraj(i));
const sealedEnvelopes = trajectories.map(t => sealTrajectory({ trajectory: t, witnessKey: key }).envelope);

// Phase 1: sign
const sign = bench('Phase 1 — sealTrajectory', (i) => {
  sealTrajectory({ trajectory: trajectories[i], witnessKey: key });
});

// Phase 1: verify
const verify = bench('Phase 1 — verifySealedTrajectory', (i) => {
  verifySealedTrajectory(sealedEnvelopes[i]);
});

// Phase 2: report break + annotate
const causal = new CausalRecoveryService();
for (let i = 0; i < 10; i++) {
  await causal.reportBreak({
    url: 'https://example.com/login',
    selector: '@e3',
    action: 'click',
    actionResult: { success: false, error: 'not found' },
  });
}
const snapshot = {
  tree: { role: 'main' },
  refs: { '@e1': { role: 'textbox' }, '@e2': { role: 'textbox' }, '@e3': { role: 'button' } },
  url: 'https://example.com/login',
  title: 'Login',
  timestamp: 'now',
};
const annotate = bench('Phase 2 — annotateSnapshot (3 refs)', async (i) => {
  await causal.annotateSnapshot(snapshot, 'https://example.com/login');
});

// Phase 3: cookie vault store + verify
const vault = new CookieVaultService({ witnessKey: key });
const cookieEnvelopes = [];
for (let i = 0; i < ITER; i++) {
  const result = await vault.store({
    cookie: { name: 'sid', value: `opaque-token-${i}`, domain: 'example.com' },
  });
  if (result.success) cookieEnvelopes.push(result.envelope);
}
const vaultVerify = bench('Phase 3 — vault.verifyAttestation', (i) => {
  vault.verifyAttestation(cookieEnvelopes[i % cookieEnvelopes.length]);
});

// Phase 5: action routing
const router = new ActionRouter();
const route = bench('Phase 5 — ActionRouter.classify', () => {
  router.classify({ action: 'click', selector: '@e1', hasResolvedRef: true });
});

// Phase 7: production UCT
const uct = bench('Phase 7 — productionUct', () => {
  productionUct({
    visits: 5,
    parentVisits: 50,
    signals: { qValue: 0.7, replayability: 0.6, risk: 0.2, costUsd: 0.005, authFragility: 0.1 },
  }, DEFAULT_PRODUCTION_UCT_WEIGHTS);
});

// Phase 7: workflow compile
const compiler = new WorkflowCompiler();
const compile = bench('Phase 7 — WorkflowCompiler.compile', (i) => {
  compiler.compile({
    id: 'bench',
    goal: 'login',
    trajectoryEnvelope: sealedEnvelopes[i],
  });
});

const results = [sign, verify, annotate, vaultVerify, route, uct, compile];

console.log('\n## @claude-flow/browser substrate benchmarks (ADR-122)\n');
console.log('| Operation | µs/op | ops/sec |');
console.log('|---|---:|---:|');
for (const r of results) {
  console.log(`| ${r.label} | ${r.usPerOp.toFixed(2)} | ${r.opsPerSec.toFixed(0)} |`);
}
console.log('\nRun:', new Date().toISOString());
console.log(`Iterations per op: ${ITER}`);
console.log(`Node: ${process.version}, Platform: ${process.platform} ${process.arch}\n`);
