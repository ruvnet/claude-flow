---
name: kg-traverse
description: Pathfinder traversal of the knowledge graph starting from a seed entity
argument-hint: "<entity> [--depth N]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall mcp__plugin_ruflo-core_ruflo__agentdb_graph-query mcp__plugin_ruflo-core_ruflo__agentdb_graph-pathfinder mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search Bash
---

# KG Traverse

Perform pathfinder graph traversal starting from a seed entity. Expands outward through the graph's edges, scores paths by relevance, and prunes low-scoring branches.

## When to use

When you need to explore the knowledge graph starting from a specific entity -- finding what depends on it, what it depends on, or discovering indirect relationships. Useful for impact analysis, dependency chains, and understanding code structure.

## Steps

1. **Seed** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall` to look up the target entity by name (one word is the most reliable query: the recall matches the whole query as a substring). Graph node ids are domain-prefixed, for example `entity:router-account`.
2. **Expand** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_graph-query` with `{ nodeId: "entity:NAME", mode: "k-hop", depth: N }` (default depth 3, the SQL path applies at most 3 and reports `appliedDepth` and `truncated`; add `relation` to filter by relation type). `agentdb_causal-edge` only records an edge, never use it to read one.
3. **Score and rank** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_graph-pathfinder` with `{ seedNodeId: "entity:NAME", query: "<what the user wants to know>", depth: N, threshold: 0.3, topK: 10 }`. It expands from the seed, scores each path by cumulative relevance, drops paths under the threshold and returns the top paths. If it returns nothing useful, score the k-hop neighbours yourself with `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` on entity names and relation types (the `semanticRouter` controller is `enabled: false` in current AgentDB builds; see ruvnet/ruflo#2049).
4. **Synthesize** -- write the summary yourself from the returned paths. Do not call `agentdb_context-synthesize`: it summarizes validated task episodes and answers `no-eligible-episodes` for entity records written by `kg-extract`.
5. **Report** -- display the top 10 paths with: path (entity chain), relation types, cumulative score, and your summary.

## When the graph cannot be read

With `CLAUDE_FLOW_ENCRYPT_AT_REST=1` the graph read tools answer `graph_edges DB is encrypted at rest (RFE1)` (#2889, #4135): edges recorded by `kg-extract` are stored but cannot be read back yet. Say so in the report. Your data is intact: do not run `memory init`. Fall back to the entity records only (`agentdb_hierarchical-recall`) and tell the user that relations are unavailable. An `agentdb_causal-edge` result with `readable: false` already warns about this at write time.

## CLI alternative

```bash
npx @claude-flow/cli@latest memory search --query "relations for ENTITY_NAME" --namespace knowledge-graph
```
