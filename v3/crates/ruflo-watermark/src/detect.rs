//! Detection: given an emitted token sequence and the key, recover the evidence
//! that it rode the watermark's pseudo-random stream, and turn it into a
//! calibrated statistic + p-value.
//!
//! The detector re-runs the exact [`ContextTracker`] the generator used (same
//! key, context width, and repeated-context mask), so the set of *scored*
//! positions is identical to the set of *watermarked* positions. For each scored
//! position it computes the scheme's per-token contribution:
//!
//! - **Tournament**: the `d` layer g-bits of the emitted token. Under the null
//!   (no watermark) each bit is a fair coin, so the total is `Binomial(N, ½)`
//!   with `N = positions × d`. A watermarked winner won every round, so its bits
//!   skew to 1 (`E ≈ 2/3` per layer). Statistic: standardized excess of ones.
//! - **Gumbel**: `-ln(1 - u)` for the emitted token. Under the null each term is
//!   `Exp(1)` (mean 1), so the sum is `Gamma(n, 1)`; the watermark inflates the
//!   mean. Statistic: standardized excess over `n`.
//!
//! Both reduce to an upper-tail standard-normal p-value. A small p-value means
//! "this text is very unlikely to have been produced without the key" — i.e.
//! likely watermarked.

use crate::context::{ContextTracker, WatermarkConfig};
use crate::gumbel::score_term;
use crate::hash::g_bit;

/// Which scheme produced (or is hypothesized to have produced) the watermark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scheme {
    /// SynthID-Text tournament (fair-coin g) with depth = `WatermarkConfig::layers`.
    Tournament,
    /// Non-distortionary tournament (continuous g + mandatory masking):
    /// key-averaged unbiased. See [`crate::tournament::tournament_nd_sample`].
    TournamentNd,
    /// Distortion-free Aaronson/Kuditipudi exponential-min.
    Gumbel,
}

/// The outcome of scoring a token sequence against a key.
#[derive(Clone, Copy, Debug)]
pub struct DetectionResult {
    pub scheme: Scheme,
    /// Number of positions that were watermarked (unmasked) and thus scored.
    /// Detection power grows with this, not with raw text length.
    pub scored_positions: usize,
    /// Raw aggregate statistic (ones-count for tournament; score-sum for gumbel).
    pub statistic: f64,
    /// Expected statistic under the null (no watermark).
    pub null_mean: f64,
    /// Standardized deviation from the null. Larger => stronger evidence.
    pub z_score: f64,
    /// Upper-tail p-value under the null. Small => likely watermarked. Floors at
    /// the smallest representable positive f64 for extreme z; use [`Self::log10_p`]
    /// for the true magnitude.
    pub p_value: f64,
    /// `log10(p_value)` computed stably even when `p_value` underflows to 0.
    pub log10_p: f64,
}

impl DetectionResult {
    /// A convenience verdict at a chosen false-positive rate `alpha`
    /// (e.g. `1e-6`). Returns `true` if the evidence clears the bar.
    pub fn is_watermarked(&self, alpha: f64) -> bool {
        self.log10_p <= alpha.log10()
    }
}

/// Detect using the tournament scheme. `cfg.layers` is the tournament depth `d`.
pub fn detect_tournament(tokens: &[u32], cfg: WatermarkConfig) -> DetectionResult {
    let d = cfg.layers.max(1);
    let mut tracker = ContextTracker::new(cfg);
    let mut ones: u64 = 0;
    let mut scored: usize = 0;
    for &tok in tokens {
        let ps = tracker.peek();
        if ps.watermarked {
            for layer in 1..=d {
                if g_bit(ps.seed, tok, layer) {
                    ones += 1;
                }
            }
            scored += 1;
        }
        tracker.advance(ps, tok);
    }
    let n = (scored as u64 * d as u64) as f64; // total Bernoulli trials
    let null_mean = 0.5 * n;
    let std = (0.25 * n).sqrt(); // Binomial(N, ½) sd = sqrt(N/4)
    let z = if std > 0.0 { (ones as f64 - null_mean) / std } else { 0.0 };
    let (p, lp) = normal_upper_tail(z);
    DetectionResult {
        scheme: Scheme::Tournament,
        scored_positions: scored,
        statistic: ones as f64,
        null_mean,
        z_score: z,
        p_value: p,
        log10_p: lp,
    }
}

