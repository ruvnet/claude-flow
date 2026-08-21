# Swarm Topology Load-Balancing SOTA Report — 2026-08-14

**TL;DR:** Ruflo's `TopologyManager.rebalanceMesh()` selected peer connections via a uniform-random shuffle with no load signal. Replacing it with power-of-two-choices (P2C — Azar/Broder/Karlin/Upfal 1999; Mitzenmacher 2001), a foundational, decades-proven load-balancing technique no competitor framework implements for agent-topology construction, produces a real, statistically significant (paired t=-20.79, n=40) 46% reduction in max per-node connection load and 44% reduction in load variance under swarm churn — but the candidate is **REJECTED** because it also produces a 13.7% drop in average connection density in the exact scenario where the effect fires, breaching a quality invariant frozen before evaluation began. This is the first evaluated (not just researched) Dream Cycle finding in this repository's 79-issue, 15-night history.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Power-of-two-choices: sampling 2 random candidates and picking the less-loaded one bounds max load at O(log log n) vs O(log n / log log n) for pure random placement | Azar, Broder, Karlin, Upfal, "Balanced Allocations," SIAM J. Comput. 29(1):180-200, 1999 (DOI 10.1137/S0097539795288490); Mitzenmacher, IEEE TPDS 12(10):1094-1104, 2001 (DOI 10.1109/71.963420) | A |
| No 2025/2026 paper applies P2C specifically to multi-agent LLM swarm mesh topology construction — closest hit (SwarmX, arXiv:2606.21401) uses it for GPU/CPU workload *scheduling*, not peer selection | Web search, verified by independent research agent | A (citation) / novel application |
| HyphaeDB reinterprets HNSW as a gossip fabric for multi-agent knowledge propagation with emergent consensus — a plausible future angle for Ruflo's ruvector layer, not yet benchmarked at scale | arXiv:2606.28781 | B |
| HNSW insert/delete profile degrades under write-heavy agent-memory workloads (not the static-corpus RAG case it was designed for) — relevant since Ruflo's ruvector usage (SONA/ReasoningBank) is write-heavy | 3 independent sources incl. arXiv:2605.25092 | B |

**Meta-finding (own repo, not external SOTA):** all 7 nights of this pipeline since its v2 rewrite (issues #2938–#3008) produced research-only GitHub issues with real commits pushed to `dream/*` branches but **zero pull requests ever opened** and **zero rows appended to `docs/dream-cycle/LEDGER.md`'s "v2 live entries" section** — the section is empty despite being described as the whole point of the rewrite. STEP 24 (draft PR) and STEP 25 (ledger append) were silently skipped every night. Tonight fixes both.

## Ruflo Current Capability

`TopologyManager` (`v3/@claude-flow/swarm/src/topology-manager.ts`) supports mesh/hierarchical/centralized/hybrid topologies with O(1) role indexes. `rebalanceMesh()` and `rebalanceHybrid()` selected peers via `sort(() => Math.random() - 0.5)` then `candidates[0]` — pure uniform-random, no load signal, despite `node.connections.length` already being read in-process one line away for the (mesh-only) `shouldRebalance()` check. `rebalanceHybrid()`'s worker-mesh loop additionally has a **pre-existing, unrelated bug**: it pushes connections one-directionally into `adjacencyList` (unlike `rebalanceMesh`'s explicit bidirectional block), which explains a real ~12-20% BFS-reachability-sample failure rate in hybrid topology in baseline, independent of tonight's candidate.

## Competitor Comparison

| Framework | Topology construction | Load-aware peer selection | 2026 status |
|---|---|---|---|
| LangGraph 0.4 | Static, developer-defined StateGraph edges | None | Production leader, 38% enterprise share |
| AutoGen/AG2 | Role/manager-driven or LLM-decided handoffs | None | GA Feb 2026 |
| CrewAI 0.95 | Fixed at crew design time | None | Active, async runner added |
| OpenAI Agents SDK | Hub-and-spoke handoffs; infra-layer model-routing load balancing only | None (at agent-topology layer) | Stable, replaced Swarm |

No competitor implements P2C or any load-aware peer-selection at the swarm-topology-construction layer — confirmed by direct search of 2026 docs/changelogs, not assumed.

## Hypothesis (frozen before evaluation)

> Given a Ruflo mesh-topology swarm under node churn with `autoRebalance` enabled, when `rebalanceMesh()`'s peer selection changes from uniform-random to power-of-two-choices, then max per-node connection load and load coefficient-of-variation should decrease relative to baseline, subject to: (1) average connection density stays within ±10% of baseline, (2) no increase in unreachable node-pair samples, (3) benchmark wall-clock regression <20%.

## Benchmarks

No existing bench corpus in this repo (`.harness/bench.json` absent; `.claude-flow/flywheel/`, `.metaharness/` absent — cold start, verified). The discovered `metaharness bench`/`evolve` tools score LLM input/output task pairs, which doesn't fit a zero-LLM deterministic algorithm change — built a minimal, honest, seeded corpus instead: 6 scenarios (mesh/hybrid × {small, medium-churn, large-churn} agent counts 12-60), 40 paired trials each (240 total), same seed per (scenario, trial) index for baseline and candidate runs. Corpus + harness committed at `v3/@claude-flow/swarm/benchmarks/`.

