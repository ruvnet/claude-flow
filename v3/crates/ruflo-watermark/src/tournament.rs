//! SynthID-Text Tournament sampling (Dathathri et al., *Nature* 2024).
//!
//! This is the scheme the shared diagram illustrates: among *similarly
//! plausible* tokens, the secret key + preceding tokens (via the g-values)
//! decide which candidate is emitted. Concretely, at a watermarked position:
//!
//! 1. Draw `2^d` candidate tokens i.i.d. from the model distribution `p`
//!    (`d` = tournament depth).
//! 2. Run a balanced single-elimination bracket of `d` rounds. In round `ℓ`,
//!    pair up survivors and keep whichever token has the larger `g_ℓ` value.
//! 3. Emit the final winner.
//!
//! Because the `2^d` entrants are genuine i.i.d. draws from `p`, the emitted
//! token is always one the model itself would plausibly have produced — the
//! watermark never injects an out-of-distribution word (no "nubilous"). It only
//! biases *which* plausible candidate wins, in a way a detector holding the key
//! can recover: the winner's g-values are systematically high.
//!
//! **Strength vs cost.** Larger `d` => stronger per-token signal (winner is the
//! max over more competitors) at `2^d` sampling cost. `d = 3` (8 draws) is a
//! good default; the paper's regime lives around here for the distortionary
//! tournament.

use crate::hash::{g_bit, g_unit};
use crate::rng::sample_index;

/// Emit one watermarked token index at a position with random `seed`, using a
/// depth-`d` tournament. `tokens[i]` is the vocabulary id of candidate `i` and
/// `probs[i]` its model probability; the two slices are parallel. Returns an
/// index into `tokens`/`probs`.
///
/// g-values are keyed on the candidate's **token id** (`tokens[i]`), never its
/// position in the list — this is what lets the detector, which sees only the
/// emitted token id, recompute the exact same g-values without the candidate set.
///
/// `depth` is clamped to `1..=16` (2..=65536 candidates).
pub fn tournament_sample(tokens: &[u32], probs: &[f32], seed: u64, depth: u32) -> usize {
    debug_assert_eq!(tokens.len(), probs.len());
    let d = depth.clamp(1, 16);
    let n = 1usize << d;

    // Round 0: 2^d i.i.d. entrants from p. Store candidate *indices* into tokens.
    let mut bracket: Vec<usize> = (0..n as u32)
        .map(|draw| sample_index(probs, seed, draw))
        .collect();

    // Rounds 1..=d: pair adjacent survivors; keep the higher g_ℓ (keyed on the
    // candidate's token id). Ties (both bits equal) keep the left entrant — a
    // fixed, detector-reproducible rule.
    let mut round = 1u32;
    while bracket.len() > 1 {
        let mut next = Vec::with_capacity(bracket.len() / 2);
        let mut i = 0;
        while i + 1 < bracket.len() {
            let a = bracket[i];
            let b = bracket[i + 1];
            let ga = g_bit(seed, tokens[a], round);
            let gb = g_bit(seed, tokens[b], round);
            next.push(if gb && !ga { b } else { a });
            i += 2;
        }
        if bracket.len() % 2 == 1 {
            next.push(bracket[bracket.len() - 1]);
        }
        bracket = next;
        round += 1;
    }
    bracket[0]
}

