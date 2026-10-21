/**
 * Browser Causal-Recovery Adapter Tests (Wedge 1, ADR-123 Phase 2)
 *
 * Acceptance:
 *  - Exports a SparseMatrix whose dimensions match the node-set
 *  - Result matrix is diagonally-dominant (coherence > 0)
 *  - Time-decay weights older events less
 *  - registerBrowserCausalAdapter() puts the adapter in the registry under
 *    the canonical `browser:causal:<origin>` graphId
 *  - sublinear/page-rank-entry routes through the adapter end-to-end
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BrowserCausalAdapter,
  browserCausalGraphId,
  registerBrowserCausalAdapter,
  type BreakEventLike,
  type BreakEventSource,
} from '../src/adapters/browser-causal-adapter.js';
import { resetRegistry, getRegistry } from '../src/domain/adapter.js';
import { coherenceScore } from '../src/infrastructure/solver-bridge.js';
import { graphIntelligenceTools } from '../src/mcp-tools/index.js';

function stubSource(events: BreakEventLike[]): BreakEventSource {
  return {
    async listBreaks(origin) {
      return events.filter((e) => e.origin === origin);
    },
  };
}

function evt(partial: Partial<BreakEventLike> & Pick<BreakEventLike, 'id' | 'selector' | 'origin'>): BreakEventLike {
  return {
    timestamp: '2026-05-19T00:00:00.000Z',
    ...partial,
  };
}

describe('browserCausalGraphId', () => {
  it('encodes origin into a stable identifier', () => {
    expect(browserCausalGraphId('https://example.com')).toBe('browser:causal:https://example.com');
  });
});

describe('BrowserCausalAdapter.exportAsSparseMatrix', () => {
  it('returns an empty matrix when there are no break events', async () => {
    const adapter = new BrowserCausalAdapter({
      origin: 'https://empty.test',
      source: stubSource([]),
    });
    const m = await adapter.exportAsSparseMatrix();
    expect(m.size).toBe(0);
    expect(m.entries).toHaveLength(0);
  });

  it('builds a DD matrix from a chronological event sequence', async () => {
    const adapter = new BrowserCausalAdapter({
      origin: 'https://example.com',
      source: stubSource([
        evt({ id: 'b1', origin: 'https://example.com', selector: '@e1', timestamp: '2026-05-19T00:00:00.000Z' }),
        evt({ id: 'b2', origin: 'https://example.com', selector: '@e2', timestamp: '2026-05-19T00:00:01.000Z' }),
        evt({ id: 'b3', origin: 'https://example.com', selector: '@e3', timestamp: '2026-05-19T00:00:02.000Z' }),
      ]),
    });
    const m = await adapter.exportAsSparseMatrix();
    expect(m.size).toBe(3);
    expect(coherenceScore(m)).toBeGreaterThan(0);
    expect(m.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('honours nodeFilter to prune irrelevant rows', async () => {
    const adapter = new BrowserCausalAdapter({
      origin: 'https://example.com',
      source: stubSource([
        evt({ id: 'b1', origin: 'https://example.com', selector: '@e1' }),
        evt({ id: 'b2', origin: 'https://example.com', selector: '@e2' }),
        evt({ id: 'b3', origin: 'https://example.com', selector: '@e3' }),
      ]),
    });
    const m = await adapter.exportAsSparseMatrix({ nodeFilter: new Set(['@e1', '@e2']) });
    expect(m.size).toBe(2);
    expect(Object.keys(m.nodeIndex).sort()).toEqual(['@e1', '@e2']);
  });

  it('records (role:name) fuzzy keys when present', async () => {
    const adapter = new BrowserCausalAdapter({
      origin: 'https://example.com',
      source: stubSource([
        evt({
          id: 'b1',
          origin: 'https://example.com',
          selector: '@e3',
          lastKnownRole: 'button',
          lastKnownName: 'Submit',
        }),
        evt({
          id: 'b2',
          origin: 'https://example.com',
          selector: '@e3',
          lastKnownRole: 'button',
          lastKnownName: 'Submit',
        }),
      ]),
    });
    const m = await adapter.exportAsSparseMatrix();
    expect(Object.keys(m.nodeIndex)).toContain('role:button:Submit');
  });

  it('time-decays older events relative to newer ones', async () => {
    const oneHour = 60 * 60 * 1000;
    const now = Date.now();
    const events: BreakEventLike[] = [
      evt({ id: 'old1', origin: 'https://x.com', selector: 'a', timestamp: new Date(now - 240 * oneHour).toISOString() }),
      evt({ id: 'old2', origin: 'https://x.com', selector: 'b', timestamp: new Date(now - 239 * oneHour).toISOString() }),
      evt({ id: 'new1', origin: 'https://x.com', selector: 'a', timestamp: new Date(now - oneHour).toISOString() }),
      evt({ id: 'new2', origin: 'https://x.com', selector: 'b', timestamp: new Date(now).toISOString() }),
    ];
    const adapter = new BrowserCausalAdapter({
      origin: 'https://x.com',
      source: stubSource(events),
      halfLifeMs: 24 * oneHour,
    });
    const m = await adapter.exportAsSparseMatrix();
    // Find the a→b edge: at least one entry should exist; the weight should
    // be dominated by the recent event-pair, not the old one.
    const aIdx = m.nodeIndex['a'];
    const bIdx = m.nodeIndex['b'];
    const offDiag = m.entries.filter((e) => e.row === aIdx && e.col === bIdx);
    expect(offDiag.length).toBeGreaterThan(0);
    // The accumulated decay should be small for old pair, ~1.0 for recent.
    const totalWeight = offDiag.reduce((s, e) => s + e.value, 0);
    // Recent pair contributes ~1.0, old pair contributes ~ exp(-239/24) ≈ 4e-5.
    expect(totalWeight).toBeGreaterThan(0.5);
    expect(totalWeight).toBeLessThan(2);
  });
});

describe('registerBrowserCausalAdapter', () => {
  beforeEach(() => resetRegistry());

  it('registers under the canonical graph id', () => {
    const registry = getRegistry();
    registerBrowserCausalAdapter({
      origin: 'https://example.com',
      source: stubSource([]),
      registry,
    });
    expect(registry.get('browser:causal:https://example.com')).toBeDefined();
  });

  it('end-to-end: sublinear/page-rank-entry resolves through the registered adapter', async () => {
    const registry = getRegistry();
    registerBrowserCausalAdapter({
      origin: 'https://example.com',
      source: stubSource([
        evt({ id: 'b1', origin: 'https://example.com', selector: '@e1' }),
        evt({ id: 'b2', origin: 'https://example.com', selector: '@e2' }),
        evt({ id: 'b3', origin: 'https://example.com', selector: '@e3' }),
      ]),
      registry,
    });
    const tool = graphIntelligenceTools.find((t) => t.name === 'sublinear/page-rank-entry');
    expect(tool).toBeDefined();
    const r = (await tool!.handler({
      graphId: 'browser:causal:https://example.com',
      nodeId: '@e2',
      maxComplexityClass: 'polynomial',
    })) as { success: boolean; result?: { score: number; complexityClass: string } };
    expect(r.success).toBe(true);
    expect(r.result?.score).toBeGreaterThanOrEqual(0);
    expect(r.result?.complexityClass).toBeDefined();
  });
});
