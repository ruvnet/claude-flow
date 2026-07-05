# ADR-176 — Self-Optimizing Harness Loop (Receipt-Backed Evolution)

- **Status:** Accepted (implemented — PR #2572)
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

**Status (honest).** Implemented + independently verifiable: the **generation-0 proof-of-mechanism** (`.claude/evolve-proof/generation-0.json`) — gate wiring, receipt persistence, SHADOW registration, no-auto-serve, replayable from disk — plus the harvester, the significance-gated ledger, and lineage/telemetry, all unit-proven (a controlled tick learns + applies + records a significant, chained entry). **Not yet demonstrated:** a real *multi-generation compounding climb on live data* — the harness is wired and the lineage scaffolding exists, but the end-to-end compounding run (winners accumulating across generations on the real store) is the next step, gated on making the live retrieval search cheap enough to iterate. Generation 0 is the fixture that work builds on. No synthetic pass here is evidence of real-world improvement.

**Local vs global trust.** A locally-mined, gate-cleared champion may be adopted **locally, unsigned** (the install trusting its own execution-verified evidence on its own data). Cross-install propagation still requires the config-signed champion (ADR-177). Local self-optimization and global distribution are separate trust domains.

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
10. **Self-optimizing flywheel** — corpus harvester (self-supervised, growing) + human-objective / harvested-guard + significance-gated improvement ledger (monotonic-by-construction proof) + shadow-first / no-auto-serve + lineage telemetry. *(Partially implemented, honestly scoped: the one-shot mint produced a real +0.0738 nDCG@3 champion over the ADR-082-tuned baseline; the **generation-0 proof-of-mechanism** is implemented + independently replayable; the **multi-generation compounding climb on live data** is NOT yet demonstrated — it is the next step (A-P3b), for which generation 0 is the fixture. A live single-tick refused to promote until the objective was reoriented, which is the gate working, not the flywheel compounding.)*

## Acceptance test — the flywheel (distinct from the one-shot loop above)

After multiple generations, the **complete lineage from the current policy back to generation 0 must be reconstructable**, every promotion supported by signed receipts and **independently replayable evidence** — i.e. rehash each bundle's inputs and re-run the versioned `accept()` to confirm the recorded decision, without trusting any service log. `reconstructLineage()` + `verifyReceiptBundle()` implement this check; generation 0 passes it today (trivially, as a single node).
10. **Propagation** — ADR-177.