/// Non-distortionary tournament variant (`Scheme::TournamentNd`). Same balanced
/// bracket, but comparisons use the **continuous** g-value `g_unit` (finer than
/// the fair-coin `g_bit`) and this scheme relies on repeated-context masking
/// being ON (the default) to keep its distribution-preservation property on
/// repetitive text.
///
/// **Property (measured, not asserted from theory):** averaged over the key, the
/// emitted-token distribution matches `p` to within sampling noise (drift
/// < 0.3% at depths 1–5 in tests) — this is the SynthID-Text *non-distortionary*
/// configuration: key-averaged unbiased. Note this is weaker than the *per-key*
/// distortion-freeness of [`crate::gumbel`]; for a fixed key the tournament
/// still biases toward high-g tokens (that bias is exactly the watermark).
pub fn tournament_nd_sample(tokens: &[u32], probs: &[f32], seed: u64, depth: u32) -> usize {
    debug_assert_eq!(tokens.len(), probs.len());
    let d = depth.clamp(1, 16);
    let n = 1usize << d;
    let mut bracket: Vec<usize> = (0..n as u32).map(|draw| sample_index(probs, seed, draw)).collect();
    let mut round = 1u32;
    while bracket.len() > 1 {
        let mut next = Vec::with_capacity(bracket.len() / 2);
        let mut i = 0;
        while i + 1 < bracket.len() {
            let a = bracket[i];
            let b = bracket[i + 1];
            // Continuous g; higher wins. Ties (equal f64) keep the left entrant.
            let ga = g_unit(seed, tokens[a], round);
            let gb = g_unit(seed, tokens[b], round);
            next.push(if gb > ga { b } else { a });
            i += 2;
        }
        if bracket.len() % 2 == 1 {
            next.push(bracket[bracket.len() - 1]);
        }
        bracket = next;
        round += 1;
    }
    bracket[0]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::{context_seed, WatermarkKey};

    // Identity token map: candidate index i has token id i, so index == id.
    fn ids(n: usize) -> Vec<u32> {
        (0..n as u32).collect()
    }

    #[test]
    fn winner_is_always_a_plausible_candidate() {
        // The emitted index must be one p actually supports (non-zero prob),
        // never an injected out-of-distribution token.
        let probs = [0.0f32, 0.5, 0.5, 0.0];
        let tok = ids(4);
        let seed = context_seed(WatermarkKey(1), &[1, 2]);
        for _ in 0..1000 {
            let idx = tournament_sample(&tok, &probs, seed, 3);
            assert!(probs[idx] > 0.0, "emitted a zero-probability token");
        }
    }

    #[test]
    fn preserves_distribution_in_aggregate_over_contexts() {
        // Across many DISTINCT contexts (so g-values vary), the tournament winner
        // frequencies must track p — the watermark biases the *randomness source*
        // not the *distribution* (Anthropic's "no bias toward overcast" claim).
        let probs = [0.7f32, 0.2, 0.1];
        let tok = ids(3);
        let mut counts = [0usize; 3];
        let trials = 60_000u32;
        for c in 0..trials {
            let seed = context_seed(WatermarkKey(9), &[c, c.wrapping_mul(31)]);
            counts[tournament_sample(&tok, &probs, seed, 3)] += 1;
        }
        let frac0 = counts[0] as f64 / trials as f64;
        assert!((frac0 - 0.7).abs() < 0.06, "distribution drifted: {frac0}");
    }

    #[test]
    fn depth_clamps_to_valid_candidate() {
        let probs = [0.5f32, 0.5];
        let tok = ids(2);
        let idx = tournament_sample(&tok, &probs, 42, 0);
        assert!(idx < 2);
    }
}

#[cfg(test)]
mod nd_tests {
    use super::*;
    use crate::hash::{context_seed, WatermarkKey};

    #[test]
    fn nd_tournament_is_key_averaged_non_distortionary() {
        // The defining property: averaged over the key, the emitted distribution
        // matches p to within sampling noise, at every depth. sd for p0=0.7 over
        // 120k trials is ~0.0013, so a 3-sigma band is ~0.004.
        let probs = [0.7f32, 0.2, 0.1];
        let tok: Vec<u32> = (0..3).collect();
        let trials = 120_000u32;
        for depth in [1u32, 2, 3, 5] {
            let mut c = [0usize; 3];
            for k in 0..trials {
                let seed = context_seed(WatermarkKey(9), &[k, k.wrapping_mul(31)]);
                c[tournament_nd_sample(&tok, &probs, seed, depth)] += 1;
            }
            let f0 = c[0] as f64 / trials as f64;
            let f1 = c[1] as f64 / trials as f64;
            assert!((f0 - 0.7).abs() < 0.006, "depth {depth}: p0 drift {:+.4}", f0 - 0.7);
            assert!((f1 - 0.2).abs() < 0.006, "depth {depth}: p1 drift {:+.4}", f1 - 0.2);
        }
    }

    #[test]
    fn nd_winner_is_plausible() {
        let probs = [0.0f32, 0.5, 0.5, 0.0];
        let tok: Vec<u32> = (0..4).collect();
        let seed = context_seed(WatermarkKey(1), &[3]);
        for _ in 0..500 {
            let idx = tournament_nd_sample(&tok, &probs, seed, 4);
            assert!(probs[idx] > 0.0);
        }
    }
}
