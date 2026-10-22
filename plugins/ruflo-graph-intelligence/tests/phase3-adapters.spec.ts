/**
 * Phase 3 Adapter Tests — federation trust + cost attribution + observability
 *
 * Acceptance:
 *  - Each adapter exports a DD SparseMatrix
 *  - Each adapter registers under its canonical graphId
 *  - sublinear/page-rank-entry routes through each end-to-end
 *  - Stale federation edges are pruned
 *  - Cost rows are L1-normalised so PR weights are proportional shares
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FederationTrustAdapter,
  FEDERATION_TRUST_GRAPH_ID,
  registerFederationTrustAdapter,
} from '../src/adapters/federation-trust-adapter.js';
import {
  CostAttributionAdapter,
  costAttributionGraphId,
  registerCostAttributionAdapter,
} from '../src/adapters/cost-attribution-adapter.js';
import {
  ObservabilitySpanAdapter,
  observabilityGraphId,
  registerObservabilitySpanAdapter,
} from '../src/adapters/observability-span-adapter.js';
import { resetRegistry, getRegistry } from '../src/domain/adapter.js';
import { coherenceScore } from '../src/infrastructure/solver-bridge.js';
import { graphIntelligenceTools } from '../src/mcp-tools/index.js';

describe('FederationTrustAdapter', () => {
  beforeEach(() => resetRegistry());

  it('exports a DD matrix from peer trust edges', async () => {
    const adapter = new FederationTrustAdapter({
      source: {
        async listTrustEdges() {
          return [
            { fromPeer: 'A', toPeer: 'B', confidence: 0.8, updatedAt: new Date().toISOString() },
            { fromPeer: 'B', toPeer: 'C', confidence: 0.6, updatedAt: new Date().toISOString() },
            { fromPeer: 'A', toPeer: 'C', confidence: 0.3, updatedAt: new Date().toISOString() },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    expect(m.size).toBe(3);
    expect(coherenceScore(m)).toBeGreaterThan(0);
  });

  it('prunes stale edges past the freshness window', async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const adapter = new FederationTrustAdapter({
      freshnessMs: 7 * 24 * 60 * 60 * 1000,
      source: {
        async listTrustEdges() {
          return [
            { fromPeer: 'A', toPeer: 'B', confidence: 0.8, updatedAt: old },
            { fromPeer: 'B', toPeer: 'C', confidence: 0.6, updatedAt: fresh },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    expect(Object.keys(m.nodeIndex).sort()).toEqual(['B', 'C']);
  });

  it('registers under the canonical graphId', () => {
    const registry = getRegistry();
    registerFederationTrustAdapter({
      source: { async listTrustEdges() { return []; } },
      registry,
    });
    expect(registry.get(FEDERATION_TRUST_GRAPH_ID)).toBeDefined();
  });

  it('end-to-end via sublinear/page-rank-entry', async () => {
    const registry = getRegistry();
    registerFederationTrustAdapter({
      source: {
        async listTrustEdges() {
          return [
            { fromPeer: 'A', toPeer: 'B', confidence: 0.9, updatedAt: new Date().toISOString() },
            { fromPeer: 'B', toPeer: 'C', confidence: 0.7, updatedAt: new Date().toISOString() },
          ];
        },
      },
      registry,
    });
    const tool = graphIntelligenceTools.find((t) => t.name === 'sublinear/page-rank-entry');
    const r = (await tool!.handler({
      graphId: FEDERATION_TRUST_GRAPH_ID,
      nodeId: 'C',
      maxComplexityClass: 'polynomial',
    })) as { success: boolean; result?: { score: number } };
    expect(r.success).toBe(true);
    expect(r.result?.score).toBeGreaterThanOrEqual(0);
  });
});

describe('CostAttributionAdapter', () => {
  beforeEach(() => resetRegistry());

  it('builds a DD matrix from causation edges', async () => {
    const adapter = new CostAttributionAdapter({
      sessionId: 'sess-1',
      source: {
        async listCausationEdges() {
          return [
            { parentId: 'prompt-1', childId: 'agent-1', costUsd: 0.5 },
            { parentId: 'prompt-1', childId: 'agent-2', costUsd: 0.2 },
            { parentId: 'agent-1', childId: 'model-call-1', costUsd: 0.05 },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    expect(m.size).toBeGreaterThan(0);
    expect(coherenceScore(m)).toBeGreaterThan(0);
  });

  it('L1-normalises costs into proportional shares per parent', async () => {
    const adapter = new CostAttributionAdapter({
      source: {
        async listCausationEdges() {
          return [
            { parentId: 'p', childId: 'a', costUsd: 1.0 },
            { parentId: 'p', childId: 'b', costUsd: 3.0 },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    const pIdx = m.nodeIndex['p'];
    const aIdx = m.nodeIndex['a'];
    const bIdx = m.nodeIndex['b'];
    const pa = m.entries.find((e) => e.row === pIdx && e.col === aIdx)?.value ?? 0;
    const pb = m.entries.find((e) => e.row === pIdx && e.col === bIdx)?.value ?? 0;
    expect(pa + pb).toBeCloseTo(1.0, 6);
    expect(pb / pa).toBeCloseTo(3, 2);
  });

  it('registers under the canonical session-scoped graphId', () => {
    const registry = getRegistry();
    registerCostAttributionAdapter({
      sessionId: 's',
      source: { async listCausationEdges() { return []; } },
      registry,
    });
    expect(registry.get(costAttributionGraphId('s'))).toBeDefined();
  });
});

describe('ObservabilitySpanAdapter', () => {
  beforeEach(() => resetRegistry());

  it('builds a DD matrix from span tree', async () => {
    const adapter = new ObservabilitySpanAdapter({
      traceId: 't1',
      source: {
        async listSpans() {
          return [
            { spanId: 'root', traceId: 't1', selfTimeUs: 100 },
            { spanId: 'child-a', parentSpanId: 'root', traceId: 't1', selfTimeUs: 60 },
            { spanId: 'child-b', parentSpanId: 'root', traceId: 't1', selfTimeUs: 40 },
            { spanId: 'leaf', parentSpanId: 'child-a', traceId: 't1', selfTimeUs: 10 },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    expect(m.size).toBe(4);
    expect(coherenceScore(m)).toBeGreaterThan(0);
  });

  it('honours cross-trace causedBy links', async () => {
    const adapter = new ObservabilitySpanAdapter({
      traceId: 't1',
      source: {
        async listSpans() {
          return [
            { spanId: 'a', traceId: 't1', selfTimeUs: 100 },
            { spanId: 'b', traceId: 't1', selfTimeUs: 50, causedBySpanId: 'a' },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    const aIdx = m.nodeIndex['a'];
    const bIdx = m.nodeIndex['b'];
    const ab = m.entries.find((e) => e.row === aIdx && e.col === bIdx);
    expect(ab?.value).toBeGreaterThan(0);
  });

  it('registers under the canonical graphId', () => {
    const registry = getRegistry();
    registerObservabilitySpanAdapter({
      traceId: 't',
      source: { async listSpans() { return []; } },
      registry,
    });
    expect(registry.get(observabilityGraphId('t'))).toBeDefined();
  });
});
