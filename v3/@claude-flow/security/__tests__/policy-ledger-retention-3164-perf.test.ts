import { describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { AgenticPolicyEngine, type PolicyState } from '../src/policy/index.js';

// #3164 engine hot-tail regression: verification/export must work on retained
// receipts, independently of how much history was issued. Real receipt checks
// and clone-input volume are the gates; shared-host wall time is diagnostic.
// These controls do not certify a latency SLA or mature-writer contention:
// authenticating/rewriting the external anchor log remains O(anchor count).
const TOTAL_RECEIPTS = 60_000;
const RETENTION = 2_000;
const SIGNING = { signingKey: 'disposable-retention-test-key', keyId: 'retention-test' };

function seedEngine(count: number): AgenticPolicyEngine {
  const engine = new AgenticPolicyEngine({ mode: 'legacy', ...SIGNING });
  for (let i = 0; i < count; i++) {
    engine.evaluate({
      identity: { id: `agent:${i % 50}`, type: 'agent' },
      action: { type: 'code.read', resource: `file-${i}` },
    });
  }
  return engine;
}

function measured<T>(run: () => T) {
  const start = performance.now();
  const cpuStart = process.cpuUsage();
  const value = run();
  const cpu = process.cpuUsage(cpuStart);
  return {
    value,
    timing: { wallMs: performance.now() - start, cpuMs: (cpu.user + cpu.system) / 1_000 },
  };
}

function receiptChecks(engine: AgenticPolicyEngine) {
  let count = 0;
  const original = engine.verifyReceipt.bind(engine);
  engine.verifyReceipt = (receipt) => { count++; return original(receipt); };
  return { count: () => count, reset: () => { count = 0; } };
}

// Count physical receipt slots across clone inputs, including extra historical
// arrays a regression might clone and then discard before returning the tail.
// This observes clone work without requiring a particular number of calls.
function receiptSlots(value: unknown): number {
  const seen = new WeakSet<object>();
  const pending = [value];
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) {
        if (child && typeof child === 'object' && 'payload' in child && 'hash' in child) count++;
        pending.push(child);
      }
    } else {
      pending.push(...Object.values(item));
    }
  }
  return count;
}

function measuredExport(engine: AgenticPolicyEngine) {
  const clone = globalThis.structuredClone;
  const inputs: unknown[] = [];
  const observer = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    inputs.push(value);
    return clone(value, options);
  });
  try {
    const result = measured(() => {
      const state = engine.exportState();
      return { state, serializedBytes: Buffer.byteLength(JSON.stringify(state)) };
    });
    // Inspect outside the timed region and before any pruning/mutation of the
    // observed inputs. Real structuredClone and JSON serialization ran above.
    return { ...result, clonedReceiptSlots: inputs.reduce<number>((sum, input) => sum + receiptSlots(input), 0) };
  } finally {
    observer.mockRestore();
  }
}

function expectTail(state: PolicyState, issued: number) {
  expect(state.receipts).toHaveLength(RETENTION);
  expect(state.retainedFrom).toBe(issued - RETENTION);
  expect(state.ledgerLength).toBe(issued);
  expect(state.receipts[0]!.payload.sequence).toBe(issued - RETENTION);
  expect(state.receipts[0]!.payload.previousReceiptHash).toBe(state.prunedHead);
  expect(state.ledgerHead).toBe(state.receipts.at(-1)!.hash);
}

