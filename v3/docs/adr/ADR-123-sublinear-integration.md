# ADR-123 — RuFlo Graph Intelligence Engine: real-time relationship intelligence with complexity-aware execution

**Status**: Proposed (2026-05-18) — revised 2026-05-19 to track upstream `sublinear-time-solver@1.7.0`
**Date**: 2026-05-18
**Authors**: claude (drafted with rUv)
**Related**: [`sublinear-time-solver@1.7.0`](https://www.npmjs.com/package/sublinear-time-solver) ([crates.io `sublinear@0.3.0`](https://crates.io/crates/sublinear), [github](https://github.com/ruvnet/sublinear-time-solver), [1.6.0 announcement gist](https://gist.github.com/ruvnet/342518ef950348c376bc7c04ffeb5337), [upstream `sublinear` ADR-001 "Complexity as Architecture"](https://github.com/ruvnet/sublinear-time-solver/blob/main/docs/adr/ADR-001-complexity-as-architecture.md)), [eleven-wedge research gist](https://gist.github.com/ruvnet/61d6d04af514b3c81ad0abf1e37fe116), ADR-103 (witness temporal history), ADR-104 (federation wire transport), ADR-105 (federation state snapshot), ADR-118 (AIDefence 2.3.0), ADR-121 (embeddings RuVector upgrade), ADR-122 (browser substrate). Library lineage: [Andoni–Krauthgamer–Pogrow ITCS 2019 (SDD sublinear)](https://arxiv.org/abs/1809.02995), [Kyng–Sachdeva FOCS 2016 (approx Cholesky)](https://rasmuskyng.com/research.html), [Asymmetric DD sublinear (2025)](https://arxiv.org/abs/2509.13891), [Friedkin–Johnsen application (2025)](https://arxiv.org/abs/2509.13112).
**Supersedes**: nothing (additive)

## Strategic positioning (the headline)

RuFlo isn't shipping "a faster solver". It is committing to a new architectural stance:

> **Intelligence that understands its own computational cost.**

Traditional AI systems recompute everything. RuFlo only computes what changed enough to matter, only at the depth the runtime can afford, and only over the relationships that are still load-bearing.

### The RuFlo Intelligence Stack (after ADR-123)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Neural Layer  —  adaptive learning                                  │
│  Trajectories • RL • ReasoningBank • SONA • EWC++                    │
│  "What works, learned from experience"                               │
├──────────────────────────────────────────────────────────────────────┤
│  Graph Intelligence Layer  —  relationship reasoning   ←  ADR-123    │
│  Causality • Trust • Influence • Dependencies • Blast-radius         │
│  "What is connected to what, and by how much"                        │
├──────────────────────────────────────────────────────────────────────┤
│  Complexity Layer  —  runtime governance              ←  ADR-123     │
│  Budget gates • Edge safety • Coherence checks • Delta-only updates  │
│  "Compute only what the runtime can afford to compute"               │
└──────────────────────────────────────────────────────────────────────┘
```

The three layers compose. Neural patterns nominate candidate decisions, graph intelligence scores their relationship impact, the complexity layer admits the work only if it fits the runtime's budget. **No competing system combines all three.**

### Plain-language framing (for the README, not the architects)

> RuFlo continuously reasons across agents, memory, infrastructure, workflows, and distributed systems while automatically adapting computation to available runtime budgets.

| Technical primitive | Product positioning |
|---|---|
| Single-entry personalized PageRank | **Relationship intelligence** |
| Sparse propagation / forward-push | **Continuous awareness** |
| `solve_on_change(prev, delta)` | **Event-driven updates** |
| `maxComplexityClass` budget gate | **Budget-aware intelligence** |
| Witness-signed PR vectors | **Verifiable reasoning** |
| `coherence_score` rejection | **Stability monitoring** |
| Streaming delta propagation | **Live adaptive reasoning** |

### Why this matters operationally

Every team running agents has hit one or more of these:

- cost overruns from runaway compute
- runaway agents that don't know when to stop
- browser UIs that freeze on heavy reasoning
- edge / battery / Pi-class devices that can't afford full graphs
- federation peers that can't negotiate compute budgets
- distributed systems where state changes faster than full re-solves can complete

ADR-123 commits to treating **complexity as a runtime contract**, not an academic property. `maxComplexityClass` is computational QoS for intelligence systems — agents request bounded computation, edge devices reject unsafe workloads, browsers stay responsive, federation peers negotiate budgets. The contract is enforced by the solver itself (upstream 1.7.0 `Complexity` trait), not by hopeful retry-and-cancel scaffolding.

### Self-regulating cognition infrastructure

Adding complexity classes + coherence gates + incremental deltas + streaming updates is not a performance optimisation. It is a category move: from *graph-accelerated agent* to *self-regulating cognition infrastructure*. The substrate now knows what it's spending, what it's stable on, and what it changed since the last tick. Everything else in ADR-123 (the eleven wedges, the signed PR artifact, the federation distribution) flows from that stance.

The rest of this document is the technical commitment — five SOTA axes surveyed, the eleven RuFlo graphs catalogued, the architecture diagrammed, an eight-phase rollout, and seven open questions. Lead from the layered story above; the layers are the architecture, not just the marketing.

---

## Upstream version update (2026-05-19 revision)

`sublinear-time-solver@1.7.0` shipped 2026-05-19 with three additions that materially shape this ADR. All three were called out as risks or open questions in the original 1.6.0 draft and are now resolved upstream:

| Upstream 1.7.0 addition | Effect on this ADR |
|---|---|
| **`Complexity` trait + 12-tier `ComplexityClass` enum** (`src/complexity.rs`) — every public solver declares its worst-case class at the type level; `is_edge_safe()` filters by Pi-Zero-class budgets; `Adaptive { default, worst }` carries both bounds | **Phase 1 exposes `max_complexity_class` as a budget arg on every MCP call**, wired into the existing ADR-026 3-tier model router (`hooks_route`). Tier 1 (Agent Booster, $0) routes to `Logarithmic`-class single-entry queries only; Tier 2 (Haiku) tolerates `Linear`; Tier 3 (Sonnet/Opus) accepts `Polynomial` full-solves. The same gate handles the browser substrate's Phase 6 `BrowserExecutionAdapter` edge runtimes (Cloudflare Workers, Deno Deploy) via `is_edge_safe()` |
| **Coherence gate** — `coherence_score(&dyn Matrix) -> f64` (per-row DD margin in [−∞, 1]) + `SolverError::Incoherent { coherence, threshold }`; opt-in via `SolverOptions::coherence_threshold` (default 0.0 = disabled, wire-compatible) | **Closes original Open Question #5 (failure modes when source matrix is not DD).** Plugin adapters call `coherence_score()` before submitting a graph; ADR-123 no longer needs to hand-roll a DD check. The structured `Incoherent` error has `is_recoverable() = true` and severity `Low`, so plugins can fall back gracefully (clamp weights, renormalise, switch to dense solver) without crashing |
| **`solve_on_change(matrix, prev_solution, delta)` event-gated entry** (`src/incremental.rs`) via the `IncrementalSolver` extension trait blanket-impl'd on every `SolverAlgorithm`. Solves `A·dx = delta` then `x_new = prev + dx`; sparse RHS gives asymptotically faster solves on small deltas; sidesteps the Neumann initial-guess trap | **Adds a new wedge to this ADR (Wedge 12, below): incremental PageRank for streaming systems.** Streamlined for federation peers exchanging trust-delta updates, MCTS branch additions during exploration, causal-break events appended in real time, cost-attribution increments per spend, and observability span streams. Re-uses the same `ruflo-sublinear` plugin surface — no new MCP tool needed beyond exposing the `delta` parameter |

Upstream also shipped its own [ADR-001 "Complexity as Architecture"](https://github.com/ruvnet/sublinear-time-solver/blob/main/docs/adr/ADR-001-complexity-as-architecture.md), formalising the same compile-time-complexity-as-architecture stance RuFlo's ADR-026 takes for model routing. The two ADRs are mutually reinforcing: ruflo-sublinear is the *call surface* and the upstream complexity classes are the *budget contracts* it negotiates against.

Test counts updated: upstream 137 → 151 (lib only) at 1.7.0; full matrix 148/148 green. The original `sublinear-time-solver@1.6.0` was unbuildable on macOS Apple Silicon before its `aarch64 mrs cntvct_el0` fix — 1.7.0 is the first release that runs cleanly on the M-series macOS hosts where most of the RuFlo team works.

## Core thesis (beyond-SOTA wedge, stated first)

The strategic frame above ("complexity as a runtime contract") is the *product* claim. This section names the *architectural* moat that makes it credible.

RuFlo is the only agent platform in the field that already ships **Ed25519-signed witness chains** (ADR-103), **portable RVF cognitive containers** (`@ruvector/rvf@0.2.1`), and a **federated peer mesh with budgeted transport** (ADR-104/105/111). Layer `sublinear-time-solver@1.7.0` on top of that substrate and RuFlo gains a capability that LangGraph, AutoGen, Letta, MemGPT, Mem0, HippoRAG, and every browser-agent vendor structurally cannot produce: **signed, replayable, federatable, complexity-budgeted, coherence-gated personalized-PageRank artifacts**.

A signed PR artifact is a single small object that says:

> "Installation A, witness key X, computed personalized PageRank π over graph G at timestamp T, with α=0.85, ε=10⁻³, using single-entry forward-push at row r, in complexity class `Adaptive { Logarithmic, Linear }`, at coherence margin 0.42. Vector hash H. Signature S over (X, T, G-id, α, ε, r, class, coherence, H)."

The artifact carries not just the *result* but the *cost class it was computed at* and the *stability margin of the input*. Federation peers receiving the artifact can verify all three: the signature (provenance), the complexity class (budget compliance — "this won't blow up my runtime if I replay it"), and the coherence margin (stability — "the math was well-defined on this input"). That is what "verifiable reasoning" actually means.

Federation peers can request this object instead of re-walking the graph. A peer that trusts X's witness key can use π directly. A peer that doesn't can verify the structure, replay the computation locally (single-entry forward-push at `r` over the *same* G is deterministic given α, ε), and confirm the byte-for-byte hash. The provenance moat from ADR-122 (signed browser trajectories) generalizes to signed graph-reasoning vectors — every PageRank over a causal graph, every transitive-trust closure, every cost-attribution roll-up, every blast-radius score becomes a verifiable, portable artifact rather than an ephemeral local computation.

This is the architectural claim. It is novel against the current literature on agent-memory frameworks ([no existing system combines portability, cryptographic integrity, capability-based access, injection-resistant rehydration, and quantitative fidelity](https://arxiv.org/html/2605.11032v1)) and against the current literature on verifiable inference (which signs *model outputs* via zk-SNARKs, not *graph-reasoning artifacts*; [ZK-DeepSeek, ZKPROV](https://arxiv.org/abs/2511.19902) prove "the model emitted this token" but not "the agent's causal-graph said this span was to blame"). Phase 7 below promotes this primitive to a federation-distributable object.

The rest of the ADR enumerates the eleven graphs RuFlo already runs (from the research gist), the integration mechanics that turn each into a sublinear primitive, and the eight-phase rollout that lands the substrate without regressing ADR-122.

## SOTA exploration

Five axes were surveyed before committing to this design. Each axis closes with the "beyond-SOTA" insight the ADR commits to.

### 1. Sublinear algorithms for diagonally-dominant systems

The foundational result is [Andoni, Krauthgamer, Pogrow, ITCS 2019](https://arxiv.org/abs/1809.02995): a single coordinate of `x` in an SDD system `M x = b` can be approximated in `Õ(polylog n / ε²)` time without materializing the full solution, by combining random-walk sampling with local push. Earlier, [Kyng & Sachdeva, FOCS 2016](https://rasmuskyng.com/research.html) shipped approximate Cholesky factorization for SDD systems, the practical workhorse for full-solve when you need *every* coordinate. The 2025 follow-ups close two important gaps: [Cheng et al. 2509.13891](https://arxiv.org/abs/2509.13891) extends single-entry sublinear solving to **asymmetric** (row- and column-) diagonally-dominant systems by unifying Forward Push and Backward Push under a "maximum p-norm gap" complexity measure, and [Friedkin–Johnsen application 2509.13112](https://arxiv.org/abs/2509.13112) proves a sublinear opinion-estimation algorithm on directed weighted graphs. `sublinear-time-solver@1.6.0` is the production-engineered embodiment of this line, with measured 816 ns Conjugate-Gradient solves on n=256 SPD systems and 47% Neumann throughput improvement over 1.5.0 from corrected convergence-exit logic.

**Beyond-SOTA insight committed:** the asymmetric-DD result is load-bearing for RuFlo. Most of the eleven RuFlo graphs are *not* symmetric (federation trust is one-way, span causality is one-way, file imports are one-way, cost attribution is one-way). Many integrations would have stalled on "your matrix is not SDD". The 2025 RDD/CDD result makes them all in-scope.

### 2. GOAP / hierarchical task planning at scale

The classical planning stack — Fast Downward, Pyperplan, PDDL — gives rigorous guarantees but struggles on long-horizon ambiguous goals. The 2024–2026 wave of work, exemplified by [LaMMA-P](https://arxiv.org/html/2602.21670) and [GoalAct (NCIIP 2025 Best Paper)](https://github.com/cjj826/GoalAct), tightly couples an LLM-driven subtask extraction layer with Fast Downward A\* search to get the best of both. The recurring failure mode in this literature: planners enumerate *every* precondition state as if all edges in the action graph are equally weighted, then take seconds-to-minutes to backtrack out of dead-end branches. [Why Do LLM-based Web Agents Fail?](https://arxiv.org/pdf/2603.14248) attributes most observed failures to hierarchical-planning bottlenecks rather than action-grounding errors.

**Beyond-SOTA insight committed:** RuFlo's `ruflo-goals` plugin can short-circuit dead-end enumeration by formulating the relaxed precondition feasibility problem as a Kyng–Sachdeva packing/covering LP (Wedge 9). Microsecond feasibility checks before invoking A\* search dominate any "smart LLM subgoal proposer" — you prune the branch *before* you spawn the LLM call, not after.

### 3. PageRank / personalized PageRank as the agent-substrate primitive

Personalized PageRank (PPR) has quietly become the dominant primitive for agentic memory and retrieval. [HippoRAG](https://graphwise.ai/blog/from-retrieval-to-reasoning-enhancing-hipporag-with-graph-based-semantics/) ([RAG paper, neurobiologically-inspired](https://www.researchgate.net/publication/397199630_HippoRAG_Neurobiologically_Inspired_Long-Term_Memory_for_Large_Language_Models)) uses PPR over an LLM-extracted knowledge graph as a single-step retrieval substitute for multi-hop iterative RAG. Pinterest's Pixie graph-recommendation engine and Microsoft's enterprise search both ship PPR in production for multi-hop entity reasoning. The current frontier is **single-entry** PPR — you don't need the full vector, you only need π[r] for a query node r. AKP19 makes this `Õ(polylog n)`; the 2025 asymmetric extension makes it work on directed/weighted graphs. No agent memory framework in the [2026 comparison surveys](https://vectorize.io/articles/mem0-vs-letta) (Letta, Mem0, MemGPT, LangMem, Zep) ships single-entry PPR — they all do full-vector PR (or skip it entirely for vanilla cosine k-NN).

**Beyond-SOTA insight committed:** RuFlo's substrate has *eleven* live graphs (research gist). Every one of them admits a single-entry PPR formulation. The cost is not "build a graph" — the graphs already exist; the cost is just plumbing the PPR query through. That's a 100× to 2000× speedup per query against the current baseline implementations (full PR walks), achieved by *substitution*, not by inventing new memory primitives.

### 4. Cryptographic provenance for AI computations

The 2025–2026 verifiable-inference wave centers on **proving the model emitted what it emitted**. [ZK-DeepSeek](https://arxiv.org/abs/2511.19902) translates DeepSeek-V3 (671B params) into a SNARK-verifiable circuit with constant-size proofs; [ZKPROV](https://arxiv.org/html/2506.20915) proves an LLM was trained on a specific authorized dataset; [Lagrange DeepProve](https://lagrange.dev/blog/dynamic-zk-snarks) ships dynamic zk-SNARKs that allow incremental retraining proofs. Separately, the agent-memory security literature has converged on a different conclusion: [memory poisoning is the dominant threat](https://arxiv.org/html/2603.20357v1) and [the failure mode is misattribution of externally injected content as own experience](https://arxiv.org/html/2604.16548v1). Existing defenses fail because they detect malicious actions, not corrupted beliefs.

**Beyond-SOTA insight committed:** RuFlo already has the right primitive to address *both* problems and neither problem is currently addressed by signed model outputs alone. ADR-103's witness chain plus ADR-122's RVF-signed trajectories are domain-specific provenance objects. Extending them to cover signed PageRank vectors (Phase 7 below) means a federation peer can prove "this is the trust-closure I computed over this attested federation membership snapshot at this time with these parameters" — a memory-poisoning attack that mutates the trust graph upstream becomes detectable in O(verify) time because the recomputation produces a different hash. zk-SNARK over a sublinear-PR computation is **not** required; an Ed25519 signature over the inputs + hash of the output suffices because the computation is publicly replayable and deterministic given α and ε. This is dramatically cheaper than SNARK-circuit-encoded PageRank.

### 5. Competitive landscape for AI-agent memory + planning substrates

| System | Memory tier | Planning | Graph primitive | Cryptographic provenance | Federation |
|---|---|---|---|---|---|
| LangGraph + LangMem | Structured store, namespaced | LLM-only | none | none | none |
| AutoGen | In-context + ext store | LLM-only | none | none | none |
| Letta (MemGPT) | Three-tier (core / archival / recall) | LLM-managed | none | none | none |
| Mem0 | Framework-agnostic SDK | none | none | none | none |
| HippoRAG | KG + PPR retrieval | none | **PPR (full)** | none | none |
| Zep | Temporal KG | none | partial | none | none |
| RuFlo (today) | RVF + AgentDB + HNSW | GOAP + MCTS (ADR-122 Phase 4) | partial (HNSW vector) | **Ed25519 + RVF** | **ADR-104/105/111** |
| **RuFlo (after ADR-123)** | + signed PR artifacts | + microsecond feasibility | **single-entry PPR over 11 graphs** | **signed PR vectors** | **federation-distributable PR cache** |

LangGraph and Letta are locked into their own runtimes; switching means rebuilding the memory layer ([Letta vs LangChain Memory comparison](https://vectorize.io/articles/letta-vs-langchain-memory)). HippoRAG ships PPR but only one (full-vector) and only over one graph. None of the surveyed systems ship cryptographic provenance for *any* memory artifact, let alone graph-reasoning artifacts.

**Beyond-SOTA insight committed:** the comparative gap is not "RuFlo has a sublinear solver while others don't" (that's a library swap any competitor can make in a sprint). The gap is "RuFlo has eleven live graphs *already wired into the substrate* AND it has the cryptographic primitives to sign their reductions AND it has the federation transport to distribute them". The combination is the moat.

## Context — the eleven graphs RuFlo already runs

The research gist enumerates eleven plugins whose internals are graph computations that today are paid for in `O(n)` or `O(nnz)` walks. Each one is restated below with the matrix form, the sublinear op that replaces it, the current cost, and the wired-up call site in the repo.

| # | Plugin | Graph | Matrix form | Sublinear op | Today's cost | After |
|---|---|---|---|---|---|---|
| 1 | `@claude-flow/browser` (ADR-122 Phase 2) | Selector-break ↔ DOM-mutation causal graph | `(I − αP^T)π = (1−α)e` | Single-entry forward-push | O(N) walk per snapshot | O(log N) per element-ref |
| 2 | `@claude-flow/browser` (ADR-122 Phases 4 + 7) | MCTS tree | `v = r + γPv` (Bellman) | Single-entry PR (value approx) | depth-O(d) UCT-only | O(log branches) global value augment |
| 3 | `ruflo-federation` | Peer trust mesh | `(I − αT)τ = e` (α=0.7) | Single-entry forward-push | O(N²) closure walk | O(log peers) |
| 4 | `ruflo-knowledge-graph` | Entity-relation graph | Standard PR (α=0.85) | Single-entry PR | O(nnz) per query (≥100 ms @ 10k) | sub-ms |
| 5 | `ruflo-rag-memory` | Graph-RAG chunk connectivity | Personalized PR seeded by query embedding | Single-entry PPR (top-K) | flat-MMR rerank | O(log chunks) per candidate |
| 6 | `ruflo-cost-tracker` | Prompt → agent → MCP → model causation | `(I − αP^T)blame = e` | Single-entry PR | O(traces) | O(log traces) |
| 7 | `ruflo-observability` | Span dependency graph | Standard PR on spans | Single-entry forward-push | O(spans) | O(log spans) |
| 8 | `ruflo-neural-trader` | n/a (covariance matrix Σ — SPD) | `Σx = μ` | CG full solve | Neumann ~50 µs @ n=256 | CG **816 ns** (40–60×) |
| 9 | `ruflo-goals` | n/a (precondition LP) | Kyng–Sachdeva packing/covering LP | ε-feasibility check | O(states) A\* enumeration | microsecond infeasibility detection |
| 10 | `ruflo-aidefence` | Syscall call graph | `(I − αP^T)suspicion = e` (α=0.95) | Single-entry PR from flagged syscall | full trace walk | O(log calls) |
| 11 | `ruflo-jujutsu` (`diff-analyze`) | File-import graph | `(I − αP^T)impact = e` (α=0.8) | Single-entry PR from changed file | O(LOC × imports) per push | O(log files) PR-time |
| **12** | **streaming subset of wedges 1, 3, 6, 7, 10** (browser causal break appends, federation trust deltas, cost-tracker spend events, observability span streams, AIDefence flag updates) — added in 2026-05-19 revision | **any wedge with append-only event input** | **`A·dx = delta` via `solve_on_change`** | **upstream 1.7.0 `IncrementalSolver` trait** | **O(log N) per event but full-cost vector materialisation each tick** | **O(nnz(delta) · log N) per event — pays only for the change** |

Cross-cutting addendum from the gist: `@claude-flow/embeddings` currently ships a hand-rolled Johnson–Lindenstrauss projection with a documented dimension bug. `sublinear-time-solver@1.7.0` ships a hardened JL with the `target_dim ≤ n−1` cap correctly enforced (Achlioptas / Dasgupta–Gupta constant). This is a correctness fix, not a performance fix, and closes the [ADR-121](./ADR-121-embeddings-ruvector-upgrade.md) Phase 4 follow-up.

### Core capabilities the substrate gains

Mapping the twelve wedges into the product-positioning vocabulary from the strategic-positioning section:

- **Real-time root-cause analysis** — single-entry PageRank over the browser causal-recovery graph (W1) and the observability span graph (W7)
- **Trust propagation** — federation peer trust closure (W3) + AIDefence suspicion propagation (W10)
- **Change-impact analysis** — jujutsu file-import blast-radius (W11)
- **Continuous workflow awareness** — MCTS branch global-value augment (W2)
- **Adaptive memory reasoning** — knowledge graph importance (W4) + Graph-RAG personalized retrieval (W5)
- **Federated graph intelligence** — Phase 8 signed PR artifact distribution
- **Streaming event propagation** — Wedge 12 (`solve_on_change` over federation deltas, span streams, append-only causal breaks, cost spend events, AIDefence flag updates)
- **Complexity-aware execution** — `maxComplexityClass` budget gate, threaded through every MCP tool
- **Verifiable reasoning artifacts** — Phase 7 witness-signed PR vectors with embedded `complexity_class` + `coherence_score`

### Built for

- Autonomous agents (`@claude-flow/browser` substrate, ADR-122)
- Browser automation (the ADR-122 stack: Stagehand / Browser Use / Playwright targets)
- AI infrastructure (`@claude-flow/*` monorepo)
- Observability platforms (`ruflo-observability`)
- Security systems (`ruflo-aidefence` + `ruflo-security-audit`)
- Distributed memory (`ruflo-agentdb` + `ruflo-rag-memory` + `@claude-flow/memory`)
- Edge AI (`is_edge_safe()` gate on every MCP call)
- AIoT systems (`ruflo-iot-cognitum` device-coordinator + telemetry-analyzer)

## Architecture

### Layered substrate placement

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Application plugins (eleven graph owners)                              │
│  browser • federation • knowledge-graph • rag-memory • cost-tracker      │
│  observability • neural-trader • goals • aidefence • jujutsu • emb       │
└─────────────────────────┬────────────────────────────────────────────────┘
                          │ exportAsSparseMatrix(opts)  ← adapter contract
                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  ruflo-sublinear  (new plugin)                                          │
│  ─────────────────────────────────────────────────────────────────────  │
│  • MCP tools: page-rank-entry / solve / feasibility / jl-embed / analyze│
│  • Memoization layer (TTL + content-hash key)                           │
│  • Witness-signed PR artifact emitter  ◀── Phase 7 beyond-SOTA wedge    │
│  • Adapter registry (plugin-id → exportAsSparseMatrix fn)               │
└─────────────────────────┬────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  sublinear-time-solver@1.6.0  (npm + crate, WASM + native node addon)   │
│  Neumann • Conjugate Gradient • adaptive random walk • single-entry      │
└──────────────────────────────────────────────────────────────────────────┘
                          ▲
                          │ signed PR artifacts (RVF container, Ed25519)
                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Substrate primitives (already shipped)                                 │
│  ADR-103 witness manifest • @ruvector/rvf • ADR-104/105/111 federation  │
└──────────────────────────────────────────────────────────────────────────┘
```

`ruflo-sublinear` sits between the eleven graph-owner plugins and the solver. It does not own any graphs of its own — every graph stays in its owning plugin's storage (AgentDB, HNSW index, span store, etc.). The adapter contract is the load-bearing boundary.

### Plugin module layout

```
plugins/ruflo-sublinear/
├── plugin.json
├── package.json
├── src/
│   ├── index.ts
│   ├── adapter-registry.ts        # plugin-id → exportAsSparseMatrix fn
│   ├── solver-bridge.ts           # wraps sublinear-time-solver Node API
│   ├── memoization.ts             # content-hash + TTL cache
│   ├── witness-signer.ts          # Phase 7: signs PR artifacts via ADR-103
│   ├── mcp/
│   │   ├── page-rank-entry.ts     # MCP tool: single-entry PR
│   │   ├── solve.ts               # MCP tool: full solve (CG / Neumann)
│   │   ├── feasibility.ts         # MCP tool: LP feasibility
│   │   ├── jl-embed.ts            # MCP tool: JL projection
│   │   └── analyze.ts             # MCP tool: condition number, DD check, sparsity
│   └── types.ts
├── tests/
└── README.md
```

The plugin ships as `@claude-flow/plugin-sublinear` on IPFS (Pinata) and follows the existing plugin registry mechanics in `v3/@claude-flow/cli/src/plugins/store/discovery.ts`.

### Adapter contract

Each graph-owning plugin exposes a per-graph exporter:

```ts
// In every owning plugin, e.g. plugins/ruflo-federation/src/sublinear-adapter.ts
export interface SparseMatrixExport {
  // CSR triplet form, matching sublinear-time-solver's SparseMatrix
  nRows: number;
  nCols: number;
  rowPtr: Uint32Array;
  colIdx: Uint32Array;
  values: Float32Array;
  // Identification (used for content-hash and signed artifact provenance)
  graphId: string;        // "ruflo-federation:trust-mesh"
  graphHash: string;      // content hash of the graph state at export time
  graphTimestamp: number; // unix ms
  // PageRank-specific hints (omitted for non-PR ops)
  alpha?: number;         // damping
  // Asymmetry hint — selects forward-push vs backward-push vs CG
  isSymmetric: boolean;
  isDiagonallyDominant: boolean;
  // Row mapping back into plugin-native node IDs
  rowToNodeId: (row: number) => string;
  nodeIdToRow: (nodeId: string) => number | undefined;
}

export interface SublinearAdapter {
  exportAsSparseMatrix(opts: {
    purpose: "page-rank" | "solve" | "feasibility" | "jl";
    seedNodes?: string[];   // for personalized PR
  }): Promise<SparseMatrixExport>;
}
```

Adapters live in the owning plugins (not centralised in `ruflo-sublinear`) — see Open Question 1. The registry in `ruflo-sublinear` is just a thin `Map<graphId, SublinearAdapter>` populated at plugin-load time via the existing plugin manifest's `exports` field.

### MCP tool surface

Six tools (one added in 2026-05-19 revision for upstream 1.7.0 incremental solver), mounted under the `sublinear/*` namespace. Every tool accepts the optional upstream 1.7.0 fields `maxComplexityClass` (budget gate) and `coherenceThreshold` (DD-margin floor; default 0 = disabled, wire-compatible with pre-1.7.0 callers):

| Tool | Purpose | Inputs | Output |
|---|---|---|---|
| `sublinear/page-rank-entry` | Single-entry PR (Wedges 1, 3, 4, 5, 6, 7, 10, 11) | `{ graphId, nodeId, alpha?, epsilon?, seedNodes?, maxComplexityClass?, coherenceThreshold? }` | `{ score, queriedAt, witnessId?, complexityClass, coherenceScore }` |
| `sublinear/solve` | Full linear solve (Wedge 8) | `{ graphId, rhs, algorithm: "cg" \| "neumann", maxComplexityClass?, coherenceThreshold? }` | `{ x, residual, iterations, complexityClass, coherenceScore }` |
| **`sublinear/solve-on-change`** | **Incremental delta solve (Wedge 12, NEW)** | `{ graphId, prevSolution, delta: { indices, values }, algorithm?, maxComplexityClass? }` | `{ x, residual, iterations, deltaNnz, complexityClass }` |
| `sublinear/feasibility` | LP packing/covering feasibility (Wedge 9) | `{ constraints, tolerance, maxComplexityClass? }` | `{ feasible, witness?, certificateOfInfeasibility? }` |
| `sublinear/jl-embed` | Johnson–Lindenstrauss projection (embeddings fix) | `{ vectors, targetDim, epsilon }` | `{ projected, distortionBound }` |
| `sublinear/analyze` | Matrix diagnostics | `{ graphId }` | `{ conditionNumber, diagDominance, sparsity, isSymmetric, recommendedAlgorithm, coherenceScore, declaredComplexityClass }` |

`sublinear/page-rank-entry` is the workhorse — eight of eleven wedges call it. Its memoization key is `(graphHash, graphTimestamp, nodeId, alpha, epsilon, seedNodes?, maxComplexityClass?)`; TTL is configurable per `graphId` (default 60 s for fast-mutating graphs like span causality, 24 h for slow-mutating graphs like file-import). `sublinear/solve-on-change` is the streaming workhorse — for event-driven plugins (federation trust deltas, span streams, append-only causal break events) it replaces the recompute-from-scratch path with `O(nnz(delta) · log N)` deltas, sidestepping the `prev_solution` initial-guess trap that Neumann historically had (fixed in upstream 1.7.0).

`maxComplexityClass` is the integration point with ADR-026's 3-tier model router. Tier-1 callers (Agent Booster, $0) clamp at `Logarithmic`. Tier-2 callers (Haiku) tolerate `Linear`. Tier-3 callers (Sonnet/Opus) accept `Polynomial` or below. Tools that cannot serve a request within the requested class return a structured `ComplexityBudgetExceeded` error so the caller can downgrade query parameters (loosen ε, narrow seed set) or escalate the tier.

### Witness-signed PR artifact (Phase 7 / 8 — beyond-SOTA)

A signed PR artifact extends the RVF container schema from ADR-122 Phase 1. Schema:

```rust
pub struct SignedPageRankArtifact {
    pub installation_id: InstallationId,
    pub witness_key_id: WitnessKeyId,         // ADR-103 key reference
    pub graph_id: GraphId,                    // e.g. "ruflo-federation:trust-mesh"
    pub graph_hash: Hash256,                  // content hash of the input matrix
    pub graph_timestamp: Timestamp,
    pub algorithm: SolverAlgorithm,           // "forward-push" / "backward-push" / "bidirectional"
    pub complexity_class: ComplexityClass,    // upstream 1.7.0 — Logarithmic / Adaptive { default, worst } / Linear / ...
    pub coherence_score: f64,                 // upstream 1.7.0 — DD margin at compute time
    pub alpha: f64,
    pub epsilon: f64,
    pub query_node: Option<String>,           // None for full-vector artifacts
    pub seed_nodes: Vec<String>,              // empty for plain PR; populated for PPR
    pub result: PageRankResult,               // either a single score or a sparse vector
    pub result_hash: Hash256,                 // hash of `result`
    pub solver_version: String,               // "sublinear-time-solver@1.7.0"
    pub signature: Ed25519Signature,          // over all of the above
}
```

Replayability: any peer with the same input matrix (or a content-hash match against its own export) can re-run single-entry forward-push and confirm the hash byte-for-byte. The computation is deterministic given `(graph, alpha, epsilon, query_node, seed_nodes, algorithm)`. No SNARK circuit required — the verifier replays in microseconds because the underlying algorithm is sublinear.

Federation distribution: a peer requests `sublinear/page-rank-entry` over a remote `graphId`; the holder serves the signed artifact (if cached + fresh) or computes-and-signs on demand. The federation transport (ADR-104) carries the artifact as a single small payload (typically <2 KB for a single-entry PR, <100 KB for a sparse PPR vector with 1k seeds). Trust gating: the requesting peer's `verifyAttestation()` returns true iff the holder's `witness_key_id` is in the requester's trust set. Otherwise the requester falls back to local re-computation.

### Production-aware UCT extension story (ADR-122 Phase 4 / 7)

ADR-122 Phase 7's production-aware UCT formula is

```
score = Q + C·√(ln(parent_visits) / child_visits) + R − λ·risk − μ·cost − α·auth
```

Wedge 2 augments `Q` with a globally-aware value approximation `Q_global = β·single_entry_PR(branch_node, mcts_tree, α=0.85)`. The UCT score becomes

```
score = Q + Q_global + C·√(ln(N)/n) + R − λ·risk − μ·cost − α·auth
```

`Q_global` is computed via `sublinear/page-rank-entry` on the MCTS tree's reward-weighted transition matrix, treated as a directed weighted graph (asymmetric — uses the 2025 RDD result, not the AKP19 SDD result). Cost: O(log branches) per UCT step; cache hit rate is high because most UCT steps reuse the same parent's `Q_global`.

This unblocks "MCTS at depth 30" — the local UCT regret bound degrades with depth, but the global value augmentation is depth-agnostic. The result is a parallel federation-MCTS that does not lose value information at depth and does not require deep simulation rollouts.

## GOAP plan for the integration itself

The integration is itself a planning problem. Treating it as such:

**Initial state**: `{adr_122_merged: true, sublinear_npm_published: true, plugin_ruflo_sublinear_exists: false, eleven_adapters_exist: false, signed_pr_artifact_schema: undefined, witness_signer_available: true, federation_transport_available: true, browser_tests_passing: 230}`.

**Goal state**: `{plugin_ruflo_sublinear_published: true, all_eleven_adapters_shipped: true, signed_pr_artifact_schema_defined: true, federation_can_request_signed_pr: true, browser_tests_passing: 230, no_adr_122_regression: true}`.

**Action graph (preconditions → action → effects):**

```
A1  add-npm-dep              {sublinear_npm_published}
                             → {dep_added}                                    cost=0.25d, risk=low
A2  scaffold-plugin          {dep_added}
                             → {plugin_skeleton_exists}                       cost=0.5d,  risk=low
A3  define-adapter-contract  {plugin_skeleton_exists}
                             → {adapter_contract_frozen}                      cost=0.5d,  risk=med (touches all 11 plugins)
A4  build-solver-bridge      {adapter_contract_frozen}
                             → {solver_bridge_works, mcp_tools_5_shipped}     cost=1.0d,  risk=low
A5a wedge1-causal-browser    {adapter_contract_frozen, solver_bridge_works}
                             → {wedge1_live, adr_122_phase_2_upgraded}        cost=0.5d,  risk=low
A5b wedge3-federation        {adapter_contract_frozen, solver_bridge_works}
                             → {wedge3_live}                                  cost=0.5d,  risk=low
A5c wedge6-cost              {adapter_contract_frozen, solver_bridge_works}
                             → {wedge6_live}                                  cost=0.5d,  risk=low
A6  wedge2-mcts-browser      {wedge1_live, adr_122_phase_4_merged}
                             → {wedge2_live, mcts_global_value_augment}       cost=1.0d,  risk=med (touches UCT formula)
A7a wedge4-kg                {adapter_contract_frozen, solver_bridge_works}
                             → {wedge4_live}                                  cost=0.5d,  risk=low
A7b wedge5-rag               {wedge4_live}
                             → {wedge5_live}                                  cost=0.5d,  risk=low (PPR shares scaffolding with PR)
A8  wedge8-trader            {solver_bridge_works}
                             → {wedge8_live}                                  cost=0.5d,  risk=low (CG full solve, no graph)
A9a wedge7-observability     {adapter_contract_frozen, solver_bridge_works}
                             → {wedge7_live}                                  cost=0.5d,  risk=low
A9b wedge10-aidefence        {adapter_contract_frozen, solver_bridge_works}
                             → {wedge10_live}                                 cost=0.5d,  risk=low
A9c wedge11-jujutsu          {adapter_contract_frozen, solver_bridge_works}
                             → {wedge11_live}                                 cost=0.5d,  risk=low
A10 wedge9-goap              {solver_bridge_works}
                             → {wedge9_live, microsecond_feasibility}         cost=1.5d,  risk=med (LP feasibility is the trickiest math)
A11 jl-fix-embeddings        {solver_bridge_works}
                             → {jl_dimension_bug_fixed, adr_121_phase_4_done} cost=0.5d,  risk=low
A12 signed-pr-schema         {witness_signer_available, solver_bridge_works}
                             → {signed_pr_artifact_schema_defined}            cost=1.0d,  risk=med (cross-plugin contract)
A13 federation-distribution  {signed_pr_artifact_schema_defined, federation_transport_available}
                             → {federation_can_request_signed_pr}             cost=1.5d,  risk=med (transport extension)
A14 verify-no-regression     {all_wedges_live, signed_pr_schema_defined, federation_distribution}
                             → {no_adr_122_regression, browser_tests_passing: 230}  cost=0.5d,  risk=low (gating)
```

**Critical path** (shortest chain to the highest-leverage outcome — "RuFlo browser MCTS branch selection uses sublinear globally-aware value scoring"):

```
A1 → A2 → A3 → A4 → A5a → A6
0.25d  0.5d  0.5d  1.0d  0.5d  1.0d   = 3.75 engineering-days
```

This is the path the rollout below optimizes for. Wedge 6 (cost), Wedge 8 (trader), Wedge 9 (GOAP), and the JL fix are independent of the critical path and parallelize. Phase 7 (signed PR artifact) and Phase 8 (federation distribution) depend on the critical path completing but unlock the beyond-SOTA moat — they are scheduled last so the moat lands on top of working primitives, not in front of them.

**Edges between wedges:**
- A5a (Wedge 1, browser causal) → A6 (Wedge 2, MCTS value augment): the MCTS work reuses the causal-graph adapter glue and the page-rank-entry MCP tool path
- A7a (Wedge 4, KG) → A7b (Wedge 5, RAG): personalized PR over the RAG chunk graph reuses the KG adapter's CSR plumbing — same matrix shape, different graph
- A12 (signed PR schema) → A13 (federation distribution): the artifact must exist before it can be distributed
- A14 gates merge — runs ADR-122's 230 browser tests on each phase tag

**Dependencies on existing ADRs:**
- ADR-103 witness signer must be invokable from a new plugin (it already is — `mcp__claude-flow__witness` is shipped)
- ADR-104/105 federation transport must allow a new message type — falls under existing extensibility, no new ADR needed for in-mesh distribution; cross-installation cross-domain distribution may need ADR-124 (see Open Question 7)
- ADR-122 Phase 2 (causal recovery, browser) and Phase 4 (federated MCTS) must be merged before A5a and A6 respectively — both are merged as of 2026-05-18

## Decision: phased rollout (8 phases)

Phases compose monotonically. Each ships behind a feature flag, ships its own version tag, and clears its own acceptance criteria before the next phase merges.

### Phase 1 — Foundation: `ruflo-sublinear` plugin scaffold + adapter contract + solver bridge + five MCP tools

Lay the substrate. No wedges go live yet — this is the platform.

- Scaffold `plugins/ruflo-sublinear/` with `plugin.json`, package manifest, MCP tool entry points
- Add `sublinear-time-solver@1.6.0` as a runtime dep
- Freeze the `SublinearAdapter` and `SparseMatrixExport` types in a new `@claude-flow/shared` export so all eleven owning plugins can import them
- Implement the solver bridge (`solver-bridge.ts`) wrapping Neumann, CG, single-entry forward-push, single-entry backward-push, bidirectional (RDD case)
- Ship the five MCP tools — `page-rank-entry`, `solve`, `feasibility`, `jl-embed`, `analyze` — with no live adapters yet (they return `{error: "no adapter for graphId"}`)
- Ship the memoization layer with content-hash keying and per-`graphId` TTL config
- Ship to npm + IPFS registry as `@claude-flow/plugin-sublinear@0.1.0-alpha.1`

**Acceptance:**
- `ruflo plugins list` shows `@claude-flow/plugin-sublinear`
- All five MCP tools registered; `analyze` returns correct diagnostics on a hand-rolled test matrix
- Tests: ≥30 unit tests covering the solver bridge against the solver's reference outputs; condition-number / DD-check tests against known matrices
- Latency: solver bridge p99 < 5 ms on n=256 SPD test matrix (the solver's own headline number is 816 ns; the bridge adds Node↔WASM marshalling overhead but stays well under the 100 ms MCP target)

### Phase 2 — Wedge 1: browser causal-recovery PR (the critical path begins)

Replace the O(N) break-count ratio in `@claude-flow/browser`'s Phase-2 causal-recovery code path with O(log N) single-entry PR.

- Ship `plugins/ruflo-browser/src/sublinear-adapter.ts` exposing `exportAsSparseMatrix({purpose: "page-rank", seedNodes: <breaking-selector-ids>})` over the AgentDB causal graph for the current domain
- Wire `mcp__claude-flow__browser_explain_recovery` to call `sublinear/page-rank-entry` instead of walking the full break-event history
- Annotate snapshot element-refs with `_causalRiskScore` sourced from the PR-entry result
- Cross-domain isolation: per-domain graphIds keep the matrix exports scoped

**Acceptance:**
- p99 latency on causal-risk annotation for an N=10k break-event graph: <5 ms (vs ~100 µs at N=100 today, ~10 ms at N=10k today)
- Correctness: top-3 risky element-refs match (Jaccard ≥0.9) between the old full-walk algorithm and the PR-entry algorithm on a recorded benchmark of 1000 sessions
- ADR-122 Phase 2 acceptance row passes unchanged (causal-explain still returns ≥1 prior break event)
- Feature flag `RUFLO_BROWSER_PR_CAUSAL` defaults to false in 0.1; flips to true in 0.2 after benchmark confirms

### Phase 3 — Wedges 3 + 6 + 7: federation trust + cost attribution + observability spans (independent fan-out)

Three independent adapters; each lands behind its own flag. All three are O(log N) replacements for O(N) or O(N²) walks.

- `ruflo-federation`: trust-mesh adapter with α=0.7; replaces transitive-trust closure walks
- `ruflo-cost-tracker`: prompt→agent→MCP→model causation adapter; α=0.85; powers real-time "blame this prompt" UI
- `ruflo-observability`: span dependency adapter; α=0.85; powers "most-influential span" debugging queries

**Acceptance:**
- Federation: trust-closure query on a 1000-peer mesh: ≤10 ms p99 (vs ~10 seconds at N²=10⁶ today)
- Cost-tracker: "blame top-K prompts for this session's spend" returns in <50 ms on a 100k-trace session
- Observability: `observe-trace --explain-influence <span-id>` returns ranked influencing spans in <20 ms on a 50k-span trace
- No regression in plugin's existing MCP tool surface (covered by each plugin's own tests)

### Phase 4 — Wedges 4 + 5: knowledge-graph PR + RAG personalized-PR

- `ruflo-knowledge-graph`: entity-relation graph adapter; α=0.85; replaces full-graph PR on every entity-importance query
- `ruflo-rag-memory`: graph-RAG chunk connectivity adapter; α=0.85; PPR seeded by query embedding; replaces flat MMR rerank in `memory_search_unified`'s graph-RAG mode

**Acceptance:**
- KG entity-importance query on 10k-node graph: <2 ms (vs ~100 ms today)
- RAG: PPR-reranked top-10 chunks on a 100k-chunk corpus: <50 ms (vs ~2 s for full-PR rerank today)
- nDCG@10 on the LongMemEval benchmark (ADR-088): no regression vs the existing MMR baseline; aspirationally +5% from graph-awareness

### Phase 5 — Wedge 8: neural-trader portfolio CG solve

- `ruflo-neural-trader`: portfolio mean-variance adapter; `Σx = μ` via CG (no graph involved — direct SPD solve)
- Replaces the existing Neumann-series solve in `trader-portfolio` with CG; expected 40–60× speedup per solver benchmarks
- Wraps the CG residual + iteration count into the existing risk-report output

**Acceptance:**
- Portfolio optimization for n=256 assets: <2 µs solve time (CG headline is 816 ns; expect ~1 µs after marshalling)
- Risk metrics (VaR / CVaR / Sharpe) computed downstream from the new solver match the old solver's outputs within ε=10⁻⁶
- Unblocks "intra-day rebalancing" use case (was previously too slow for sub-minute cadence)

### Phase 6 — Wedges 9 + 10 + 11 + JL fix: GOAP feasibility, AIDefence suspicion, jujutsu blast-radius, embeddings JL

Four independent landings; all are sublinear-time queries against pre-existing graphs (or, for the JL fix, a direct library swap).

- `ruflo-goals`: precondition-LP adapter; `sublinear/feasibility` short-circuits A\* on infeasible goals
- `ruflo-aidefence`: syscall-call-graph adapter; α=0.95 (high decay so suspicion can travel far); single-entry PR from flagged syscall back to root agent
- `ruflo-jujutsu`: file-import-graph adapter; α=0.8; single-entry PR from changed file → "blast radius" score in PR review
- `@claude-flow/embeddings`: replace hand-rolled JL with `sublinear/jl-embed`; this is a correctness fix not a performance fix, but it closes ADR-121 Phase 4

**Acceptance:**
- GOAP: infeasible-goal detection on a 100-action plan: <100 µs (vs minutes of A\* enumeration today)
- AIDefence: "trace suspicion from flagged syscall to root agent" on a 10k-syscall trace: <20 ms
- Jujutsu: blast-radius score per-changed-file on a 50k-file repo: <50 ms (feasible per-push; today it's O(LOC × imports) which is multi-second)
- Embeddings JL: distortion bound certificate matches the ε parameter on a known test set; `target_dim ≤ n−1` no longer silently violated

### Phase 7 — Beyond-SOTA: witness-signed PageRank artifact (the moat)

This is the architectural claim. Now that all eleven wedges are live and producing PR-entry / solve outputs, wrap the outputs in `SignedPageRankArtifact` and sign them with the project's witness key.

- Implement `witness-signer.ts` in `ruflo-sublinear`; reuse the existing ADR-103 witness machinery via `mcp__claude-flow__witness`
- Add the `SignedPageRankArtifact` schema as a versioned export in `@claude-flow/shared`
- Every successful `sublinear/page-rank-entry` and `sublinear/solve` call optionally emits a signed artifact (controlled by a per-call `sign: true` flag; default false to keep the hot path cheap)
- Ship a `sublinear/verify-artifact` MCP tool that takes a `SignedPageRankArtifact` and confirms signature + replays the computation byte-for-byte
- Persist signed artifacts into an RVF container (`*.pr.rvf`); the container is a first-class deliverable from MCTS rollouts, cost attribution reports, and CI blast-radius checks

**Acceptance:**
- A signed PR artifact round-trips through `compute → sign → distribute → verify → replay` with byte-exact reproduction
- Forging a value (modifying `result_hash` or `result` in the artifact) fails `verify-artifact`
- A signed artifact produced by Installation A can be opened on Installation B and verified iff B trusts A's witness key (matches the ADR-103 trust model)
- CI integration: a `.pr.rvf` artifact produced by a CI job can be checked into a repo and replayed by a downstream consumer

### Phase 8 — Beyond-SOTA: federation-distributable PR vectors

Promote signed PR artifacts to a federation-distributable object. A federation peer can request a precomputed PR vector by `(graphId, nodeId, alpha, epsilon)` and receive a `SignedPageRankArtifact` from any peer in its trust set.

- Add a new federation message type `pr_artifact_request` / `pr_artifact_response` (transport extension over ADR-104; see Open Question 7 on whether this needs an ADR-124 transport addendum or fits cleanly under ADR-104's extensibility)
- Cache fanout: the holding peer serves from its memoization cache when the requested `(graphHash, graphTimestamp, ...)` matches a cached signed artifact; otherwise it computes, signs, and serves
- Trust gating: requester verifies `witness_key_id ∈ trust_set` before consuming; otherwise it falls back to local recomputation against its own export of the graph
- Cost: federation peers can bill PR-artifact serving via the existing ADR-097 / ADR-110 production spend reporter (each served artifact records a small spend event)

**Acceptance:**
- A peer A can request a federation-trust-mesh PR-entry from peer B; B returns a signed artifact; A verifies and uses it
- Cache hit rate on a representative federation workload (100-peer mesh, 1 req/s/peer): ≥70% after warm-up
- Spend reporter logs each served artifact; per-peer budget enforcement blocks abusive request patterns
- Trust mismatch: requester refuses to consume an artifact signed by a key not in its trust set; falls back to local recomputation

### Phase summary

| Phase | Wedges landed | Cumulative composed primitives | Ships as |
|---|---|---|---|
| 1 | foundation | `ruflo-sublinear@0.1.0-alpha.1` + 6 MCP tools (incl. `solve-on-change`) + `maxComplexityClass`/`coherenceThreshold` budget surface | alpha.1 |
| 2 | W1 (browser causal) | + browser adapter | alpha.2 |
| 3 | W3, W6, W7 | + federation, cost-tracker, observability adapters | alpha.3 |
| 4 | W4, W5 | + KG, RAG adapters | alpha.4 |
| 5 | W8 | + neural-trader CG path | alpha.5 |
| 6 | W9, W10, W11, JL | + GOAP feasibility, AIDefence, jujutsu, embeddings JL fix | alpha.6 |
| 6.5 | **W12 streaming** (2026-05-19 revision) | + `solve-on-change` integrations for federation trust deltas, cost spend events, observability span stream, AIDefence flag updates, causal-break append | alpha.6.5 |
| 7 | **signed PR artifact** | + witness-signed PR / replay round-trip (artifact carries `complexity_class` + `coherence_score`) | **alpha.7** ← beyond-SOTA wedge |
| 8 | **federation distribution** | + `pr_artifact_request`/`pr_artifact_response` + `pr_artifact_delta` over ADR-104 | **alpha.8** ← beyond-SOTA moat |

Wedge 2 (browser MCTS global value augment) lands as a separate `@claude-flow/browser@3.0.0-alpha.{N+1}` release tied to ADR-122's Phase 4/7 — it's an upgrade to the substrate consumer, not a new phase of `ruflo-sublinear` itself.

## Acceptance rubric — substrate-level

| Dimension | Phase 1 | Phase 4 (W1–W7 live) | Phase 7 (signed artifacts) | Phase 8 (federated PR) |
|---|---|---|---|---|
| Speedups achieved over baselines (per gist) | n/a | ≥6/11 wedges measured against gist's claimed gains, ≥80% confirmation | ≥10/11 confirmed | n/a |
| Cryptographic provenance | n/a | n/a | round-trip pass | + cross-installation verify |
| Federation distribution | n/a | n/a | n/a | ≥70% cache hit on warm mesh |
| ADR-122 230-test regression | 0 fail | 0 fail | 0 fail | 0 fail |
| MCP p99 response | <100 ms | <100 ms | <150 ms (sign adds <50 ms) | <200 ms (network) |
| Plugin published to IPFS | yes | yes | yes | yes |

## Open questions

1. **Adapter ownership: plugin-local vs centralised in `ruflo-sublinear`.** This ADR commits to **plugin-local adapters** (e.g. `plugins/ruflo-federation/src/sublinear-adapter.ts`) because the owning plugin already understands its own storage layout. The cost is that `ruflo-sublinear` cannot ship adapter logic on its own — it depends on adapter installation by the owning plugin. The alternative (centralised adapters in `ruflo-sublinear`) reduces moving parts but tightly couples `ruflo-sublinear` to every owning plugin's internal schema. Decided: plugin-local. Reversible if adapter drift becomes a maintenance burden.

2. **Memoization layer + TTL.** Per-`graphId` TTL config is in scope for Phase 1; what's not in scope is **distributed cache invalidation** when a federation peer's local graph changes. For Phase 8, a stale signed artifact (graph changed since signing) is detected by `graphHash` mismatch on the consumer side — the consumer falls back to recomputation. There is no proactive invalidation broadcast. This is the cheaper design and is acceptable as long as recomputation is sublinear. Revisit if measured fallback rates exceed 30%.

3. **Witness-signed PageRank artifact lifecycle + rotation.** ADR-103 covers project-key rotation for witness signatures but not the "what happens to in-flight signed PR artifacts when the key rotates" question. Proposal: artifacts carry `witness_key_id` (key version, not key identity); consumers honor any historically-trusted key version unless explicitly revoked. Revocation publishes a CRL-style entry through the federation; consumers refresh on a 1-hour cadence. This may want its own follow-up ADR if it grows complicated; for Phase 7 stick to "single key version per installation, no rotation in-flight".

4. **Benchmark target matrices — what's "representative" for each plugin?** Each owning plugin must supply a benchmark fixture matrix (or a recorded production trace) for its own wedge. The acceptance numbers in Phases 2–6 assume reasonable target matrices; if a plugin lacks an honest fixture, the benchmark is a placeholder and the acceptance number is provisional. Phase 1 ships a "benchmark fixture catalog" doc that lists missing fixtures.

5. **Failure modes — what happens when the source matrix is NOT diagonally-dominant?** ~~Open as of original draft.~~ **Closed upstream by `sublinear-time-solver@1.7.0`'s coherence gate** (2026-05-19 revision): `coherence_score(matrix)` returns the per-row DD margin in [−∞, 1]; `check_coherence_or_reject(matrix, threshold)` produces `SolverError::Incoherent { coherence, threshold }` with `is_recoverable() = true` and severity `Low`. Plugins pass `coherenceThreshold` on the MCP call; the structured rejection lets adapters fall back gracefully (clamp negative weights, renormalise rows, or switch to a dense solver). RuFlo no longer hand-rolls a DD check. Original guidance still applies for non-DD branches (CG needs SPD; LP has its own preconditions; the owning plugin still chooses preprocessing semantics because only it knows the weight meaning) — the only change is that the failure now arrives as a clean structured error instead of silent divergence.

6. **Node-Rust binding strategy — WASM, native node addon, or both?** `sublinear-time-solver@1.7.0` ships both. The plugin defaults to **native node addon when available, WASM as a fallback**. The detection is at plugin-load time, mirroring how `@claude-flow/embeddings` handles ONNX runtime detection. The WASM path serves Edge runtimes (Cloudflare Workers, Deno Deploy) where native modules are unavailable; the native path is the hot path in the v3 monorepo. Latency budgets above assume native; WASM has ~3× overhead. **Edge detection now uses the upstream 1.7.0 `is_edge_safe()` helper** rather than an ad-hoc check.

7. **Federation distribution of PR vectors — does this need an ADR-104 transport extension?** Most likely **no**, because ADR-104's message-type extensibility was designed for this. The new `pr_artifact_request` / `pr_artifact_response` message types fit cleanly under the existing wire framing. However, **cross-installation federation** (i.e. an Installation A in one org talking to Installation B in another org) may want stricter rate-limiting + capability-token authorization than the within-mesh case — and that may want an **ADR-124-federation-graph-artifact-distribution** as a follow-up. Flagged as a Phase 8 prerequisite.

8. **Incremental updates: when does `solve_on_change` win vs full re-solve?** (2026-05-19 revision, opened by upstream 1.7.0.) Heuristic: when `nnz(delta) / nnz(matrix) < 0.05` AND the previous solution is < 1 hour old, prefer `solve-on-change`. Otherwise full re-solve. Phase 1 ships a heuristic; Phase 6 measures actual crossover on each wedge's production trace and tunes per-graph. Federation peers exchanging deltas (Wedge 12 streaming subset) should be served `solve-on-change` directly; the federation request payload carries a `lastKnownSolutionHash` so the server can decide whether to ship a delta or a full vector.

## Updates to assumptions discovered during research

Two SOTA findings updated working assumptions mid-flight; recorded here explicitly per the brief's standing instructions:

- **Asymmetric DD result (arXiv 2509.13891, 2025) supersedes the implicit AKP19-SDD assumption.** Several of the eleven RuFlo graphs (federation trust, span causality, file imports, cost attribution) are *not* symmetric. Under a strict AKP19 reading, those wedges would have required transformation to symmetric form (e.g. by adding `M + M^T`) with attendant approximation loss. The 2025 paper proves single-entry sublinear time for the asymmetric case directly, using the "maximum p-norm gap" complexity parameter and a bidirectional Forward/Backward Push unification. **The ADR commits to the 2025 result, not the 2019 result.** `sublinear-time-solver@1.6.0` already implements both forward-push and backward-push primitives, so this is a configuration choice (not a code-change) at integration time.

- **The right comparison object is not zk-SNARK-of-PageRank; it's "Ed25519-signed inputs + hash-of-output + deterministic replay".** Initial drafting assumed the cryptographic-provenance angle would parallel ZK-DeepSeek and ZKPROV. After re-reading those papers it became clear they target a different threat model — proprietary models, hidden weights, untrusted compute. RuFlo's threat model is the *opposite*: the algorithm is public, the inputs are content-addressable, and the federation peer is semi-trusted via a witness-key trust set. A SNARK circuit over Neumann or CG would be enormously expensive for no marginal security gain in this threat model. Ed25519-over-inputs-and-output-hash is sufficient because the verifier can replay the computation in microseconds. This shifts Phase 7 from "build a SNARK circuit" to "extend ADR-103 schema with PR-specific fields" — a ~1-day task instead of a multi-week one.

- **Upstream `sublinear-time-solver@1.7.0` shipped three features that closed planned ADR-123 risks (2026-05-19 revision).** (a) The 12-tier `ComplexityClass` taxonomy + `is_edge_safe()` lets ADR-123 wire complexity-budget gating into ADR-026's 3-tier model router *via the solver itself* — no need to invent a separate budget abstraction; the upstream `max_complexity_class` arg threads through to every MCP tool. (b) The coherence gate closes Open Question #5 cleanly (see above). (c) `solve_on_change` lifts streaming wedges (federation trust deltas, span streams, append-only causal breaks) into a separate event-loop-friendly path that pays only `O(nnz(delta) · log N)` per event — recorded as Wedge 12 in the context table and as the new `sublinear/solve-on-change` MCP tool. None of these capabilities existed when the original 1.6.0 draft was written; this is genuine SOTA movement, not a re-framing.

## References

- `sublinear-time-solver@1.7.0` npm: https://www.npmjs.com/package/sublinear-time-solver
- `sublinear@0.3.0` crate: https://crates.io/crates/sublinear
- Library github: https://github.com/ruvnet/sublinear-time-solver
- 1.6.0 announcement gist: https://gist.github.com/ruvnet/342518ef950348c376bc7c04ffeb5337
- Upstream `sublinear` ADR-001 — Complexity as Architecture: https://github.com/ruvnet/sublinear-time-solver/blob/main/docs/adr/ADR-001-complexity-as-architecture.md
- Upstream CHANGELOG (1.6.0 + 1.7.0): https://github.com/ruvnet/sublinear-time-solver/blob/main/CHANGELOG.md
- Eleven-wedge research gist (foundational): https://gist.github.com/ruvnet/61d6d04af514b3c81ad0abf1e37fe116
- Andoni, Krauthgamer, Pogrow — "On Solving Linear Systems in Sublinear Time" (ITCS 2019): https://arxiv.org/abs/1809.02995
- Asymmetric DD sublinear (2025): https://arxiv.org/abs/2509.13891
- Friedkin–Johnsen application (2025): https://arxiv.org/abs/2509.13112
- Kyng & Sachdeva approx-Cholesky and follow-ups: https://rasmuskyng.com/research.html
- Robust & Practical Solution of Laplacian Equations by Approximate Elimination (Gao–Kyng–Spielman, 2023): https://arxiv.org/abs/2303.00709
- LaMMA-P hierarchical LLM + PDDL: https://arxiv.org/html/2602.21670
- GoalAct (NCIIP 2025 Best Paper): https://github.com/cjj826/GoalAct
- Why Do LLM-based Web Agents Fail? (hierarchical-planning perspective): https://arxiv.org/pdf/2603.14248
- HippoRAG (PPR-on-KG retrieval): https://graphwise.ai/blog/from-retrieval-to-reasoning-enhancing-hipporag-with-graph-based-semantics/
- HippoRAG paper: https://www.researchgate.net/publication/397199630_HippoRAG_Neurobiologically_Inspired_Long-Term_Memory_for_Large_Language_Models
- ZK-DeepSeek (zk-SNARK verifiable inference): https://arxiv.org/abs/2511.19902
- ZKPROV (dataset provenance for LLMs): https://arxiv.org/html/2506.20915
- Lagrange DeepProve (dynamic zk-SNARKs): https://lagrange.dev/blog/dynamic-zk-snarks
- Portable Agent Memory provenance protocol: https://arxiv.org/html/2605.11032v1
- Memory poisoning in multi-agent systems: https://arxiv.org/html/2603.20357v1
- Mnemonic Sovereignty survey (long-term memory security): https://arxiv.org/html/2604.16548v1
- 2026 agent-memory framework comparisons: https://vectorize.io/articles/mem0-vs-letta, https://vectorize.io/articles/letta-vs-langchain-memory
- ADR-103 (witness temporal history): `v3/docs/adr/ADR-103-witness-temporal-history.md`
- ADR-104 (federation wire transport): `v3/docs/adr/ADR-104-federation-wire-transport.md`
- ADR-105 (federation state snapshot): `v3/docs/adr/ADR-105-federation-v1-state-snapshot.md`
- ADR-121 (embeddings RuVector upgrade — JL fix follow-up): `v3/docs/adr/ADR-121-embeddings-ruvector-upgrade.md`
- ADR-122 (browser substrate): `v3/docs/adr/ADR-122-browser-beyond-sota.md`
