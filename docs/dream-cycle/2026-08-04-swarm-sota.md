# Swarm SOTA Report — 2026-08-04

**TL;DR:** Stigmergic pheromone-field coordination (zero direct messaging, 50% fewer agents, +11.6% fitness) is the dominant 2026 swarm paradigm. Ruflo's direct `SendMessage` architecture is the primary structural gap.

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| Stigmergic RL: agents coordinate via pheromone fields in shared memory, no direct messages; scales to continuous action spaces | arXiv 2607.17709 | A |
| Pheromone-threat consensus: 50% agent reduction → +11.6% collective fitness; consensus acceptance 0.97 ± 0.02 | arXiv 2607.03628 | A |
| Neural operator generalizes 10-agent swarm training → zero-shot 1,000-agent deployment | arXiv 2608.00320 | A |
| Gear-based 3-agent safety: 99.6% anomaly detection vs 2.1% single-agent; 3.5× latency reduction | arXiv 2607.00334 | A |
| Formal verification of swarm comms: 97.9% decision-tree fidelity, 88.9% temporal-logic property satisfaction | arXiv 2606.19632 | A |
| LangGraph `Send` API: runtime-dynamic map-reduce sub-agent graph routing (65M+ downloads/month) | LangGraph blog, Jul 2026 | B |
| Telephone Loop attack compromises 80% of multi-agent LLM systems; Claude Sonnet 4.6 resists at 92% | arXiv 2608.00202 | B |

## Ruflo Current Capability

| Capability | Status | Gap |
|------------|--------|-----|
| Multi-agent topology | Hierarchical, mesh, adaptive | Static selection; no runtime dynamic routing |
| Coordination mechanism | Direct named-agent messaging between agents | No pheromone/stigmergic memory bus |
| Consensus | Raft (hive-mind), hierarchical (default) | No pheromone-field consensus layer |
| Agent count | Default 8, `maxAgents` configurable | No fitness-based adaptive reduction |
| Formal verification | None | Temporal-logic property checker absent |
| Attack surface | No Telephone Loop mitigation documented | Gap vs arXiv 2608.00202 |

## Competitor Comparison

| System | Coordination Model | Agent Topology | Observability | Swarm Security |
|--------|--------------------|----------------|---------------|----------------|
| **LangGraph** | Runtime-dynamic DAG via `Send` API | Sub-agent graphs, no static predefinition | LangSmith tracing (GA) | No documented swarm attack mitigations |
| **AutoGen / AG2** | GroupChat + sequential tool calls | Static team composition | AG2 Playground; per-token tracing | No documented |
| **CrewAI** | Role-based crew; sequential/hierarchical | Fixed role assignment | AMP (Agent Management Platform, 2026) | No documented |
| **OpenAI Swarm** (experimental) | Handoff protocol between agents | Flat handoff graph | Minimal; experimental only | No documented |
| **Ruflo** | Named-agent messaging; hierarchical default | 5 topologies (hierarchical/mesh/adaptive/etc.) | Hooks + ruview (partial) | 92% resistance via Claude Sonnet 4.6 (inherited) |

## Benchmarks

| Claim | Value | Grade | Source |
|-------|-------|-------|--------|
| Pheromone consensus: agent reduction → fitness | 50% agents → +11.6% fitness | **A** | arXiv 2607.03628 |
| Gear-based multi-agent anomaly detection | 99.6% (3-agent) vs 2.1% (1-agent) | **A** | arXiv 2607.00334 |
| Formal verification: temporal-logic pass rate | 88.9% on 18 verified properties | **A** | arXiv 2606.19632 |
| Swarm generalization: 10 → 1,000 agents (zero-shot) | Matches per-agent optimal-control solver accuracy | **A** | arXiv 2608.00320 |
| Qdrant filterable HNSW at 1% selectivity (ef=64) | 99.8% recall @ 1.0ms vs ACORN-1: 67.7% @ 4.7ms | **B** | Qdrant blog, Jul 2026 |
| Telephone Loop attack success rate | 80% of frontier LLM multi-agent systems compromised | **B** | arXiv 2608.00202 |

## Scan Findings

### ruview-integration
CrewAI AMP and AG2 Playground both shipped centralized agent observability in early 2026. Weaviate Engram (GA June 2026) bundles retrieval + state audit as a managed service — bridging vector search and agent memory auditability in one primitive. Ruflo's ruview integration remains partial; no unified trace-inspection layer exists across swarm topologies. **Action:** surface Engram as integration target for `@claude-flow/memory` audit trail.

### ruvector-integration
Qdrant's July 2026 benchmark (Grade B) shows filterable HNSW delivers 99.8% recall at 1.0ms vs ACORN-1's 67.7% at 4.7ms — an 18.7% recall gap and 4.7× latency penalty for ACORN. Weaviate HFresh disk index (v1.38, GA) supports incremental rebalancing without full rebuild on updates. Ruflo's RuVector HNSW currently requires full index reconstruction on updates. **Action:** adopt filtered-HNSW pattern from Qdrant; evaluate incremental-rebalance approach from Weaviate HFresh for AgentDB.

## SOTA Proof & Witness

- **Session Commit:** 913f9eaedee92627950544424e50339feaf98271
- **Report SHA-256:** d2a598b70bd61d70b43b8ef5e13f704fae57974b53b150b4801e1859c4f315d2
- **Witness Stamp:** c02ab0e966c51108f042733aeb374ad40d853e4fda5117ba4fe6d1588cd53e2a
- **Verifier:** `sha256(report_sha256 + session_commit)` must equal Witness Stamp

## Recommended Next Steps

1. **Implement `PheromoneBus` in AgentDB** (ADR-381): Replace default direct-messaging broadcast with a time-decaying pheromone key-space in shared memory. Agents write gradient signals; workers read and self-coordinate without direct coupling. Target: 50% agent reduction at equivalent fitness, matching arXiv 2607.03628 results.

2. **Add fitness-based adaptive agent-count gate**: Measure per-cycle task fitness in the hierarchical coordinator. When convergence is detected early, reduce `maxAgents` by 50%. Combine with the TPSC pattern (ADR-330) for compounded agent efficiency.

3. **Ship swarm formal-verification gate**: Before spawning production swarms, run a temporal-logic property checker over the swarm's communication graph (pattern from arXiv 2606.19632). Wire as a `pre-swarm` hook in the V3 hooks system. Minimum: 5 core safety properties checked, targeting ≥88% pass rate.
