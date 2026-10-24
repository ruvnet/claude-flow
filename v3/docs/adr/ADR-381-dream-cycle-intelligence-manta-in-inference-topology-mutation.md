# ADR-381: MANTA-Style In-Inference Topology Mutation for adaptive-coordinator

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-08-02)  
**Date:** 2026-08-02  
**Related:** ADR-026 (3-tier model routing), ADR-376 (heterogeneous ensemble API)

---

## Context

Ruflo's `adaptive-coordinator` (ADR-026) selects between pre-defined swarm topologies
(hierarchical, mesh, adaptive) at swarm initialisation time based on a complexity heuristic.
Once set, the communication graph between agents is static for the lifetime of that swarm.

The 2026 paper **MANTA: Multi-Agent Network Topology Adaptation for Self-Evolving
Multi-Agent Systems** demonstrates that allowing agents to dynamically add or remove edges
in their communication graph **during inference** — not at initialisation — yields:

- 74.0 average score across 5 standard benchmarks
- **+5.8 percentage points** over the best static-topology baseline
- No increase in total agent count; improvement is purely from adaptive communication

The key mechanism is a lightweight GNN gate evaluated at each reasoning step that scores
which peer messages are worth incorporating and prunes low-signal edges on the fly.

## Decision

Extend `adaptive-coordinator` with an optional **in-inference topology mutation mode**
activated by a new swarm flag `--dynamic-edges` (default: off for backwards compatibility).

When enabled:

1. At each agent turn boundary, a tiny GNN gate (< 1M params, runs on CPU) scores the
   utility of each in-scope peer's last output against the current task embedding.
2. Edges with utility score < threshold `τ` (default 0.3) are pruned for this turn only;
   edges with score > 0.8 are promoted to `priority` (message delivered first).
3. The gate is initialised from a pre-trained checkpoint bundled with
   `@claude-flow/cli` and fine-tuned per-swarm via post-task reward signal.
4. Mutation decisions are logged to `.swarm/topology-mutations.jsonl` for replay
   and offline analysis.

## Consequences

**Benefits:**
- Expected +3–6 pp task-completion improvement on multi-step decomposition tasks
  (conservative estimate: half of MANTA's observed +5.8 pp, adjusting for Ruflo's
  smaller default swarm size of 6–8 vs MANTA's 10–20 agent settings).
- No agent-count increase; cost-neutral.
- Fully backwards-compatible: `--dynamic-edges` defaults to `false`.

**Costs / Risks:**
- GNN gate adds ~15–30 ms latency per turn boundary on CPU (negligible vs. LLM call).
- Requires bundling a ~4 MB checkpoint with `@claude-flow/cli` (acceptable; smaller than
  the existing ONNX embedding model).
- Dynamic edge sets make distributed traces harder to interpret; `topology-mutations.jsonl`
  partially mitigates this.
- MANTA paper benchmark settings (10–20 agents, GPT-4o backbone) differ from Ruflo's
  default 6–8 agents with mixed model tiers; uplift may be lower at small swarm sizes.

## Implementation Plan

1. **Spike (0.5 sprint):** prototype GNN gate as a tiny `@claude-flow/hooks` worker;
   validate latency on CI runner hardware (target < 50 ms/turn).
2. **Integration (1 sprint):** wire gate into `adaptive-coordinator` turn lifecycle;
   add `--dynamic-edges` flag to `swarm init`; emit `topology-mutations.jsonl`.
3. **Benchmarking (0.5 sprint):** run Ruflo's 5-benchmark suite (`scripts/benchmark-intelligence.mjs`)
   with and without `--dynamic-edges`; require measured delta > 0 before enabling as default.
4. **Calibration (addendum):** if measured uplift < +1 pp at N=6 agents, revisit gate
   threshold `τ` or defer to a larger agent pool setting only.

## Alternatives Considered

- **Static topology selection at init only (current behaviour):** retained as default.
  `--dynamic-edges` is opt-in; no regression risk.
- **Full MANTA replication (training GNN from scratch):** too expensive for a single
  sprint; using a pre-trained checkpoint with fine-tuning is the pragmatic path.
- **Increase default maxAgents to 16+:** would raise cost without the communication-
  quality gain MANTA demonstrates. Rejected.

## References

- MANTA: Multi-Agent Network Topology Adaptation for Self-Evolving Multi-Agent Systems
  (arXiv 2026)
- ADR-026: 3-Tier Model Routing
- ADR-376: Heterogeneous Agent Ensemble Composition API
- Dream Cycle 2026-08-02 gist (witness: `8f51517b546b194099f9a054ff8b3692e85c1043a91883978f887326490069a2`)
