//! Higher-power detectors for short texts.
//!
//! The mean/sum detectors in [`crate::detect`] use a normal approximation to the
//! null. That is fine for long texts but (a) is inaccurate in the tail for small
//! `n` — exactly the short-text regime Anthropic flags as hard — and (b) is not
//! the most powerful test when the watermark signal is *sparse* (a few strong
//! positions among many null ones, as in low-entropy / mostly-factual text).
//!
//! Two upgrades, both for the distortion-free Gumbel scheme (whose per-token
//! statistic has a clean closed form):
//!
//! 1. [`detect_gumbel_exact`] — replaces the normal tail with the **exact**
//!    `Gamma(n, 1)` upper tail (the true null of a sum of `n` `Exp(1)` terms).
//!    Correct, not anti-conservative, at any `n`.
//! 2. [`detect_gumbel_hc`] — a **Higher Criticism** statistic (Donoho–Jin) over
//!    the per-token null tail probabilities. Provably more powerful than the sum
//!    when the signal is sparse, which is the short/low-entropy case.

use crate::context::{ContextTracker, WatermarkConfig};
use crate::detect::{DetectionResult, Scheme};
use crate::gumbel::score_term;

/// Per-watermarked-position Gumbel score terms (masking-aware, matching the
/// generator), for the exact/HC detectors to consume.
fn score_terms(tokens: &[u32], cfg: WatermarkConfig) -> Vec<f64> {
    let mut tracker = ContextTracker::new(cfg);
    let mut out = Vec::new();
    for &tok in tokens {
        let ps = tracker.peek();
        if ps.watermarked {
            out.push(score_term(ps.seed, tok));
        }
        tracker.advance(ps, tok);
    }
    out
}

/// Ln Γ(x) via the Lanczos approximation (g=7, n=9). Accurate to ~1e-13 for
/// x > 0 — enough for exact incomplete-gamma p-values.
fn ln_gamma(x: f64) -> f64 {
    const G: f64 = 7.0;
    const C: [f64; 9] = [
        0.999_999_999_999_809_93,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if x < 0.5 {
        // Reflection: Γ(x)Γ(1-x) = π / sin(πx).
        (core::f64::consts::PI / (core::f64::consts::PI * x).sin()).ln() - ln_gamma(1.0 - x)
    } else {
        let x = x - 1.0;
        let mut a = C[0];
        let t = x + G + 0.5;
        for (i, &c) in C.iter().enumerate().skip(1) {
            a += c / (x + i as f64);
        }
        0.5 * (2.0 * core::f64::consts::PI).ln() + (x + 0.5) * t.ln() - t + a.ln()
    }
}

/// Regularized upper incomplete gamma `Q(a, x) = P(Gamma(a,1) > x)`.
/// Series expansion for `x < a+1`, continued fraction otherwise (Numerical
/// Recipes `gammq`). Returns a probability in `[0, 1]`.
fn gammq(a: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 1.0;
    }
    if x < a + 1.0 {
        // Lower series P(a,x), then Q = 1 - P.
        let mut ap = a;
        let mut sum = 1.0 / a;
        let mut del = sum;
        for _ in 0..1000 {
            ap += 1.0;
            del *= x / ap;
            sum += del;
            if del.abs() < sum.abs() * 1e-15 {
                break;
            }
        }
        let p = sum * (-x + a * x.ln() - ln_gamma(a)).exp();
        (1.0 - p).clamp(0.0, 1.0)
    } else {
        // Lentz continued fraction for Q directly.
        let tiny = 1e-300;
        let mut b = x + 1.0 - a;
        let mut c = 1.0 / tiny;
        let mut d = 1.0 / b;
        let mut h = d;
        for i in 1..1000 {
            let an = -(i as f64) * (i as f64 - a);
            b += 2.0;
            d = an * d + b;
            if d.abs() < tiny {
                d = tiny;
            }
            c = b + an / c;
            if c.abs() < tiny {
                c = tiny;
            }
            d = 1.0 / d;
            let del = d * c;
            h *= del;
            if (del - 1.0).abs() < 1e-15 {
                break;
            }
        }
        (h * (-x + a * x.ln() - ln_gamma(a)).exp()).clamp(0.0, 1.0)
    }
}

/// Exact-null Gumbel detector: the statistic is `S = Σ score_term` (sum of `n`
/// `Exp(1)` terms under the null), and the p-value is the **exact**
/// `P(Gamma(n,1) > S)`. Same statistic as [`crate::detect::detect_gumbel`], but
/// a correct tail at small `n` where the normal approximation misleads.
pub fn detect_gumbel_exact(tokens: &[u32], cfg: WatermarkConfig) -> DetectionResult {
    let s = score_terms(tokens, cfg);
    let n = s.len();
    let sum: f64 = s.iter().sum();
    let p = if n == 0 { 0.5 } else { gammq(n as f64, sum) };
    let lp = if p > 0.0 { p.log10() } else { f64::NEG_INFINITY };
    // Report a normal-equiv z for a comparable field, but the p-value is exact.
    let z = if n > 0 { (sum - n as f64) / (n as f64).sqrt() } else { 0.0 };
    DetectionResult {
        scheme: Scheme::Gumbel,
        scored_positions: n,
        statistic: sum,
        null_mean: n as f64,
        z_score: z,
        p_value: p,
        log10_p: lp,
    }
}

/// Standard-normal upper-tail probability, reused for per-token p-values.
fn norm_q(z: f64) -> f64 {
    crate::detect::normal_upper_tail(z).0.max(1e-300)
}

