//! Provably distortion-free watermarking — the Aaronson (2022) exponential-min
//! scheme, also the basis of Kuditipudi et al. (2024) "Robust distortion-free
//! watermarks for language models".
//!
//! Unlike the tournament (which biases the distribution slightly), this scheme
//! samples *exactly* from the model distribution `p` — the marginal token
//! distribution is provably unchanged — while still leaving a key-detectable
//! signal. It is the right choice when zero distortion is a hard requirement.
//!
//! **Sampling.** For each candidate `i`, draw a uniform `u_i = g_unit(seed, i)`.
//! Emit `argmax_i u_i^{1/p_i}`. Equivalently (and how we compute it, avoiding
//! `powf`): emit `argmin_i (-ln u_i) / p_i`. Since `-ln u_i ~ Exp(1)`, the term
//! `(-ln u_i)/p_i ~ Exp(p_i)`, and the index of the minimum of independent
//! `Exp(p_i)` is `j` with probability `p_j / Σ p = p_j`. Hence: distortion-free.
//!
//! **Detection.** The emitted token's `u_{x_t}` is stochastically *larger* than
//! a fresh uniform. The per-token statistic `-ln(1 - u_{x_t})` is `Exp(1)` under
//! the null (mean 1) but has mean `> 1` under the watermark. Summed over tokens
//! it is a clean Gamma-distributed detector (see [`crate::detect`]).

use crate::hash::g_unit;

/// Emit one watermarked token index at a position with random `seed`, using the
/// distortion-free exponential-min rule. `tokens[i]` is candidate `i`'s vocab id
/// and `probs[i]` its probability (parallel slices). Returns an index into
/// `tokens`/`probs`. The uniform is keyed on the **token id** so the detector,
/// which sees only emitted token ids, reproduces it. Zero-prob tokens are skipped.
pub fn gumbel_sample(tokens: &[u32], probs: &[f32], seed: u64) -> usize {
    debug_assert_eq!(tokens.len(), probs.len());
    let mut best = 0usize;
    let mut best_key = f64::INFINITY; // minimise (-ln u)/p
    for (i, (&tok, &p)) in tokens.iter().zip(probs.iter()).enumerate() {
        if p <= 0.0 {
            continue;
        }
        let u = g_unit(seed, tok, 0).max(f64::MIN_POSITIVE);
        let key = -u.ln() / p as f64;
        if key < best_key {
            best_key = key;
            best = i;
        }
    }
    best
}

/// The per-token detection contribution for a **token id** at `seed`:
/// `-ln(1 - u)`. Exposed so the detector can score directly from emitted token
/// ids without the candidate set.
#[inline]
pub fn score_term(seed: u64, token: u32) -> f64 {
    let u = g_unit(seed, token, 0).min(1.0 - f64::MIN_POSITIVE);
    -(1.0 - u).ln()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::{context_seed, WatermarkKey};

    fn ids(n: usize) -> Vec<u32> {
        (0..n as u32).collect()
    }

    #[test]
    fn is_distortion_free() {
        // The KEY property: marginal token frequencies must match p *exactly* in
        // expectation, across independent contexts. Tighter tolerance than the
        // tournament because this scheme is provably unbiased.
        let probs = [0.6f32, 0.25, 0.15];
        let tok = ids(3);
        let mut counts = [0usize; 3];
        let trials = 200_000u32;
        for c in 0..trials {
            let seed = context_seed(WatermarkKey(3), &[c, c ^ 0x5555]);
            counts[gumbel_sample(&tok, &probs, seed)] += 1;
        }
        let f0 = counts[0] as f64 / trials as f64;
        let f1 = counts[1] as f64 / trials as f64;
        assert!((f0 - 0.6).abs() < 0.006, "p0 drift {f0}");
        assert!((f1 - 0.25).abs() < 0.006, "p1 drift {f1}");
    }

    #[test]
    fn never_emits_zero_prob_token() {
        let probs = [0.0f32, 1.0, 0.0];
        let tok = ids(3);
        for c in 0..5000u32 {
            let seed = context_seed(WatermarkKey(1), &[c]);
            assert_eq!(gumbel_sample(&tok, &probs, seed), 1);
        }
    }

    #[test]
    fn chosen_token_has_elevated_score_term() {
        // Averaged over positions, the emitted token's score term exceeds the
        // null mean of 1.0 — this is what detection exploits.
        let probs = [0.5f32, 0.5];
        let tok = ids(2);
        let mut sum = 0.0;
        let trials = 40_000u32;
        for c in 0..trials {
            let seed = context_seed(WatermarkKey(2), &[c]);
            let idx = gumbel_sample(&tok, &probs, seed);
            sum += score_term(seed, tok[idx]);
        }
        let mean = sum / trials as f64;
        assert!(mean > 1.05, "watermark score term not elevated: {mean}");
    }
}
