//! Darwin/flywheel-style bounded tuner for the indel-robust alignment detector.
//!
//! ## Why in-crate, not `metaharness-darwin evolve`
//!
//! `@metaharness/darwin evolve` evolves *its own* synthetic 7-surface harness
//! and scores it by a target repo's test command; it cannot optimize this
//! crate's [`AlignParams`]. Shelling out to it would evolve the wrong thing
//! (NO SILENT SUBSTITUTION). So we apply the Darwin + flywheel *methodology*
//! where it actually fits:
//!
//! - **Frozen fitness** declared before the run (separation margin on a held-out
//!   indel benchmark).
//! - **Bounded** generations × children (no unbounded search).
//! - **Retained lineage**: every candidate's receipt is kept, failures included,
//!   so a future run does not rediscover a dead direction.
//! - **No auto-promotion**: returns the best candidate + full evidence; wiring it
//!   in as the default is a separate, human decision.
//!
//! ## Fitness
//!
//! `margin = mean(z over watermarked-then-attacked cases) − max(z over null
//! cases)`. Rewards recovering signal after indel attacks while penalizing any
//! null case that scores high (false-positive control). Deterministic given the
//! benchmark seed — reproducible, no wall-clock.

use crate::align::{detect_gumbel_aligned, detect_gumbel_selfsync, AlignParams};
use crate::context::WatermarkConfig;
use crate::hash::mix64;
use crate::robustness::{attack_delete, attack_substitute};
use crate::{Scheme, Watermarker};

/// A frozen benchmark: watermarked-then-indel-attacked positives and null
/// negatives. Built once, reused across all candidates (fair comparison).
pub struct IndelBenchmark {
    positives: Vec<Vec<u32>>,
    negatives: Vec<Vec<u32>>,
    cfg: WatermarkConfig,
}

impl IndelBenchmark {
    /// Build the benchmark. `delete_rates` are the indel strengths sampled for
    /// positives; negatives are null streams over the same vocab. Deterministic.
    pub fn build(
        cfg: WatermarkConfig,
        vocab: u32,
        stream_len: usize,
        streams: usize,
        delete_rates: &[f64],
        seed: u64,
    ) -> Self {
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs = vec![1.0f32 / vocab as f32; vocab as usize];
        let mut positives = Vec::with_capacity(streams);
        let mut negatives = Vec::with_capacity(streams);

        for s in 0..streams {
            // Positive: fresh watermarked stream, then a mixed indel+sub attack.
            let mut wm = Watermarker::new(cfg, Scheme::Gumbel);
            let clean: Vec<u32> = (0..stream_len).map(|_| tokens[wm.step(&tokens, &probs)]).collect();
            let rate = delete_rates[s % delete_rates.len()];
            let aseed = mix64(seed ^ s as u64 ^ 0x0DE1);
            let deleted = attack_delete(&clean, rate, aseed);
            // A light substitution on top, so the tuner isn't overfit to pure deletion.
            let attacked = attack_substitute(&deleted, rate * 0.5, vocab, mix64(aseed));
            positives.push(attacked);

            // Negative: null stream that never used the key.
            let nseed = mix64(seed ^ s as u64 ^ 0x0FF);
            let null: Vec<u32> = (0..stream_len)
                .map(|i| (mix64(nseed ^ i as u64) % vocab as u64) as u32)
                .collect();
            negatives.push(null);
        }
        IndelBenchmark { positives, negatives, cfg }
    }

    /// The frozen fitness for a candidate parameter set. Higher is better.
    pub fn fitness(&self, params: AlignParams) -> Receipt {
        self.score_with(|t| detect_gumbel_aligned(t, self.cfg, params).z_score, Some(params))
    }

    /// The self-sync baseline (parameter-free) scored on the SAME frozen cases —
    /// the honest reference the tuner must beat to justify the alignment layer.
    /// A frequent, legitimate outcome: self-sync already dominates and the
    /// evolution's evidence says so (a useful negative result).
    pub fn selfsync_reference(&self) -> Receipt {
        self.score_with(|t| detect_gumbel_selfsync(t, self.cfg).z_score, None)
    }

    fn score_with(&self, mut z: impl FnMut(&[u32]) -> f64, params: Option<AlignParams>) -> Receipt {
        let pos_mean = self.positives.iter().map(|t| z(t)).sum::<f64>()
            / self.positives.len().max(1) as f64;
        let neg_max = self.negatives.iter().map(|t| z(t)).fold(f64::MIN, f64::max);
        Receipt {
            params: params.unwrap_or(AlignParams::default()),
            pos_mean_z: pos_mean,
            neg_max_z: neg_max,
            margin: pos_mean - neg_max,
        }
    }
}

/// One candidate's evaluation evidence. Retained for the whole run (lineage).
#[derive(Clone, Copy, Debug)]
pub struct Receipt {
    pub params: AlignParams,
    pub pos_mean_z: f64,
    pub neg_max_z: f64,
    /// Frozen fitness: mean positive z minus worst null z.
    pub margin: f64,
}

/// Bounded-evolution budget. Kept small by default — this is tuning, not search.
#[derive(Clone, Copy, Debug)]
pub struct Budget {
    pub generations: u32,
    pub children: u32,
    pub seed: u64,
}

impl Default for Budget {
    fn default() -> Self {
        Budget { generations: 4, children: 6, seed: 0 }
    }
}

/// The outcome: the best alignment params found, the default-params baseline,
/// the parameter-free self-sync reference, and the full evaluated lineage
/// (evidence). Promotion — making `best` the default detector — is the caller's
/// decision, never automatic. `beats_selfsync()` reports the honest verdict.
pub struct EvolutionResult {
    pub best: Receipt,
    pub baseline: Receipt,
    pub selfsync: Receipt,
    pub lineage: Vec<Receipt>,
}

