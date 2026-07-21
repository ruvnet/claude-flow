---
name: agentdb-query
description: Query AgentDB through the controller bridge -- semantic routing, hierarchical recall, causal graphs, context synthesis, pattern store/search
argument-hint: "<query>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__agentdb_semantic-route mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store mcp__plugin_ruflo-core_ruflo__agentdb_controllers mcp__plugin_ruflo-core_ruflo__agentdb_health mcp__plugin_ruflo-core_ruflo__agentdb_batch mcp__plugin_ruflo-core_ruflo__agentdb_feedback mcp__plugin_ruflo-core_ruflo__agentdb_consolidate mcp__plugin_ruflo-core_ruflo__agentdb_session-start mcp__plugin_ruflo-core_ruflo__agentdb_session-end Bash
---

# AgentDB Query

Query and manage AgentDB through the controller bridge. AgentDB exposes 15 `agentdb_*` MCP tools; this skill enumerates the standard usage path.

## When to use

When you need to store, retrieve, or search knowledge across agent sessions. AgentDB provides hierarchical storage, causal knowledge graphs, semantic routing, and context synthesis.

## Steps

1. **Check health** — `mcp__plugin_ruflo-core_ruflo__agentdb_health`. Sanity-check `available: true`.
2. **Start session** — `mcp__plugin_ruflo-core_ruflo__agentdb_session-start` if not already active.
3. **Store knowledge** — `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store` for structured tier-keyed data (tiers: `working|episodic|semantic`).
4. **Recall knowledge** — `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall` with a query.
5. **Search patterns** — `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` for learned patterns (ReasoningBank-routed).
6. **Synthesize context** — `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize` to combine multiple memories.
7. **Build causal graph** — `mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge` to link related knowledge.

## Available controller groups

Call `mcp__plugin_ruflo-core_ruflo__agentdb_controllers` to list the runtime registry. Functional categories surfaced via the 15 MCP tools:

- **Hierarchical** — `agentdb_hierarchical-store`, `_recall` (tier-routed)
- **Pattern** — `agentdb_pattern-store`, `_search` (ReasoningBank-routed)
- **Semantic** — `agentdb_semantic-route`, `_context-synthesize`
- **Causal** — `agentdb_causal-edge` (graph-node backend with bridge fallback)
- **Lifecycle** — `agentdb_health`, `_controllers`, `_session-start`, `_session-end`
- **Bulk** — `agentdb_batch` (≤500 entries), `_consolidate`
- **Quality** — `agentdb_feedback`

## Important: namespace handling

Namespace strings apply to `memory_*` and `embeddings_search` only. The `agentdb_hierarchical-*`, `agentdb_pattern-*`, and `agentdb_causal-edge` tools route by **tier** or **controller**, not namespace. Don't pass `namespace: 'foo'` to those tools — it will be silently ignored. See plugin README "Namespace convention".

## Operational fallbacks (branch on these)

- `controller: 'memory-store-fallback'` — pattern persisted via `memory_store --namespace pattern`. NOT a failure.
- `_graphNodeBackend: true` — causal-edge handled by `@ruvector/graph-node`.
- `success: false, error: '...Use memory_store/memory_search instead.'` — bridge unavailable; switch to `memory_*` tools per the README replacement table.

## CLI alternative

```bash
npx @claude-flow/cli@latest memory search --query "your query" --namespace patterns
npx @claude-flow/cli@latest memory store --key "key" --value "value" --namespace patterns
npx @claude-flow/cli@latest memory list --namespace patterns
```
