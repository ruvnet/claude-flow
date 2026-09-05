/**
 * Phase 4 Adapter Tests — knowledge graph + RAG memory
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  KnowledgeGraphAdapter,
  KNOWLEDGE_GRAPH_ID,
  registerKnowledgeGraphAdapter,
} from '../src/adapters/knowledge-graph-adapter.js';
import {
  RagMemoryAdapter,
  ragMemoryGraphId,
  registerRagMemoryAdapter,
} from '../src/adapters/rag-memory-adapter.js';
import { resetRegistry, getRegistry } from '../src/domain/adapter.js';
import { coherenceScore } from '../src/infrastructure/solver-bridge.js';
import { graphIntelligenceTools } from '../src/mcp-tools/index.js';

describe('KnowledgeGraphAdapter', () => {
  beforeEach(() => resetRegistry());

  it('exports a DD matrix from KG edges', async () => {
    const adapter = new KnowledgeGraphAdapter({
      source: {
        async listEdges() {
          return [
            { fromEntity: 'Claude', toEntity: 'Anthropic', relation: 'createdBy', confidence: 0.95 },
            { fromEntity: 'Anthropic', toEntity: 'AI Safety', relation: 'focuses-on', confidence: 0.9 },
            { fromEntity: 'Claude', toEntity: 'AI Safety', relation: 'aligned-with', confidence: 0.8 },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    expect(m.size).toBe(3);
    expect(coherenceScore(m)).toBeGreaterThan(0);
  });

  it('combines multiple relations between same entities', async () => {
    const adapter = new KnowledgeGraphAdapter({
      source: {
        async listEdges() {
          return [
            { fromEntity: 'A', toEntity: 'B', relation: 'r1', confidence: 0.4 },
            { fromEntity: 'A', toEntity: 'B', relation: 'r2', confidence: 0.5 },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    const offDiag = m.entries.find((e) => e.row !== e.col);
    expect(offDiag?.value).toBeCloseTo(0.9, 5);
  });

  it('caps combined confidence at 1.0', async () => {
    const adapter = new KnowledgeGraphAdapter({
      source: {
        async listEdges() {
          return [
            { fromEntity: 'A', toEntity: 'B', relation: 'r1', confidence: 0.7 },
            { fromEntity: 'A', toEntity: 'B', relation: 'r2', confidence: 0.8 },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    const offDiag = m.entries.find((e) => e.row !== e.col);
    expect(offDiag?.value).toBe(1.0);
  });

  it('registers under canonical graphId', () => {
    const registry = getRegistry();
    registerKnowledgeGraphAdapter({
      source: { async listEdges() { return []; } },
      registry,
    });
    expect(registry.get(KNOWLEDGE_GRAPH_ID)).toBeDefined();
  });

  it('end-to-end via sublinear/page-rank-entry', async () => {
    const registry = getRegistry();
    registerKnowledgeGraphAdapter({
      source: {
        async listEdges() {
          return [
            { fromEntity: 'A', toEntity: 'B', relation: 'r', confidence: 0.5 },
            { fromEntity: 'B', toEntity: 'C', relation: 'r', confidence: 0.5 },
            { fromEntity: 'C', toEntity: 'A', relation: 'r', confidence: 0.5 },
          ];
        },
      },
      registry,
    });
    const tool = graphIntelligenceTools.find((t) => t.name === 'sublinear/page-rank-entry');
    const r = (await tool!.handler({
      graphId: KNOWLEDGE_GRAPH_ID,
      nodeId: 'B',
      maxComplexityClass: 'polynomial',
    })) as { success: boolean; result?: { score: number } };
    expect(r.success).toBe(true);
    expect(r.result?.score).toBeGreaterThan(0);
  });
});

describe('RagMemoryAdapter', () => {
  beforeEach(() => resetRegistry());

  it('exports a DD matrix from chunk edges, filtering below similarity floor', async () => {
    const adapter = new RagMemoryAdapter({
      similarityFloor: 0.5,
      source: {
        async listChunkEdges() {
          return [
            { fromChunkId: 'c1', toChunkId: 'c2', similarity: 0.8 },
            { fromChunkId: 'c1', toChunkId: 'c3', similarity: 0.3 }, // filtered
            { fromChunkId: 'c2', toChunkId: 'c3', similarity: 0.7 },
          ];
        },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    // c3 still appears via c2 → c3 (above floor); c1 → c3 is the filtered one.
    expect(m.size).toBe(3);
    expect(coherenceScore(m)).toBeGreaterThan(0);
  });

  it('namespace scopes the graph id', () => {
    expect(ragMemoryGraphId('docs')).toBe('ruflo-rag-memory:chunks:docs');
    expect(ragMemoryGraphId()).toBe('ruflo-rag-memory:chunks:default');
  });

  it('end-to-end personalized PR via seedNodes', async () => {
    const registry = getRegistry();
    registerRagMemoryAdapter({
      namespace: 'test',
      source: {
        async listChunkEdges() {
          return [
            { fromChunkId: 'c1', toChunkId: 'c2', similarity: 0.9 },
            { fromChunkId: 'c2', toChunkId: 'c3', similarity: 0.7 },
            { fromChunkId: 'c3', toChunkId: 'c1', similarity: 0.6 },
          ];
        },
      },
      registry,
    });
    const tool = graphIntelligenceTools.find((t) => t.name === 'sublinear/page-rank-entry');
    const r = (await tool!.handler({
      graphId: ragMemoryGraphId('test'),
      nodeId: 'c3',
      seedNodes: ['c1'],
      maxComplexityClass: 'polynomial',
    })) as { success: boolean; result?: { score: number } };
    expect(r.success).toBe(true);
    expect(r.result?.score).toBeGreaterThan(0);
  });
});
