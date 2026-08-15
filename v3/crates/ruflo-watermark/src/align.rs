//! Indel-robust detection via context self-synchronization + local alignment.
//!
//! ## The gap this closes
//!
//! The position-locked detector ([`crate::detect`]) is substitution-robust but
//! degrades under deletion/insertion. The dominant failure mode is NOT the
//! per-token seed — that *self-synchronizes*: once an edit has slid out of the
//! `H`-token context window, the observed window is again a run of consecutive
//! generated tokens, so `context_seed` matches what the generator used and the
//! token scores correctly. The real losses are (1) the `H` "straddle" positions
//! after each edit whose window contains the edit, and (2) **repeated-context
//! masking desync**: an indel makes the detector's `seen` set diverge from the
//! generator's, so masking decisions differ and scored positions no longer line
//! up, injecting noise across the whole tail.
//!
//! ## The fix, in two layers
//!
//! 1. **Self-sync scoring** ([`detect_gumbel_selfsync`]): score *every* position
//!    from its observed local window with **masking off**. This removes failure
//!    mode (2) entirely and keeps closed-form calibration (each position is one
//!    `Exp(1)` term under the null), while the self-syncing context recovers all
//!    non-straddle positions after an edit. Big, cheap win.
//!
//! 2. **Local alignment** ([`detect_gumbel_aligned`]): a gap-tolerant maximum-
//!    segment scan over the centered score-terms concentrates the statistic on
//!    genuinely watermarked spans and *bridges over* straddle/inserted runs
//!    (paying a tunable gap penalty), instead of diluting the sum with their
//!    null noise. Calibrated against an empirical null (the same alignment run
//!    under a wrong key), so the max-over-paths inflation is accounted for. Its
//!    parameters are what the Darwin/flywheel tuner in [`crate::evolve`] fits.

use crate::context::WatermarkConfig;
use crate::detect::{DetectionResult, Scheme};
use crate::gumbel::score_term;
use crate::hash::{context_seed, WatermarkKey};

/// Per-position centered Gumbel score `score_term - 1` computed from the
/// observed local window with masking OFF. Mean ~0 under the null, positive on
/// intact watermarked spans. Positions before a full window exist are scored on
/// the short prefix (weaker, but self-consistent with the generator's own
/// short-prefix seeding).
fn centered_scores(tokens: &[u32], key: WatermarkKey, h: usize) -> Vec<f64> {
    let mut out = Vec::with_capacity(tokens.len());
    for t in 0..tokens.len() {
        let start = t.saturating_sub(h);
        let seed = context_seed(key, &tokens[start..t]);
        out.push(score_term(seed, tokens[t]) - 1.0);
    }
    out
}

/// Self-synchronizing indel-robust detector (layer 1). Closed-form: the sum of
/// centered score-terms is `Normal(0, n)` under the null, so `z = Σc / sqrt(n)`.
/// No masking, no calibration, no parameters — the cheap robustness win.
pub fn detect_gumbel_selfsync(tokens: &[u32], cfg: WatermarkConfig) -> DetectionResult {
    let c = centered_scores(tokens, cfg.key, cfg.context_width);
    let n = c.len() as f64;
    let sum: f64 = c.iter().sum();
    let std = n.sqrt();
    let z = if std > 0.0 { sum / std } else { 0.0 };
    let (p, lp) = crate::detect::normal_upper_tail(z);
    DetectionResult {
        scheme: Scheme::Gumbel,
        scored_positions: c.len(),
        statistic: sum,
        null_mean: 0.0,
        z_score: z,
        p_value: p,
        log10_p: lp,
    }
}

/// Tunable parameters for the local-alignment detector (layer 2). These are the
/// search space for [`crate::evolve`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AlignParams {
    /// Max consecutive low/straddle positions a segment may bridge over.
    pub band: usize,
    /// Score paid per bridged position (the gap penalty). Higher => stingier
    /// bridging, less null inflation, but less indel recovery.
    pub gap_penalty: f64,
    /// Number of wrong-key null replays used to calibrate the max statistic.
    pub null_replays: u32,
}

impl Default for AlignParams {
    fn default() -> Self {
        AlignParams {
            band: 6,
            gap_penalty: 0.5,
            null_replays: 24,
        }
    }
}

/// Gap-tolerant maximum-segment score. `dp[t]` = best segment ending at `t`; a
/// segment may extend from up to `band` positions back, paying `gap_penalty`
/// per skipped position. Returns the global maximum (Smith-Waterman-like, `O(n·band)`).
fn local_align_max(scores: &[f64], p: &AlignParams) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }
    let mut dp = vec![0.0f64; scores.len()];
    let mut best = f64::MIN;
    for t in 0..scores.len() {
        // Start fresh at t, or extend the best reachable predecessor within band.
        let mut prev_best = 0.0f64; // "start new segment here"
        let lo = t.saturating_sub(p.band);
        for k in lo..t {
            let gap = (t - k - 1) as f64 * p.gap_penalty; // positions skipped between k and t
            let cand = dp[k] - gap;
            if cand > prev_best {
                prev_best = cand;
            }
        }
        dp[t] = prev_best + scores[t];
        if dp[t] > best {
            best = dp[t];
        }
    }
    best
}