## Evaluation

Real baseline-then-candidate receipts (`receipt-baseline.json`, `receipt-candidate-final.json`), compared pairwise. **mesh-large-churn (60 agents, 12 churned) — the only scenario where `rebalanceMesh`'s while-loop does substantial work:**

| Metric | Baseline | Candidate | Δ |
|---|---|---|---|
| Mean max load | 18.75 | 10.1 | -46.1% |
| Mean load CoV | 0.389 | 0.216 | -44.4% |
| Mean connections/node (density) | ~7.25 | ~6.25 | **-13.7%** |
| Reachability failures (960 samples) | 0 | 0 | 0 |
| Wall-clock | baseline | candidate | -15.4% (candidate faster) |
| Paired t-statistic (n=40, this scenario) | — | — | **-20.79** |

An independent adversarial-critic agent reviewed the diff, harness, and stats script, and found two real problems, both fixed before this report: (1) an earlier version of the comparison script reported one t-statistic pooled across all 240 trials (200 of them exact zero-variance ties) and mischaracterized it as "n=40" — fixed to report per-scenario t-tests; (2) the -13.7% density change in mesh-large-churn was originally hidden inside a pooled "-0.185 average" across all 6 scenarios — fixed to report per-scenario. The critic confirmed the P2C algorithm implementation is correct (one minor non-blocking bias in tie-breaking, ~1.7% at n=59, immaterial), the benchmark seeding is fair, and the mesh-only scoping (after discovering the hybrid one-directional-adjacency bug) is legitimate methodology, not p-hacking.

Reward-hack check: no gold data exists to weaken (deterministic geometry benchmark); no thresholds altered after seeing results; no task cherry-picking (all 6 pre-declared scenarios reported, including the 4 that showed zero effect). `@metaharness/weight-eft` (reward-hack detector) is a loaded dependency but exposes no standalone CLI under `ruvector harness --help` — not independently run tonight; the adversarial-agent review substitutes for it.

Existing test suite: 218/218 passing pre-candidate, 219/219 passing post-candidate (added 1 regression-guard test). Zero regressions.

## Darwin Results

**Skipped.** Darwin (`@metaharness/darwin` v0.8.0, direct dependency, confirmed available) requires the candidate to pass basic evaluation before bounded exploration (STEP 12 precondition). This candidate's density invariant failed, so no Darwin generations were run — bounded evolution over a rejected baseline would just be tuning toward a p-hacked pass, which the adversarial-critique step exists to prevent.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `3030924f22fd24ea10cd5216acbd707217fd70c1` |
| Report SHA-256 (pre-witness content) | `eaaf09d3e50113ddd45b9d71a9d4c9237514963b82d2d73d71ade9d3bb9b83e2` |
| Witness stamp | `e77acc86b638424e3ef5e3315eba3aa848a32a055a287b09d707141a76710c09` |
| Evaluation receipts | `v3/@claude-flow/swarm/benchmarks/` — `receipt-baseline.json`/`receipt-candidate-final.json` regenerated by `topology-load-balance.bench.ts`; `comparison-final.json` regenerated by `compare-receipts.mjs` |
| Flywheel evidence identity | No signed `@metaharness/flywheel` bundle produced — bespoke deterministic benchmark, not an LLM-task corpus; evidence retained as committed receipts + this report instead |
| Darwin lineage identity | N/A — skipped, candidate failed its own quality invariant (see Evaluation) |

**Verifier:** strip this table's values back to placeholders, `sha256sum` the file, concatenate with the session commit, `sha256sum` again → must equal the witness stamp above. (Report SHA-256 is computed on the content *before* this table was filled in, per the pipeline's witness procedure — this is a known self-referential limitation of the scheme carried over from prior nights, not unique to tonight.)

## Recommended Next Steps

1. **REJECT tonight's candidate as specified**, but retain it: `pickPowerOfTwoChoices()` is real, tested, and 46%/44% effective at the metric it targets — a follow-up hypothesis should test "P2C with `targetConnections` raised to compensate for the ~13.7% density loss" (e.g., target=6 instead of 5) as a fresh, separately-evaluated candidate, not a retroactive threshold change on tonight's result.
2. **File a small, separate fix** for `rebalanceHybrid()`'s one-directional worker-mesh adjacency bug (lines ~545-562) — independent of tonight's candidate, discovered as a side effect of this evaluation, currently causing genuine ~12-20% reachability-sample failures in hybrid topology.
3. **Fix the Dream Cycle pipeline itself**: 7 consecutive nights skipped STEP 24 (draft PR) and STEP 25 (ledger append) despite pushing real commits. Tonight's PR and ledger row are the first since the v2 rewrite — future nights should treat an empty `LEDGER.md` "v2 live entries" section as a fire alarm, not a stable state.
