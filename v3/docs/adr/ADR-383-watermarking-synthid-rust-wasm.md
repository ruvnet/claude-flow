# ADR-383 — LLM Text Watermarking (SynthID-Text / distortion-free) as a Rust/WASM component

- **Status**: Proposed
- **Date**: 2026-08-15
- **Component**: `v3/crates/ruflo-watermark` (self-contained crate; Rust core + optional WASM)
- **Related**: ADR-150 (MetaHarness optional/removable augmentation — this crate follows the same drop-in, no-required-runtime-dep discipline), the redblue adversarial harness (the robustness evaluator here is its watermarking analogue)
- **Prompted by**: the EU AI Act transparency requirement (in force 2026-08-02) that AI providers *mark* AI-generated content, and Anthropic's own rollout of SynthID-Text-style watermarking. ruflo/metaharness need a fast, embeddable implementation both to *produce* compliant marks on any locally-generated text and to *measure* watermark robustness as part of harness evaluation.

## Context

Autoregressive models pick one token at a time. At most positions several
candidates are near-equally plausible ("the weather is cold and **overcast**"
vs "…and **grey**"), and which one is emitted is settled by a random draw.
Watermarking changes only the *source of that randomness*: instead of an
arbitrary RNG, the draw is seeded by a secret key plus the preceding tokens.
The emitted text is still a valid model sample — no out-of-distribution words
are injected — but a holder of the key can later test whether a token sequence
rode the keyed stream and assign a probability that a keyed model produced it.
This is the "digits of pi instead of dice" analogy from Anthropic's explainer.

Three properties make this deployable and are the design targets here:

1. **No quality impact / no extra tokens.** The mark lives in tie-breaks among
   already-plausible candidates, so it does not change what the model can say,
   costs no extra tokens, and (for the distortion-free scheme) does not even
   change the marginal token distribution.
2. **Length-dependent, entropy-dependent detectability.** Confidence grows with
   the number of *low-stakes choices* the text contains. Factual or near-
   deterministic spans (Principia **Mathematica**; `2 + 2 = 4`; most code)
   carry little to no mark, by construction.
3. **Key-specific, carries no user information.** The key selects a
   pseudo-random stream; it encodes nothing about a user, org, or chat, and one
   provider's mark is invisible to another's detector.

### Scope decision (load-bearing): watermark + robustness evaluation, NOT a removal product

This ADR delivers watermark **generation**, **detection**, and a **robustness-
evaluation harness**. It deliberately does **not** deliver a general-purpose
watermark-*removal* / text-laundering tool.

The distinction is the same one drawn throughout the redblue work: implementing
attacks to *measure and harden* a defense is legitimate and valuable;
productizing an evasion tool is not. A watermark exists to satisfy an AI-content
transparency mandate and carries no user-identifying information, so a
turnkey stripper's only real-world effect is defeating provenance — passing AI
text off as un-marked, evading a legal transparency mechanism. The robustness
harness gives watermark *designers* everything they need (quantified detection
decay vs. attack strength) while operating on abstract token-id sequences and
returning *statistics*, not laundered natural-language text. See
`src/robustness.rs`'s module header for the enforced boundary.

## Decision

A single self-contained crate, `ruflo-watermark`, with two watermarking schemes
over shared infrastructure, a calibrated detector, a robustness harness, and an
optional WASM surface. The crate declares its own `[workspace]` so it builds and
tests standalone without perturbing ruflo's parent workspace (whose root
manifest documents why nested workspace roots stay isolated), and it is equally
droppable into `agent-harness-generator/crates/`.

### API boundary

The crate does **not** run an LLM. At each step the host supplies the model's
candidate token ids and their probabilities (typically a top-k slice); the
watermarker returns which candidate to emit. This is the correct deployment
shape (logits in → watermarked sample out) and keeps the crate model-agnostic,
tiny, and WASM-friendly.

### Shared infrastructure

- **Keyed PRF (`hash.rs`)** — the randomness source. A SplitMix64/MurmurHash3-
  family finalizer maps `(key, context, token_id, layer)` to a uniform `f64` or
  a fair coin bit. No tables, a few multiplies/xors, statistically uniform
  (`E[g] = 0.5` on unwatermarked streams — the null the detector tests against).
  **g-values are keyed on the token *id*, never a candidate list index**, so the
  detector — which sees only emitted token ids — reproduces the exact stream.
- **Context + masking (`context.rs`)** — each draw is seeded by the preceding
  `H` tokens (default `H=4`). Repeated-context masking skips watermarking (and
  detection) at any position whose `H`-gram context already occurred, which
  preserves the distribution on repetitive text and blunts "repeat the prompt"
  attacks. Generator and detector run the identical tracker, so scored positions
  match watermarked positions exactly.

