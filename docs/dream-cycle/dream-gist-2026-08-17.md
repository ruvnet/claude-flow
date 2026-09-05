# Intelligence SOTA Report — 2026-08-17

TL;DR: Tonight (2026-08-17, intelligence deep-dive) found that Ruflo's 3-tier model router (`model-router.ts`, ADR-026/143) accumulates its Beta-Bernoulli Thompson-sampling priors forever with zero temporal decay, while the codebase's *other* router (`q-learning-router.ts`) already solves the analogous problem via epsilon annealing — an internal-consistency gap, not a hypothetical one. Shipped an opt-in `priorDecay` config field (default disabled, zero behavior change) implementing discounted Thompson sampling. A 30-trial paired benchmark shows a real, statistically significant recovery-speed improvement in the low-complexity bucket after a simulated model-quality shift — but the effect does **not** generalize to the med-complexity bucket, a limitation an independent adversarial critic's feedback led directly to testing and disclosing.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Discounted Thompson Sampling remains an active, unsolved-by-default production problem | arXiv 2606.23933 (Jun 2026), arXiv 2305.10718 | A |
| Confidence-Adaptive Routing (CARE) reallocates MoE expert budget via gate entropy | arXiv 2607.26052 (Jul 2026) | B |
| Ghost Vectors: soft-deleted embeddings remain reconstructible in HNSW indexes | arXiv 2606.18497 (Jun 2026) | A (general finding); C (Ruflo-specific applicability, unmeasured) |
| No orchestration framework (LangGraph/AutoGen/CrewAI/OpenAI Agents SDK) does learned/adaptive routing in its core loop — a deliberate, field-wide tradeoff, not an oversight | Live doc/repo review, 2026-08 | A |

## Ruflo Current Capability

`model-router.ts:recordOutcome()` does `bp[model].alpha += reward; bp[model].beta += 1-reward` with **zero decay anywhere in the 1490-line file** (confirmed by direct grep). Persisted forever to `.swarm/model-router-state.json`. Meanwhile `q-learning-router.ts` (a sibling, less-used router) already implements exponential epsilon annealing for its own exploration rate. Two more findings from tonight's architecture pass, not acted on tonight: the MoE gate (`moe-router.ts`) computes routing entropy every call but never uses it for expert-count control (dead signal); and `EWCConsolidator.pruneOldPatterns()` mutates its own pattern Map but never propagates deletions to `LocalReasoningBank` or the HNSW-backed store — three independent, unsynced "forgetting" mechanisms in one pipeline.

## Competitor Comparison

| Framework | Adaptive/learned routing | Forgetting mitigation | 2026 status |
|---|---|---|---|
| LangGraph | Developer-written conditionals / LLM-prompted routing only | RAG-style external memory; docs explicitly discourage weight-level fine-tuning | Active |
| AutoGen / AG2 | LLM-prompted "manager" selection | `TeachableAgent` deprecated v0.12, removed v0.14 (Mar 2026 rewrite) | Maintenance-mode (upstream) |
| CrewAI | Hierarchical/manager-based, not learned | Context/vector memory only | Active |
| OpenAI Agents SDK | Developer-defined handoffs | External memory (no built-in continual learning) | Active |
| Letta (MemGPT) | N/A | Self-editing 3-tier (Core/Recall/Archival) memory — explicit token-space alternative to weight-space continual learning | Active, sharpest comparator |

None of the four major orchestration frameworks implement a real bandit/RL routing policy in their core loop — genuine adaptive routing exists only in standalone services (RouteLLM, MetaLLM) and academic work, never integrated. This is a deliberate cost/complexity tradeoff the field has made, not a gap nobody noticed — which makes Ruflo's own bandit (imperfect as tonight's finding shows) still ahead of the field's default posture. Letta's token-space memory is the sharpest available foil for EWC++'s weight/pattern-space approach, not a "competitors have nothing" claim.

## Hypothesis

Given the router's unbounded Beta-prior accumulation, when an exponential discount (`priorDecay < 1`) is applied to all bucket/model priors once per `recordOutcome()` call before that round's reward, then post-shift recovery speed after a simulated model-quality shift should improve relative to baseline, subject to: no material regression under a stationary (non-shifting) workload.

## Benchmarks

Bespoke deterministic simulation (`benchmarks/results/scripts/prior-decay-benchmark.mjs`) — no LLM calls, $0 cost, seeded PRNG (identical random stream fed to baseline and candidate per trial, isolating the decay math as the only variable). 1500 pre-shift rounds (simulating months of accumulated persisted history) + 300 post-shift rounds, n=30 paired trials, two complexity buckets. An independent adversarial-critic pass found and I fixed a real bug in the paired-t formula (population vs. sample stddev, inflating t by n/(n-1)) before finalizing these numbers.

## Evaluation

**evaluated: accepted, scoped.** Low bucket (haiku→sonnet shift): recovery 26.5→21.9 rounds (**-17.6%**, t=7.00), post-shift correct-routing rate +1.3pp (t=5.90), stationary invariant held (Δ=+0.02pp, t=0.70 — no regression). Med bucket (sonnet→opus shift): recovery essentially flat (Δ=-0.17 rounds, t=-0.74, not significant), stationary invariant held (Δ=-0.08pp; statistically distinguishable from zero at t=-3.01 but two orders of magnitude inside the pre-declared -1pp tolerance). **The mechanism's benefit is real but bucket-scoped** — it helps most where reward asymmetry is largest (haiku success reward=1.0 vs. opus=0.4 in `BANDIT_REWARDS`), which is exactly the case that produces the most entrenched stale posteriors. This was found only because an independent critic asked for med/high-bucket coverage; the first version of this benchmark tested only the low bucket and would have overclaimed generality. Shipped **disabled by default** (`priorDecay: 1`); this is an opt-in mechanism, not a default-behavior change.

## Darwin Results

**Skipped — scope mismatch**, same class of skip as 2026-08-16's security night. `@metaharness/darwin`'s discovered real interface (`evolve --bench <suite.json>`) evolves harness/prompt genomes against LLM-scored coding-task corpora; it has no analog for tuning a single continuous scalar (`priorDecay`) in a deterministic-math function. A γ-value sensitivity sweep (0.995/0.99/0.98) was run directly in the bespoke benchmark instead — 0.995 gave the cleanest signal-to-noise (t=7.00 vs. 6.76/3.71 for 0.99/0.98) and is the value used above.

## SOTA Proof & Witness

See the linked issue and PR for the full witness stamp (session commit, report hash, witness hash) and verifier procedure.

## Recommended Next Steps

1. **Merge tonight's opt-in `priorDecay` candidate** (draft PR) — zero-risk (disabled by default), reviewable single-file diff, evidence-backed for the low-complexity bucket, all findings from an independent adversarial critique addressed (paired-t formula fixed, NaN/negative-decay input validation added, med-bucket coverage added).
2. **Follow-up candidate:** investigate why the med bucket shows no effect — likely `BANDIT_REWARDS`' smaller success-reward magnitudes for sonnet/opus change entrenchment dynamics; a bucket-scaled decay rate (stronger where reward asymmetry is largest) is the natural next hypothesis, explicitly flagged here rather than implemented tonight.
3. **Follow-up candidate:** wire the MoE gate's already-computed routing entropy into its `topK` selection (Confidence-Adaptive Routing, arXiv 2607.26052) — currently dead signal, distinct from tonight's candidate, scored highly in tonight's 5-candidate ranking (2nd place).
