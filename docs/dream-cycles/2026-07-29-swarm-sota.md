# Swarm SOTA Report — 2026-07-29

**TL;DR:** Adaptive pheromone swarm consensus (TPSC, July 2026, Grade A) achieves 50% active-agent reduction with +11.6% fitness improvement — Ruflo's static swarm topology has no equivalent dynamic pruning mechanism. Weaviate Engram (GA June 2026) enters the agent memory market directly competing with ruvector's AgentDB layer.

---

## What's New in 2026 (Swarm Deep Dive)

| Finding | Source | Confidence |
|---------|--------|------------|
| TPSC Adaptive Pheromone Consensus: 50% agent reduction, +11.6% fitness, consensus rate 0.97±0.02, r=0.93 support–quality correlation | arXiv 2607.03628, Jul 2026 | A |
| SPIN Tensorized Policy Coordination: MPS-chain topology, linear vs exponential joint-action scaling, zero-shot multi-goal transfer | arXiv 2606.07557, Jun 2026 | A |
| Hierarchical MCP planner-executor at exascale (Aurora HPC): low coordination overhead, validates MCP as swarm substrate | arXiv 2604.07681, Apr 2026 | A |
| RAPS intent-based pub/sub + Bayesian reputation BFT: topology emerges from task semantics, no pre-configuration required | arXiv 2602.08009, Feb 2026 | B |
| 3-Level UAV Swarm Meta-Cognition: 22 formal contracts across 6 components, swarm monitors own cognitive state | arXiv 2607.14093, Jul 2026 | B |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|------------|--------|-------|
| Swarm topologies | hierarchical / mesh / adaptive / hierarchical-mesh | Static at `swarm init` time |
| Dynamic agent count | maxAgents=8 hard cap (anti-drift default) | No runtime pruning |
| Consensus | Raft (leader-based), BFT (byzantine-coordinator), Gossip, CRDT | No pheromone/emergent mechanism |
| MCP as swarm substrate | Yes — all swarm coordination via MCP tools | Aligned with arXiv 2604.07681 validation |
| Bayesian fault detection | No — BFT flag is binary (faulty/healthy) | RAPS Bayesian reputation more granular |
| Swarm Meta-Cognition | Partial — SONA 0.0043ms/adapt + MoE routing | No formal multi-timescale cognitive contracts |

---

## Competitor Comparison

| Framework | Swarm Topology | Dynamic Pruning | Pheromone/Emergent | BFT | Latest (Jul 2026) |
|-----------|---------------|:---------------:|:-----------------:|:---:|-------------------|
| **Ruflo** | hierarchical/mesh/adaptive | ❌ None | ❌ None | ✅ byzantine-coordinator | 3.6.10 |
| **LangGraph** | Graph DAG (node-based) | ❌ None | ❌ None | ❌ None | v1.2.10 (39.2M monthly PyPI) |
| **AutoGen/MAF** | AutoGen Swarm pattern; async event-driven | ❌ None | ❌ None | ❌ None | MAF v1.0 GA (Apr 2026) |
| **CrewAI** | Sequential/Hierarchical/Consensual | ❌ None | ❌ None | ❌ None | Inline skills + Flow authoring (A) |
| **OpenAI Swarm** | Archived → Agents SDK | ❌ N/A | ❌ N/A | ❌ N/A | Not maintained |

---

## Benchmarks

| Benchmark | Result | Grade |
|-----------|--------|-------|
| TPSC 500-run swarm consensus (arXiv 2607.03628) | acceptance rate 0.97±0.02; hypothesis-support >0.99; inter-agent agreement 0.82±0.06; Adaptive-TPSC 50% agent reduction +11.6% fitness | **A** |
| SPIN zero-shot multi-goal transfer (arXiv 2606.07557) | Linear O(n) coordination scaling vs exponential joint enumeration; validated on 3 distinct regimes | **A** |
| HPC MCP orchestration on Aurora exascale (arXiv 2604.07681) | Low coordination overhead, high completion rate at full CoRE MOF database scale | **A** |
| Ruflo HNSW (measured in-tree, N=20k) | ~1.9x speedup vs brute force; recall@10 ~0.99 | **A** |

