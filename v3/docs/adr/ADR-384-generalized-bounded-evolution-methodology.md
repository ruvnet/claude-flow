# ADR-384 — Generalized Bounded-Evolution Methodology (Darwin+Flywheel) with Error-Control Proof

**Status:** Proposed
**Date:** 2026-08-15
**Deciders:** ruflo-watermark maintainers, darwin-mode / agent-harness-generator maintainers, integration owner
**Supersedes/relates:** ADR-072/073/075 (Darwin cost/reproducibility/archive), ADR-099/101/102/106 (sandbox manifold + Tier2), ADR-112 (FDR small-n caveat), ADR-153/155 (bench suites, security harness), ADR-322 (flywheel receipts/promotion), ADR-381 (sequential-evidence e-process). In-crate instance: `crates/ruflo-watermark/src/{evolve.rs, align.rs}`.

---

## Context

Two systems in this monorepo implement the *same* bounded-evolution methodology with *zero shared code*:

1. **Darwin-mode harness-evolution** (`agent-harness-generator/packages/darwin-mode/src`, TypeScript): evolves a 7-file agent-harness genome (`planner/contextBuilder/reviewer/retryPolicy/toolPolicy/memoryPolicy/scorePolicy`), grades variants with a frozen 6-term scorer, promotes only through a 4-clause gate plus an optional statistical layer (bootstrap child-vs-parent, Benjamini-Hochberg FDR demote-only, monotonic SGM risk budget), and retains a whole-archive lineage.

2. **ruflo-watermark detector-tuning** (`crates/ruflo-watermark/src/{evolve.rs, align.rs}`, Rust): a `(1+λ)` elitist strategy over a 3-field numeric genome (`AlignParams{band, gap_penalty, null_replays}`), a frozen `IndelBenchmark`, a frozen scalar fitness (`margin = mean_pos_z − max_neg_z`), one honest reference (`selfsync_reference`), full seeded determinism, retained lineage, and promotion deliberately left to the caller.

Both already assert the identical invariants — **frozen fitness declared before the run, bounded budget, retained lineage including failures, no auto-promotion, evaluation ≠ promotion**. The generic *back half* of Darwin (selection zoo, BH-FDR / bootstrap / SGM statistics, whole-archive lineage) already operates on abstract `(variant, score, traces)`. The *front half* (genome, environment, fitness, reference, sandbox) is domain-welded in both. As a result the watermark crate cannot reuse a line of Darwin, and Darwin cannot express a numeric-parameter search.

We want one governed framework in which "evolve a 7-surface harness" and "tune a detector's parameters" are literal instances, and we want to state — honestly — exactly what error-control the framework buys and where the guarantees are only approximate.

**This ADR was written against a full adversarial statistical review and an implementation review.** Both are load-bearing. The central finding of the statistical review is uncomfortable and is stated up front rather than buried:

