/**
 * ruflo-graph-intelligence — Adapter Registry Tests (ADR-123 Phase 1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AdapterRegistry, getRegistry, resetRegistry } from '../src/domain/adapter.js';
import type { SublinearAdapter } from '../src/domain/adapter.js';
import type { SparseMatrix } from '../src/domain/types.js';

function fakeAdapter(graphId: string): SublinearAdapter {
  return {
    graphId,
    ownerPlugin: 'test',
    async exportAsSparseMatrix(): Promise<SparseMatrix> {
      return {
        graphId,
        size: 1,
        entries: [{ row: 0, col: 0, value: 1 }],
        nodeIndex: { only: 0 },
        indexNode: ['only'],
        capturedAt: 't',
      };
    },
  };
}

describe('AdapterRegistry', () => {
  beforeEach(() => resetRegistry());

  it('registers + retrieves an adapter', () => {
    const r = new AdapterRegistry();
    const a = fakeAdapter('test:graph');
    r.register(a);
    expect(r.get('test:graph')).toBe(a);
  });

  it('throws on duplicate registration', () => {
    const r = new AdapterRegistry();
    r.register(fakeAdapter('test:graph'));
    expect(() => r.register(fakeAdapter('test:graph'))).toThrow(/already registered/);
  });

  it('unregister removes the adapter', () => {
    const r = new AdapterRegistry();
    r.register(fakeAdapter('test:graph'));
    expect(r.unregister('test:graph')).toBe(true);
    expect(r.get('test:graph')).toBeUndefined();
  });

  it('list returns all adapters', () => {
    const r = new AdapterRegistry();
    r.register(fakeAdapter('a'));
    r.register(fakeAdapter('b'));
    expect(r.list()).toHaveLength(2);
  });

  it('getRegistry returns a singleton', () => {
    const r1 = getRegistry();
    const r2 = getRegistry();
    expect(r1).toBe(r2);
  });

  it('resetRegistry forces a new instance', () => {
    const r1 = getRegistry();
    resetRegistry();
    const r2 = getRegistry();
    expect(r1).not.toBe(r2);
  });
});
