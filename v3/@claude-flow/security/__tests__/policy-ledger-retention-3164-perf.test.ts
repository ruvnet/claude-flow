import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { AgenticPolicyEngine } from '../src/policy/index.js';

// #3164: without retention, `verifyLedger()` walked the FULL receipt chain
// from sequence 0 on every single policy decision (even in default `legacy`
// mode, which always allow-and-records), and `exportState()`/`JSON.stringify`
// touched the full receipts array too. Once a project accumulated ~100K+
// receipts, every MCP tool call paid that O(total history) cost under the
// policy lock and started timing out. This benchmark reproduces the bug
// shape at scale, then proves pruning actually bounds the cost regardless of
// how many receipts were ever issued — the only thing that matters for #3164.

const TOTAL_RECEIPTS = 60_000;
const RETENTION = 2_000;

function seedEngine(count: number): AgenticPolicyEngine {
  const engine = new AgenticPolicyEngine({ mode: 'legacy' });
  for (let i = 0; i < count; i++) {
    engine.evaluate({
      identity: { id: `agent:${i % 50}`, type: 'agent' },
      action: { type: 'code.read', resource: `file-${i}` },
    });
  }
  return engine;
}

describe('#3164 ledger retention performance (regression guard, not a microbenchmark)', () => {
  it(`bounds verifyLedger() and exportState() cost after pruning ${TOTAL_RECEIPTS} receipts to a ${RETENTION}-entry retention window`, () => {
    const engine = seedEngine(TOTAL_RECEIPTS);

    const verifyBeforeStart = performance.now();
    const verifyBefore = engine.verifyLedger();
    const verifyBeforeMs = performance.now() - verifyBeforeStart;
    expect(verifyBefore).toEqual({ valid: true, length: TOTAL_RECEIPTS });

    const cloneBeforeStart = performance.now();
    JSON.stringify(engine.exportState());
    const cloneBeforeMs = performance.now() - cloneBeforeStart;

    engine.pruneReceipts(RETENTION);
    expect(engine.exportState().receipts).toHaveLength(RETENTION);

    const verifyAfterStart = performance.now();
    const verifyAfter = engine.verifyLedger();
    const verifyAfterMs = performance.now() - verifyAfterStart;
    expect(verifyAfter).toEqual({ valid: true, length: TOTAL_RECEIPTS });

    const cloneAfterStart = performance.now();
    JSON.stringify(engine.exportState());
    const cloneAfterMs = performance.now() - cloneAfterStart;

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      schema: 'ruflo.policy-ledger-retention-benchmark/v1',
      totalReceipts: TOTAL_RECEIPTS,
      retention: RETENTION,
      verifyLedgerMs: { unpruned: Number(verifyBeforeMs.toFixed(3)), pruned: Number(verifyAfterMs.toFixed(3)) },
      exportStateAndSerializeMs: { unpruned: Number(cloneBeforeMs.toFixed(3)), pruned: Number(cloneAfterMs.toFixed(3)) },
    }, null, 2));

    // The actual #3164 symptom: cost scales with total history unpruned, and
    // stops scaling with it once pruned — regardless of how many receipts
    // were ever issued. Order-of-magnitude, not a tight bound, to avoid CI
    // flakiness, plus a concrete small-ms budget on the pruned side.
    expect(verifyAfterMs).toBeLessThan(verifyBeforeMs / 10);
    expect(verifyAfterMs).toBeLessThan(50);
    expect(cloneAfterMs).toBeLessThan(cloneBeforeMs / 10);
    expect(cloneAfterMs).toBeLessThan(50);
  }, 60_000);

  it('after pruning, verify cost stays roughly constant no matter how much MORE history accumulates behind the retention window', () => {
    const smallHistory = seedEngine(5_000);
    smallHistory.pruneReceipts(RETENTION);
    const smallStart = performance.now();
    smallHistory.verifyLedger();
    const smallMs = performance.now() - smallStart;

    const largeHistory = seedEngine(TOTAL_RECEIPTS);
    largeHistory.pruneReceipts(RETENTION);
    const largeStart = performance.now();
    const largeResult = largeHistory.verifyLedger();
    const largeMs = performance.now() - largeStart;

    expect(largeResult).toEqual({ valid: true, length: TOTAL_RECEIPTS });
    // 12x more total history, but the hot tail is the same size: verify cost
    // should not grow proportionally. Generous multiplier to avoid flakiness
    // on noisy CI, but tight enough to catch a regression to O(total).
    expect(largeMs).toBeLessThan(Math.max(smallMs * 5, 20));
  }, 60_000);
});
