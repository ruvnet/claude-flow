---
name: memory-search
description: SOTA semantic search — hybrid (sparse+dense), Graph RAG multi-hop, MMR diversity reranking, recency weighting
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_search_unified mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize
argument-hint: "<query> [--hybrid] [--graph-rag] [--namespace NAME]"
---

# Memory Search (SOTA)

State-of-the-art semantic search across Ruflo memory with multiple retrieval strategies.

## Strategy Selection

Choose based on query type:
- **Default** (dense): fast single-hop semantic match
- **--hybrid**: sparse + dense with RRF fusion (20-49% better for keyword+semantic queries)
- **--graph-rag**: multi-hop knowledge retrieval (30-60% better for reasoning queries)

## Steps

1. **Parse query and flags** — extract search text and strategy flags from arguments
2. **Select retrieval strategy**:

   **Dense search (default)**:
   ```bash
   npx @claude-flow/cli@latest memory search --query "QUERY" --namespace NAMESPACE --limit 10
   ```
   Or via MCP: `mcp__plugin_ruflo-core_ruflo__memory_search({ query: "QUERY", namespace: "NAMESPACE", limit: 10 })`

   **Hybrid search** (when --hybrid or query has specific keywords):
   ```bash
   npx ruvector search "QUERY" --hybrid --limit 10
   ```

   **Graph RAG** (when --graph-rag or multi-hop reasoning needed):
   ```bash
   npx ruvector search "QUERY" --graph-rag --limit 10
   ```

   **Smart retrieval** (when --smart or complex recall needed):
   ```bash
   npx @claude-flow/cli@latest memory search --query "QUERY" --smart --limit 10
   ```
   Or via MCP: `mcp__plugin_ruflo-core_ruflo__memory_search({ query: "QUERY", smart: true, limit: 10 })`

   Applies 5-phase pipeline: query expansion, RRF fusion, recency boost, MMR diversity, session round-robin.
   Best for: multi-session recall, temporal queries, diverse result sets.

   **Unified cross-namespace**:
   `mcp__plugin_ruflo-core_ruflo__memory_search_unified({ query: "QUERY", limit: 10 })`

3. **Apply MMR reranking** — for diverse results, filter near-duplicates (cosine > 0.92) while maximizing relevance
4. **Apply recency weighting** — boost recent entries with exponential decay (0.95/day)
5. **Synthesize context** (for complex queries):
   `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize({ query: "QUERY", sources: ["patterns", "tasks", "solutions"] })`
6. **Present results** — ranked by composite score (relevance * diversity * recency), with source namespace attribution

## Namespace Guide

| Namespace | Best For |
|-----------|----------|
| `patterns` | "How did we handle X?" |
| `tasks` | "What was the context for Y?" |
| `solutions` | "How did we fix Z?" |
| `feedback` | "What did the user prefer?" |
| `security` | "Known vulnerabilities in..." |
| (omit) | Search all namespaces |
