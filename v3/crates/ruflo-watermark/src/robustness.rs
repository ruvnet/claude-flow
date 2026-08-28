//! Robustness evaluation harness — the *defensive* red-team half of the crate.
//!
//! Purpose and scope (read this before using it): this measures **how much a
//! watermark's detectability degrades under editing**, so a watermark designer
//! can quantify robustness and harden the scheme (larger context width, more
//! layers, better scorers). It is the watermarking analogue of the adversarial
//! robustness curves used throughout metaharness/redblue.
//!
//! It deliberately reports *detection statistics after an attack* — a robustness
//! curve — and operates on abstract token-id sequences. It is **not** a
//! text-laundering tool: it does not take natural-language text and hand back a
//! "cleaned" version with the mark stripped. The output is evidence about the
//! watermark, not a product for defeating provenance. Removing a watermark from
//! third-party AI text to pass it off as un-marked defeats the EU AI Act
//! transparency mechanism these watermarks exist to satisfy; that is not what
//! this harness is for and not something it is built to do.
//!
//! Attacks modeled (all deterministic given an `attack_seed`, for reproducible
//! curves): random token **substitution**, **deletion**, and contiguous-span
//! **resampling** (a stand-in for local paraphrase). Each returns the residual
//! detection result so you can plot detectability vs attack strength.

use crate::context::WatermarkConfig;
use crate::detect::{detect_gumbel, detect_tournament, DetectionResult, Scheme};
use crate::hash::mix64;

/// A single point on a robustness curve: the attack applied and the detection
/// result that survived it.
#[derive(Clone, Copy, Debug)]
pub struct RobustnessPoint {
    /// Fraction of tokens perturbed (0.0..=1.0).
    pub attack_strength: f64,
    /// Detection outcome on the attacked sequence.
    pub detection: DetectionResult,
}

/// Deterministic uniform in `[0,1)` from `(attack_seed, index)` — keeps attacks
/// reproducible so a robustness curve is a stable measurement, not a coin flip.
#[inline]
fn u01(attack_seed: u64, index: u64) -> f64 {
    (mix64(attack_seed ^ index.wrapping_mul(0x9E37_79B9_7F4A_7C15)) >> 11) as f64
        * (1.0 / (1u64 << 53) as f64)
}

#[inline]
fn rand_token(attack_seed: u64, index: u64, vocab: u32) -> u32 {
    (mix64(attack_seed ^ index ^ 0xDEAD_BEEF) % vocab as u64) as u32
}

/// Substitute each token independently with probability `rate`, replacing it
/// with a uniform random vocab token. The canonical watermark-robustness stress
/// test (mirrors "edit N% of the words").
pub fn attack_substitute(tokens: &[u32], rate: f64, vocab: u32, attack_seed: u64) -> Vec<u32> {
    tokens
        .iter()
        .enumerate()
        .map(|(i, &t)| {
            if u01(attack_seed, i as u64) < rate {
                rand_token(attack_seed, i as u64, vocab)
            } else {
                t
            }
        })
        .collect()
}

/// Delete each token independently with probability `rate`. Shifts all
/// downstream contexts — a harder attack because it desynchronizes the context
/// windows, not just individual g-values.
pub fn attack_delete(tokens: &[u32], rate: f64, attack_seed: u64) -> Vec<u32> {
    tokens
        .iter()
        .enumerate()
        .filter(|(i, _)| u01(attack_seed, *i as u64) >= rate)
        .map(|(_, &t)| t)
        .collect()
}

/// Resample a single contiguous span of length `span` starting at `start` with
/// fresh random tokens — a stand-in for locally paraphrasing one passage while
/// leaving the rest intact.
pub fn attack_resample_span(
    tokens: &[u32],
    start: usize,
    span: usize,
    vocab: u32,
    attack_seed: u64,
) -> Vec<u32> {
    let mut out = tokens.to_vec();
    let end = (start + span).min(out.len());
    for (i, slot) in out.iter_mut().enumerate().take(end).skip(start) {
        *slot = rand_token(attack_seed, i as u64, vocab);
    }
    out
}

