# ADR-130 — Graph Intelligence Integration: Unified Knowledge Graph Backend

**Status**: Proposed (2026-05-24)
**Date**: 2026-05-24
**Authors**: claude (drafted with rUv)
**Related**: ADR-087 (graph-node native backend), ADR-123 (sublinear integration / graph intelligence engine), ADR-053 (AgentDB MCP tools), ADR-097 (federation budget circuit breaker), ADR-103 (witness temporal history), ADR-121 (embeddings RuVector upgrade), issues #2047 (witness manifest drift), #1872 (integration test bugs), #1907 (ADR-113 strategic gaps)
**Supersedes**: nothing — consolidates graph surfaces established by ADR-087 and ADR-123

---

## Context

### Status quo: four graph layers that do not know about each other

Ruflo 3.8.0 ships four independent graph-layer implementations. All four are live in production and have real users, but they share no schema, no query contract, and no indexing strategy. Each was added in a separate ADR and each solves a slice of the graph problem in isolation.

**Layer 1 — `@ruvector/graph-node` native backend (ADR-087)**
File: `v3/@claude-flow/cli/src/ruvector/graph-backend.ts`

The Rust-native graph store. Exposes `createNode`, `createEdge`, `createHyperedge`, `kHopNeighbors`, and `stats`. Used by `agentdb_causal-edge` as the preferred write path (`agentdb-tools.ts:341–356`) and by `agent_spawn` to record agent nodes (`agent-tools.ts:315`). Persistence path is `.claude-flow/graph/agents.db` (`graph-backend.ts:53`). Embeddings at insertion time are 8-dimensional character-hash stubs (`graph-backend.ts:68–79`) — not semantically meaningful. k-hop neighbors are returned as opaque string IDs with no relevance scores.

**Layer 2 — AgentDB CausalMemoryGraph (ADR-053)**
File: `v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:312–370`, `v3/@claude-flow/cli/src/memory/memory-bridge.ts`

The AgentDB bridge's `CausalMemoryGraph` controller. Accepts `{ sourceId, targetId, relation, weight }` via `agentdb_causal-edge`. Falls back to SQLite rows when graph-node is unavailable. Has no graph traversal primitives — only insert and delete. `agentdb_causal-edge-delete` is marked `controller="native-unsupported"` for graph-node edges because the native backend lacks a delete API (`memory-bridge.ts:1748–1821`).

**Layer 3 — ruflo-knowledge-graph plugin (v0.2.0)**
Files: `plugins/ruflo-knowledge-graph/`, including `agents/graph-navigator.md`, `skills/kg-extract/SKILL.md`, `skills/kg-traverse/SKILL.md`

A pure-skill-layer plugin. Stores entities via `agentdb_hierarchical-store`, relations via `agentdb_causal-edge`, and traverses using `agentdb_semantic-route` + `agentdb_pattern-search`. The graph-navigator agent runs a custom pathfinder algorithm in its prompt (seed, expand, score, prune, rank) with no native graph query behind it — it issues O(depth) sequential MCP calls. The plugin has no knowledge of Layers 1, 2, or 4.

**Layer 4 — ruflo-graph-intelligence plugin (0.1.0-alpha.1, ADR-123)**
Files: `plugins/ruflo-graph-intelligence/src/`, including `mcp-tools/index.ts` (6 tools), `adapters/` (8 adapter modules), `application/streaming-bridge.ts`, `domain/types.ts`

The sublinear-solver layer. Provides complexity-governed PageRank (`sublinear/page-rank-entry`), linear solve, incremental solve (`sublinear/solve-on-change`), feasibility checking, JL-embed, and diagnostics. Consumes graphs via the `SublinearAdapter` interface — implementors call `exportAsSparseMatrix()`. Eight adapters exist: `knowledge-graph-adapter.ts`, `rag-memory-adapter.ts`, `cost-attribution-adapter.ts`, `federation-trust-adapter.ts`, `browser-causal-adapter.ts`, `observability-span-adapter.ts`, `jujutsu-blast-radius-adapter.ts`, and `portfolio-cg-adapter.ts`. Layer 4 is independent of Layers 1–3; the `KnowledgeGraphAdapter` (`adapters/knowledge-graph-adapter.ts`) defines its own `KnowledgeGraphSource` interface that callers must implement manually.