/// Higher-Criticism detector (Donoho–Jin). Converts each token's score term to a
/// null tail p-value `p_i = P(Exp(1) > s_i) = e^{-s_i}`, sorts them, and forms
/// `HC = max_i sqrt(n) (i/n - p_(i)) / sqrt(p_(i)(1-p_(i)))` over the smaller
/// half. Large HC ⇒ more small p-values than chance ⇒ watermark. Provably more
/// powerful than the sum when only a sparse subset of tokens carries signal
/// (the low-entropy / short-text case). Calibrated to a standard-normal tail via
/// the HC null approximation.
pub fn detect_gumbel_hc(tokens: &[u32], cfg: WatermarkConfig) -> DetectionResult {
    let s = score_terms(tokens, cfg);
    let n = s.len();
    if n == 0 {
        return DetectionResult {
            scheme: Scheme::Gumbel,
            scored_positions: 0,
            statistic: 0.0,
            null_mean: 0.0,
            z_score: 0.0,
            p_value: 0.5,
            log10_p: 0.5f64.log10(),
        };
    }
    // Per-token null tail p-values (score_term ~ Exp(1) under H0).
    let mut ps: Vec<f64> = s.iter().map(|&x| (-x).exp().clamp(1e-300, 1.0)).collect();
    ps.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let nf = n as f64;
    let mut hc = f64::MIN;
    // Search the smaller-p half (standard HC+ truncation avoids the noisy tail).
    for i in 1..=(n / 2).max(1) {
        let pi = ps[i - 1];
        let denom = (pi * (1.0 - pi)).sqrt().max(1e-12);
        let stat = nf.sqrt() * (i as f64 / nf - pi) / denom;
        if stat > hc {
            hc = stat;
        }
    }
    // HC's null grows like sqrt(2 log log n); standardize to a normal-ish z so
    // the p-value is comparable and conservative.
    let norm = (2.0 * (nf.ln()).max(1.0).ln().max(1.0)).sqrt();
    let z = hc - norm; // centered HC statistic
    let p = norm_q(z.max(0.0));
    let lp = if p > 0.0 { p.log10() } else { f64::NEG_INFINITY };
    DetectionResult {
        scheme: Scheme::Gumbel,
        scored_positions: n,
        statistic: hc,
        null_mean: norm,
        z_score: z,
        p_value: p,
        log10_p: lp,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::{mix64, WatermarkKey};
    use crate::{Scheme, Watermarker};

    fn watermarked(n: usize, vocab: u32, cfg: WatermarkConfig) -> Vec<u32> {
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs = vec![1.0f32 / vocab as f32; vocab as usize];
        let mut wm = Watermarker::new(cfg, Scheme::Gumbel);
        (0..n).map(|_| tokens[wm.step(&tokens, &probs)]).collect()
    }

    #[test]
    fn ln_gamma_and_gammq_are_accurate() {
        // Γ(5)=24 => ln 24; Q(1,x)=e^{-x} (Exp(1) tail).
        assert!((ln_gamma(5.0) - 24.0f64.ln()).abs() < 1e-9);
        // Gamma(1,1) = Exp(1): Q(1,x) = e^{-x}.
        assert!((gammq(1.0, 2.0) - (-2.0f64).exp()).abs() < 1e-9);
        // Gamma(2,1): Q(2,x) = e^{-x}(1+x), exact. Q(2,1) = 2/e.
        assert!((gammq(2.0, 1.0) - 2.0 / core::f64::consts::E).abs() < 1e-9);
        // Continued-fraction branch (x >= a+1): Q(2,5) = e^{-5}·6.
        assert!((gammq(2.0, 5.0) - (-5.0f64).exp() * 6.0).abs() < 1e-9);
    }

    #[test]
    fn exact_pvalue_is_calibrated_on_null() {
        // A null stream must not be flagged by the exact detector.
        let cfg = WatermarkConfig::new(WatermarkKey(0x9)).with_layers(1);
        let null: Vec<u32> = (0..300u32).map(|i| (mix64(i as u64 ^ 0xAA) % 256) as u32).collect();
        let r = detect_gumbel_exact(&null, cfg);
        assert!(r.p_value > 1e-3, "exact detector false-positive on null: p={}", r.p_value);
    }

    #[test]
    fn exact_detects_short_watermark() {
        // The short-text win: the exact Gamma tail flags a short watermarked
        // text with a correct (not anti-conservative) p-value.
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"short")).with_layers(1);
        let stream = watermarked(120, 256, cfg);
        let exact = detect_gumbel_exact(&stream, cfg);
        assert!(exact.p_value < 1e-3, "exact detector missed short watermark: p={}", exact.p_value);
    }

    #[test]
    fn hc_is_calibrated_and_detects() {
        // Higher Criticism must (a) not false-positive on null and (b) fire on a
        // clearly watermarked text. Its edge over the sum is in the sparse
        // regime; here we assert calibration + detection, the defensible claims.
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"hc")).with_layers(1);
        let stream = watermarked(400, 256, cfg);
        let hc = detect_gumbel_hc(&stream, cfg);
        let null: Vec<u32> = (0..400u32).map(|i| (mix64(i as u64 ^ 0x1234) % 256) as u32).collect();
        let hc_null = detect_gumbel_hc(&null, cfg);
        assert!(hc_null.p_value > 1e-2, "HC false-positive on null: p={}", hc_null.p_value);
        assert!(hc.z_score > hc_null.z_score + 1.0, "HC did not separate watermark from null: {} vs {}", hc.z_score, hc_null.z_score);
    }
}