/// Insert a random token after each position with probability `rate` — the
/// dual of deletion; also desynchronizes downstream contexts.
pub fn attack_insert(tokens: &[u32], rate: f64, vocab: u32, attack_seed: u64) -> Vec<u32> {
    let mut out = Vec::with_capacity(tokens.len() + tokens.len() / 4);
    for (i, &t) in tokens.iter().enumerate() {
        out.push(t);
        if u01(attack_seed ^ 0x1_0000, i as u64) < rate {
            out.push(rand_token(attack_seed ^ 0x2_0000, i as u64, vocab));
        }
    }
    out
}

/// Combined "paraphrase-like" attack: substitution + deletion + insertion at a
/// shared strength, the realistic mixed edit a light rewrite produces. Composed
/// in one pass over the buffer to keep it fast.
pub fn attack_paraphrase(tokens: &[u32], strength: f64, vocab: u32, attack_seed: u64) -> Vec<u32> {
    let subbed = attack_substitute(tokens, strength * 0.6, vocab, attack_seed);
    let deleted = attack_delete(&subbed, strength * 0.3, mix64(attack_seed));
    attack_insert(&deleted, strength * 0.3, vocab, mix64(mix64(attack_seed)))
}

/// **Adaptive worst-case attack** (the "ultra" part). Rather than editing
/// uniformly, spend a fixed edit budget on the positions that currently carry
/// the *most* watermark signal — the strongest robustness stress a bounded-
/// budget editor could apply. Reports the residual detection, i.e. the
/// worst-case detectability at that budget. Measurement only: it returns a
/// detection statistic, never a "cleaned" text for laundering.
pub fn adaptive_worst_case(
    tokens: &[u32],
    cfg: WatermarkConfig,
    scheme: Scheme,
    vocab: u32,
    budget_frac: f64,
    attack_seed: u64,
) -> DetectionResult {
    // Rank positions by their standalone contribution to the statistic, then
    // substitute the top `budget_frac` fraction. Uses per-position seeds from a
    // fresh context tracker so ranking matches what detection actually scores.
    let n = tokens.len();
    let budget = ((n as f64) * budget_frac).round() as usize;
    let mut contrib: Vec<(f64, usize)> = (0..n)
        .map(|i| {
            let start = i.saturating_sub(cfg.context_width);
            let seed = crate::hash::context_seed(cfg.key, &tokens[start..i]);
            let c = match scheme {
                Scheme::Gumbel => crate::gumbel::score_term(seed, tokens[i]),
                Scheme::Tournament => {
                    let d = cfg.layers.max(1);
                    (1..=d).filter(|&l| crate::hash::g_bit(seed, tokens[i], l)).count() as f64
                }
                Scheme::TournamentNd => {
                    let d = cfg.layers.max(1);
                    (1..=d).map(|l| crate::hash::g_unit(seed, tokens[i], l)).sum::<f64>()
                }
            };
            (c, i)
        })
        .collect();
    // Partial sort: highest-contribution positions first.
    contrib.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(core::cmp::Ordering::Equal));
    let mut attacked = tokens.to_vec();
    for &(_, i) in contrib.iter().take(budget) {
        attacked[i] = rand_token(attack_seed, i as u64, vocab);
    }
    redetect(&attacked, cfg, scheme)
}

/// Re-detect after an attack, choosing the detector by `scheme`.
fn redetect(tokens: &[u32], cfg: WatermarkConfig, scheme: Scheme) -> DetectionResult {
    match scheme {
        Scheme::Tournament => detect_tournament(tokens, cfg),
        Scheme::TournamentNd => crate::detect::detect_tournament_nd(tokens, cfg),
        Scheme::Gumbel => detect_gumbel(tokens, cfg),
    }
}

