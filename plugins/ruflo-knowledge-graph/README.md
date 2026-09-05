# ruflo-knowledge-graph

Knowledge graph construction -- entity extraction, relation mapping, and pathfinder graph traversal.

## Overview

Extracts entities (classes, functions, modules, types, concepts) and relations (imports, extends, implements, depends-on, calls) from source code and documentation. Builds a navigable knowledge graph stored in AgentDB with hierarchical nodes and causal edges. Traverses the graph using a pathfinder algorithm that scores paths by edge weight and semantic similarity.

## Installation

```bash
claude --plugin-dir plugins/ruflo-knowledge-graph
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `graph-navigator` | sonnet | Entity extraction, relation mapping, knowledge graph construction, pathfinder traversal |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `kg-extract` | `/kg-extract <path>` | Extract entities and relations from source files to build a knowledge graph |
| `kg-traverse` | `/kg-traverse <entity> [--depth N]` | Pathfinder traversal starting from a seed entity |

## Commands (5 subcommands)

```bash
kg extract <path>            # Extract entities and relations from source files
kg traverse <entity>         # Pathfinder traversal from a seed entity
kg relations <entity>        # List all direct relations for an entity
kg visualize                 # ASCII visualization of the knowledge graph
kg search <query>            # Semantic search across the graph
```

## Entity Types

| Type | Examples |
|------|----------|
| class | `UserService`, `AuthController` |
| function | `calculateDiscount`, `handleRequest` |
| module | `auth`, `payments`, `api` |
| concept | `authentication`, `caching` |
| type | `User`, `OrderStatus` |
| config | `database`, `redis`, `jwt` |

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-knowledge-graph/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns the `knowledge-graph` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

Entity nodes are stored via `agentdb_hierarchical-store`; relation edges via `agentdb_causal-edge`; semantic indexing via `embeddings_generate` (NOT `embeddings_embed` — that tool name doesn't exist; ADR-0001 fixes prior references).

## Pathfinder Algorithm

1. **Seed** -- start from the target entity node
2. **Expand** -- follow causal edges outward (configurable depth, default 3)
3. **Score** -- `relevance = edge_weight * semantic_similarity(query, node)`
4. **Prune** -- remove paths below threshold (default 0.3)
5. **Rank** -- return top-K paths by cumulative relevance

## G7 controllers (activated in ruflo 3.6.23+ / 3.6.24)

[ADR-095](../../v3/docs/adr/ADR-095-architectural-gaps-from-april-audit.md) closed five AgentDB controllers that this plugin's graph traversal can leverage:

- **`gnnService`** — GNN embeddings + relational scoring over the AgentDB causal graph. Augments the pathfinder's `semantic_similarity(query, node)` term with structurally-aware scoring; nodes that are graph-neighbors of confirmed-relevant nodes get a boost.
- **`rvfOptimizer`** — Quantizes + dedupes vector blocks before persistence. Knowledge-graph indexes commonly have many near-duplicate entity vectors (same class re-exported from multiple modules); rvfOptimizer collapses them transparently.
- **`mutationGuard`** + **`attestationLog`** + **`GuardedVectorBackend`** — Proof-gated writes to the underlying vector store. Relevant when the graph spans trust boundaries (federated knowledge import) — the attestation chain at `.swarm/attestation.db` records every mutation for after-the-fact audit.

The yet-pending **`graphAdapter`** controller will give this plugin a first-class graph-DB backend (instead of building the graph view on top of AgentDB's flat causal-edge table). Tracked in ADR-095.

Inspect runtime status via the `agentdb_controllers` or `agentdb_health` MCP tools.

## Verification

```bash
bash plugins/ruflo-knowledge-graph/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-knowledge-graph plugin contract (embeddings_generate fix, namespace coordination, smoke as contract)](./docs/adrs/0001-knowledge-graph-contract.md)

## Related Plugins

- `ruflo-agentdb` -- The G7 controllers above ship via this plugin's runtime; install both for full graph + traversal coverage; namespace convention owner
- `ruflo-ruvector` -- HNSW indexing for fast semantic search across graph nodes
- `ruflo-adr` -- ADR dependency graphs share the same causal edge model

## License

MIT