/// Detect using the non-distortionary tournament (continuous g). Each
/// watermarked position contributes `d` terms `g_unit(seed, tok, ℓ) - 0.5`,
/// mean 0 and variance `1/12` under the null; a winner's g-values skew high
/// (`E[g_unit] = 2/3` per won layer). Statistic standardized to a normal tail.
pub fn detect_tournament_nd(tokens: &[u32], cfg: WatermarkConfig) -> DetectionResult {
    let d = cfg.layers.max(1);
    let mut tracker = ContextTracker::new(cfg);
    let mut sum = 0.0f64;
    let mut scored: usize = 0;
    for &tok in tokens {
        let ps = tracker.peek();
        if ps.watermarked {
            for layer in 1..=d {
                sum += crate::hash::g_unit(ps.seed, tok, layer) - 0.5;
            }
            scored += 1;
        }
        tracker.advance(ps, tok);
    }
    let n = (scored as u64 * d as u64) as f64; // total uniform terms
    let std = (n / 12.0).sqrt(); // Var(U(0,1)) = 1/12
    let z = if std > 0.0 { sum / std } else { 0.0 };
    let (p, lp) = normal_upper_tail(z);
    DetectionResult {
        scheme: Scheme::TournamentNd,
        scored_positions: scored,
        statistic: sum,
        null_mean: 0.0,
        z_score: z,
        p_value: p,
        log10_p: lp,
    }
}

/// Detect using the distortion-free Gumbel scheme.
pub fn detect_gumbel(tokens: &[u32], cfg: WatermarkConfig) -> DetectionResult {
    let mut tracker = ContextTracker::new(cfg);
    let mut sum = 0.0f64;
    let mut scored: usize = 0;
    for &tok in tokens {
        let ps = tracker.peek();
        if ps.watermarked {
            sum += score_term(ps.seed, tok);
            scored += 1;
        }
        tracker.advance(ps, tok);
    }
    let n = scored as f64;
    // Sum of n i.i.d. Exp(1) has mean n, variance n; normal approx for the tail.
    let std = n.sqrt();
    let z = if std > 0.0 { (sum - n) / std } else { 0.0 };
    let (p, lp) = normal_upper_tail(z);
    DetectionResult {
        scheme: Scheme::Gumbel,
        scored_positions: scored,
        statistic: sum,
        null_mean: n,
        z_score: z,
        p_value: p,
        log10_p: lp,
    }
}

/// Complementary error function (Numerical Recipes `erfcc`): fractional error
/// < 1.2e-7 everywhere, and — crucially — stays accurate for large `x` where
/// `1 - erf(x)` would catastrophically cancel. Returns tiny positive values
/// rather than underflowing prematurely.
fn erfc(x: f64) -> f64 {
    let z = x.abs();
    let t = 1.0 / (1.0 + 0.5 * z);
    let ans = t
        * (-z * z - 1.265_512_23
            + t * (1.000_023_68
                + t * (0.374_091_96
                    + t * (0.096_784_18
                        + t * (-0.186_288_06
                            + t * (0.278_868_07
                                + t * (-1.135_203_98
                                    + t * (1.488_515_87
                                        + t * (-0.822_152_23 + t * 0.170_872_77)))))))))
            .exp();
    if x >= 0.0 {
        ans
    } else {
        2.0 - ans
    }
}

/// Upper-tail probability `Q(z) = P(Z > z)` for standard normal, returned as
/// `(p_value, log10_p)`. For large `z` the p-value underflows to 0.0, so
/// `log10_p` is computed from the asymptotic tail
/// `ln Q(z) ≈ -z²/2 - ln(z) - ½ln(2π)` to preserve the true magnitude.
pub(crate) fn normal_upper_tail(z: f64) -> (f64, f64) {
    let p = 0.5 * erfc(z / core::f64::consts::SQRT_2);
    if p > 0.0 && p.is_finite() {
        (p, p.log10())
    } else if z <= 0.0 {
        (0.5, 0.5f64.log10())
    } else {
        // Asymptotic log tail (natural log), converted to log10.
        let ln_q = -0.5 * z * z - z.ln() - 0.5 * (2.0 * core::f64::consts::PI).ln();
        (0.0, ln_q / core::f64::consts::LN_10)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::WatermarkKey;

    #[test]
    fn erfc_matches_known_values() {
        assert!((erfc(0.0) - 1.0).abs() < 1e-6);
        assert!((erfc(1.0) - 0.157_299_2).abs() < 1e-5);
        assert!(erfc(10.0) > 0.0 && erfc(10.0) < 1e-40); // stays positive & tiny
    }

    #[test]
    fn null_text_is_not_flagged() {
        // A deterministic pseudo-random token stream that never used the key must
        // score near z=0 (p ~ 0.5), not trip the detector.
        let cfg = WatermarkConfig::new(WatermarkKey(0xABCD)).with_layers(4);
        let tokens: Vec<u32> = (0..500u32).map(|i| crate::hash::mix64(i as u64) as u32 % 1000).collect();
        let r = detect_tournament(&tokens, cfg);
        assert!(r.z_score.abs() < 4.0, "null text spuriously flagged: z={}", r.z_score);
        assert!(!r.is_watermarked(1e-6), "false positive on null text");
    }
}
