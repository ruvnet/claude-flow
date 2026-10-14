---
name: memory-search
description: Search Ruflo memory with semantic retrieval, keyword/semantic union, or optional SmartRetrieval reranking
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_search_unified mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize
argument-hint: "<query> [--hybrid] [--smart] [--namespace NAME]"
---

# Memory Search

Search Ruflo's stored memories. Select a strategy supported by the Ruflo CLI or MCP tool, and report which one actually ran.

## Strategy selection

- **Default:** semantic retrieval through `memory search` or MCP `memory_search`.
- **`--hybrid`:** CLI keyword + semantic result union, deduplicated and sorted by score. This is not the `ruvector search` CLI and does not claim Graph RAG or sparse/dense RRF.
- **`--smart`:** request query expansion, RRF across variants, recency weighting, and MMR diversity. The MCP tool can fall back to plain search if the installed memory package lacks `smartSearch`; inspect the returned fallback note before claiming SmartRetrieval ran.
- **Cross-namespace:** MCP `memory_search_unified` merges and deduplicates results from multiple namespaces.

If the user requests `--graph-rag`, explain that this plugin has no supported text-query Graph RAG command. Offer `--smart` semantic retrieval as a clearly labeled fallback; do not claim graph traversal.

## Steps

1. Parse the query, optional namespace, result limit, and strategy flags. Omit `--namespace` to search all namespaces.
   For CLI commands, treat the query as untrusted shell input: use POSIX single-quote escaping for embedded apostrophes and reject embedded newlines. Do not interpolate it inside double quotes.
2. Run one of the supported paths:

   **Semantic (default)**
   ```bash
   npx @claude-flow/cli@latest memory search --query 'QUERY' --limit 10
   ```
   MCP: `mcp__plugin_ruflo-core_ruflo__memory_search({ query: "QUERY", limit: 10 })`

   **Keyword + semantic union (`--hybrid`)**
   ```bash
   npx @claude-flow/cli@latest memory search --query 'QUERY' --type hybrid --limit 10
   ```
   Add `--namespace NAMESPACE` only when the user requests one.

   **Smart retrieval (`--smart`)**
   ```bash
   npx @claude-flow/cli@latest memory search --query 'QUERY' --smart --limit 10
   ```
   MCP: `mcp__plugin_ruflo-core_ruflo__memory_search({ query: "QUERY", smart: true, limit: 10 })`

   **Cross-namespace bridge search**
   `mcp__plugin_ruflo-core_ruflo__memory_search_unified({ query: "QUERY", limit: 10 })`

3. For a complex query, optionally request AgentDB context synthesis with its registered schema:
   `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize({ query: "QUERY", maxEntries: 10 })`
4. Present the returned entries with namespace attribution. Distinguish raw `similarity` from SmartRetrieval's `rankingScore`; neither is a probability of truth. State when SmartRetrieval fell back to plain search.

## Namespace guide

| Namespace | Typical content |
|-----------|-----------------|
| `patterns` | Reusable approaches |
| `tasks` | Task context |
| `solutions` | Resolved problems |
| `feedback` | User corrections |
| `security` | Security notes |
| (omit) | All available namespaces |