**Layer 5 (ambient) — MemoryGraph (ADR-049)**
References: `v3/@claude-flow/cli/src/init/executor.ts:1762`, `init/types.ts:221`

A PageRank knowledge graph described in init-generated CAPABILITIES.md files but with no dedicated implementation file found in the source tree. Referenced in `init/settings-generator.ts:123` as `enableMemoryGraph`. Its current implementation status is unclear — the feature appears in generated documentation but there is no `memory-graph.ts` module in `src/`. This is an unknown that would need user clarification before Phase 1 scope is finalized.

### What this fragmentation costs

1. **Double writes on causal edges.** `agentdb_causal-edge` writes to graph-node native storage and then also to the AgentDB bridge (`agentdb-tools.ts:351–353`) "for compatibility". Every edge is stored twice in different formats with no reconciliation.

2. **No semantic graph traversal.** graph-node's `kHopNeighbors` returns raw node IDs. The knowledge-graph plugin's pathfinder is a prompt-level loop with no graph-native scoring. ruflo-graph-intelligence's PageRank operates on SparseMatrix snapshots that must be re-exported from scratch on every query. There is no path from a query string to a semantically-ranked subgraph.

3. **No cross-layer visibility.** SONA trajectory steps (`hooks_intelligence_trajectory-step`) are stored as memory entries with no graph edges. When a task succeeds, the causal relationship between the triggering context and the solution pattern is not recorded as a graph edge — it is only stored as a flat memory row. The RETRIEVE step of the 4-step intelligence pipeline has no graph backbone.

4. **Embedding mismatch.** graph-node uses 8-dimensional char-hash embeddings (not semantically useful). AgentDB uses ONNX all-MiniLM-L6-v2 384-dimensional embeddings. ruflo-graph-intelligence operates on weight matrices with no embedding layer at all. Three incompatible embedding regimes for three layers that are supposed to describe the same graph.

5. **No shared query language.** There is no way to ask "which memory entries caused the current agent's trajectory?" using a single MCP call. A client must coordinate across `agentdb_causal-edge`, `agentdb_hierarchical-recall`, `sublinear/page-rank-entry`, and the knowledge-graph agent's pathfinder — with no shared node ID namespace.

6. **Plugin is alpha-only.** `ruflo-graph-intelligence@0.1.0-alpha.1` is unpublished to npm (version string is pre-1.0 alpha, not in the marketplace). The knowledge-graph plugin is `v0.2.0` and listed but does not appear in the plugin registry's `featured` or `official` sections in `discovery.ts`.

### What "integration" means concretely

The goal of ADR-130 is not to build a new graph database. It is to give all four existing layers a shared contract so that:

- Graph nodes use a single namespace (UUIDs prefixed by domain, e.g. `mem:<id>`, `agent:<id>`, `task:<id>`, `entity:<id>`).
- All edges share one backing table in AgentDB sql.js (the `vector_indexes` + a new `graph_edges` table), queryable via the existing MCP surface.
- ruflo-graph-intelligence adapters can read live edges from AgentDB without requiring a manual `exportAsSparseMatrix()` re-implementation per adapter.
- SONA trajectory steps become graph edges automatically via a post-step hook.
- A single `graph_query` MCP tool answers k-hop, semantic-neighbor, and PageRank queries using the backend appropriate to the query size and complexity budget.

The canonical backend is: **AgentDB sql.js** for persistence (cross-platform, no native compilation required), **@ruvector/graph-node** for native operations when available (k-hop, hyperedges, stats), and **ruflo-graph-intelligence's SublinearAdapter** for complexity-governed analytics queries. The three are not competing — they are complementary layers of the same stack.

---

## Decision

Land six independently shippable phases targeting 3.9.0 (Phases 1–3) and 3.10.0 (Phases 4–6). Each phase has defined scope, acceptance criteria, and a CI smoke guard.

---

### Phase 1 — Unified node namespace and schema (no new behavior; largest blast-radius reduction)

**What changes**

Define a canonical node ID format: `{domain}:{uuid-v4}` where domain is one of `mem`, `agent`, `task`, `entity`, `span`, `pattern`. All graph-producing code must prefix IDs on write. Existing unprefixed IDs in graph-node storage are soft-migrated on first read: if an ID contains no `:` separator it is treated as legacy and prefixed `mem:` for AgentDB compatibility.