/// Local-alignment indel-robust detector (layer 2), empirically calibrated.
///
/// Computes the gap-tolerant max-segment score on the real key, then on
/// `null_replays` wrong keys (same tokens, so identical marginal statistics),
/// and standardizes: `z = (obs - mean_null) / sd_null`. This accounts for the
/// max-over-paths inflation that would otherwise make a naive p-value anti-
/// conservative.
pub fn detect_gumbel_aligned(
    tokens: &[u32],
    cfg: WatermarkConfig,
    params: AlignParams,
) -> DetectionResult {
    let real = centered_scores(tokens, cfg.key, cfg.context_width);
    let obs = local_align_max(&real, &params);

    // Empirical null: replay under deterministically-perturbed wrong keys.
    let k = params.null_replays.max(2);
    let mut vals = Vec::with_capacity(k as usize);
    for r in 0..k {
        let wrong = WatermarkKey(crate::hash::mix64(cfg.key.0 ^ (0xA5A5_0000 ^ r as u64)));
        let s = centered_scores(tokens, wrong, cfg.context_width);
        vals.push(local_align_max(&s, &params));
    }
    let mean = vals.iter().sum::<f64>() / vals.len() as f64;
    let var = vals.iter().map(|v| (v - mean) * (v - mean)).sum::<f64>() / (vals.len() as f64 - 1.0).max(1.0);
    let sd = var.sqrt().max(1e-9);
    let z = (obs - mean) / sd;
    let (p, lp) = crate::detect::normal_upper_tail(z);
    DetectionResult {
        scheme: Scheme::Gumbel,
        scored_positions: tokens.len(),
        statistic: obs,
        null_mean: mean,
        z_score: z,
        p_value: p,
        log10_p: lp,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::WatermarkKey;
    use crate::robustness::attack_delete;
    use crate::{Scheme, Watermarker};

    fn watermarked(n: usize, vocab: u32, cfg: WatermarkConfig) -> Vec<u32> {
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs = vec![1.0f32 / vocab as f32; vocab as usize];
        let mut wm = Watermarker::new(cfg, Scheme::Gumbel);
        (0..n).map(|_| tokens[wm.step(&tokens, &probs)]).collect()
    }

    // Build a stream in one of two regimes: flat large-vocab (masking rarely
    // fires) or skewed small-vocab (repeated contexts => masking fires often,
    // like real text with recurring phrases).
    fn regime_stream(vocab: u32, rep_bias: bool, n: usize, cfg: WatermarkConfig) -> Vec<u32> {
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs: Vec<f32> = if rep_bias {
            let mut p = vec![0.02f32; vocab as usize];
            p[0] = 1.0 - 0.02 * (vocab as f32 - 1.0);
            p
        } else {
            vec![1.0f32 / vocab as f32; vocab as usize]
        };
        let mut wm = Watermarker::new(cfg, Scheme::Gumbel);
        (0..n).map(|_| tokens[wm.step(&tokens, &probs)]).collect()
    }

    #[test]
    fn selfsync_fixes_masking_desync_the_real_indel_gap() {
        // The headline, honest result: in the repeated-context regime the
        // position-locked detector is near-dead (masking desync), while self-sync
        // stays strong AND indel-robust across deletion rates.
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"indel")).with_layers(1);
        let stream = regime_stream(12, true, 1800, cfg);
        for rate in [0.0f64, 0.35, 0.5] {
            let attacked = attack_delete(&stream, rate, 0xD00D);
            let locked = crate::detect::detect_gumbel(&attacked, cfg).z_score;
            let ss = detect_gumbel_selfsync(&attacked, cfg).z_score;
            assert!(ss > locked + 10.0, "self-sync ({ss}) did not dominate locked ({locked}) at del={rate}");
            assert!(ss > 8.0, "self-sync collapsed at del={rate}: z={ss}");
        }
    }

    #[test]
    fn selfsync_never_worse_than_position_locked() {
        // In the flat regime masking rarely fires, so the two must agree closely
        // (self-sync is never a regression on the position-locked detector).
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"flat")).with_layers(1);
        let stream = regime_stream(256, false, 1500, cfg);
        let attacked = attack_delete(&stream, 0.2, 0xBEEF);
        let locked = crate::detect::detect_gumbel(&attacked, cfg).z_score;
        let ss = detect_gumbel_selfsync(&attacked, cfg).z_score;
        assert!(ss >= locked - 0.5, "self-sync regressed vs locked: {ss} < {locked}");
    }

    #[test]
    fn aligned_detects_under_heavy_deletion_and_calibrates_null() {
        let cfg = WatermarkConfig::new(WatermarkKey(0x1357)).with_layers(1);
        let stream = watermarked(2000, 256, cfg);
        let attacked = attack_delete(&stream, 0.25, 0x1234);

        let r = detect_gumbel_aligned(&attacked, cfg, AlignParams::default());
        assert!(r.z_score > 4.0, "aligned detector too weak under 25% deletion: z={}", r.z_score);

        // Null: a stream that never used the key must not calibrate as watermarked.
        let null: Vec<u32> = (0..2000u32).map(|i| (crate::hash::mix64(i as u64) % 256) as u32).collect();
        let rn = detect_gumbel_aligned(&null, cfg, AlignParams::default());
        assert!(!rn.is_watermarked(1e-3), "aligned detector false-positive on null: z={}", rn.z_score);
    }
}