### Scheme A — SynthID-Text Tournament (`tournament.rs`)

Draw `2^d` i.i.d. candidates from `p`, run a `d`-round single-elimination bracket
keeping the higher `g_ℓ` each round, emit the winner. Strong; mildly
distortionary; strength and cost scale with depth `d`. The winner's g-values are
systematically high (`E ≈ 2/3` per won layer), which detection exploits.

### Scheme B — distortion-free Gumbel / exponential-min (`gumbel.rs`)

For each candidate `i`, draw `u_i = g_unit(seed, id_i)`; emit `argmin_i
(-ln u_i)/p_i`. Provably samples exactly from `p` (marginal distribution
unchanged), while the emitted token's `u` is stochastically elevated. The right
choice when zero distortion is a hard requirement.

### Detection (`detect.rs`)

Re-runs the generator's context tracker, then aggregates per scheme: Tournament →
`Binomial(positions·d, ½)` ones-count; Gumbel → `Gamma(positions, 1)` score-sum.
Both reduce to an upper-tail standard-normal p-value via a numerically-stable
`erfc` (accurate for large `z`, with an asymptotic `log10(p)` so extreme
confidences don't underflow to zero silently). `is_watermarked(alpha)` gives a
verdict at a chosen false-positive rate.

### Robustness harness (`robustness.rs`)

Deterministic substitution / deletion / span-resample attacks + a
`sweep_substitution` that returns the detectability curve (residual z / p vs.
edit rate). Measurement only; see the scope decision above.

### WASM (`wasm.rs`, `--features wasm`)

`wasm-bindgen` surface: a streaming `WasmWatermarker` and a `detect` function,
marshaling tokens/probs as typed arrays. 53 KB release artifact.

## Prior art

| Work | Scheme | Distortion | This crate |
|---|---|---|---|
| Aaronson (2022, unpublished talk) | exponential-min / Gumbel | distortion-free | Scheme B |
| Kirchenbauer et al. (2023), "A Watermark for LLMs" | green-list logit bias | distortionary | not implemented — biases the distribution more than the tie-break family; noted as an alternative |
| Kuditipudi et al. (2024), "Robust distortion-free watermarks" | exponential-min + edit-distance alignment | distortion-free | Scheme B is the sampler; alignment-based detection is future work (see Open Questions) |
| Dathathri et al. (2024, *Nature*), SynthID-Text | tournament sampling | tunable (distortionary / non-distortionary variants) | Scheme A |

SynthID-Text is the method Anthropic states it uses (a version of the Nature
approach, in the Aaronson lineage). We implement the practical distortionary
tournament plus the provably distortion-free Gumbel scheme so a host can pick
the distortion/strength trade-off explicitly.

## Optimization & measured performance

Mixer is branch-free and table-free; the hot path per emitted token is
`2^d` categorical draws + `d` coin-bit hashes (tournament) or one hash per
candidate (gumbel). Release profile: fat LTO, single codegen unit.

Measured (`cargo bench`, dev workstation, 256 candidates):

| Operation | Cost | Rate |
|---|---|---|
| Generation, tournament depth 2 (4 draws) | ~1.5 µs/token | ~677 K tok/s |
| Generation, tournament depth 4 (16 draws) | ~3.7 µs/token | ~273 K tok/s |
| Generation, tournament depth 8 (256 draws) | ~46 µs/token | ~22 K tok/s |
| Generation, gumbel | ~2.0 µs/token | ~494 K tok/s |
| Detection scan (either scheme) | — | ~10 M tok/s |

Generation at practical depths is single-digit microseconds per token —
negligible beside a model's millisecond-scale forward pass, matching the
"negligible impact on speed, no extra cost" claim. Detection scans at ~10M
tokens/sec, so a detection API is effectively free.

## Security & ethics

- **Key handling.** `WatermarkKey` carries no user information. Keys should be
  provisioned as secrets (GCP Secret Manager in this org); the crate never logs
  or serializes them.
- **No removal product.** Enforced by scope: the crate ships measurement, not a
  stripper (see Context).
- **Honest detection semantics.** A positive only means "a keyed model likely
  produced or heavily edited this"; it cannot distinguish authorship from heavy
  editing, says nothing about ownership, and (per the length/entropy properties)
  is weak on short or low-entropy text. `DetectionResult` exposes
  `scored_positions` so callers never over-read a verdict built on few choices.

## Evaluation

27 tests pass (22 unit + 4 integration + 1 doctest). Verified properties:
Gumbel distortion-freeness (marginals within 0.6% of `p`); PRF uniformity and
layer independence; wrong-key non-detection; length-scaling; low-entropy
weakness; repeated-context masking; monotonic robustness decay; and end-to-end
detection at `p < 1e-6` for both schemes with no false positive on null streams.
WASM target builds clean (53 KB).

## Consequences

- ruflo/metaharness gain a real, embeddable watermarking primitive usable from
  native Rust, Node/NAPI, or the browser (WASM) with no LLM dependency.
- The robustness harness slots into the harness-evaluation story: watermark
  strength becomes a measurable, defensible dimension like any other.
- Because the crate is self-contained and model-agnostic, adopting it is adding
  a member/vendoring a directory — not a framework commitment.

## Alternatives considered

- **Green-list logit biasing (Kirchenbauer)** — simpler but distortionary and
  operates on logits (needs the full vocab distribution, not a top-k slice);
  rejected as the default in favor of the tie-break family Anthropic actually
  uses, though it could be added behind the same `Scheme` enum.
- **Wrapping a C/C++ SynthID reference** — rejected: a dependency-free Rust core
  is smaller, WASM-native, and matches the org's "always Rust for these
  components" rule.

## Rollback

The crate is additive and isolated (own workspace, no parent-workspace member
entry required to exist). Rollback is deleting the directory; nothing else in
ruflo depends on it until a host explicitly wires it in.

## Indel robustness (addressed — `align.rs`, `evolve.rs`)

The initial framing ("degrades under deletion/insertion") was only partly right,
and measuring it corrected the diagnosis:

- **The context seed self-synchronizes.** Once an edit slides out of the
  `H`-token window, the observed window is again a run of consecutive generated
  tokens, so per-token scoring recovers automatically. In the flat/large-vocab
  regime the position-locked detector is therefore *already* indel-robust
  (measured: z ~unchanged self-sync vs locked up to 35% deletion).
- **The real gap is repeated-context masking desync**, which bites in the
  low-entropy / repetitive regime where real text with recurring phrases lives.
  There the position-locked detector is near-dead (measured z≈2.8) while the
  **self-synchronizing detector** (`detect_gumbel_selfsync`: score every position
  from its observed window, masking off, closed-form null) stays strong and
  indel-robust (measured z≈39→27 across 0–50% deletion). This is the fix.
- **Local-alignment detection** (`detect_gumbel_aligned`, a gap-tolerant
  max-segment scan, empirically null-calibrated) helps only for *concentrated*
  edits; it is the wrong statistic for the diffuse watermark signal and loses to
  plain self-sync in the repetitive regime (measured z≈0.5). It is retained,
  honestly scoped, and its parameters are what the bounded-evolution tuner
  (`evolve.rs`) searches — with the self-sync baseline reported as the reference,
  so "alignment did not beat self-sync here" is a first-class retained outcome,
  not a hidden regression.

## Third scheme + short-text detectors (implemented)

- **Non-distortionary tournament** (`Scheme::TournamentNd`, `tournament.rs`) —
  the balanced bracket with **continuous** g-values and mandatory repeated-
  context masking. Measuring it corrected an earlier mis-reading: the tournament
  is **non-distortionary in expectation over the key** — the key-averaged
  emitted distribution matches `p` to within sampling noise (measured drift
  < 0.3% at depths 1–5; test asserts < 0.6%). This is the SynthID-Text
  non-distortionary *config*; it is weaker than the *per-instance* distortion-
  freeness of `Scheme::Gumbel` (for a fixed key the tournament still biases
  toward high-g tokens — that bias is the watermark). Detects its own output at
  `p < 1e-6` with no null false-positive.
- **Short-text detectors** (`bayes.rs`) — (1) `detect_gumbel_exact` replaces the
  normal tail with the **exact** `Gamma(n,1)` upper tail (via Lanczos `ln_gamma`
  + regularized incomplete gamma), correct at small `n` where the normal approx
  misleads; (2) `detect_gumbel_hc` a **Higher-Criticism** statistic over per-
  token null tail probabilities, aimed at the sparse-signal (low-entropy) case.
  Both are calibrated (no null false-positive) and detect real watermarks.

## Open questions

1. **Insertion-specific alignment** — self-sync already recovers most insertion
   signal, but a phase-tracking detector could recover the straddle zone.
2. **HC power vs the sum** is asserted only as "calibrated + detects" here; a
   controlled power comparison across entropy regimes would quantify its edge.