Add a `graph_edges` table to the sql.js schema alongside the existing `vector_indexes` table (`v3/@claude-flow/cli/src/commands/ruvector/setup.ts:197–253`):

```sql
CREATE TABLE IF NOT EXISTS claude_flow.graph_edges (
  id              TEXT PRIMARY KEY,          -- edge-{uuid}
  source_id       TEXT NOT NULL,             -- domain-prefixed node ID
  target_id       TEXT NOT NULL,             -- domain-prefixed node ID
  relation        TEXT NOT NULL,             -- e.g. "caused", "depends-on", "imports"
  weight          REAL DEFAULT 1.0,
  -- Temporal / reliability semantics. Without these the graph only grows
  -- and never forgets — catastrophic in autonomous agent systems.
  confidence      REAL DEFAULT 1.0,          -- [0,1]; updated by JUDGE step
  decay_rate      REAL DEFAULT 0.0,          -- per-day exponential decay applied at read time
  last_reinforced TEXT,                      -- ISO-8601; set when CONSOLIDATE re-touches this edge
  witness_id      TEXT,                      -- FK to verification/witness-fixes.json entry (ADR-103 lineage)
  -- Storage: see "Embedding storage strategy" below — embedding may be
  -- inline (int8 PQ-compressed), referenced via vector_indexes, or null
  -- with a foreign cold-tier pointer.
  embedding_ref   TEXT,                      -- "inline:{base64}" | "vector_indexes:{id}" | "rvf:{cid}" | NULL
  metadata        TEXT,                      -- JSON blob for plugin-specific fields
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON claude_flow.graph_edges (source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON claude_flow.graph_edges (target_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON claude_flow.graph_edges (relation);
CREATE INDEX IF NOT EXISTS idx_graph_edges_reinforced ON claude_flow.graph_edges (last_reinforced);
```

**Embedding storage strategy.** A raw 384-dim float32 embedding per edge is 1.5 KB. At 1 M edges that is 1.5 GB before SQLite + HNSW overhead — too heavy for the primary sql.js tier. Three escape valves:

1. **Default (Phase 1)**: store as PQ-compressed `int8[384]` (4× shrink, ~0.4 KB/edge); call out exactly that float32 is *never* primary.
2. **Vector index reference**: write the embedding once into the existing `vector_indexes` HNSW table and store only the row ID in `embedding_ref` — amortizes duplicate embeddings across edges sharing a `(relation, source, target)` shape.
3. **Cold tier** (Phase 6 work, optional earlier): for projects that exceed 5 M edges, route embeddings to `ruvector-postgres` or RVF cold tiers; sql.js keeps only the structural columns. This is the same tiering pattern used by ADR-125 memory consolidation.

The 8-dim char-hash in `graph-backend.ts:68–79` is replaced by a 384-dim ONNX embedding call via the existing `getEmbeddingService()` pattern (used in `embeddings-tools.ts`), then run through the PQ encoder before storage. The ONNX call is async and adds ~50ms per edge insert; this is acceptable for write paths but must not block the read path.

**Why these columns matter (the "graph that forgets" property).** Reads multiply the stored `weight` by `confidence * exp(-decay_rate * days_since_last_reinforced)` to produce an effective weight. CONSOLIDATE (the EWC++ step) bumps `last_reinforced` on edges that participated in successful trajectories; un-touched edges decay naturally. `witness_id` chains every reinforcement to an ADR-103 manifest entry so edge weight changes are auditable, not silent drift.

The existing `agentdb_causal-edge` handler in `agentdb-tools.ts:312–370` is updated to write to `graph_edges` in addition to the current dual-write path.

**Acceptance criteria**

1. `agentdb_causal-edge { sourceId: "agent:abc", targetId: "task:xyz", relation: "assigned_to" }` inserts one row in `graph_edges` with a valid 384-dim embedding blob.
2. `agentdb_causal-edge { sourceId: "legacy-id-no-prefix" }` inserts with source auto-prefixed as `mem:legacy-id-no-prefix` and logs a deprecation warning.
3. Double-write to graph-node native storage is retained as before (no regression to existing `kHopNeighbors` consumers).
4. `graph_edges` table created by `ruvector setup` (`setup.ts` migration) without error.

**CI smoke**: `scripts/smoke-graph-schema-migration.mjs` — runs setup, inserts one edge, verifies row + 384-dim embedding present. Runs without `@ruvector/graph-node` (tests sql.js fallback path).

