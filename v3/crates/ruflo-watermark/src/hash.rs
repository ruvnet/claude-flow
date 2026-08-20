//! Keyed pseudo-random function (PRF) that produces the watermark's *g-values*.
//!
//! In the SynthID-Text / Aaronson family, the watermark never invents a token
//! the model wouldn't have picked — it only changes the *source of randomness*
//! used to break ties among plausible tokens (the "digits of pi" analogy). This
//! module is that source: a fast, well-mixed keyed hash mapping
//! `(secret_key, context, token_id, layer)` to a uniform value.
//!
//! Two outputs are exposed:
//! - [`g_unit`]: a uniform `f64` in `[0, 1)` — used by the distortion-free
//!   Gumbel scheme and by weighted detectors.
//! - [`g_bit`]: a uniform `bool` (fair coin) — used by SynthID Tournament layers.
//!
//! The mixing core is a 64-bit finalizer of the SplitMix64 / MurmurHash3
//! avalanche family: cheap (a few multiplies + xors), no table lookups, and
//! statistically uniform enough that `E[g_unit] = 0.5` on unwatermarked token
//! streams — the property detection relies on.

/// A secret watermarking key. Carries NO user-identifying information; it only
/// selects which pseudo-random stream the watermark rides on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WatermarkKey(pub u64);

impl WatermarkKey {
    /// Derive a key from arbitrary key material (e.g. a hex secret) by mixing
    /// its bytes. Deterministic; the same material always yields the same key.
    pub fn from_bytes(material: &[u8]) -> Self {
        let mut acc: u64 = 0x9E37_79B9_7F4A_7C15; // golden-ratio odd constant
        for &b in material {
            acc = mix64(acc ^ (b as u64).wrapping_add(0x0100_0000_01B3));
        }
        WatermarkKey(mix64(acc))
    }
}

/// SplitMix64 finalizer — a bijective avalanche mixer. Every input bit affects
/// every output bit; distinct inputs are statistically independent outputs.
#[inline(always)]
pub fn mix64(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Fold a context (the preceding `H` token ids) plus the secret key into a
/// single 64-bit seed `r`. This is the watermark's per-position randomness
/// source: the same context+key always produces the same `r`, which is exactly
/// what lets a detector recompute the stream without the model.
#[inline]
pub fn context_seed(key: WatermarkKey, context: &[u32]) -> u64 {
    let mut acc = key.0 ^ 0xD1B5_4A32_D192_ED03;
    for &tok in context {
        acc = mix64(acc.rotate_left(13) ^ (tok as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    }
    mix64(acc)
}

/// Raw 64-bit g-value for a `(seed, token, layer)` triple. `layer` selects an
/// independent tournament round (SynthID uses `m` layers); pass `0` for
/// single-layer schemes.
#[inline(always)]
pub fn g_raw(seed: u64, token: u32, layer: u32) -> u64 {
    // Distinct primes per field so token/layer/seed can't alias each other.
    let a = seed ^ (token as u64).wrapping_mul(0xFF51_AFD7_ED55_8CCD);
    let b = a.rotate_left(29) ^ (layer as u64).wrapping_mul(0xC4CE_B9FE_1A85_EC53);
    mix64(b)
}

/// Uniform `f64` in `[0, 1)` for `(seed, token, layer)`. Uses the top 53 bits so
/// the result is a uniformly-spaced dyadic rational (full f64 mantissa).
#[inline(always)]
pub fn g_unit(seed: u64, token: u32, layer: u32) -> f64 {
    (g_raw(seed, token, layer) >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
}

/// Fair-coin g-value (`{0,1}`) for a SynthID tournament layer. Uses the top bit
/// of the mixed value, which is unbiased.
#[inline(always)]
pub fn g_bit(seed: u64, token: u32, layer: u32) -> bool {
    (g_raw(seed, token, layer) >> 63) == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn g_bit_is_a_fair_coin() {
        // Over many tokens, P(g_bit = 1) must be ~0.5 — the null hypothesis the
        // detector tests against. A biased PRF would silently break detection.
        let seed = context_seed(WatermarkKey(42), &[1, 2, 3]);
        let ones = (0u32..100_000).filter(|&t| g_bit(seed, t, 0)).count();
        let frac = ones as f64 / 100_000.0;
        assert!((frac - 0.5).abs() < 0.01, "g_bit bias too large: {frac}");
    }

    #[test]
    fn g_unit_is_uniform_mean_half() {
        let seed = context_seed(WatermarkKey(7), &[9, 9, 9]);
        let sum: f64 = (0u32..100_000).map(|t| g_unit(seed, t, 0)).sum();
        let mean = sum / 100_000.0;
        assert!((mean - 0.5).abs() < 0.01, "g_unit mean off: {mean}");
    }

    #[test]
    fn layers_are_independent() {
        // Two tournament layers must not correlate, else stacking them adds no
        // detection power. Check the fraction where layer0 == layer1 is ~0.5.
        let seed = context_seed(WatermarkKey(1), &[5]);
        let agree = (0u32..100_000)
            .filter(|&t| g_bit(seed, t, 0) == g_bit(seed, t, 1))
            .count();
        let frac = agree as f64 / 100_000.0;
        assert!((frac - 0.5).abs() < 0.01, "layers correlated: {frac}");
    }

    #[test]
    fn context_changes_stream() {
        // Different preceding context => different randomness (so the same token
        // is watermarked differently in different places — the non-bias claim).
        let s1 = context_seed(WatermarkKey(1), &[1, 2, 3]);
        let s2 = context_seed(WatermarkKey(1), &[1, 2, 4]);
        assert_ne!(s1, s2);
        assert_ne!(g_unit(s1, 100, 0), g_unit(s2, 100, 0));
    }

    #[test]
    fn key_from_bytes_deterministic() {
        assert_eq!(
            WatermarkKey::from_bytes(b"8F3A91C7"),
            WatermarkKey::from_bytes(b"8F3A91C7")
        );
        assert_ne!(
            WatermarkKey::from_bytes(b"8F3A91C7"),
            WatermarkKey::from_bytes(b"8F3A91C8")
        );
    }
}
