---
name: kg
description: Knowledge graph operations — extract entities, traverse relations, and search the graph
---

Knowledge graph commands:

**`kg extract <path>`** -- Extract entities and relations from source files at the given path.
1. Scan files at `<path>` recursively for classes, functions, modules, types, and config references
2. For each entity, record its type, name, file location, and description
3. Map relations between entities: imports, extends, implements, depends-on, calls, references
4. Store entities via `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store` in the `knowledge-graph` namespace
5. Create causal edges via `mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge` for each relation
6. Report: total entities found, total relations mapped, entity type breakdown

**`kg traverse <entity>`** -- Pathfinder traversal starting from the named entity.
1. Look up the seed entity via `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall`
2. Expand outward by following causal edges (default depth: 3)
3. Score each path: `relevance = edge_weight * semantic_similarity(query, node)`
4. Prune paths with cumulative score below 0.3
5. Return the top 10 paths with entities, relations, and scores

**`kg relations <entity>`** -- List all direct relations for the named entity.
1. Query causal edges where source or target matches `<entity>`
2. Group by relation type (imports, extends, implements, depends-on, calls)
3. Display as a table with: relation, direction (incoming/outgoing), target entity, weight

**`kg visualize`** -- Generate an ASCII visualization of the knowledge graph.
1. Recall all entities and edges from the `knowledge-graph` namespace
2. Identify the most-connected nodes (top 10 by degree)
3. Render a simplified graph showing key nodes and their connections
4. Include legend with entity types and relation types

**`kg search <query>`** -- Semantic search across the knowledge graph.
1. Search entities via `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` (the `semanticRouter` controller is `enabled: false` in current AgentDB builds — pattern-search is the available substitute; see ruvnet/ruflo#2049)
2. Expand results with causal edges to show related context
3. Rank by pattern-match score (fall back to `mcp__plugin_ruflo-core_ruflo__embeddings_generate` + manual cosine for higher-fidelity semantic similarity if needed)
4. Display matches with entity name, type, file location, and relevance score
