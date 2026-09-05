---
name: kg-traverse
description: Pathfinder traversal of the knowledge graph starting from a seed entity
argument-hint: "<entity> [--depth N]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize Bash
---

# KG Traverse

Perform pathfinder graph traversal starting from a seed entity. Expands outward through causal edges, scores paths by relevance, and prunes low-similarity branches.

## When to use

When you need to explore the knowledge graph starting from a specific entity -- finding what depends on it, what it depends on, or discovering indirect relationships. Useful for impact analysis, dependency chains, and understanding code structure.

## Steps

1. **Seed** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall` to look up the target entity by name
2. **Expand** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge` to find all edges connected to the seed entity, then recursively expand outward to the specified depth (default: 3)
3. **Score** -- for each path, compute relevance: `cumulative_score = product(edge_weight * keyword_similarity(query, node))` using `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` (the `semanticRouter` controller is `enabled: false` in current AgentDB builds; pattern-search is the available substitute and works fine for entity-name + relation-type keyword matches — see ruvnet/ruflo#2049). For higher-fidelity semantic similarity, callers can fall back to `mcp__plugin_ruflo-core_ruflo__embeddings_generate` + manual cosine, but that's not required for step 3 to function.
4. **Prune** -- remove paths with cumulative score below 0.3
5. **Rank** -- sort remaining paths by cumulative score descending
6. **Synthesize** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize` to combine the top paths into a coherent summary
7. **Report** -- display the top 10 paths with: path (entity chain), relation types, cumulative score, and synthesized context

## CLI alternative

```bash
npx @claude-flow/cli@latest memory search --query "relations for ENTITY_NAME" --namespace knowledge-graph
```