describe('#3164 engine hot-tail verification and export work', () => {
  it(`bounds authenticated receipts and cloning after pruning ${TOTAL_RECEIPTS} receipts to ${RETENTION}`, () => {
    const engine = seedEngine(TOTAL_RECEIPTS);
    const checks = receiptChecks(engine);
    const verifyBefore = measured(() => engine.verifyLedger());
    expect(verifyBefore.value).toEqual({ valid: true, length: TOTAL_RECEIPTS });
    expect(checks.count()).toBe(TOTAL_RECEIPTS);
    const exportBefore = measuredExport(engine);
    expect(exportBefore.value.state.receipts).toHaveLength(TOTAL_RECEIPTS);
    expect(exportBefore.clonedReceiptSlots).toBe(TOTAL_RECEIPTS);

    const removed = engine.pruneReceipts(RETENTION);
    expect(removed).toHaveLength(TOTAL_RECEIPTS - RETENTION);
    checks.reset();
    const verifyAfter = measured(() => engine.verifyLedger());
    expect(verifyAfter.value).toEqual({ valid: true, length: TOTAL_RECEIPTS });
    expect(checks.count()).toBe(RETENTION);
    const exportAfter = measuredExport(engine);
    const { state } = exportAfter.value;
    expectTail(state, TOTAL_RECEIPTS);
    expect(state.prunedHead).toBe(removed.at(-1)!.hash);
    expect(exportAfter.clonedReceiptSlots).toBeLessThanOrEqual(RETENTION);
    expect(AgenticPolicyEngine.fromState(state, SIGNING).verifyLedger())
      .toEqual({ valid: true, length: TOTAL_RECEIPTS });

    // A cheap alias/shallow copy must not satisfy the bounded-clone guard.
    const original = JSON.stringify(state);
    for (const offset of [0, Math.floor(RETENTION / 2), RETENTION - 1]) {
      state.receipts[offset]!.payload.request.action.resource = `changed-only-in-export-${offset}`;
    }
    expect(JSON.stringify(engine.exportState())).toBe(original);
    expect(engine.verifyLedger()).toEqual({ valid: true, length: TOTAL_RECEIPTS });

    console.log(JSON.stringify({
      schema: 'ruflo.policy-ledger-retention-work/v2',
      scope: 'synthetic engine hot tail; timings are diagnostic, not a latency or contention gate',
      totalReceipts: TOTAL_RECEIPTS,
      retention: RETENTION,
      authenticatedReceipts: { unpruned: TOTAL_RECEIPTS, pruned: RETENTION },
      clonedReceiptSlots: { unpruned: exportBefore.clonedReceiptSlots, pruned: exportAfter.clonedReceiptSlots },
      verify: { unpruned: verifyBefore.timing, pruned: verifyAfter.timing },
      exportStateAndSerialize: { unpruned: exportBefore.timing, pruned: exportAfter.timing },
      serializedBytes: { unpruned: exportBefore.value.serializedBytes, pruned: exportAfter.value.serializedBytes },
    }, null, 2));
  }, 60_000);

  it('authenticates and clones the same bounded tail with 5,000 or 60,000 issued receipts', () => {
    const diagnostics = [];
    for (const issued of [5_000, TOTAL_RECEIPTS]) {
      const engine = seedEngine(issued);
      const removed = engine.pruneReceipts(RETENTION);
      expect(removed).toHaveLength(issued - RETENTION);
      const checks = receiptChecks(engine);
      const verify = measured(() => engine.verifyLedger());
      expect(verify.value).toEqual({ valid: true, length: issued });
      expect(checks.count()).toBe(RETENTION);
      const exported = measuredExport(engine);
      expectTail(exported.value.state, issued);
      expect(exported.clonedReceiptSlots).toBeLessThanOrEqual(RETENTION);
      diagnostics.push({ issued, authenticatedReceipts: checks.count(), clonedReceiptSlots: exported.clonedReceiptSlots, verify: verify.timing, exportStateAndSerialize: exported.timing });
    }
    console.log(JSON.stringify({ schema: 'ruflo.policy-ledger-retention-scaling/v2', diagnosticTimingsOnly: true, histories: diagnostics }, null, 2));
  }, 60_000);

  it.each(['middle-payload', 'final-payload', 'final-signature'] as const)('rejects %s corruption inside the retained signed tail', (corruption) => {
    const issued = RETENTION + 10;
    const engine = seedEngine(issued);
    engine.pruneReceipts(RETENTION);
    const state = engine.exportState();
    const offset = corruption === 'middle-payload' ? Math.floor(RETENTION / 2) : RETENTION - 1;
    const receipt = state.receipts[offset]!;
    if (corruption === 'final-signature') receipt.signature = 'invalid-signature';
    else receipt.payload.request.action.resource = 'corrupted-retained-receipt';
    expect(AgenticPolicyEngine.fromState(state, SIGNING).verifyLedger()).toEqual({
      valid: false,
      length: issued - RETENTION + offset,
      error: corruption === 'final-signature' ? 'receipt-signature-invalid' : 'receipt-hash-mismatch',
    });
  });
});
