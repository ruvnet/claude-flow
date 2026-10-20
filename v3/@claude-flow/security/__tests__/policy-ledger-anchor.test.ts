import { describe, expect, it } from 'vitest';
import { AgenticPolicyEngine, type PolicyRequest, type PolicyState } from '../src/policy/index.js';

// #3568: a prefix of a valid hash chain is itself a valid chain, so deleting
// the tail of the ledger (or all of it) used to verify as `valid: true`.

const request = (index: number): PolicyRequest => ({
  identity: { id: `agent:${index}`, type: 'agent' },
  action: { type: 'code.read', resource: `file-${index}` },
});

function ledgerOf(receipts: number): PolicyState {
  const engine = new AgenticPolicyEngine({ mode: 'legacy' });
  for (let i = 0; i < receipts; i++) engine.evaluate(request(i));
  return engine.exportState();
}

describe('policy decision ledger anchor (#3568)', () => {
  it('verifies an untouched ledger exactly as before', () => {
    const state = ledgerOf(16);
    expect(state.ledgerLength).toBe(16);
    expect(state.ledgerHead).toBe(state.receipts.at(-1)!.hash);
    expect(AgenticPolicyEngine.fromState(state).verifyLedger()).toEqual({ valid: true, length: 16 });
  });

  it.each([
    ['the last receipt', 1],
    ['the last 10 of 16 receipts', 10],
    ['every receipt', 16],
  ])('rejects a ledger with %s deleted', (_label, removed) => {
    const state = ledgerOf(16);
    state.receipts.splice(16 - removed, removed);
    expect(AgenticPolicyEngine.fromState(state).verifyLedger()).toEqual({
      valid: false,
      length: 16 - removed,
      error: 'policy-ledger-truncated',
    });
  });

  it('still rejects a modified middle receipt', () => {
    const state = ledgerOf(16);
    state.receipts[7]!.payload.request.action.resource = 'tampered';
    expect(AgenticPolicyEngine.fromState(state).verifyLedger()).toMatchObject({
      valid: false,
      error: 'receipt-hash-mismatch',
    });
  });

  it('still rejects a deleted middle receipt', () => {
    const state = ledgerOf(16);
    state.receipts.splice(7, 1);
    expect(AgenticPolicyEngine.fromState(state).verifyLedger()).toMatchObject({
      valid: false,
      error: 'receipt-chain-mismatch',
    });
  });

  it('reports an empty ledger distinctly from an intact one', () => {
    expect(new AgenticPolicyEngine({ mode: 'legacy' }).verifyLedger())
      .toEqual({ valid: true, length: 0, state: 'empty' });
  });

  it('refuses to extend a truncated ledger, so appending cannot erase the evidence', () => {
    const state = ledgerOf(16);
    state.receipts.splice(10, 6);
    const engine = AgenticPolicyEngine.fromState(state);
    expect(() => engine.evaluate(request(99))).toThrow('policy-ledger-truncated');
    expect(engine.verifyLedger().error).toBe('policy-ledger-truncated');
  });

  it('never re-anchors receipts that have no anchor on its own (#3602)', () => {
    const state = ledgerOf(16);
    delete state.ledgerHead;
    delete state.ledgerLength;
    state.receipts.splice(10);

    const engine = AgenticPolicyEngine.fromState(state);
    expect(engine.verifyLedger()).toEqual({ valid: false, length: 10, error: 'anchor-missing' });
    expect(engine.exportState().ledgerLength).toBeUndefined();
  });

  it('anchors receipts only on an explicit establish, once', () => {
    const state = ledgerOf(16);
    delete state.ledgerHead;
    delete state.ledgerLength;

    const engine = AgenticPolicyEngine.fromState(state);
    expect(engine.verifyLedger({ establishAnchor: true })).toEqual({ valid: true, length: 16, anchor: 'established-now' });

    const anchored = engine.exportState();
    expect(anchored.ledgerLength).toBe(16);
    expect(anchored.ledgerHead).toBe(anchored.receipts.at(-1)!.hash);
    expect(AgenticPolicyEngine.fromState(anchored).verifyLedger()).toEqual({ valid: true, length: 16 });

    anchored.receipts.pop();
    expect(AgenticPolicyEngine.fromState(anchored).verifyLedger().error).toBe('policy-ledger-truncated');
  });

  it('refuses to append to receipts that have no anchor, so appending cannot re-anchor them', () => {
    const state = ledgerOf(3);
    delete state.ledgerHead;
    delete state.ledgerLength;
    const engine = AgenticPolicyEngine.fromState(state);
    expect(() => engine.evaluate(request(3))).toThrow('policy-ledger-anchor-missing');
  });

  it('a first decision on a genesis ledger anchors it', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    engine.evaluate(request(0));
    expect(engine.verifyLedger()).toEqual({ valid: true, length: 1 });
  });
});