impl EvolutionResult {
    /// **In-sample** verdict: whether the selected params beat self-sync on the
    /// SEARCH benchmark. This is a selection-biased point estimate — `best` was
    /// chosen as the max-margin candidate over many children on one benchmark
    /// realization, so `best.margin` is optimistically inflated (winner's curse)
    /// and this comparison is NOT an error-controlled test. Use
    /// [`EvolutionResult::validate_on`] with a held-out benchmark for the honest
    /// verdict. (ADR-384 §Formal Properties: the rigorous gate is a held-out
    /// re-evaluation + a permutation/wrong-key null on the margin.)
    pub fn beats_selfsync(&self) -> bool {
        self.best.margin > self.selfsync.margin
    }

    /// **De-biased** verdict: re-evaluate the *already-selected* `best.params`
    /// (and self-sync) on an independent, held-out benchmark the search never
    /// saw. Because the params are fixed before this evaluation, the held-out
    /// margins carry no selection bias, so `beats` here is the trustworthy call.
    /// Returns `(best_holdout, selfsync_holdout, beats)`.
    pub fn validate_on(&self, holdout: &IndelBenchmark) -> (Receipt, Receipt, bool) {
        let best_h = holdout.fitness(self.best.params);
        let ss_h = holdout.selfsync_reference();
        let beats = best_h.margin > ss_h.margin;
        (best_h, ss_h, beats)
    }
}

#[inline]
fn u01(seed: u64, i: u64) -> f64 {
    (mix64(seed ^ i.wrapping_mul(0x9E37_79B9_7F4A_7C15)) >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
}

/// Mutate a parent's params deterministically from `(seed, gen, child)`.
fn mutate(parent: AlignParams, seed: u64, gen: u32, child: u32) -> AlignParams {
    let base = mix64(seed ^ ((gen as u64) << 32) ^ child as u64);
    let d_band = (u01(base, 1) * 7.0) as i64 - 3; // -3..=3
    let band = (parent.band as i64 + d_band).clamp(1, 32) as usize;
    let d_gap = (u01(base, 2) - 0.5) * 0.8; // ±0.4
    let gap_penalty = (parent.gap_penalty + d_gap).clamp(0.05, 3.0);
    let d_rep = (u01(base, 3) * 17.0) as i64 - 8; // -8..=8
    let null_replays = (parent.null_replays as i64 + d_rep).clamp(8, 48) as u32;
    AlignParams { band, gap_penalty, null_replays }
}

/// Evolve [`AlignParams`] against a frozen benchmark. Bounded, deterministic,
/// lineage-retaining, no auto-promotion.
pub fn evolve_align_params(bench: &IndelBenchmark, budget: Budget) -> EvolutionResult {
    let baseline = bench.fitness(AlignParams::default());
    let mut lineage = vec![baseline];
    let mut best = baseline;
    let mut parent = baseline.params;

    for gen in 1..=budget.generations {
        let mut gen_best = best;
        for child in 0..budget.children {
            let cand = mutate(parent, budget.seed, gen, child);
            let r = bench.fitness(cand);
            lineage.push(r); // retain every candidate, winners and losers
            if r.margin > gen_best.margin {
                gen_best = r;
            }
        }
        // Elitism: the parent of the next generation is the best-so-far.
        if gen_best.margin > best.margin {
            best = gen_best;
        }
        parent = best.params;
    }

    let selfsync = bench.selfsync_reference();
    EvolutionResult { best, baseline, selfsync, lineage }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::WatermarkKey;

    #[test]
    fn tuning_does_not_regress_the_baseline() {
        // The evolved best must be at least as good as the default params on the
        // frozen benchmark (elitism guarantees this) — and the lineage keeps
        // every candidate as evidence.
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"tune")).with_layers(1);
        let bench = IndelBenchmark::build(cfg, 128, 600, 4, &[0.1, 0.2, 0.3], 0xABCD);
        let result = evolve_align_params(&bench, Budget { generations: 3, children: 5, seed: 1 });

        assert!(result.best.margin >= result.baseline.margin - 1e-9, "evolution regressed baseline");
        assert!(result.lineage.len() >= 1 + 3 * 5, "lineage not fully retained");
        // The tuner should keep null false-positives controlled.
        assert!(result.best.neg_max_z < 4.0, "tuned params allow null false-positive: {}", result.best.neg_max_z);
        // The self-sync reference is computed so the verdict is honest either way.
        assert!(result.selfsync.pos_mean_z > 0.0, "self-sync reference not evaluated");
        // Elitism holds; whether alignment beats self-sync is reported, not assumed.
        let _ = result.beats_selfsync();

        // De-biased verdict: re-evaluate the SELECTED params on an independent
        // held-out benchmark (different seed). The held-out margin removes the
        // winner's-curse inflation; the in-sample best.margin should be >= it.
        let holdout = IndelBenchmark::build(cfg, 128, 600, 4, &[0.1, 0.2, 0.3], 0x1111_2222);
        let (best_h, ss_h, _beats) = result.validate_on(&holdout);
        assert!(best_h.margin.is_finite() && ss_h.margin.is_finite());
        assert!(
            result.best.margin >= best_h.margin - 3.0,
            "held-out margin wildly exceeds in-sample — benchmark mismatch: {} vs {}",
            result.best.margin,
            best_h.margin
        );
        // Held-out null control still holds for the selected params.
        assert!(best_h.neg_max_z < 4.5, "held-out null false-positive: {}", best_h.neg_max_z);
    }
}