---

## Scan Findings — ruview-integration

**Source:** Martian Code Review Bench (Feb 2026, ex-DeepMind/Anthropic/Meta researchers); CodeAnt AI blog; arXiv 2603.23448.

**Finding:** The Martian Benchmark evaluates 17 code review tools against 200,000+ real pull requests using behavior-based signal (developers fixing code after a comment = meaningful comment). Qodo ranks #1 on hardest reviews; CodeAnt AI ranks #3 at 51.7% F1. LangGraph is the preferred framework for code review agents requiring audit trails; AutoGen/AG2 preferred for iterative coder/reviewer negotiation loops. **Grade B** (benchmark methodology credible; vendor F1 scores are self-reported citations of the benchmark).

**Gap:** Ruflo's `github-code-review` skill uses swarm coordination but has no behavior-based evaluation harness equivalent to the Martian methodology. ruview currently produces comments with no feedback loop measuring whether developers act on them.

**Competitive signal:** CrewAI shipped **inline skill definitions** and a **Flow Definition authoring skill** in July 2026 — the closest feature-parity overlap with Ruflo's `skill-creator` skill yet observed.

---

## Scan Findings — ruvector-integration

**Source:** Weaviate blog (direct fetch, Jul 2026); Qdrant blog (direct fetch, Jul 2026); Milvus 2.6 blog.

**Findings:**
- **Weaviate Engram** (GA June 3, 2026): Full managed agent memory platform — episodic, semantic, and procedural tiers with MCP server built-in. **Grade A** (primary source). Direct competitor to Ruflo AgentDB + ruvector layer.
- **Qdrant** (Jul 2026): 2× throughput vs Elasticsearch; sub-10ms at production scale documented; MCP-native. **Grade A** (primary source + corroborated).
- **Milvus 2.6** RaBitQ 1-bit quantization: 72% memory reduction, 95% recall at 10M vectors; 4× faster than Elasticsearch. **Grade B** (vendor blog, no independent replication).

**Gap:** Ruflo's AgentDB + HNSW is embedded/local; no `--backend qdrant/weaviate/milvus` adapter exists. Weaviate Engram is the highest-urgency signal — it ships a managed memory platform that competes with ruvector at the product level, not just the storage layer.

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `314ad1eb0b5463567ff80bbf18e25ecad2ee7e43` |
| Report SHA-256 | `13aaf8f4344322f3443e814245ee4656e4e483ef0d3d14f29f306509226d800b` |
| Witness stamp | `5ad489ef1a828bdb8e77989bc9eeabeea11a707c7066e8ed8b166c7815083e6e` |

Verifier: `sha256sum dream-gist-2026-07-29.md` → concat session commit (no separator) → `sha256sum` → must equal Witness stamp.

---

## Recommended Next Steps

1. **Implement ADR-330 Adaptive Pheromone Swarm Consensus (APSC):** Add a `topology: "pheromone-adaptive"` option to `swarm init`. Each agent emits a pheromone score (task-success signal) after each turn; the coordinator prunes agents whose score falls below the adaptive threshold. Target: 30–50% reduction in active agents on convergent tasks without quality loss. File in `v3/@claude-flow/hooks/src/workers/pheromone-pruner-worker.ts`. Hook: `post-task`.

2. **Add ruview behavior-based evaluation harness:** Implement Martian-methodology evaluation in the `github-code-review` skill — track whether PR authors fix code within 48h of ruview's comments. Instrument `post-task` hook to record comment IDs; schedule `audit` worker to check resolution rates. Target metric: >50% developer-action rate (beating CodeAnt AI baseline of 51.7% F1).

3. **Add Weaviate Engram as ruvector backend option:** Implement `--backend weaviate-engram` flag in `memory search` / `memory store` CLI commands, delegating to Weaviate's MCP server when available. This unblocks multi-agent deployments that exceed AgentDB's SQLite scale ceiling without changing the internal HNSW interface contract.