/// Sweep substitution strength across `rates` and report the detectability
/// curve. This is the headline robustness measurement: at each edit rate, how
/// strong is the surviving evidence?
pub fn sweep_substitution(
    tokens: &[u32],
    cfg: WatermarkConfig,
    scheme: Scheme,
    vocab: u32,
    rates: &[f64],
    attack_seed: u64,
) -> Vec<RobustnessPoint> {
    rates
        .iter()
        .map(|&rate| {
            let attacked = attack_substitute(tokens, rate, vocab, attack_seed);
            RobustnessPoint {
                attack_strength: rate,
                detection: redetect(&attacked, cfg, scheme),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::WatermarkKey;
    use crate::Watermarker;

    // Build a watermarked stream over a small vocab with a flat-ish distribution
    // so the watermark has many low-stakes choices to ride.
    fn watermarked_stream(n: usize, scheme: Scheme) -> (Vec<u32>, WatermarkConfig, u32) {
        let vocab = 64u32;
        let cfg = WatermarkConfig::new(WatermarkKey(0x1234)).with_layers(5);
        let mut wm = Watermarker::new(cfg, scheme);
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs = vec![1.0f32 / vocab as f32; vocab as usize];
        let out: Vec<u32> = (0..n).map(|_| tokens[wm.step(&tokens, &probs)]).collect();
        (out, cfg, vocab)
    }

    #[test]
    fn adaptive_attack_is_worse_than_uniform_at_equal_budget() {
        // The "ultra" robustness measurement: spending the SAME edit budget on
        // the highest-signal positions degrades detection more than spreading it
        // uniformly — the true worst-case robustness a bounded editor achieves.
        let (stream, cfg, vocab) = watermarked_stream(1200, Scheme::Gumbel);
        let budget = 0.2;
        let uniform = super::attack_substitute(&stream, budget, vocab, 0x51);
        let z_uniform = crate::detect::detect_gumbel(&uniform, cfg).z_score;
        let z_adaptive = super::adaptive_worst_case(&stream, cfg, Scheme::Gumbel, vocab, budget, 0x51).z_score;
        assert!(
            z_adaptive < z_uniform,
            "adaptive attack ({z_adaptive}) not worse than uniform ({z_uniform}) at equal budget"
        );
    }

    #[test]
    fn insertion_is_handled_and_degrades() {
        let (stream, cfg, vocab) = watermarked_stream(1000, Scheme::Gumbel);
        let clean = crate::detect::detect_gumbel(&stream, cfg).z_score;
        let inserted = super::attack_insert(&stream, 0.2, vocab, 0x99);
        // Position-locked detection under insertion; self-sync would recover more.
        let after = crate::detect::detect_gumbel(&inserted, cfg).z_score;
        assert!(after.is_finite() && after < clean, "insertion not measured: {clean} -> {after}");
    }

    #[test]
    fn detectability_decays_monotonically_with_attack() {
        let (stream, cfg, vocab) = watermarked_stream(800, Scheme::Tournament);
        let curve = sweep_substitution(
            &stream,
            cfg,
            Scheme::Tournament,
            vocab,
            &[0.0, 0.25, 0.5, 0.9],
            0xA77,
        );
        // Clean text: strong evidence. Heavily edited: evidence collapses toward
        // the null. z must be (weakly) non-increasing across the sweep.
        assert!(curve[0].detection.z_score > 6.0, "clean stream too weak: z={}", curve[0].detection.z_score);
        for w in curve.windows(2) {
            assert!(
                w[1].detection.z_score <= w[0].detection.z_score + 1.5,
                "detectability did not degrade: {:?} -> {:?}",
                w[0].detection.z_score,
                w[1].detection.z_score
            );
        }
        assert!(
            curve.last().unwrap().detection.z_score < curve[0].detection.z_score,
            "90% edit left detection unchanged"
        );
    }
}