---

### Phase 2 — `graph_query` MCP tool: unified traversal API

**What changes**

Add `agentdb_graph-query` to `agentdb-tools.ts` — a single MCP tool that dispatches to the most capable backend available:

```
agentdb_graph-query({
  nodeId: string,         // domain-prefixed; required
  mode: "k-hop"           // k-hop neighbor expansion
       | "semantic"        // cosine-nearest via ONNX embeddings on graph_edges
       | "pagerank",       // single-entry PPR via ruflo-graph-intelligence
  depth?: number,          // for k-hop (default 2)
  topK?: number,           // for semantic + pagerank (default 10)
  relation?: string,       // optional edge filter
  complexityBudget?: {         // formal budget; same shape as pathfinder (Phase 5)
    maxNodesVisited?: number,  // default 10_000
    maxDepth?: number,         // default 5
    maxMillis?: number,        // default 50
    maxMemoryMB?: number       // default 32
  }
})
```

Dispatch logic (in order of capability):
1. If `mode === "k-hop"` and graph-node native is available: call `db.kHopNeighbors(nodeId, depth)`.
2. If `mode === "k-hop"` and graph-node unavailable: SQL `SELECT target_id FROM graph_edges WHERE source_id = ?` recursively (CTE up to depth 3).
3. If `mode === "semantic"`: cosine search over `graph_edges.embedding` column via the HNSW index.
4. If `mode === "pagerank"`: load edges from `graph_edges` into a `SparseMatrix`, call `runPageRank` from `ruflo-graph-intelligence`'s `solver-bridge.ts`. This is the integration point where the sublinear solver reads from the unified schema.

The `KnowledgeGraphSource` interface in `plugins/ruflo-graph-intelligence/src/adapters/knowledge-graph-adapter.ts:17` gains a default implementation that reads from `graph_edges` via the bridge, so the `KnowledgeGraphAdapter` no longer requires callers to implement their own edge source.

**Acceptance criteria**

1. `agentdb_graph-query({ nodeId: "agent:abc", mode: "k-hop", depth: 2 })` returns neighbor IDs without error when graph-node is available.
2. Same call with graph-node unavailable returns results from SQL CTE fallback.
3. `agentdb_graph-query({ nodeId: "entity:xyz", mode: "pagerank", topK: 5 })` returns ranked node list using ruflo-graph-intelligence's `runPageRank`. Requires `ruflo-graph-intelligence` to be importable (optional dependency; graceful error if absent).
4. `mode === "semantic"` returns nodes ranked by embedding cosine similarity.

**CI smoke**: `scripts/smoke-graph-query-dispatch.mjs` — tests all three modes against a seeded `graph_edges` table. Native-backend mode tests are guarded by `isGraphBackendAvailable()` and skipped if unavailable.

---

### Phase 3 — SONA trajectory-to-graph hook (intelligence pipeline integration)

**What changes**

The RETRIEVE step of the 4-step intelligence pipeline currently reads from HNSW pattern vectors. It has no awareness of causal edges between past task outcomes and the patterns that led to success.

Add a `post-trajectory-step` side-effect in `hooks-tools.ts` (the `hooks_intelligence_trajectory-step` handler): after storing the step result in HNSW, also write a directed edge in `graph_edges` from the current session context node to the pattern node. Relation: `trajectory-caused`.

Add a `post-task` side-effect in `hooks-tools.ts` (the `hooks_post-task` handler): when `success: true`, write edges from the task's triggering context nodes (the top-K RETRIEVE results from the session's HNSW query) to the pattern that succeeded. Relation: `reinforced-by`. This makes the causal graph grow with each successful task without any manual intervention.

These are additive writes — no existing read paths change. Both side-effects are fire-and-forget (non-blocking errors are logged and discarded).

**Acceptance criteria**

1. After `hooks_intelligence_trajectory-step` with a non-empty `result`, `graph_edges` contains one row with `relation = "trajectory-caused"` and the step's pattern ID as `target_id`.
2. After `hooks_post-task { success: true }`, `graph_edges` contains at least one row with `relation = "reinforced-by"` and `source_id` matching a context node from the session.
3. Neither write blocks the MCP tool response (verified by timing: the tool must return in under 200ms even when the async edge writes are pending).