> **The shipped watermark crate does not currently possess the headline "bounded false-promotion" property.** Its only promotion guard is a single point comparison `best.margin > selfsync.margin` (`evolve.rs:143`) — no null, no variance, no error rate. The error-control machinery the proof relies on (ADR-381's e-process, or the meta-null permutation) is *not wired in*. The proof below certifies an **abstract tuner** and specifies what must be built; the crate as of this ADR is a partial instance. The implementation plan (Phase 0) is what makes the guarantee real for the watermark instance.

---

## Decision

Introduce a domain-agnostic bounded-search framework — **`ruflo-evolve`** (Rust) with a mirror **`@claude-flow/evolve`** (TypeScript) — whose contract is six abstractions plus a generic driver. Both flagship systems re-express themselves as thin adapters. The framework **coordinates and evaluates; it never promotes.** Promotion is a separate, signable, human-gated artifact.

The generic *back half* (selection strategies, statistics, lineage, driver) is shared as a specification realized twice (Rust value-typed + byte-deterministic; TypeScript async because the evaluator may be out-of-process/paid). The *front half* is injected per domain through traits.

### The six abstractions (Rust; TS mirror in Applicability)

```rust
pub type GenomeId = [u8;32];
pub type EvaluatorId = [u8;32];

// Deterministic PRNG addressed by (run_seed, generation, child).
// All SEARCH randomness flows through this (see revised invariant 5).
pub struct Prng(u64);
impl Prng { pub fn at(seed:u64, gen:u32, child:u32) -> Self; pub fn u01(&mut self)->f64; }

// (1) GENOME — unifies AlignParams(numeric) and the 7 policy surfaces(structured).
pub trait Genome: Clone + Send + Sync + 'static {
    fn seed() -> Self;                         // incumbent/default, deterministic
    fn mutate(&self, rng:&mut Prng) -> Self;   // clamps into feasible region for numeric reps
    fn is_feasible(&self) -> bool;             // load-bearing only when mutate cannot self-clamp (TS surfaces: compiles?)
    fn id(&self) -> GenomeId;                  // content hash → lineage id + dedup
}

// (2) METRIC — replaces the frozen 6-term scorer AND the scalar margin.
// Diagnostics live HERE (typed), NOT in a stringly-typed side channel (review finding 6).
pub trait Metric: Clone + Send + Sync + 'static {
    fn scalar(&self) -> f64;             // total order for elitism / best()
    fn dominates(&self, o:&Self) -> bool; // Pareto — NO DEFAULT (review finding 9)
}

// Unified cost — the seam that makes iteration-count and paid spend one thing.
#[derive(Default,Clone)]
pub struct Cost { pub evals:u64, pub wall_s:f64, pub usd:f64, pub tokens:u64 }

// Immutable per-candidate evidence, retained whole; carries evaluator_id (frozen-env proof).
pub struct Receipt<G:Genome, M:Metric> {
    pub genome:G, pub genome_id:GenomeId, pub metric:M,
    pub evaluator_id:EvaluatorId, pub cost:Cost, pub coords:(u32,u32) /*gen,child*/,
}

// (3) FITNESS EVALUATOR (FROZEN) — replaces IndelBenchmark AND the three sandboxes.
pub trait FitnessEvaluator: Send + Sync {
    type G: Genome; type M: Metric;
    // Reserve → run → settle so a paid out-of-process judge is metered correctly
    // (review finding 2 — debit-before-work strands partial evals).
    fn reserve(&self, g:&Self::G, b:&mut Budget) -> Result<Ticket, Exhausted>;
    fn settle(&self, t:Ticket, g:&Self::G) -> Receipt<Self::G, Self::M>; // &self: never sees a verdict
    fn fingerprint(&self) -> EvaluatorId;                       // declared-before-run proof
    fn references(&self, b:&mut Budget) -> Vec<Receipt<Self::G,Self::M>>; // a LADDER, not one ref
}

// (4) LINEAGE STORE — generalizes the Archive; failures included, never dropped.
pub trait LineageStore { type G:Genome; type M:Metric;
    fn record(&mut self, r:Receipt<Self::G,Self::M>);   // called BEFORE any comparison
    fn all(&self) -> &[Receipt<Self::G,Self::M>];
    fn best(&self) -> Option<&Receipt<Self::G,Self::M>>;
}

// (5) PROMOTION GATE — first-class, signable, SEPARATE from search.
pub enum Verdict { Promote, Retain(String) }

// Null evidence is NOT replay-shaped by contract (review finding 5): the metaharness
// instance clears winner's-curse with bootstrap/FDR, which has no null_mean/null_sd.
pub enum NullEvidence {
    Replayed(Standardized),                 // watermark: wrong-key / meta-null z
    Bootstrap { q:f64, method:&'static str },// metaharness: BH-FDR / bootstrap
    Absent { reason:&'static str },         // must be justified; a Promote with Absent is a policy error
}

pub struct PromotionReceipt {
    pub genome_id:GenomeId, pub evaluator_id:EvaluatorId, pub gate_seed:u64, pub verdict:Verdict,
    pub evidence: serde_json::Value,        // margins-vs-refs, null evidence, FDR q, SAFETY-FLOOR result
    pub signature: Option<[u8;64]>,         // Ed25519; ONLY on a policy-authorized promote
}
pub trait PromotionGate { type G:Genome; type M:Metric;
    // PURE. Never mutates a running incumbent. MUST evaluate a declared safety floor
    // (review finding M) in addition to beats-references + null-cleared + statistical checks.
    fn safety_floor(&self, cand:&Receipt<Self::G,Self::M>) -> Result<(), String>;
    fn admit(&self, cand:&Receipt<Self::G,Self::M>,
             refs:&[Receipt<Self::G,Self::M>],
             null:&NullEvidence, stats:&serde_json::Value) -> PromotionReceipt;
}
```

### (6) The lifted primitive — EmpiricalNullCalibrator + NuisancePreservingNull

The watermark's wrong-key replay and the missing winner's-curse guard are one contract: *recompute the selection statistic under a signal-destroying, nuisance-preserving perturbation, then standardize.* Factor it out of `detect_gumbel_aligned` so both levels reuse it, and make it accept a **pluggable null estimator** (replay OR bootstrap/analytic surrogate — review finding 8):

```rust
pub trait NuisancePreservingNull { type Ctx;
    fn perturb(&self, base:&Self::Ctx, replica:u32) -> Self::Ctx; } // identical nuisance, zero signal

pub struct Standardized { pub observed:f64, pub null_mean:f64, pub null_sd:f64, pub z:f64, pub p_perm:f64 }

pub struct EmpiricalNullCalibrator;
impl EmpiricalNullCalibrator {
    pub fn calibrate<C>(&self, base:&C, observed:f64,
        stat: impl Fn(&C)->f64, null:&impl NuisancePreservingNull<Ctx=C>, replays:u32) -> Standardized;
}
```

### Driver (the generic back half — structurally cannot promote)

```rust
pub struct EvolutionOutcome<G:Genome,M:Metric> {
    pub best:Receipt<G,M>, pub references:Vec<Receipt<G,M>>,
    pub lineage:Vec<Receipt<G,M>>, pub meta_null:NullEvidence,
}
pub fn evolve<E,S>(ev:&E, store:&mut dyn LineageStore<G=E::G,M=E::M>,
    strat:&S, budget:Budget) -> EvolutionOutcome<E::G,E::M>
where E:FitnessEvaluator, S:SelectionStrategy<G=E::G,M=E::M>;
// seed → reserve/settle → record; per gen: strat.parents(store.all());
// child = parent.mutate(Prng::at(seed,gen,child)); skip if !feasible;
// reserve/settle or halt on Exhausted; record EVERY child incl. losers;
// stop on budget.exhausted(); compute references + meta_null. NEVER calls a PromotionGate.
```

`Budget` is the single place iteration-count and spend unify — a monotonic, non-refillable ledger with `reserve → settle` two-phase accounting.

---

## Formal Properties & Proof

We formalize the abstract tuner `(Θ, D, E, f, b, Search, Gate)` and prove three properties. **Every assumption is stated; every approximation is flagged.** The running instance is the watermark crate; the guarantees hold for the *abstract tuner once Phase 0 is built*, not for the crate as shipped today.

The abstract object: Θ genome space; `E=(P positives, N negatives)` a benchmark drawn **once** from D and **frozen** before any candidate exists; `f:Θ→ℝ` a **pure** function of `(θ,E)` a candidate cannot alter; reference `b` scored on the same E; `Δ(θ)=f(θ)−f(b)` a **paired** contrast; Search bounded and seed-deterministic — `mutate` reads only `(seed,gen,child)`, never a fitness value; winner `θ* = argmax_k f(θ_k)`, stream length `M=1+G·C`; Gate separate from search.

### Claim 1 — frozen fitness + held-out benchmark bounds over-optimism of the *pos_mean* term of the selected candidate

**Assumptions.** (A1) E frozen, independent of the mutation operator; (A2) `f` pure in `(θ,E)` — no self-grading; (A3) per-positive-stream contributions concentrate (see flag G below).

**Key move (load-bearing, and its limits).** Because `mutate` deltas depend on the **seed, not on fitness**, the set of *reachable* candidates is finite and **E-independent**, fully determined by `budget.seed`: `|R_reach| = O(C^G)`, `log N_reach ≈ 8` at G=4,C=6. Seeded determinism is therefore *part of the proof*, not just reproducibility hygiene. A union bound over the E-independent `R_reach` gives, w.p. ≥ 1−δ:

`F_pos(θ*) ≥ f_pos(θ*;E) − σ·√(2 log(N_reach/δ)/|P|)`.

Elitism additionally gives `f(θ*) ≥ f(baseline)` deterministically (no in-sample regression).

**Flags / approximations (adversarial points E→H, K, F, G).**

- **[FLAG — scope; adversarial F].** This bound covers **only the `pos_mean` term** (a mean of iid streams). It does **not** cover `neg_max_z`, the safety-critical FP term: `neg_max_z(θ*) = max over the negative *set*` at an adaptively-selected θ*, which is itself a selection statistic. **Neither Claim 1 (a mean bound) nor Claim 2 (a per-stream null) bounds `E[neg_max_z(θ*)] − true`.** The one quantity the safety gate (`neg_max_z < 4.0`) depends on has *no analytic over-optimism control*. This is closed operationally by the independent-gate split (Claim 3 / Phase 0): `neg_max_z` is re-measured on an independent seed B and the `< 4.0` clause is enforced on B, where selection did not act on it. We state plainly: **the analytic bound does not reach the safety term; only the split does, and the split gives an unbiased estimate, not a closed-form certificate.**

- **[FLAG — assumption conflict; adversarial G].** A3's σ-sub-Gaussian assumption **contradicts** Claim 2's admission that the per-stream z's are a Gaussian standardization of a right-skewed extreme (heavier-than-Gaussian tails). We cannot have both. Resolution: replace A3 with a **bounded-support / empirical-Bernstein** concentration — post-calibration z is clamped to a finite range in practice, and we use `σ̂` estimated with its own inflation term. The bound then carries a variance-of-variance correction and is **weaker than the clean sub-Gaussian form.** We do not claim the sub-Gaussian constant.

- **[FLAG — numerically empty at deployed sizes; adversarial H/I].** At `|P|≈20`, `δ=0.05`, `log N_reach≈8`: slack `≈ σ·√(22/20) ≈ 1.05σ` — comparable to the margins themselves (order 1); at `|P|=6` (the ADR-112 floor) it is `≈1.9σ`. **The analytic certificate is asymptotically sound and empirically vacuous at the sizes the system runs.** Therefore Claim 1 is *not* the operative guarantee. The operative guarantee is the empirical independent-gate split + the corrected meta-null permutation (Claims 3). Claim 1 is retained as a qualitative statement (over-optimism grows only `√(log N_reach) = O(√(G log C))` in search effort) and as motivation for keeping the seed E-independent — not as a numeric bound we rely on.

- **[FLAG — per-seed; adversarial K].** `R_reach` is per-seed. Running M seeds and reporting best-across-seeds is uncontrolled optional stopping that widens the bound to `log(M·N_reach)`. **Mitigation (governed):** the run seed is pre-registered and persisted in the `PromotionReceipt.gate_seed`, exactly as the k-index is persisted for Claim 3; seed-shopping is a policy violation, not a free move. The meta-null (which *requires* B reruns with varied seeds) uses a fixed, declared seed schedule.

### Claim 2 — empirical-null (wrong-key replay) gives a valid null; the per-stream z/p is not (badly) anti-conservative

The statistic `T(θ;key)=local_align_max(centered_scores(tokens,key))` is a max-over-alignment-paths quantity whose naive null is right-skewed. Calibration recomputes `T` under `K=null_replays` wrong keys (nuisance-preserving: identical tokens/marginal law/band/gap; signal-destroying), then standardizes.

**Assumptions.** (i) under H0 the stream is independent of all K+1 keys (true for a genuine null stream); (ii) **hash idealization** — `mix64`/`context_seed` as a random oracle.

**Exact result.** Under (i)+(ii), `(T_obs, T_1,…,T_K)` are **exchangeable**, so the permutation p-value `p_perm = (1 + #{r: T_r ≥ T_obs})/(K+1)` satisfies `P_{H0}(p_perm ≤ α) ≤ α` **exactly** (finite-sample).

**Flags / approximations (adversarial E).**

- **[FLAG — as-coded ≠ as-proved].** The code uses a Gaussian standardization + `normal_upper_tail(z)`, **not** `p_perm`. This corrects the first two moments (removes the dominant max-over-paths inflation) but leaves residual far-tail miscalibration from (a) finite K estimating (mean,sd) with K−1 dof and (b) Gaussianizing a skewed extreme — so `z` is mildly inflated deep in the tail. **Exact α-testing requires `K ≥ 1/α − 1`** (default K=24 floors at p=1/25). Phase 0 emits `p_perm` alongside `z` and the gate consumes `p_perm` (or a fitted Gumbel/GPD tail) for the promotion decision; the evolved `z` remains only a ranking signal.

- **[FLAG — frozen-kernel is overclaimed for this instance; adversarial E, review finding 1].** `null_replays` is an **evolvable genome field** consumed directly to compute `(mean_null, sd_null)`. "A variant cannot re-grade itself" is true only of the *formula*; the candidate selects the *calibration* fed into it, and `argmax margin` will preferentially pick genomes whose fixed-seed `(K, replay-seeds)` realization yields a lucky-low `sd_null`. **This is a live selection-of-calibration-noise channel Claim 2 does not bound, and it is a correctness bug in the shipped crate, not merely a design nicety.** Fix (Phase 0, mandatory): the promotion gate **re-scores the winner and every reference at a fixed, pre-registered `k*`** (e.g. 48) — nearly free because caching already holds all `r<48` wrong-key vectors. The frozen-kernel invariant is restated honestly as *frozen formula + frozen gate-time calibration*, and `null_replays` may vary during *search* but not at the *gate*.

### Claim 3 — family-wise false-promotion control under an adaptively-chosen candidate stream

Two routes. **Both require the independent-gate split** — this resolves the contradiction the two source documents left open (adversarial C): the efficiency lemma says the split is mandatory; the naive Claim-3 statement applied the e-process to the shared E. **We adopt the split as mandatory.** Select on seed A; gate on independent seed B ⟂ selection.

**Route A — sequential e-process (ADR-381), applied on B.** Per candidate k, an anytime-valid e-process bets `(1+λ)` on candidate-wins / `(1−λ)` on baseline-wins over discordant McNemar pairs *drawn from seed B*. Under the **sign null** `H0^k: P(discordant pair favors candidate) ≤ ½`, `(E_k^t)` is a non-negative supermartingale with `E[E_k^0]=1` w.r.t. the filtration including all prior candidates' B-data. Ville's inequality ⇒ per-candidate type-I ≤ α_k under *any* stopping rule. Basel allocation `α_k = α_total·6/(π²k²)` with `Σα_k = α_total` and an independence-free union bound ⇒ `P(∃ false promotion) ≤ α_total`.

**Route B — meta-null permutation (the corrected nuisance-preserving form).** Re-run the *whole* bounded evolution B times against a nuisance-preserving, signal-free benchmark; `p_meta = (1+#{null-best ≥ real-best})/(B+1)` is an exact permutation test of the global "the gain is chance" null for the single selection, provided identical budget/seed discipline per rerun and provided the null is genuinely nuisance-preserving.

**Flags / approximations (adversarial B, C, D, I, J, L, N) — stated explicitly.**

- **[FLAG — wrong functional; adversarial B].** Route A controls the **sign/win-rate null**, which is **orthogonal to the safety-critical worst-case FP** encoded in `neg_max_z`. A candidate can win >½ of discordant pairs (legitimately clearing Route A) while being *worse* on one catastrophic negative. **The e-process alone is insufficient for a detector.** The `PromotionGate::safety_floor` predicate is therefore **not optional**: the watermark gate must enforce `neg_max_z(best on B) < 4.0` as a hard clause *in addition to* the FWER test. We do not claim the e-process bounds the worst-case FP; it does not.

- **[FLAG — martingale breaks under benchmark reuse; adversarial C — RESOLVED by making the split mandatory].** Applying the e-process to the *same* E used for selection violates the conditional-½ assumption (testing on the training set). This ADR **removes that unsoundness by requiring seed B ⟂ selection.** Any implementation that scores the e-process on the selection benchmark is out of contract.

- **[FLAG — α-allocation is power-adverse; adversarial D].** Basel `α_k∝1/k²` gives the *least* budget to *late* candidates — which, in an evolutionary loop, are the *most likely genuine wins*. Validity survives; **usable power collapses for exactly the improvements we want.** The "fix" of reusing/resetting k is the α-double-spend the proof forbids. Consequence we accept: for the watermark's single-selection question, **prefer Route B** (the meta-null permutation), which spends α once on the whole selection and is not subject to the position-dependent starvation. Route A is retained for metaharness's genuinely sequential candidate stream where per-candidate control is the right shape; its power limitation is documented, not denied.

- **[FLAG — meta-null is NOT nuisance-preserving as originally specified; adversarial I — this is the deepest correction].** A "positive built without the watermark key" is an **unwatermarked-then-attacked** stream, whose token marginal differs from a **watermarked-then-attacked** stream — because watermarking *is* a shift of the sampling distribution. So the naive signal-free benchmark draws from a different token law, and `p_meta` becomes an exact test of the *wrong* null (potentially anti-conservative). **Correction adopted here:** build the meta-null by **holding the real watermarked-then-attacked positives fixed and replacing the detector's key with wrong keys at the meta level** — i.e., run the entire evolution scoring against *wrong-key readings of the genuine positive streams*. This preserves the token law exactly (the streams are still watermarked+attacked) while destroying the detector's access to signal — the wrong-key-replay principle lifted correctly to the meta level. This is the watermark-domain-valid meta-null; the "unwatermarked positives" construction is rejected. **Even so, `p_meta` remains conditional on the hash idealization (ii) and on B being finite (quantile uncertainty ~1/B); we report B and use a conservative high quantile.**

- **[FLAG — self-calibration fails under a signal-adaptive proposer; adversarial J].** The meta-null "self-calibrates to whatever selection intensity the optimizations create" **only for a signal-independent proposer** (blind seeded mutation). A surrogate (EI over lineage) fits a real gradient on the real benchmark and pure noise on the null — its induced selection intensity differs, so the null under-reproduces the real funnel. **Consequence:** the calibrated guarantee is claimed **only when the proposer is signal-independent** (Phase 0/1). The surrogate (Phase 3) ships behind the split, and its meta-null is generated with the *same surrogate and same seed schedule* as a best-effort match, with the residual mismatch flagged as an **open question**, not a proven guarantee.

- **[FLAG — generalization dissolves f-purity; adversarial L].** Claims 1–3 assume `f(θ;E)` is a **pure, deterministic** real number (Claim 2's exchangeability treats the K+1 T-values as deterministic given the stream; Claim 1 union-bounds over a finite genome set). A metaharness **paid out-of-process judge is stochastic per call.** Then `R_reach` is no longer the covering object, `fingerprint()` proves *nothing* about grading stability (a stable fingerprint with varying grading is possible), and permutation exactness is gone. **We therefore state which guarantees hold where:** the exact permutation/finite-sample results hold **only for the watermark's pure in-process f**; for metaharness, invariant 5 relaxes to "seeded + variance-bounded", Claim 2's exactness degrades to a **bootstrap/variance-bounded approximation**, and Claim 3 uses BH-FDR/bootstrap (`NullEvidence::Bootstrap`) rather than replay. The "one framework, two instances" thesis holds at the level of *the specification and the gate interface*; it does **not** claim the watermark's exact statistics transfer unchanged to a stochastic judge.

- **[FLAG — safety-of-selection, not safety-of-detection; adversarial N].** Every bound is conditional on `E ~ D`. A deployment attacker is adaptive and free to attack outside E's support. **"Bounded false promotion" means "bounded probability of promoting a detector that fails to beat baseline *on E*" — a selection guarantee, not a deployment guarantee.** Under an adaptive attacker the entire edifice is vacuous regardless of statistical tightness. Mitigation (adversarial-benchmark refresh) is real work but **out of scope for the error-control proof** and is listed under Open Questions.

**Integration.** Claim 1 (qualitatively) bounds over-optimism of the pos_mean term and motivates seed-determinism, but is numerically empty at deployed |P|. Claim 2 makes each per-stream statistic a validly-calibrated null (exact via `p_perm`; approximate as-coded via `z`). Claim 3 — on the *independent gate seed B*, with a mandatory `neg_max` safety floor, via the corrected wrong-key meta-null (watermark) or bootstrap/FDR (metaharness) — converts "best on frozen E" into a governed promotion whose family-wise false-promotion probability ≤ α_total *for the selection question on E*. The crate acquires this property only after Phase 0.

---

## Optimization

Every optimization touches only the **proposer** (what to try), the **scheduler** (order/parallelism), or a **memoization** of the pure evaluator — **never the grader**. Two safety classes:

- **EXACT** — value-identical to sequential by referential transparency or an unbiased-difference estimator. Cannot bias the comparison or inflate FP.
- **SELECTION-ONLY** — may only prune/reorder; an error costs optimality, never correctness, **provided the final gate runs at full fidelity on the independent split B.**

The five techniques and their proofs-of-no-bias:

1. **Successive halving / early stopping — SELECTION-ONLY.** Cheap rung → richer rung. Reported margins of survivors + references are full-fidelity. **Two hard constraints:** (a) **subsample positives only, never negatives** — `margin` uses `neg_max`, and max-over-subset ≤ max-over-full biases margin *upward for exactly the FP-risky candidates the safety clause exists to catch*; (b) rung item-subsets are seed-determined a priori, never chosen from observed scores.
2. **Empirical-null variance reduction.** (2a) **CRN — EXACT, already latent:** the wrong-key seed `mix64(cfg.key.0 ^ (0xA5A5_0000 ^ r))` is candidate-independent and prefix-stable in `r`, so all candidates share null draws → cross-candidate margin differences are low-variance. (2b) **Control variate — EXACT iff β pre-registered:** use the closed-form self-sync sum (analytic null mean) as a proxy; in-sample β injects O(1/k) bias, so β is frozen before the run. (2c) **Adaptive replays — SELECTION-ONLY in pruning only:** data-dependent K at the *gate* is optional stopping; the gate re-scores at the fixed pre-registered `k*` (finding 1 / Claim 2 fix), neutralizing both the optional-stopping channel and the calibration-noise-selection channel.
3. **Surrogate-assisted proposal — PROPOSER-ONLY.** Fewer full evals to a given margin. **The real hazard:** denser search = stronger winner's curse + noise-exploitation. Neutralized **only** by the mandatory independent-gate split + a meta-null generated through the *same* surrogate pipeline. Without the split the surrogate *will* inflate false promotion. (Residual mismatch under a signal-adaptive proposer: see Claim 3 flag J — open.)
4. **Parallel-across-candidates with deterministic seeds — EXACT.** `fitness` reads only immutable bench data + params + pure seed derivations; parallelize across candidates, index lineage by `(gen,child)`, keep **intra-candidate folds fixed-order** (a nondeterministic parallel float sum breaks byte-repro — a stated safety property).
5. **Per-item caching of `centered_scores` — EXACT, highest-value.** `centered_scores(tokens,key,h)` is `AlignParams`-independent; cache per `(item, key-role ∈ {real, wrong_r})` once. Per-candidate cost collapses to the O(n·band) DP; the O(n·H) hashing is paid once for the whole run. Prefix-stable seeds mean one `r<48` cache serves every `null_replays` value and delivers CRN (2a) for free. Cache key must include every value-affecting input, guarded by an equality assertion against a freshly recomputed reference on a sampled item.

**Increment order (the framework is NOT a prerequisite for the speedups — review finding 3):**
`{5, 4, 2a, 2b}` (EXACT, in-crate, byte-safe) → `{fixed-k* gate + independent-gate split + corrected meta-null}` (semantic; Phase 0) → `{1, 2c-pruning, 3}` (SELECTION accelerators, only after the split exists).

The R× meta-null cost is affordable for the pure in-crate watermark precisely because 4+5 make each run cheap (note: the per-item cache does **not** transfer across the B meta-null benchmarks, since each null run reads different key-roles — caching helps *within* a run). For the paid metaharness judge, R× full evolutions is prohibitive, so the calibrator there uses a bootstrap/analytic surrogate, not replay — same *interface slot* (`NullEvidence`), different calibrator per cost regime.

---

## Applicability

The two flagship systems are literal instances of the same six abstractions.

**ruflo-watermark (pure, in-process, deterministic — the exact-guarantee instance):**
- `Genome = AlignParams` (`mutate` = existing clamped perturbations `evolve.rs:153-162`; `is_feasible` dead-but-true because numeric `mutate` self-clamps).
- `Metric = ScalarMargin{margin, pos_mean_z, neg_max_z}` (typed diagnostics live in `M`, no JSON side channel); `scalar()=margin`; `dominates` = scalar (single-objective).
- `FitnessEvaluator = IndelBenchmark`, `Cost{evals:1}`, `fingerprint = hash(cfg,vocab,seed,streams)`, `references = [default-params baseline, self-sync]`.
- `PromotionGate = MarginGate`: `safety_floor` = `neg_max_z < 4.0` (hard); `admit` Promote iff margin > every reference on **seed B** AND `NullEvidence::Replayed` (meta-null) clears threshold AND no-regression re-checked on B.
- Calibrator level-1 = wrong-key replay (extracted from `align.rs:139-150`); level-2 = **corrected wrong-key meta-null over the genuine positives** (closes the winner's-curse gap; nuisance-preserving by construction).

**metaharness harness-evolution (out-of-process, paid, stochastic — the approximate-guarantee instance):**
- `Genome = SevenSurfaces` (`mutate` = regex perturb; `is_feasible` = importable/compiles / Tier2 `--experimental-strip-types` check — here `is_feasible` is load-bearing because `mutate` cannot self-clamp).
- `Metric = Graded{tpr, fpr, patch_pass, cost}` with a **real** `dominates` (Pareto — no default) + a declared scalarization for elitism.
- `FitnessEvaluator` = test command / paid model judge → `Cost{wall_s, usd, tokens}` (this is why `reserve/settle` and the spend budget exist); `references = [B0 static, B1 LLM-single, B2 fixed-agent, B3 prior champion]`.
- `PromotionGate = FlywheelGate`: `safety_floor` = FPR/unsafe clauses; `admit` = BH-FDR (demote-only) + bootstrap child-vs-parent + SGM monotonic risk budget + Ed25519 signed-promote; `NullEvidence::Bootstrap`.
- Calibrator = bootstrap/FDR over the ≥5-task corpus (the existing empirical-null audit dashboard), not replay.

The anti-substitution rule (`evolve.rs:2-9` — refusing to shell to metaharness-darwin because it would "evolve the wrong thing") is *satisfied*: the shared artifact is the **methodology (traits)**, not a shared evaluator. Neither crate pulls the other's domain code.

**Honest scope of "one framework" (review finding 4):** it is **one specification, two implementations** sharing no compiled artifact (Rust crate + separate TS package). Of the six invariants, **byte-determinism (5) and fingerprint-frozen-fitness (2) are structurally enforced only in Rust**; in TypeScript they degrade to convention (interfaces cannot enforce record-before-compare, Prng-only randomness, or verdict-blindness), and for a stochastic paid judge determinism relaxes to "seeded + variance-bounded". The framework's value is **contingent on both adopters implementing the traits** — if darwin-mode keeps its bespoke TS loop, `ruflo-evolve` is indirection for a single caller. This is why the framework extraction (Phase 2) is gated on a darwin-mode commitment, and the exact speedups + Phase-0 correctness fixes land first, independent of any abstraction.

---

## Security / Governance

- **Evaluation ≠ promotion, structurally.** `evolve()` returns an `EvolutionOutcome` and *cannot* mutate an incumbent. Only a separate `PromotionGate::admit()` produces a `PromotionReceipt`. Wiring the winner in is a human decision.
- **No auto-promotion.** No code path signs a `PromotionReceipt` without a policy-authorized promote step; a `Verdict::Promote` carrying `NullEvidence::Absent` is a policy error and is rejected.
- **Human gate.** Signing is Ed25519 with a policy-held key (the flywheel signed-promote model, ADR-322). Darwin, Flywheel, MetaHarness, and this framework may propose and evaluate; they cannot self-promote or widen tools/network/secrets/spend/concurrency.
- **Frozen evaluator, verdict-blind.** `evaluate` takes `&self`; `fingerprint()` stamps every receipt; the driver asserts all receipts in a run share one `evaluator_id`. The evaluator never receives a verdict — a candidate cannot re-grade itself. **Caveat (adversarial L):** `fingerprint()` catches accidental drift, **not** a stable-fingerprint stochastic judge; for paid judges this is a "seeded + variance-bounded" posture, not a cryptographic freeze.
- **Mandatory safety floor.** `PromotionGate` must implement `safety_floor` (review finding M): the FP-critical axis is checked *outside* the scalar score, because elitism's no-regression is on `Metric::scalar()` and a Pareto metric can improve the scalar while regressing FPR. The floor is re-checked on the independent seed B.
- **Governed seeds.** Run seed and gate seed B are persisted in the receipt; seed-shopping across runs is a policy violation (adversarial K).
- **Bounded resource use.** Non-refillable `Budget` ledger; the driver halts on `exhausted()` or the first `Exhausted` from `reserve`.

---

## Evaluation plan

Each phase ships behind **tests + a frozen benchmark** (byte-reproducible fixture; no wall-clock in any graded quantity).

1. **Exact-speedup equivalence.** Golden-master test: `{5,4,2a,2b}` produce **byte-identical** `margin`/`neg_max_z`/promoted-verdict to the current sequential loop on a frozen `IndelBenchmark` seed. Fail on any float divergence.
2. **Calibration validity (Claim 2).** Feed genuine null streams; assert `p_perm` controls type-I at α (`P(p_perm ≤ α) ≤ α` over ≥10k trials); assert the as-coded `z`-path is *not worse than* `p_perm` in the body and record its far-tail anti-conservatism as a measured caveat.
3. **Winner's-curse control (Claim 3, Route B).** On a signal-free (**wrong-key-over-genuine-positives**) meta-benchmark, measure empirical false-promotion rate of the full pipeline (incl. halving) at `p_meta ≤ α`; require ≤ α + quantile slack; report B.
4. **Split necessity (adversarial C).** Ablation: run the gate on the selection benchmark vs seed B; demonstrate the shared-E gate inflates false promotion and the split restores control.
5. **Safety-floor orthogonality (adversarial B/F).** Construct a candidate that wins >½ discordant pairs but regresses `neg_max_z`; assert the FWER test *passes* and the `safety_floor` *rejects* — proving the floor is load-bearing.
6. **FDR small-n (ADR-112).** Below 5 tasks, assert the gate falls back to conservative non-promotion, not a mis-calibrated pass.
7. **Metaharness parity.** The darwin adapter reproduces the existing ADR-099 empirical-FDR audit (FDR≈0.049 at q=0.05 on true-null uniform p-values) through the new `PromotionGate`/`NullEvidence::Bootstrap` path.
8. **Adopter drill.** `ruflo-watermark` and `darwin-mode` both compile against the traits; a CI job asserts the watermark crate's bespoke loop is deleted and re-expressed as an adapter.

---

## Consequences

**Positive.** One governed methodology; the watermark crate acquires real winner's-curse control it lacks today; the `neg_max` safety term gets an explicit floor; the exact speedups make the R× meta-null affordable; the frozen-kernel claim is made honest (fixed-k* gate); Darwin and the watermark tuner share statistics without sharing domain code.

**Negative / accepted.** The analytic Claim 1 is numerically empty at deployed |P| and is demoted to motivation, not certificate. The FWER guarantee is over the sign null, not the worst-case FP — the floor, not the e-process, protects safety. Basel α-allocation is power-adverse for late (best) candidates, pushing the watermark toward Route B. The meta-null is exact only under the hash idealization and the corrected wrong-key construction; under a signal-adaptive surrogate self-calibration is best-effort, not proven. The "one framework" is one spec / two implementations; structural enforcement is Rust-only; value is contingent on darwin-mode adopting the traits. All guarantees are safety-of-selection-on-E, **not** safety-of-detection under an adaptive attacker.

---

## Alternatives

1. **Do nothing / copy-paste.** Keep two welded implementations. Rejected: no shared statistics, and the watermark crate keeps its zero-meta-level-control and its calibration-noise bug.
2. **Shell the watermark tuner to darwin-mode.** Rejected by the anti-substitution rule — it would evolve TS surfaces, not detector params.
3. **Framework-first (extract traits before fixing the crate).** Rejected: the fixed-k* gate, the split, and the corrected meta-null are correctness fixes the crate needs regardless; bundling them with a six-trait rewrite delays a bug fix behind an abstraction whose payoff is contingent.
4. **Keep `null: Standardized` in the gate contract.** Rejected: leaks the replay shape; metaharness has no `null_mean/null_sd` — hence `NullEvidence`.
5. **`Metric::dominates` default = scalar.** Rejected: silently collapses metaharness's Pareto front (review finding 9); no default.
6. **Analytic-only guarantee (rely on Claim 1).** Rejected: vacuous at deployed |P|; the empirical split + meta-null is the operative control.

---

## Rollback

- **Phase 0 (in-crate correctness) rollback:** the fixed-k* gate, split, and meta-null are additive and feature-flagged (`WATERMARK_GOVERNED_GATE`); disabling reverts to `beats_selfsync()` point comparison (the current, weaker-but-known behavior). No data migration.
- **Speedups (1)** are byte-equivalence-tested; rollback = revert commits; no semantic change to undo.
- **Framework (2):** `ruflo-evolve` is a new crate; the watermark adapter can be reverted to the bespoke loop (kept behind a `git tag` snapshot) without touching consumers. The workspace `Cargo.toml` addition is the only shared-manifest change and is trivially revertible.
- **TS mirror / darwin adapter (4):** separate PRs in `agent-harness-generator`; abandon the PRs — no effect on ruflo. If darwin-mode declines the traits, Phase 2's extraction is retained for the single watermark caller only if a second Rust consumer materializes; otherwise revert the extraction and keep the crate-local governed loop.

---

## Open Questions

1. **Signal-adaptive proposer meta-null (adversarial J).** Can the meta-null be made provably selection-intensity-matched under a surrogate proposer, or must the calibrated guarantee be restricted to signal-independent proposers? (Currently: restricted; surrogate ships behind the split with a flagged residual.)
2. **Worst-case FP control (adversarial B/F).** Is there a valid sequential/permutation test *for the `neg_max` extreme functional itself*, so the FWER guarantee and the safety functional coincide, rather than relying on a separate hard floor?
3. **Hash idealization (adversarial, Claim 2 (ii)).** Can exchangeability be established without treating `mix64`/`context_seed` as a random oracle, or is the guarantee inherently heuristic outside that idealization?
4. **Stochastic-judge covering object (adversarial L).** What is the right complexity measure for a stochastic paid evaluator to recover a Claim-1-analogue, and what variance bound makes `fingerprint()` meaningful for grading stability?
5. **Adaptive-attacker benchmark refresh (adversarial N).** How to keep `E ~ D` under an adaptive watermark attacker so the selection guarantee approximates a deployment guarantee — an adversarial-benchmark cadence, out of scope for the error-control proof.
6. **darwin-mode adoption.** Will darwin-mode implement the TS traits? The framework's "one methodology" value is contingent on it (review finding 4); until then the guarantee is realized only for the watermark instance.
7. **Reserve/settle over-charge.** Does the two-phase ledger correctly settle a paid judge that charges on a mid-eval budget cross, or does a reservation strand real spend (review finding 2)?

---

## Implementation Plan

**Concurrency rule (load-bearing).** Concurrent multi-agent implementation into **`agent-harness-generator`** (which carries heavy pre-existing WIP) **must use isolated git worktrees + separate PRs — never parallel writers in one checkout.** Only the integration owner edits shared manifests (`Cargo.toml` workspace members, `v3/` `package.json`, `ruflo/package.json` overrides, lockfiles). Read-only agents may share a checkout; writing agents may not. Every phase binds its tests/benchmarks to an exact clean commit or an immutable dirty-worktree snapshot. Every phase ships **behind tests + a frozen benchmark**.

Legend: **[WT-ISO]** = worktree-isolated, safe for a dedicated writing agent in its own worktree · **[INT-OWNER]** = touches shared manifests, integration-owner-only.

### Phase 0 — In-crate correctness + wire the guarantee for the watermark instance **[WT-ISO — `crates/ruflo-watermark`]**
Addresses adversarial A, C, E, F, I, K and review finding 1. Ships independently of any abstraction.
- `crates/ruflo-watermark/src/align.rs`: extract `EmpiricalNullCalibrator` from `detect_gumbel_aligned` (lines 139-150); emit `p_perm` alongside `z`.
- `crates/ruflo-watermark/src/evolve.rs`:
  - **Independent-gate split** — add a distinct **gate seed B** to `Budget`; `score_with` gains a select/gate distinction; select on A, re-score winner + all references on B.
  - **Fixed-k\* gate re-score** — gate re-scores at a pre-registered `k*` (default 48), neutralizing the `null_replays` calibration-noise-selection channel (finding 1); `null_replays` remains evolvable during search only.
  - **Corrected meta-null** — new `signal_free_meta_null()`: re-run the whole evolution B times scoring against **wrong-key readings of the genuine watermarked-then-attacked positives** (nuisance-preserving); return `p_meta`.
  - **Governed promotion** — replace the informal `beats_selfsync()` decision with a first-class `PromotionReceipt`-shaped struct carrying `neg_max_z(B) < 4.0` **safety floor** + margin-vs-references(B) + `p_meta`; persist run seed + gate seed B. Feature-flag `WATERMARK_GOVERNED_GATE`.
- **Tests + frozen benchmark:** Evaluation-plan items 2, 3, 4, 5, 6 as `#[test]`s over a frozen `IndelBenchmark` seed; assert byte-repro of the governed verdict.

### Phase 1 — Exact speedups in the crate **[WT-ISO — `crates/ruflo-watermark`]**
Addresses optimizations {5, 4, 2a, 2b}. No semantic change.
- `align.rs`: per-item cache of `centered_scores` keyed by `(item, key-role)` (opt 5) with equality-assertion guard; state/exploit CRN (opt 2a); pre-registered control-variate β using the self-sync analytic proxy (opt 2b).
- `evolve.rs`: parallelize evaluation **across candidates** indexed by `(gen,child)`; keep intra-candidate folds fixed-order (opt 4).
- **Tests + frozen benchmark:** golden-master byte-equivalence (Evaluation item 1) — any float divergence fails CI.

### Phase 2 — Extract `ruflo-evolve` crate (six traits + driver + calibrator + budget) **[INT-OWNER for workspace manifest; WT-ISO for crate contents]**
Gated on a darwin-mode adoption commitment (Open Question 6).
- New crate `crates/ruflo-evolve`: `Genome`, `Metric` (no `dominates` default — finding 9), `FitnessEvaluator` with `reserve/settle` (finding 2), `LineageStore`, `PromotionGate` with mandatory `safety_floor`, `NullEvidence` enum (finding 5), `NuisancePreservingNull` + `EmpiricalNullCalibrator` (pluggable null estimator — finding 8), `Cost`/`Budget`, `Prng` (invariant relaxed to *search* randomness — finding 7), `SelectionStrategy`, `evolve()`.
- **[INT-OWNER]** add `crates/ruflo-evolve` to the workspace `Cargo.toml` members.
- **[WT-ISO]** re-express `ruflo-watermark` as an adapter implementing the six traits over `AlignParams`; delete the bespoke loop (kept behind a `git tag` for rollback).
- **Tests + frozen benchmark:** adapter reproduces Phase-0/1 governed verdicts byte-identically; Evaluation item 8 (bespoke-loop-deleted CI assertion).

### Phase 3 — Selection accelerators behind the split **[WT-ISO — `crates/ruflo-watermark` + `crates/ruflo-evolve`]**
Only after Phase 0's split + meta-null exist. Addresses optimizations {1, 2c-pruning, 3}.
- Successive halving (positives-only subsampling; full negatives — opt 1); adaptive replays in pruning only, fixed-k* at gate (opt 2c); surrogate EI proposer as a `SelectionStrategy` (opt 3) with its meta-null generated through the same surrogate + seed schedule.
- **Tests + frozen benchmark:** Evaluation item 3 re-run with halving in the pipeline; assert false-promotion ≤ α; record the surrogate self-calibration residual (Open Question 1) as a measured caveat, not a pass.

### Phase 4 — TS mirror `@claude-flow/evolve` + darwin-mode adapter **[agent-harness-generator: WT-ISO worktrees + SEPARATE PRs; INT-OWNER for shared TS manifests]**
Heavy WIP repo — **isolated worktrees + separate PRs mandatory; no parallel writers in one checkout.**
- New package `@claude-flow/evolve` (TS): the six interfaces (async `FitnessEvaluator` — evaluator may be out-of-process/paid), `NullEvidence`, `calibrate`, `evolve`. Structural invariants documented as *convention* (interfaces cannot enforce them — review finding 4); byte-determinism and fingerprint-freeze explicitly marked Rust-only.
- `packages/darwin-mode/src` adapter (one agent per file, each in its own worktree/PR): `types.ts` → `Genome`/`Metric(Graded, Pareto dominates)`; `generator.ts`+sandboxes (`mock-sandbox.ts`, `tier2-sandbox.ts`) → `FitnessEvaluator` with `Cost{usd,tokens}` + `reserve/settle`; `archive.ts` → `LineageStore`; `scorer.ts` gate + `bench/{runner,stats,risk}.ts` → `PromotionGate` with `NullEvidence::Bootstrap` + BH-FDR + SGM + signed-promote; `evolve.ts` → thin driver call.
- **[INT-OWNER]** `v3/` `package.json` + `ruflo/package.json` overrides for the new package.
- **Tests + frozen benchmark:** Evaluation item 7 (reproduce the ADR-099 empirical-FDR audit through the new gate path).

### Phase 5 — Governance wiring **[WT-ISO per repo; INT-OWNER for signing-key policy]**
- Ed25519 `PromotionReceipt` signing behind the policy-held key (ADR-322 model) in both `ruflo-evolve` (Rust) and `@claude-flow/evolve` (TS); human-gate CLI surface; `NullEvidence::Absent`-on-Promote rejected at the gate.
- **Tests + frozen benchmark:** a Promote without valid `NullEvidence` and without passing `safety_floor` is refused; signed receipts verify against the public key.

**Cross-phase discipline:** bind every test/benchmark to an exact clean commit or immutable snapshot; only the integration owner reconciles overlapping changes or edits shared manifests; continue independent local work after spawning agents and wait only on real dependencies (Phase 2 depends on 0/1; Phase 3 depends on 0; Phase 4 depends on 2's spec but not its Rust code; Phase 5 depends on 2 and 4).