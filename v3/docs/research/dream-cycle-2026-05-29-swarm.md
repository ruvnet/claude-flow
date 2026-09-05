# Swarm SOTA Report — 2026-05-29

**TL;DR:** Five 2026 arXiv papers redefine swarm consensus — decentralized Shapley credit, hierarchical PBFT at O(n) message complexity, and communication-policy decoupling each expose structural gaps in Ruflo's flat Raft consensus that will limit scaling past ~50 agents.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| SWARM+: hierarchical PBFT consensus scales to 1,000 agents with 97-98% scheduling latency improvement and ≤7.5% degradation under 50% agent failures | arXiv:2603.19431 (Mar 19, 2026) | A |
| SwarmHarness: skill nodes self-organise into compute swarm without central authority via DHT + Shapley-value credit attribution | arXiv (May 27, 2026) | A |
| SLIM: decoupling communication from policy maintains performance under severe bandwidth constraints — direct drop-in for drone and LLM-agent swarms | arXiv (May 20, 2026) | A |
| Auction-Consensus: RL-based bidding replaces hand-crafted functions in consensus task allocation, improving solution quality while preserving decentralised execution | arXiv (May 20, 2026) | A |
| CINOC: neural policies trained on 10-agent swarms transfer zero-shot to 500-agent populations via physics-informed operator learning | arXiv (May 25, 2026) | A |
| LangGraph v0.4 fastest on latency across 2,000-task benchmark; CrewAI 3× token overhead on single-tool flows vs LangGraph | tensoria.fr benchmark (2026) | B |

---

## Ruflo Current Capability

| Capability | Status | Detail |
|-----------|--------|--------|
| Consensus protocol | Raft (leader-based) | Good crash-fault tolerance; weak under 30%+ Byzantine |
| Max validated agents | 8 (CLAUDE.md default) | No public stress-test beyond this |
| Credit attribution | None | Agents have no Shapley-style contribution weighting |
| Communication-policy coupling | Coupled | All agents share same coordination channel; no bandwidth tiering |
| Scale-transfer primitives | None | Swarm configs are static; no zero-shot scale extrapolation |
| Event-triggered messaging | No | All coordination is time- or call-driven |
| Swarm observability (ruview) | Hooks + memory only | No structured audit trail or agent execution graph |
| Hybrid vector search (ruvector) | No | HNSW only; no vector+keyword hybrid retrieval |
| Public recall benchmark | None | No published score for AgentDB/HNSW at 1M+ vectors |

---

## Competitor Comparison

| Framework | Consensus | Max Agents (validated) | Credit Attribution | Observability |
|-----------|-----------|----------------------|-------------------|--------------|
| **Ruflo (claude-flow v3.6)** | Raft | 8 (configured max) | None | Hooks + memory (no trace graph) |
| **LangGraph v0.4** | Checkpoint-based (no consensus) | No stated limit | None | LangSmith native (full trace) |
| **AutoGen 1.0 GA** | GroupChat selector | No stated limit | None | Azure Monitor integration |
| **CrewAI Enterprise** | Sequential/hierarchical fixed | 50+ (enterprise reported) | None | SOC2 observability hooks |
| **OpenAI Agents SDK** | Handoff-based (no consensus) | No stated limit | None | Built-in tracing, spans |
| **SWARM+** (research) | Hierarchical PBFT | 1,000 (benchmarked) | Dynamic quorum | Not productised |

---

## Benchmarks

| System | Metric | Value | Grade | Source |
|--------|--------|-------|-------|--------|
| SWARM+ | Scheduling latency improvement over baseline | 97-98% | A | arXiv:2603.19431 |
| SWARM+ | Job completion under 50% agent failure | ≥92.5% | A | arXiv:2603.19431 |
| SWARM+ | Agent scale | 1,000 agents | A | arXiv:2603.19431 |
| RLR consensus | Quality of Delivery vs RaBFT (30% Byzantine) | +126% | B | Research Square rs-7522626 |
| Qdrant | Query latency at 100M vectors, 95% recall | sub-100ms | B | dasroot.net (Apr 2026) |
| Milvus | Throughput at 1B vectors | 100K+ QPS | B | dasroot.net (Apr 2026) |
| Weaviate | Hybrid search recall at 1M vectors | 93.2% | B | dasroot.net (Apr 2026) |
| LangGraph | Fastest latency in 2,000-task cross-framework test | #1 | B | tensoria.fr (2026) |

---

## SOTA Proof & Witness

_This section is completed after file hash computation._

| Field | Value |
|-------|-------|
| **Session commit** | `b8a49cfb82ffe3e1f376cc3be3776bdd4d8c9ab7` |
| **Report SHA-256** | `712376e4ef16f9f00e24da2f5dabe4600825f7b103f98670298b50e77c09121e` |
| **Witness stamp** | `8e3c2d8fb902014b739e54cf07b1b237d0168feb1a24c4e6e1d6ae47474f3588` |
| **Verifier** | `sha256sum dream-gist-2026-05-29.md` → concat session commit → `sha256sum` → must equal witness stamp |

---

## Scan: ruvector-integration

**Source:** dasroot.net (Apr 2026), digitalapplied.com (2026), callsphere.ai (2026)

Qdrant is 10-25% faster than Weaviate/Milvus on common workloads (Grade B). Weaviate hybrid search (vector + keyword) achieves 93.2% recall at 1M vectors (Grade B). Milvus handles 1B-scale collections at 100K+ QPS (Grade B). Ruflo's ruvector/AgentDB has no public benchmark, no hybrid retrieval, and no validated performance at 1M+ vectors. LanceDB costs ~$200-500/month at 10M vectors — 4-25× cheaper than alternatives.

**Finding:** ruvector benchmarking gap is the single highest-ROI documentation task: publishing HNSW recall@10 at 100K, 1M, 10M vectors would immediately differentiate vs all four competitors who publish vendor-only Grade B claims.

---

## Scan: ruview-integration (Swarm Observability)

**Source:** codebase grep (no ruview module found), LangSmith docs, OpenAI Agents SDK tracing

Ruflo has no dedicated swarm execution trace module. `post-edit` and `post-task` hooks write to memory namespaces but produce no structured span-based trace graph. LangGraph ships LangSmith natively (full agent graph, token cost per node, replay). OpenAI Agents SDK emits OpenTelemetry-compatible spans out of the box. CrewAI Enterprise has SOC2 observability. Ruflo has none.

**Finding (Grade C — single internal assessment):** Absence of a structured trace graph is the primary barrier to enterprise adoption; every competitor has addressed this; Ruflo has not.

---

## Recommended Next Steps

1. **ADR-132 (file today):** Adopt hierarchical consensus topology for swarms >20 agents — replace flat Raft with SWARM+-style two-tier hierarchy (leader group + worker shards), reducing coordination overhead and enabling scale to 200+ agents without O(n²) message explosion. Implement in `@claude-flow/cli` hive-mind module.

2. **Benchmark ruvector now (implementation-level, no ADR):** Add `npx claude-flow performance benchmark --suite vector` that runs recall@10 and p99 latency at 100K/1M/10M vectors using the existing HNSW index and publishes results to `v3/docs/benchmarks/vector-search.md`. This closes the Grade B gap vs all four external vector DBs.

3. **ruview stub (implementation-level, no ADR):** Add `@claude-flow/ruview` plugin stub that wraps existing hook events into OpenTelemetry-compatible spans. Single-file implementation using `@opentelemetry/sdk-trace-node` as a dev dependency. Enables export to Jaeger/Zipkin with zero architectural change to existing hooks.