**CI smoke**: `scripts/smoke-trajectory-graph-edges.mjs` — calls trajectory-step and post-task, then queries `graph_edges` for the expected relation types.

---

### Phase 4 — Plugin adapter contract (`graph_adapter` field in plugin.json)

**What changes**

Plugins that produce graph-meaningful data (agent activity, cost events, browser spans, etc.) currently each implement their own `SublinearAdapter` with custom `exportAsSparseMatrix()` logic. The eight existing adapters in `plugins/ruflo-graph-intelligence/src/adapters/` each re-implement edge loading from different sources with no shared contract.

Define an optional `"graph_adapter"` section in `.claude-plugin/plugin.json`:

```json
{
  "graph_adapter": {
    "edgeRelations": ["costs", "browser-session", "federation-trust"],
    "nodeTypes": ["span", "session"],
    "autoRegister": true
  }
}
```

When `autoRegister: true`, the plugin's edges are automatically included in `graph_edges` writes by the core graph layer, rather than requiring a custom `SublinearAdapter` implementation. The plugin declares which relation types it produces; the core writes them when the relevant MCP tools are called (e.g., `observe-trace` writes `span` nodes; `browser_session_record` writes `session` nodes).

The eight existing adapters in `plugins/ruflo-graph-intelligence/src/adapters/` are updated to read from `graph_edges` as their primary source, falling back to their current plugin-specific sources when rows are absent (backward compatibility).

**Acceptance criteria**

1. A fixture plugin with `"graph_adapter": { "edgeRelations": ["test-event"], "autoRegister": true }` causes writes to `graph_edges` with `relation = "test-event"` when its MCP tool is called.
2. The eight existing adapters pass their existing tests unchanged (backward compat via fallback).
3. `ruflo-plugin-creator` scaffold includes the `"graph_adapter"` stub (commented out) in generated `plugin.json`.

**CI smoke**: `scripts/smoke-graph-plugin-adapter.mjs` — fixture plugin, one MCP call, verify `graph_edges` row.

---

### Phase 5 — `graph_pathfinder` MCP tool: pathfinder API replacing the prompt-level loop

**What changes**

The `ruflo-knowledge-graph` plugin's graph-navigator agent currently runs its pathfinder algorithm in its system prompt, issuing sequential `agentdb_causal-edge` and `agentdb_semantic-route` calls in a loop. This is O(depth × branching-factor) sequential MCP calls — expensive, slow, and not reproducible.

Add `agentdb_graph-pathfinder` to `agentdb-tools.ts`:

```ts
agentdb_graph-pathfinder({
  seedNodeId: string,     // domain-prefixed start node
  query: string,          // natural-language query for relevance scoring
  depth?: number,         // expansion depth (default 3; max 5)
  threshold?: number,     // minimum cumulative relevance score (default 0.3)
  topK?: number,          // max paths returned (default 10)
  algorithm?:             // see "Algorithm matrix" below; default "personalized-pagerank"
    | "personalized-pagerank"
    | "dynamic-mincut"
    | "spectral-sparsify"
    | "temporal-centrality"
    | "connected-component-churn"
    | "witness-chain-divergence"
  complexityBudget?: {    // formal, enforced before solver dispatch
    maxNodesVisited?: number,    // default 10_000
    maxDepth?: number,           // default depth || 5
    maxMillis?: number,          // default 50
    maxMemoryMB?: number         // default 32
  }
})
```

**Algorithm matrix.** PageRank alone is sufficient for relevance ranking but weak for the higher-order reasoning that distinguishes a cognitive substrate from a search index. The pathfinder dispatches by algorithm:

| Algorithm | Answers the question | Sublinear primitive | Typical use |
|---|---|---|---|
| `personalized-pagerank` | "What's most relevant to this query, seeded here?" | `runPageRank` with restart vector | Default retrieval, recommendation |
| `dynamic-mincut` | "Where is this graph about to fracture?" | min-cut on weighted edges (incremental) | Coherence boundary detection, agent-context split points |
| `spectral-sparsify` | "What's the smallest equivalent subgraph?" | spectral sparsification | Compression for downstream solvers, working-set selection |
| `temporal-centrality` | "Which nodes' importance is drifting?" | centrality over a sliding `last_reinforced` window | Agent drift detection, stale-knowledge surfacing |
| `connected-component-churn` | "Is the graph becoming unstable?" | component diff between snapshots | Instability alarm, runaway-feedback detection |
| `witness-chain-divergence` | "Where does the lineage break?" | walk along `witness_id` edges | Integrity audit, ADR-103 compliance forensics |

