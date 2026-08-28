//! Deterministic categorical sampling from a candidate distribution.
//!
//! The watermark schemes need to draw tokens from the model's next-token
//! distribution using randomness that is (a) reproducible from `(seed, draw)` so
//! generation is deterministic given the key, and (b) *namespaced away* from the
//! g-values, so the base draw and the tournament/selection signal are
//! statistically independent. Both come from the same PRF ([`crate::hash`]) but
//! on disjoint `layer` namespaces.

use crate::hash::g_unit;

/// Layer namespace for base categorical draws, kept disjoint from tournament
/// g-value layers (which live in `0..m`) so a draw's randomness never aliases
/// the selection signal.
const RNG_LAYER_BASE: u32 = 0xF000_0000;

/// Draw one token index from `probs` (which must be finite, non-negative, and
/// sum to > 0) using the uniform derived from `(seed, draw_index)`. Inverse-CDF
/// over the candidate list; O(k) in the number of candidates.
///
/// Returns an index into `probs`, not a token id — the caller maps it back.
#[inline]
pub fn sample_index(probs: &[f32], seed: u64, draw_index: u32) -> usize {
    debug_assert!(!probs.is_empty());
    let total: f64 = probs.iter().map(|&p| p as f64).sum();
    let u = g_unit(seed, draw_index, RNG_LAYER_BASE) * total;
    let mut acc = 0.0f64;
    for (i, &p) in probs.iter().enumerate() {
        acc += p as f64;
        if u < acc {
            return i;
        }
    }
    probs.len() - 1 // floating-point slack: fall back to last candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respects_the_distribution() {
        // A candidate that owns 80% of the mass should be drawn ~80% of the time.
        let probs = [0.8f32, 0.1, 0.1];
        let mut counts = [0usize; 3];
        for d in 0..50_000u32 {
            counts[sample_index(&probs, 123, d)] += 1;
        }
        let frac0 = counts[0] as f64 / 50_000.0;
        assert!((frac0 - 0.8).abs() < 0.01, "top candidate frac {frac0}");
    }

    #[test]
    fn deterministic() {
        let probs = [0.5f32, 0.3, 0.2];
        assert_eq!(
            sample_index(&probs, 999, 4),
            sample_index(&probs, 999, 4)
        );
    }

    #[test]
    fn draws_are_independent() {
        // Consecutive draw indices must not correlate (else the tournament's
        // 2^d "independent" samples wouldn't be independent).
        let probs = [0.5f32, 0.5];
        let mut agree = 0;
        for d in (0..40_000u32).step_by(2) {
            if sample_index(&probs, 7, d) == sample_index(&probs, 7, d + 1) {
                agree += 1;
            }
        }
        let frac = agree as f64 / 20_000.0;
        assert!((frac - 0.5).abs() < 0.02, "adjacent draws correlated: {frac}");
    }
}
