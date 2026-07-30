# ADR-344: Knowledge Graph Index for ReasoningBank

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-06-12)  
**Dream Cycle Issue**: #TBD (filed same session)  
**Related**: ADR-087 (graph-node native backend), ADR-006 (Unified Memory Service)

## Context

Ruflo's ReasoningBank stores trajectory patterns as flat vector embeddings, queried via HNSW similarity search. This serves single-hop semantic retrieval well but cannot answer multi-hop questions like "which agent patterns are causally supported by evidence from method lineage X?"

arXiv:2606.13669 (Agents-K1, June 11, 2026) demonstrates that agent-native knowledge graphs — capturing entities, claims, evidence, and method lineages as graph nodes with typed edges — achieve superior multi-hop scientific reasoning compared to flat retrieval. The system processed 2.46M papers into Scholar-KG using a 4B GRPO-trained extraction backbone.

Ruflo already has `@ruvector/graph-node@2.0.3` installed and wired (ADR-087) for agent-relationship topology (k-hop neighbor queries, hyperedges). That same infrastructure is unused for *knowledge indexing*. This creates an avoidable gap: LangGraph v0.4 ships GraphStore (neo4j/networkx wrappers) as a first-class memory option; Ruflo's graph capability is topology-only.

## Decision

Extend `v3/@claude-flow/memory/src/ruvector/graph-backend.ts` (ADR-087) to support knowledge graph indexing of ReasoningBank entries. Add a `kg_query(entity, hops)` retrieval path to `UnifiedMemoryService` alongside the existing HNSW vector path. Feature-flag the entire addition behind `CLAUDE_FLOW_KG_ENABLED`.

### Node Types

| Type | Fields | Indexed From |
|------|--------|-------------|
| `entity` | id, label, embedding | Pattern tags, tool names |
| `claim` | id, statement, confidence, embedding | Pattern outcome verdicts |
| `evidence` | id, sourcePatternId, outcome, embedding | JUDGE step outputs |

### Edge Types

| Label | From → To | Meaning |
|-------|-----------|---------|
| `supports` | evidence → claim | Evidence backs claim |
| `method_lineage` | claim → entity | Claim derived from entity method |
| `causal_precondition` | entity → entity | Entity A enables entity B |

### New API Surface (~200 LOC across 3 files)

**`graph-backend.ts`** — add:
```typescript
indexMemoryEntry(entry: MemoryEntry): Promise<void>
kg_query(entity: string, hops: number): Promise<GraphQueryResult>
```

**`unified-memory-service.ts`** — add:
```typescript
async hybridRetrieve(query: string, opts: { vectorK: number; graphHops: number }) {
  const [vectorResults, graphResults] = await Promise.all([
    this.hnsw_search(query, opts.vectorK),
    process.env.CLAUDE_FLOW_KG_ENABLED ? this.kg_query(query, opts.graphHops) : []
  ]);
  return rankFusion(vectorResults, graphResults);
}
```

**`reasoningbank.ts`** — call `indexMemoryEntry()` on every successful `store()` when KG enabled.

### No New Dependencies

Reuses `@ruvector/graph-node@2.0.3` already installed per ADR-087.

## Feature Flag Rollout

| `CLAUDE_FLOW_KG_ENABLED` | Behavior |
|--------------------------|----------|
| unset / `false` | Pass-through to existing HNSW only |
| `true` | Index entries + hybrid `kg_query` + `hnsw_search` |

Flip default to `true` only after `scripts/benchmark-intelligence.mjs` validates multi-hop recall improvement vs. HNSW-only baseline at N ≥ 5K patterns.

## Consequences

**Positive:**
- Closes architectural gap vs. LangGraph GraphStore and Agents-K1 pattern
- Reuses existing infrastructure (no new dependency, no new install step)
- Feature-flagged: zero risk to existing users
- Enables future RL-trained knowledge extraction (Agents-K1 GRPO backbone pattern)

**Negative:**
- Write-path overhead when KG enabled (~1ms per entry for graph indexing)
- sql.js graph storage grows proportionally to ReasoningBank size
- Requires schema migration for existing AgentDB databases (handled by `migrate` command)

## Benchmark Gate (before default flip)

Run `npx claude-flow@latest performance benchmark --suite memory-kg` comparing:
- HNSW-only recall@10 on multi-hop test set
- Hybrid KG+HNSW recall@10 on same test set
- Write-path latency: must remain < 5ms p99 per entry

Promote to default only if KG recall@10 improves by ≥ 10% on multi-hop queries.