Each algorithm respects `complexityBudget` and aborts cleanly with a partial result when any cap is hit. The budget is forwarded to the sublinear solver and also enforced at the dispatcher level for non-solver algorithms.

Implementation: expand k-hop neighbors from `graph_edges`, score each candidate node by the algorithm's per-edge cost function, prune paths below threshold, rank. This matches the pathfinder algorithm described in `plugins/ruflo-knowledge-graph/agents/graph-navigator.md:26–40` for the default `personalized-pagerank` mode but executes as a single native operation instead of a prompt loop.

The `graph-navigator` agent's SKILL.md and agent prompt are updated to use `agentdb_graph-pathfinder` as the primary traversal tool. The manual loop steps remain documented for cases where the tool is unavailable (graceful degradation).

**Performance target**: estimated sub-100ms for graphs up to 10,000 nodes at depth 3. This is comparable to the HNSW search latency already achieved in embeddings — no novel data structure is required; the bottleneck is the cosine scoring step which is O(neighbors × 384) floating-point ops per depth level.

**Acceptance criteria**

1. `agentdb_graph-pathfinder({ seedNodeId: "entity:auth-module", query: "what imports auth?", depth: 3 })` returns a ranked list of paths within 100ms on a graph with 1,000 edges.
2. An empty graph returns `{ paths: [], message: "no edges found from seedNodeId" }` without error.
3. `depth > 5` is clamped to 5 with a warning in the response.

**CI smoke**: `scripts/smoke-graph-pathfinder.mjs` — seeds 50 edges, calls pathfinder, asserts top result has cumulative score > 0.

---

### Phase 6 — Benchmark and comparator integration

**What changes**

