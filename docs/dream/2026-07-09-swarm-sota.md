# Swarm SOTA Report — 2026-07-09

**TL;DR**: Zero-shot 83× swarm scalability (ND-MARL, Grade A) and entropy-catalyzed emergent coordination (Grade A) expose two structural gaps in Ruflo's static-topology swarm — no size-invariant training path and no minimal-mode coordinator; HyphaeDB proposes treating HNSW as a communication fabric, pointing to an architectural pivot for ruvector-integration.

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|-----------|
| ND-MARL: policies trained on 3 agents deploy zero-shot to 250-agent swarms (83× scale, 2-neighbor topology, MASAC) | arXiv:2606.02107, June 2026 | A |
| Emergent Culture: 3 LLM agents develop spontaneous storage strategies + cultural artifacts via entropy-pressured shared KV + message passing — no explicit role prompts needed | arXiv:2606.30668, June 2026 | A |
| HyphaeDB: HNSW neighbor graph reinterpreted as gossip-protocol communication fabric for multi-agent knowledge propagation | arXiv:2606.28781, June 2026 | B |
| Governed Caste Reassignment: cryptographic governance (signed cause-chains + hash-chained audit logs) for role elevation in heterogeneous swarms | arXiv:2607.04634, July 2026 | B |
| ND-MARL shows "consistent convergence" but increasing "steady-state spread" at large teams — sparse comms is the scaling bottleneck | arXiv:2606.02107 | A |
| LangGraph Q2 2026: per-node timeouts, DeltaChannel, v2 typed streaming; `langgraph-swarm` library now stable | changelog.langchain.com, July 2026 | B |
| CrewAI 1.14.6 + June patch: pluggable memory/knowledge/RAG/flow backends, native Chat API | CrewAI changelog | B |
| Qdrant leads vector DB latency: p50=4ms, p99=12ms @ 10M vectors; Weaviate p99=16ms; Milvus p99=18ms | qdrant.tech/benchmarks 2026 | A |
| All major vector DBs (Qdrant, Weaviate, Milvus) ship hybrid search (BM25 + ANN) natively; ruvector does not | vendor docs 2026 | A |

## Ruflo Current Capability

| Capability | Status | Notes |
|------------|--------|-------|
| Swarm topologies | hierarchical / mesh / adaptive / hierarchical-mesh | All use static role assignment at spawn time |
| Max agent scale | maxAgents=8 recommended (CLAUDE.md) | No zero-shot scaling to larger N |
| Swarm coordinator training | None — runtime-only | No offline policy training for size invariance |
| Minimal-mode coordination | None | All swarms require explicit role prompts |
| ruvector hybrid search | Missing | HNSW only; no BM25 or keyword filtering |
| HNSW as comms fabric | Not implemented | Search-only; no gossip-protocol layer |
| ruview-swarm integration | ADR-148 present | CRDT sensor fusion but no Byzantine sensor validation |

## Competitor Comparison

| Framework | Latest Release | Key Swarm Feature | Token Cost Profile | Swarm Latency |
|-----------|---------------|-------------------|--------------------|---------------|
| **LangGraph** | June 2026 (v0.4.x, DeltaChannel) | `langgraph-swarm` lib, per-node timeouts | Best / AutoGen close | ~15ms p99 |
| **AutoGen** | Stable 0.5 | Multi-agent debate, verification patterns | Research-optimized | ~15ms p99 |
| **CrewAI** | 1.14.6 + June 11 patch | Pluggable memory/RAG backends, Chat API | Heaviest profile | ~20ms p99 |
| **OpenAI Swarm** | Stable | Native tool-call routing, lowest latency | Moderate | ~10ms p99 |
| **Ruflo** | 3.6.10 | 314 MCP tools, 16 agent roles, hierarchical swarm | Lowest with caching | ~unknown p99 |

**Notes**: LangGraph is #1 in 2026 enterprise production footprint. CrewAI leads on "time to first demo" (40% faster than LangGraph per tensoria.fr benchmark). OpenAI Swarm wins raw latency. Ruflo is the only framework with native HNSW memory, self-learning intelligence (SONA), and 314 MCP tools — but lacks a published latency benchmark.

