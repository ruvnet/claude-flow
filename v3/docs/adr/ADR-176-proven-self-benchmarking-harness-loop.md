# ADR-176 — Self-Optimizing Harness Loop (Receipt-Backed Evolution)

- **Status:** Accepted — **demonstrated** (flywheel milestone met: 2 real, significant, independently-replayable compounding promotions; PR #2572)
- **Date:** 2026-07-04
- **Deciders:** ruflo core
- **Related:** [ADR-150](ADR-150-metaharness-integration-surfaces.md) (metaharness integration contract + removability), [ADR-153](ADR-153-metaharness-darwin-mode-integration.md) (Darwin/evolve — *Proposed*), [ADR-155] (security-bench / Darwin Shield), [ADR-171](ADR-171-provenance-tiered-evaluation-oracle.md) (provenance tiers), [ADR-172](ADR-172-fable-advisor-harness.md) (Fable, cost-bounded), [ADR-174](ADR-174-memory-distillation-self-optimization.md) (distill loop + the held-out promote-gate pattern + Ed25519 signing), [ADR-177](ADR-177-signed-config-propagation-to-installs.md) (propagation to existing installs)

## Thesis

This is a **self-optimizing harness** — ruflo improves its own execution policies over time. What makes that claim *defensible* (rather than the usual hand-wave) is a single discipline we call **receipt-backed evolution**:

> **Every self-optimization step is independently benchmarked, adversarially verified, canary-observed, cryptographically attested, and reversible.** No transition is authorized by self-assertion; each is gated by external, independently-measurable evidence.

The optimizer is only *permitted* to change ruflo when a candidate satisfies a conjunction of externally-measurable predicates — never a single scalar objective. "Self-optimizing" names the capability; "receipt-backed" is why you can trust it.

## Context

Two halves of a learning system exist but are not joined into a proven loop:

- **Observe (real, shipped).** Hooks capture trajectories + outcomes, now including failures (ADR-174). `distill-tuning.ts` already demonstrates the discipline we generalize: isolated-copy scoring, a time-based held-out split, and an explicit numeric promotion rule.
- **Optimize/benchmark (real *wrappers*, unproven *substance*).** metaharness's `evolve` (MAP-Elites over 7 fixed policy surfaces), `gepa`, `learn`, `bench`/`security_bench`, `redblue`, and the mature readiness family (`score`/`genome`/`similarity`/`drift`/`oia_audit`) are thin, contract-tested wrappers over external `optionalDependencies`; the algorithms run upstream via subprocess.

**Honest gaps** (why today's optimization is *un*-proven): never run to a measured outcome in-repo; no ruflo-owned held-out benchmark (fitness reduces to "beats `npm test`" — gameable); no provenance on any output; `learn` unreachable without an external checkout; `--host` an unvalidated passthrough; **no feedback path** back into ruflo config; **no memory of rejected mutations**; **no separation of observation from training data**; **no separation of promotion from deployment**.

## Decision

Build the **closure layer** that turns metaharness's optimization primitives into a closed, receipt-backed loop. The optimization *substance* stays upstream (optional-dependency, degrades per ADR-150); ruflo owns **qualification, the benchmark, the gate, the canary, the proof, the anti-pattern memory, the host fan-out, the schedule, and the feedback.**

```
OBSERVE
  │        (raw hook trajectories — NOT yet training data)
  ▼
CANDIDATE DATASET
  │        collect trajectories + their receipts
  ▼
QUALIFICATION ──────────────► [reject] ──► ANTI-PATTERN DB (negative learning)
  │        admit only qualified trajectories
  ▼
OPTIMIZE (multi-host)         evolve / gepa / learn — proposes a mutation
  │
  ▼
VERIFY                        held-out benchmark + redblue + drift + deterministic replay
  │
  ▼
CANARY                        real-world behavior on a bounded slice before global rollout
  │        [reject] ──► ANTI-PATTERN DB
  ▼
PROMOTE                       accept() conjunction holds
  │
  ▼
SIGN                          Ed25519 proven-configuration-manifest receipt
  │
  ▼
DEPLOY ──► (ADR-177) PROPAGATE to existing installs ──► AUDIT (continuous)
```

Two structural separations are load-bearing (see the review that shaped this ADR):

### 1. Separate observation from training data — the Qualification stage

Raw observed trajectories are **not** training data. Between OBSERVE and OPTIMIZE sits QUALIFICATION, which admits a trajectory into the candidate dataset **only if it is complete, unambiguous, sufficiently-confident, replayable, and receipt-backed**. Otherwise the optimizer slowly learns from noisy successes and overfits the benchmark.

> **Invariant (Q):** No trajectory enters optimization unless it has **complete provenance** (every step attributed, ADR-171 tier ≥ oracle/judge, not proxy), **deterministic replay** (re-running the recorded inputs reproduces the recorded outputs), and **benchmark attribution** (it maps to a task in the versioned corpus). Trajectories failing Q are not silently dropped — they are recorded (see negative learning).

### 2. Separate promotion from deployment — the Canary stage

Held-out evaluation proves the candidate on *frozen* data; it has not observed *real-world* behavior. Between VERIFY and PROMOTE sits CANARY: the candidate runs on a **bounded, reversible slice** of live work and reports **rollback rate, latency, token cost, failure frequency, and user acceptance**. Only after canary evidence does PROMOTE fire. This is what prevents benchmark-specific evolution from reaching global rollout.

## The promotion rule — a conjunction of externally-measurable predicates

Promotion is **not** a scalar. A candidate is accepted iff **every** externally-measurable term holds:

```
accept(candidate) ⟺
      held_out_score      >  baseline
  AND redblue             == PASS
  AND drift               <= threshold
  AND replay              == deterministic
  AND receipt_coverage    == 100%          // every candidate-dataset trajectory receipt-backed
  AND canary.rollback_rate <= baseline      // real-world, not just held-out
```

Every term is independently measured by a different mechanism (benchmark harness, redblue, drift-from-history, replay engine, receipt audit, canary telemetry). A candidate that regresses **any** term is rejected — and archived as an anti-pattern.

## Success metrics — multi-dimensional, Goodhart-resistant

No single optimization score. Track independent dimensions with independent monotonicity constraints:

| Metric | Constraint |
|---|---|
| Held-out quality | must improve |
| RedBlue resilience | must improve |
| Cost per accepted task | no worse |
| Latency | no worse |
| Determinism | maintain |
| Rollback frequency | lower |
| Receipt coverage | 100% |

Optimizing one at the expense of another is a **rejection**, not a trade-off the optimizer may make on its own.

## Negative learning — the anti-pattern database

Rejected mutations are **knowledge**, not waste. Every mutation that fails qualification, verify, canary, or the `accept()` conjunction is recorded to an **anti-pattern archive** (`{ mutation, stage_failed, evidence, corpusVersion }`), stored in the shared substrate with ADR-171 provenance. Future optimization runs consult it to avoid re-discovering identical failures.

```
mutation ─► evaluation ─┬─► accepted ─► champion archive (lineage)
                        └─► rejected ─► anti-pattern DB (avoid-list)
```

## Multi-host + hierarchical evolution (generalization)

"All available hosts" → a small **host registry** (`claude-code`, `codex`, extensible) fans the optimize+verify+canary pass across hosts, so a manifest is proven per-host (not an unvalidated `--host` passthrough).

The open research risk is that improvements found on one repository do **not** generalize — repository-specific optima will emerge. Rather than chase one universal harness, evolution is **hierarchical**, each layer inheriting upward but **independently benchmarked**:

```
Global baseline
  └─ Language family (e.g. TypeScript)
       └─ Framework family (e.g. Node CLI)
            └─ Repository specialization
```

A repository adopts the most-specific layer whose manifest passes *its own* benchmark; layers it can't clear fall back to the parent. This scopes what any single manifest claims and keeps generalization an empirical, per-layer question.

## The self-optimizing flywheel — getting smarter *as it runs*

The stages above optimize *once, on demand*. A **flywheel** is the closed loop where each *verified* improvement becomes the baseline for the next cycle, so gains **compound** instead of being rediscovered:

```
Observe → Benchmark(immutable holdout) → Evolve(candidates) → Verify(holdout, security,
drift, replay, governance) → Promote(winner = new baseline, signed) → Deploy(SHADOW first,
adopt only after local verification) → Observe again
```

The property that makes it a flywheel, not a search engine: **every generation starts from the best *verified* policy, and the full lineage back to generation 0 is reconstructable, each promotion backed by signed, independently-replayable receipts.** A search engine explores and discards; the flywheel accumulates verified winners with an auditable lineage.

Three things must be true, each engineered to stay honest:

1. **The yardstick grows from real usage.** A corpus harvester (`harness-corpus-harvester.ts`) mines the install's own store into a **self-supervised self-retrieval** benchmark: a stored doc is unambiguous ground truth for a query derived from its *own body with the subject tokens withheld*. An `oracle:test-exec`-grade executable check, not a proxy — so the test set expands as the store does.

2. **Optimize the trusted objective; guard breadth with the cheap signal.** The optimization target is the **human-labeled** anchor (ADR-081) — the relevance we actually care about, where headroom is known to exist. The large, growing harvested set is the **no-regression generalization guard** (bound to the `redblue` term), so tuning the objective can't quietly wreck broad retrieval. *(An earlier inverted design — optimize the cheap harvested metric, guard with the human anchor — was corrected after a live run showed the best candidate regressing the anchor: the gate correctly refused, exposing the mismatch.)*

3. **Improvement is proven, not asserted.** Every tick appends to an **improvement ledger** (`harness-improvement-ledger.ts`) with the corpus hash, baseline vs candidate held-out score, a **bootstrap confidence lower bound** on the per-task delta (the gain must survive resampling — small-N noise guard), every `accept()` term, and the outcome. Because the loop only accepts a *strict, significant* improvement that regresses no task, the accepted subsequence is **monotonic-by-construction** and each champion **chains** to its predecessor. `summarizeImprovement()` folds this into an auditable claim; a single non-improving or unchained accept flips the `monotonic`/`chainIntact` flags — the ledger cannot launder a regression, and it records the *refusals* too.

**Deploy shadow-first — no auto-serve.** A promoted candidate is registered in **SHADOW** (`served: false`); serving is a separate, locally-verified adoption step, never automatic. The `evolve-proof.ts` receipt bundle carries the seven artifacts — input-holdout hash, baseline + candidate manifest hashes, `meetsPromotionRule` version, decision receipt, SHADOW registration id, cost receipt — so a third party can rehash the inputs and **re-run the same versioned `accept()` to confirm *why* a candidate passed or failed without trusting any service log** (`verifyReceiptBundle`).

**Telemetry makes it observable, not aspirational.** `reconstructLineage()` answers: generations run, candidates evaluated, promotions, cumulative held-out improvement, rejection rate, plateau — so one can see whether the system is *genuinely compounding* or *merely searching*.

**Status (honest) — DEMONSTRATED.** The flywheel milestone has been met on real data (`.claude/evolve-proof/real-generation-{0,1}.json`, reproducible via `scripts/flywheel-generations.mjs`, replayable from disk with no service logs):

- **gen 0** (immutable root): self-retrieval RR **0.496 → 0.758** (Δ +0.262, bootstrap CI-low **0.181 > 0** → significant), human anchor preserved (0.776 vs 0.796, within guard), canary 0 rollbacks → promoted.
- **gen 1** (compounds on gen 0): RR **0.758 → 0.847** (Δ +0.090, CI-low **0.039 > 0**), anchor preserved (0.792), canary 0 → promoted. Its baseline == gen 0's promoted candidate — the winner *became* the baseline.
- `reconstructLineage` → **promotions=2, lineageIntact=true, allReplayable=true**, single immutable root; both bundles re-run `accept/v1+sig` to their recorded verdicts independently.

The discovery was **autonomous** — a coarse→local multi-axis grid with **constrained (Pareto) selection** (maximize the frozen self-supervised held-out *subject to* the human-relevance guard) found both winners; no config was hand-picked.

**The autonomy loop is now the daemon's behavior, not a one-shot script** (`harness-flywheel-generations.ts` + `runFlywheelGenerationWorker`): each daemon tick runs ONE generation, reads the **persisted champion** as the baseline, and on a verified promotion advances the champion so the next tick **compounds** — winners accumulate in a persisted, replayable lineage. It is **shadow-first**: a promoted champion is applied to the active policy only at the *start of a later tick* (a 1-generation shadow delay), never auto-served the instant it is promoted. Verified live on the real store: tick 0 promoted gen 0 (served=none), tick 1 compounded gen 1 *and* served gen 0. `flywheelStatus()` / `scripts/flywheel-status.mjs` surface the lineage + telemetry (generations, cumulative Δ, plateau, mutation-effectiveness, served champion) as the status endpoint.

**Meta-learning (evidence → action).** `axisEffectiveness()` attributes each promotion's held-out Δ to the policy axes that moved, and `biasedGrid()` concentrates the search on axes that have historically paid off (a ±1 exploration floor on every axis, but expanded range + pairwise joint moves on productive ones) — the optimizer *uses* the lineage-as-knowledge-base, not just records it. **Deployment-safety canary.** `checkServedChampionDrift()` runs each tick *before* the generation: it re-scores the currently-served champion against its predecessor on a **fresh harvest of the current store**, and auto-**rolls back** the active policy if the champion has drifted (self-retrieval or the human anchor). Real ongoing measurement + real rollback on real evolving data — the honest analogue of a live-traffic canary, without fabricating traffic.

**Biggest failure mode + fix (anti-overfitting).** The known risk: the loop overfits the self-supervised proxy while human relevance is *preserved but not improved*. Two defenses make that **visible and falsifiable** rather than hidden:
- a **frozen, public, hashed human-labeled eval set** (`.claude/eval/human-relevance-frozen-v1.json`, loaded via `harness-frozen-eval.ts` which pins the content hash and throws on drift) — the single source of truth for the red/blue anchor;
- a **per-generation human-relevance delta** recorded in every receipt (`deltas.humanRelevance` vs `humanEvalHash`) and surfaced by `flywheelStatus` — so "proxy Δ ≫ 0 while human Δ ≈ 0" shows up in the status as an explicit **overfitting** flag instead of being buried.

**Acceptance test (clean-room replay).** `scripts/replay-generation.mjs` (a CI gate): from a clean install, replay one PROMOTED generation from its receipt alone — every embedded hash recomputes bit-identically and re-running `accept/v1+sig` on independently-recomputed inputs reproduces `promoted=true`, with **network access trapped** (offline). A promotion is reproducible without trusting any service log.

**Honest scope of the claim.** The measured improvement is on a **self-supervised self-retrieval** benchmark (find a doc from its own body), gated so human-labeled relevance does **not** regress. So the demonstrated capability is: *retrieval gets generation-over-generation better at self-retrieval while preserving human relevance and deployment safety* — it is **not** a claim that human-labeled relevance improved (that is held flat by design). Proving compounding gains on human-labeled relevance directly would need a large human-labeled suite (out of scope for $0 autonomous operation). The value shown is that **the wheel provably turns**: verified improvements accumulate into an auditable, replayable lineage without human intervention.

**Local vs global trust.** A locally-mined, gate-cleared champion may be adopted **locally, unsigned** (the install trusting its own execution-verified evidence on its own data). Cross-install propagation still requires the config-signed champion (ADR-177). Local self-optimization and global distribution are separate trust domains.

## Version control for operating policies

The right mental model is **git, but for executable decision policies**. Each generation is a commit with a parent, a diff, verification, a signature, reproducibility, and deployment history — and **generation 0 is the immutable root of the evolution graph** (replay starts there; it never changes). This makes the lineage a **knowledge base**, not just an audit trail:

- **Causality, not just provenance.** A promotion record carries `mutationClass`, `mutationSummary`, and multi-dimensional `deltas` (benchmark / security / cost) alongside the decision receipt — so the graph answers *which mutation classes reliably pay off*, not merely *which policy won* (`PromotionRecord`, `classifyMutation`).
- **Mutation effectiveness → evidence-grounded meta-learning.** `mutationEffectiveness()` aggregates attempts / promotions / mean-Δ per class; after enough generations the optimizer can bias toward classes with historical payoff rather than searching uniformly.
- **Regression ancestry.** A rejected candidate records its `failureCause` (holdout / security / drift / replay / governance / canary / significance) and its ancestor — so "which design decisions repeatedly regress?" becomes answerable (`RegressionRecord`).
- **A DAG, not a linked list.** Lineage is modeled as a graph with branch labels (`main`, and future tenant/domain branches like `legal` / `coding` / `customer-A`). The invariant is *a child's baseline == its parent's promoted candidate* — it holds for linear chains and forks alike (`reconstructLineage`).
- **Statistical plateau, not intuition.** `detectPlateau()` over a rolling window separates **local-optimum** (no gains + candidate variance shrinking), **noisy-benchmark** (no gains + high non-shrinking variance), and **optimizer-failure** (no gains + candidates barely vary), rather than "no promotion for a while."

**The milestone that matters.** Not "generation 1," nor "generation 10." The first significant milestone is: *the system autonomously discovers a **second** independently-verified improvement that survives a **frozen anchor suite** and enters the immutable lineage **without human intervention**.* At that point the thesis moves from design to demonstrated capability — the wheel has provably turned. **This milestone has now been met** (see *Status — DEMONSTRATED* above): two successive significant promotions on a frozen self-supervised held-out, each preserving the human-relevance guard, chained + independently replayable back to the immutable root.

## Naming (see ADR-177)

Internally, an optimized artifact is a *genome*. **Once propagated, it is a "proven configuration manifest" / "verified execution policy"** — names that emphasize reproducibility and constraints over evolutionary novelty. External surfaces (CLI, docs, the propagation channel) use the manifest naming.

## Proof primitives (reuse, don't reinvent)

- **Receipt / attestation:** Ed25519 via `helper-signing.ts`'s canonical-JSON sign/verify (do not add a fifth trust root; helpers, RVFA, witness already exist).
- **Provenance tiers:** ADR-171 (`oracle:test-exec` > `judge:fable` > `proxy:structural`); qualification requires ≥ oracle/judge.
- **Held-out gate:** the `distill-tuning.ts` pattern (isolated copies, checksum before/after, one-shot held-out scoring).
- **Cost/safety:** $0 dry-run default; spend explicit + capped (ADR-172); metaharness `safety.ts` (no live targets/secrets/shell) inherited.

## What this ADR deliberately does NOT claim

- Not that `evolve`/`learn`/`redblue` already produce proven results — they are optional engines *behind* the gate; if absent, the loop degrades and the last signed champion stands.
- Not a reimplementation of upstream algorithms (`_harness.mjs`/`_darwin.mjs`/`_redblue.mjs` remain the only resolution points, ADR-150).
- Not that a signed manifest is *suitable* for a given install — suitability is ADR-177's constraint-manifest concern.

## Alternatives considered

- **Trust the evolve winner and ship.** Rejected: no held-out corpus + `npm test` fitness = gameable (the "measured not marketing" failure ADR-174 warns against).
- **Observe → Optimize directly (no qualification).** Rejected: learns from noisy successes; the Qualification invariant is the cheaper defense.
- **Held-out pass ⇒ deploy (no canary).** Rejected: held-out ≠ real-world; canary catches benchmark-specific evolution.
- **A single scalar objective.** Rejected: Goodhart; the multi-term `accept()` + independent metrics table is the defense.
- **One universal harness.** Rejected as the *default*: hierarchical, per-layer-benchmarked manifests scale better and bound each claim.

## Rollback

Every stage is additive and gated; the loop only *proposes*. A champion is applied only after clearing qualification, verify, canary, and the full `accept()` conjunction; applied config carries reversible provenance metadata and a pointer to the previous manifest (ADR-177). Absent the optional metaharness packages the loop is a no-op and the last signed champion remains.

## Acceptance test

**Reproducibility + replayability:** starting from the same baseline, **two independent runs with the same benchmark corpus and promotion rules must converge on equivalent promoted manifests**, and **every promoted manifest must be fully replayable from its signed receipts**. If two runs diverge or a manifest cannot be replayed from its receipts, the loop is not receipt-backed and the release is blocked.

## Implementation roadmap (phased, each independently shippable)

1. **Qualification + candidate dataset** — the Invariant-Q admitter; wire the anti-pattern DB for rejects.
2. **Benchmark corpus** — curate + version `benchmarks/harness-suite/`; isolated-copy scoring + numeric held-out gate.
3. **Deterministic replay engine** — record/replay for Invariant-Q + the `replay == deterministic` predicate.
4. **Adversarial + drift gate** — `redblue --mock-judge` + `drift_from_history`.
5. **Canary** — bounded live slice + telemetry (rollback/latency/cost/acceptance).
6. **Proven-configuration-manifest receipt** — Ed25519 sign/verify (proof #3), with the ADR-177 constraint fields.
7. **Host registry + hierarchical layers** — claude-code/codex; global→language→framework→repo.
8. **Daemon worker** — scheduled, $0-default, budget-capped.
9. **Feedback applier** — apply the signed champion to routing/agent config, provenance-tagged, reversible.
10. **Self-optimizing flywheel** — corpus harvester (self-supervised, growing) + constrained (Pareto) multi-axis Evolve + significance-gated rule (`accept/v1+sig`) + separated canary + shadow-first / no-auto-serve + DAG lineage telemetry. *(**DEMONSTRATED** — `scripts/flywheel-generations.mjs` autonomously produced 2 real, significant, anchor-safe, independently-replayable compounding promotions on a frozen self-supervised held-out (RR 0.496→0.758→0.847), chained to the immutable root; see *Status — DEMONSTRATED*. Getting there required: retrieval-stats + per-query cosine caching (~14x, made generations iterable), significance in the rule (small-N noise guard), separating the canary from the held-out, and constrained selection (improve the proxy subject to the human-relevance guard). The one-shot mint separately produced a real +0.0738 nDCG@3 champion over the ADR-082-tuned baseline.)*

## Acceptance test — the flywheel (distinct from the one-shot loop above)

After multiple generations, the **complete lineage from the current policy back to generation 0 must be reconstructable**, every promotion supported by signed receipts and **independently replayable evidence** — i.e. rehash each bundle's inputs and re-run the versioned `accept()` to confirm the recorded decision, without trusting any service log. `reconstructLineage()` + `verifyReceiptBundle()` implement this check; generation 0 passes it today (trivially, as a single node).
10. **Propagation** — ADR-177.