The SOTA comparator drive (PR #2124, gist `298f8c668c8859b369f91734a0e9cbbe`) measured ruflo winning 3 of 5 dimensions vs LangGraph/AutoGen/CrewAI. Graph traversal latency, edge insert throughput, and k-hop query cost are not currently in the benchmark suite — they are "what we don't measure" caveats.

Add graph benchmarks to `scripts/benchmark-graph.mjs`:

- **Edge insert throughput**: batch-insert 10,000 edges (with 384-dim embeddings), measure inserts/second. Baseline: estimated 200–500 inserts/second based on sql.js write benchmarks from existing `guidance-baseline.json` runs; comparable to the embeddings insert benchmark in `scripts/benchmark-embeddings-footprint.mjs`. Target: needs measurement before setting.
- **k-hop query latency**: 1,000-node graph, depth 2, p50/p95/p99. Target: needs measurement.
- **PageRank single-entry**: 10,000-node sparse graph (1% density), single-entry PPR, p50. Expected O(log n) per ADR-123's forward-push algorithm. Target: estimated sub-10ms based on ADR-123 positioning; needs empirical confirmation.
- **Pathfinder (Phase 5)**: 1,000-edge graph, depth 3, p50. Target: estimated sub-100ms (see Phase 5).

Comparator angle: LangGraph's graph traversal latency is approximately 10–50ms per hop for Python-native in-memory graphs (based on LangGraph documentation and public benchmarks; this figure needs independent verification against the actual LangGraph version tested in PR #2124). This would be noted as "estimated" in any published comparison.

**Witness manifest entries (ADR-103)**: the following artifacts must be registered in `verification.md` upon Phase completion:

| Fix marker | File | Hash basis |
|---|---|---|
| `graph-schema-migration-v1` | `src/commands/ruvector/setup.ts` | sha256 of the `graph_edges` CREATE TABLE block |
| `agentdb-graph-query-tool` | `src/mcp-tools/agentdb-tools.ts` | sha256 of `agentdb_graph-query` handler |
| `agentdb-graph-pathfinder-tool` | `src/mcp-tools/agentdb-tools.ts` | sha256 of `agentdb_graph-pathfinder` handler |
| `trajectory-graph-hook` | `src/mcp-tools/hooks-tools.ts` | sha256 of trajectory-step graph-write block |

Registration via `npx ruflo witness regen` after each phase lands.

---

## Performance Targets

Targets are a mix of estimated (based on analogous measurements in the codebase) and "needs measurement" (no analogous benchmark exists yet). No numbers are invented.

| Metric | Target | Basis |
|---|---|---|
| Edge insert (single, with embedding) | < 100ms | ONNX embed call is ~50ms per existing embeddings benchmark |
| Edge insert (batch 1,000, no embed) | < 5s | sql.js batch write observed in guidance benchmarks |
| k-hop query (1,000-node, depth 2) | < 10ms | comparable to HNSW search latency |
| k-hop query (100,000-node, depth 2, native) | needs measurement | graph-node native benchmarks not yet run |
| PageRank single-entry (10k nodes, 1% density) | < 10ms estimated | ADR-123 O(log n) forward-push claim; needs empirical run |
| Pathfinder (1,000 edges, depth 3) | < 100ms estimated | scoring step is O(neighbors × 384); needs empirical run |
| Memory per 1M edges (sql.js) | needs measurement | depends on embedding storage; BLOB vs float32 packing |

For the comparator angle: target graph query latency < 10ms at 1,000 nodes, which would be competitive with LangGraph's documented per-hop latency. This claim requires independent measurement before publication.

---

## Risks

### 1. Schema migration of existing causal-edge data (HIGH)

Existing `agentdb_causal-edge` data lives in three places: graph-node native `.claude-flow/graph/agents.db`, AgentDB bridge SQL tables, and the pilot "double-write" rows added by `agentdb-tools.ts:351–353`. Phase 1 adds a fourth table (`graph_edges`). Without a migration, data is split across all four locations and the unified query in Phase 2 will miss historical edges. Mitigation: Phase 1 must include a one-time migration that reads existing bridge rows and inserts them into `graph_edges`. The graph-node native database lacks an enumeration API (no `listAllEdges()` confirmed in `graph-backend.ts`), so native-only edges cannot be automatically migrated — this is an acknowledged gap. Users who rely on native-only k-hop queries will not lose data, but those edges will not be queryable via `agentdb_graph-query` mode "semantic" or "pagerank" until Phase 4's adapter registers them.

### 2. Double-write cost during transition (MEDIUM)

Between Phase 1 and Phase 3, every `agentdb_causal-edge` call writes to: (a) graph-node native, (b) AgentDB bridge, and (c) the new `graph_edges` table — three writes per edge. For high-frequency callers (SONA trajectory steps in busy sessions) this triples the write load. Mitigation: add a `CLAUDE_FLOW_GRAPH_DUAL_WRITE=0` env var to suppress the legacy writes once Phase 3 lands. The double-write can be removed in 3.10.0 after a single minor version of parallel operation.

### 3. Query language compatibility (LOW)

The `agentdb_graph-pathfinder` tool (Phase 5) exposes a simplified subset of graph query capabilities. Teams using the knowledge-graph plugin's pathfinder algorithm in custom agents may have prompt language that references specific intermediate steps ("expand causal edges", "prune below threshold") that will no longer be the primary execution path. Mitigation: the prompt-level pathfinder algorithm is explicitly documented as a fallback in the updated `graph-navigator.md`. The underlying steps remain individually callable via `agentdb_causal-edge`, `agentdb_semantic-route`, etc.

### 4. Plugin breakage from adapter changes (LOW)

The eight adapters in `plugins/ruflo-graph-intelligence/src/adapters/` currently read from plugin-specific sources. Phase 4 makes `graph_edges` the primary source and the plugin-specific source a fallback. If a plugin's edges are not yet migrated to `graph_edges`, its adapter will silently return stale or empty data. Mitigation: Phase 4 must include a `validateAdapterSource()` diagnostic that warns (not errors) when `graph_edges` returns fewer rows than the plugin-specific source.

### 5. Witness manifest drift (#2047, HIGH — existing issue)

Issue #2047 reports `missing=95 drift=2` on all three platforms. Phase 1's schema change and Phase 2's new MCP tool will add more artifacts to the witness manifest. If the manifest is not regenerated after each phase, the drift count will increase. Mitigation: ADR-103 compliance is required for each phase (see Phase 6's witness manifest entries table). CI must run `verify.mjs` after `npm run build` — the issue notes that source-only checkouts produce false positives; this constraint must be enforced in `v3-ci.yml`.

### 6. MemoryGraph (ADR-049) status unknown

The `enableMemoryGraph` flag referenced in `v3/@claude-flow/cli/src/init/types.ts:221` and `init/executor.ts:1762` appears in init-generated docs but has no corresponding implementation module in the source tree. If MemoryGraph is a live feature with its own edge storage, it represents a fifth independent layer not captured above. This requires user clarification before Phase 1's migration scope is finalized.

---

## Acceptance criteria per phase (summary)

| Phase | Key deliverable | CI smoke | Target release |
|---|---|---|---|
| 1 | `graph_edges` table + 384-dim edge embeddings + legacy ID prefix migration | `smoke-graph-schema-migration.mjs` | 3.9.0 |
| 2 | `agentdb_graph-query` with k-hop / semantic / pagerank dispatch | `smoke-graph-query-dispatch.mjs` | 3.9.0 |
| 3 | SONA trajectory-step and post-task write causal edges automatically | `smoke-trajectory-graph-edges.mjs` | 3.9.0 |
| 4 | Plugin adapter contract + existing adapters read from `graph_edges` | `smoke-graph-plugin-adapter.mjs` | 3.10.0 |
| 5 | `agentdb_graph-pathfinder` native pathfinder tool | `smoke-graph-pathfinder.mjs` | 3.10.0 |
| 6 | Graph benchmark suite + comparator results + witness manifest entries | CI benchmark run in `v3-ci.yml` | 3.10.0 |

## Implementation notes

- Phases 1 and 2 must land together (Phase 2 depends on the `graph_edges` schema).
- Phase 3 is independent and can land as a separate PR.
- Phases 4 and 5 can land in either order.
- Phase 6 is gated on Phases 1–5 being complete enough to produce meaningful benchmark numbers.
- No code changes to `ruflo-graph-intelligence@0.1.0-alpha.1` are required in Phases 1–3; the plugin is consumed, not modified.
- Phase 4 requires changes inside `plugins/ruflo-graph-intelligence/src/adapters/` — bump the plugin to `0.2.0-alpha.1` and register in the plugin marketplace.

---

## Strategic positioning

What this ADR is really converging on, named explicitly: **a layered cognition architecture**, not another orchestration framework.

| Layer | Responsibility | Owned by |
|---|---|---|
| AgentDB sql.js | Canonical persistence | This ADR (`graph_edges` table) |
| graph-node | Fast structural traversal | Existing, dispatched via Phase 2 |
| ruflo-graph-intelligence | Complexity-bounded reasoning | Existing, called via solver bridge |
| HNSW / embeddings | Semantic locality | Existing, indexed on `embedding_ref` |
| SONA hooks | Temporal reinforcement learning | Phase 3 |

Most agent frameworks treat graphs as orchestration metadata. This stack treats the graph as a **live reasoning substrate** — the same surface that stores tool calls also drives retrieval, scoring, and consolidation.

The bridge Phase 3 builds is the key one: the moment trajectory steps become graph edges automatically, four kinds of memory collapse into a single substrate:

- **Vector memory** (semantic neighbors via HNSW on `embedding_ref`)
- **Symbolic memory** (relation typing via `relation` column)
- **Temporal memory** (`last_reinforced` + `decay_rate` per edge)
- **Operational memory** (PageRank weights tracking real call frequency, not static ingestion)

Most systems today solve one or two of these. Combining all four behind a single MCP surface (`graph_query` + `graph_pathfinder`) with a formal `complexityBudget` is the differentiation:

| Market positioning | Description |
|---|---|
| LangGraph | Workflow graphs (orchestration metadata) |
| Neo4j | Enterprise graph DB (no agent integration) |
| Mem0 / Zep | Memory layers (vector-only, no graph algorithms) |
| CrewAI | Orchestration (no persistent graph) |
| MCP | Tool transport (no memory at all) |
| **Ruflo (post-ADR-130)** | **Unified cognitive graph runtime — vector + symbolic + temporal + operational memory behind one bounded query surface** |

The most important architectural line in the 4-step intelligence pipeline today: **RETRIEVE has no graph backbone**. It searches HNSW only. This ADR is what gives RETRIEVE a graph backbone, and once that lands, every step downstream (JUDGE, DISTILL, CONSOLIDATE) gets first-class access to causal lineage instead of similarity-only ranking.

That is the bridge from "agent framework" to "agent operating system."
