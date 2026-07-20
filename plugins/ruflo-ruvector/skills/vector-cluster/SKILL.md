---
name: vector-cluster
description: Cluster code by graph community detection via npx ruvector@0.2.25 hooks graph-cluster (spectral / Louvain)
argument-hint: "<namespace> [--k N]"
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_list
---

# Vector Cluster

Cluster vectors in a namespace by semantic similarity using `ruvector`.

## When to use

Use this skill when you have a collection of embeddings and want to discover natural groupings. Clustering reveals themes, identifies outliers, and helps organize large vector collections.

## Steps

1. **Ensure ruvector@0.2.25 is available**:
   ```bash
   npm ls ruvector 2>/dev/null | grep '0.2.25' || npm install ruvector@0.2.25
   ```
2. **Run clustering** — in ruvector@0.2.25 the only working clustering is via `hooks graph-cluster` (spectral/Louvain over a code graph). The top-level `cluster` command is reserved for distributed cluster ops and is currently "Coming Soon" upstream.
   ```bash
   npx -y ruvector@0.2.25 hooks graph-cluster <files...>
   npx -y ruvector@0.2.25 hooks graph-mincut <files...>
   ```
3. **Review output** — JSON with cluster assignments, community labels, and edges. If you see `"graph.nodes is not iterable"`, run `hooks init` first to seed the graph state.
4. **Store results**:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "clusters-PROJECT-TIMESTAMP", value: "CLUSTER_ASSIGNMENTS", namespace: "vector-clusters" })`

## Interpreting results

- **High cohesion** (>0.85): tight, well-defined cluster
- **Medium cohesion** (0.6-0.85): related but diverse content
- **Low cohesion** (<0.6): loose grouping, try higher resolution
- **Outliers**: novel or anomalous files worth investigating

## Caveats

- `cluster --namespace ... --k N` and `cluster --density` are **not** valid in ruvector@0.2.25 — those flags fall through to the distributed-cluster command, which only accepts `--status`, `--join`, `--leave`, `--nodes`, `--leader`, `--info`.
- For namespaced k-means over arbitrary embeddings, run k-means in your own code against vectors stored in AgentDB.