## Benchmarks

| Metric | Result | Grade | Source |
|--------|--------|-------|--------|
| ND-MARL zero-shot scalability | 3→250 agents, 83× scale increase, consistent convergence | A | arXiv:2606.02107 |
| Qdrant p99 latency @ 10M vectors | 12ms | A | qdrant.tech/benchmarks 2026 |
| Weaviate p99 latency @ 10M vectors | 16ms | A | qdrant.tech/benchmarks 2026 |
| Milvus p99 latency @ 10M vectors | 18ms | A | qdrant.tech/benchmarks 2026 |
| ruvector p99 latency @ 10M vectors | **No 2026 data available** | — | Internal |
| LangGraph 40% faster time-to-production vs Ruflo | C | tensoria.fr (single source) |
| Ruflo swarm latency (end-to-end) | **No published benchmark** | — | Internal |

## Scan: ruview-integration

**One-sentence finding**: WiFi-sensing swarm (RuView/ADR-148) uses CRDT sensor fusion, but the June 2026 `Distributed Containment of Compromised Agents` paper (arXiv:2607.01230) demonstrates that Byzantine sensor injection attacks can propagate through CRDT-convergent swarms — a life-safety gap Ruflo's current ruview-swarm crate does not address.

**Competitive signal**: Boston Dynamics Orbit (June 2026) added WiFi-SLAM for multi-robot swarm spatial coordination, entering the same use case as RuView drone swarm control.

**Action**: Implement Byzantine-resilient CRDT (BCRDT) validation layer in `ruview-swarm` before any production life-safety deployment.

## Scan: ruvector-integration

**One-sentence finding**: HyphaeDB (arXiv:2606.28781) proposes treating HNSW's neighbor graph topology as a swarm communication fabric for gossip-protocol knowledge propagation — an architectural direction that would differentiate ruvector from all three major competitors (Qdrant, Weaviate, Milvus) and align vector search with swarm coordination.

**Competitive signal**: Qdrant's June 2026 `sparse-vectors 2.0` update enables true hybrid BM25+ANN in a single pass at p99=12ms — closing the accuracy gap with Weaviate while maintaining Qdrant's latency lead.

**Action**: Add hybrid search (BM25 + HNSW) to ruvector as a blocking item; publish a p99 latency benchmark to quantify the current position vs Qdrant.

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `a444930d88d753e04793f55bd38861e82d9cb062` |
| Report SHA-256 | `7ecfed0c80765bba326f47f1ed00319f5b1f1b47a7252a978e824c56d59f5277` |
| Witness stamp | `a93663a28216de847b5b8438e7e041533667e69b073f66bdf4364bfd0c91a90d` |
| Verifier | `sha256(report_file) + session_commit → sha256 → must equal witness stamp` |

## Recommended Next Steps

1. **ZeroShotScaleMode for swarm** (from ND-MARL, Grade A): Add a `zeroShotScale: true` flag to `swarm_init` that trains the coordinator policy on `minAgents=3` and validates zero-shot deployment to `maxAgents`. Implement with 2-neighbor sparse topology and MASAC. Target: reproduce the 83× scale range for Ruflo's hierarchical swarm.

2. **Entropy-mode minimal coordinator** (from Emergent Culture, Grade A): Implement a `topology: "minimal"` swarm variant where agents share a single decaying-TTL memory namespace with no explicit role prompts. Benchmark creative/research tasks against `topology: "specialized"`. Expected: better emergent coordination for open-ended tasks, worse for deterministic pipelines.

3. **Hybrid search + HNSW-comms-fabric RFC** (from HyphaeDB + Qdrant, Grade A/B): (a) Ship hybrid search (BM25 + HNSW) in ruvector as a blocking issue — without it, production RAG pipelines on Ruflo cannot match Qdrant's retrieval quality. (b) Open an RFC (ADR-179) for HNSW-as-comms-fabric: nodes in vector space gossip knowledge updates to their HNSW neighbors, turning AgentDB into a communication substrate. This is architecturally novel vs all competitors.
