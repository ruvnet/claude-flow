# ADR-179: HNSW-as-Communication-Fabric (HCF) for RuVector Swarm Knowledge Gossip

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-07-09)  
**References**: arXiv:2606.28781 (HyphaeDB), arXiv:2606.02107 (ND-MARL), arXiv:2606.30668 (Emergent Culture)  

---

## Context

Tonight's dream-cycle research (SLOT=4, DEEP=swarm) surfaced three Grade-A/B findings that jointly motivate a new architectural direction for ruvector and the Ruflo swarm layer:

1. **HyphaeDB (arXiv:2606.28781, Grade B)**: Proposes reinterpreting HNSW's neighbor graph topology not as a search optimization but as a *communication fabric* — agents placed as nodes in vector space exchange knowledge updates via gossip-protocol propagation to their HNSW neighbors. This creates "semantic neighborhoods" where conceptually-similar agents share state without explicit routing.

2. **ND-MARL (arXiv:2606.02107, Grade A)**: Demonstrates zero-shot 83× swarm scalability (3-agent policy → 250-agent deployment) via 2-neighbor sparse communication topology. The constraint is the bottleneck: agents only see 2 neighbors, limiting information propagation but enabling scale. This validates sparse neighbor graphs as a viable swarm communication primitive.

3. **Emergent Culture (arXiv:2606.30668, Grade A)**: 3 LLM agents develop spontaneous coordination via shared decaying-TTL storage + message passing — no explicit role prompts required. Entropy pressure catalyzes cooperation. Core insight: information decay forces agents to maintain and re-encode knowledge, producing emergent protocols.

**Current Ruflo gaps exposed by these findings:**

- `AgentDB` / ruvector treats HNSW purely as a search optimization. The index is never used for agent-to-agent communication.
- All competitor vector DBs (Qdrant, Weaviate, Milvus) also treat HNSW as search-only — HCF would be architecturally novel.
- ruvector lacks hybrid search (BM25 + ANN), which all major competitors ship. This is a blocking gap for production RAG.
- Ruflo swarms use static role assignment; no `topology: "minimal"` variant exists for entropy-driven emergent coordination.

---

## Decision

### Part A — HNSW-as-Communication-Fabric (HCF) mode (RFC)

Add an opt-in `commsMode: "hcf"` to AgentDB that activates the HNSW graph as a gossip-protocol communication substrate:

```typescript
interface AgentDBCommsConfig {
  commsMode: 'search-only' | 'hcf';  // default: 'search-only'
  hcf?: {
    gossipFanout: number;      // neighbors to propagate to (default: 2, per ND-MARL)
    ttlMs: number;             // gossip message TTL before entropy decay
    propagationDepth: number;  // max hop count (default: 3)
    dedupeWindow: number;      // ms window for dedup (default: 500)
  };
}
```

When `commsMode: "hcf"` is active:
1. Each AgentDB write event triggers gossip propagation to the writing agent's `k`-nearest neighbors in vector space.
2. Neighbor agents receive the knowledge update via their `post-edit` hook with source attribution.
3. Propagation depth is bounded to prevent amplification storms.
4. TTL decay mirrors the Emergent Culture paper's entropy mechanism, forcing agents to re-encode stale knowledge.

This turns `AgentDB` from a passive retrieval store into an active communication substrate — agents sharing semantic space automatically receive related updates without explicit `SendMessage` calls.

### Part B — Hybrid search (blocking prerequisite)

Before HCF can be meaningful, ruvector must ship hybrid search. All three competitor databases (Qdrant p99=12ms, Weaviate p99=16ms, Milvus p99=18ms @ 10M vectors) implement BM25 + ANN in a single pass. Without hybrid search, keyword-heavy agent queries that the swarm produces during HCF gossip will miss lexically-exact matches.

Target interface:

```typescript
interface HybridSearchParams {
  vector: number[];
  keyword?: string;          // BM25 term query
  hybridAlpha?: number;      // 0=pure keyword, 1=pure vector, default 0.5
  limit: number;
  filter?: Record<string, unknown>;
}
```

### Part C — `topology: "minimal"` swarm variant

Add a new swarm topology based on the Emergent Culture paper's pattern:
- Agents share a single TTL-decaying namespace (backed by HCF when enabled)
- No explicit role prompts — system prompt is minimal ("You are a curious and creative agent")
- Communication is via the shared namespace + direct message passing
- Intended for creative/research tasks where emergent coordination outperforms specialized roles

---

## Consequences

**Positive:**
- HCF differentiates ruvector from all known competitors — none implement HNSW-as-comms-fabric.
- Semantic neighborhoods reduce explicit `SendMessage` overhead for closely-related agents.
- Entropy-driven TTL creates natural memory pressure that may improve swarm focus on active tasks.
- Hybrid search closes the RAG quality gap vs Qdrant/Weaviate.

**Risks / Mitigations:**
- **Gossip storm**: Bounded by `propagationDepth` and `dedupeWindow`. Must be validated with load tests at `maxAgents=8` before enabling at scale.
- **Search semantics interference**: HCF gossip must not mutate the HNSW index structure used for search. Implementation must maintain two views: search index (immutable per-write) and comms graph (read-only topology derived from HNSW at swarm init).
- **TTL contention**: Decaying entries may cause cache thrash. Default `ttlMs=60000` (1 min) is conservative.
- **Part B prerequisite**: HCF gossip over hybrid queries requires hybrid search to be implemented first. Sequence: B → A → C.

**Implementation order**: Part B (hybrid search) → Part A (HCF mode) → Part C (minimal topology).  
**Estimated scope**: Part B: 2–3 weeks. Part A: 3–4 weeks. Part C: 1 week.

---

## References

- arXiv:2606.28781 — HyphaeDB: A Living Knowledge Topology for Agent-First Memory
- arXiv:2606.02107 — Network Distributed Multi-Agent Reinforcement Learning for Consensus Control
- arXiv:2606.30668 — Emergent Culture in Minimal LLM Systems
- Dream Cycle 2026-07-09 gist (in-branch: `docs/dream/2026-07-09-swarm-sota.md`)
- ADR-178: Verifiable Memory Governance (security context for memory writes)
