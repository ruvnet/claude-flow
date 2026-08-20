//! Context window management and repeated-context masking.
//!
//! The watermark's randomness at position `t` is seeded by the preceding `H`
//! tokens (the *watermarking context window*, `h` in the SynthID paper). Two
//! subtleties this module handles:
//!
//! 1. **Sliding window.** Positions before `H` tokens exist have a short/empty
//!    context; we seed on whatever prefix is available so early tokens still
//!    carry (weaker) signal.
//!
//! 2. **Repeated-context masking.** If the same `H`-gram context recurs, re-using
//!    the same random stream would (a) bias the distribution on repetitive text
//!    and (b) hand an attacker a trivial correlation. SynthID-Text skips
//!    watermarking (samples from the *unmodified* model distribution) whenever a
//!    context h-gram has already been seen. This is what makes the scheme
//!    distribution-preserving in expectation and robust to "repeat the prompt"
//!    attacks. The detector applies the identical mask so scored positions match
//!    generated ones exactly.

use crate::hash::{context_seed, WatermarkKey};

/// Configuration shared by generator and detector. Both MUST use identical
/// settings or the recomputed g-value stream will not line up.
#[derive(Clone, Copy, Debug)]
pub struct WatermarkConfig {
    /// Secret key. Carries no user information.
    pub key: WatermarkKey,
    /// Context window size `H` (number of preceding tokens seeding each draw).
    /// Larger `H` => more distortion-free and repetition-robust, but early
    /// tokens carry less signal and short texts are harder to detect.
    pub context_width: usize,
    /// Number of tournament layers `m` (SynthID). More layers => stronger
    /// watermark per token (more bias) at more compute. Ignored by the
    /// distortion-free Gumbel scheme.
    pub layers: u32,
    /// Enable repeated-context masking (recommended: `true`).
    pub repeated_context_mask: bool,
}

impl WatermarkConfig {
    /// Sensible defaults matching the SynthID-Text paper's practical regime:
    /// `H = 4`, `m = 30` tournament layers, masking on.
    pub fn new(key: WatermarkKey) -> Self {
        WatermarkConfig {
            key,
            context_width: 4,
            layers: 30,
            repeated_context_mask: true,
        }
    }

    pub fn with_context_width(mut self, h: usize) -> Self {
        self.context_width = h.max(1);
        self
    }

    pub fn with_layers(mut self, m: u32) -> Self {
        self.layers = m.max(1);
        self
    }
}

/// Streaming context tracker. Feed it the tokens as they are generated (or, at
/// detection time, as they are read) and it yields, per position, the random
/// seed to use and whether this position is *watermarked* (unmasked) or should
/// be skipped (masked because its context repeated).
pub struct ContextTracker {
    cfg: WatermarkConfig,
    history: Vec<u32>,
    /// Seeds of context h-grams already emitted, for repeated-context masking.
    /// A seed collision is astronomically unlikely with a 64-bit mixer, so we
    /// store seeds (8 bytes) rather than the raw h-grams.
    seen: Vec<u64>,
}

/// The watermarking decision for a single position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PositionSeed {
    /// The random seed `r` for this position.
    pub seed: u64,
    /// Whether this position is watermarked. If `false` (masked), the generator
    /// samples from the unmodified model distribution and the detector ignores
    /// the position — the two stay in lockstep.
    pub watermarked: bool,
}

impl ContextTracker {
    pub fn new(cfg: WatermarkConfig) -> Self {
        ContextTracker {
            cfg,
            history: Vec::new(),
            seen: Vec::new(),
        }
    }

    /// Compute the seed for the *next* position from current history, and decide
    /// masking. Does NOT advance — call [`ContextTracker::advance`] once the
    /// token at this position is known.
    pub fn peek(&self) -> PositionSeed {
        let start = self.history.len().saturating_sub(self.cfg.context_width);
        let ctx = &self.history[start..];
        let seed = context_seed(self.cfg.key, ctx);
        let watermarked = if self.cfg.repeated_context_mask {
            !self.seen.contains(&seed)
        } else {
            true
        };
        PositionSeed { seed, watermarked }
    }

    /// Record the emitted `token` and, if this position was watermarked, mark its
    /// context seed as seen so a future recurrence is masked.
    pub fn advance(&mut self, seed: PositionSeed, token: u32) {
        if self.cfg.repeated_context_mask && seed.watermarked {
            self.seen.push(seed.seed);
        }
        self.history.push(token);
    }

    pub fn config(&self) -> &WatermarkConfig {
        &self.cfg
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_context_is_masked() {
        let cfg = WatermarkConfig::new(WatermarkKey(1)).with_context_width(2);
        let mut t = ContextTracker::new(cfg);
        // Emit tokens A B A B A B — the context "A B" recurs.
        let seq = [10u32, 20, 10, 20, 10, 20];
        let mut watermarked_flags = Vec::new();
        for &tok in &seq {
            let ps = t.peek();
            watermarked_flags.push(ps.watermarked);
            t.advance(ps, tok);
        }
        // First occurrence of each distinct context is watermarked; recurrences
        // of "10,20" -> masked. Position 4 has context [20,10] (from idx2,3),
        // position 5 has context [10,20] again (seen) => masked.
        assert!(watermarked_flags[5] == false, "recurring context not masked");
    }

    #[test]
    fn masking_off_never_masks() {
        let cfg = WatermarkConfig {
            key: WatermarkKey(1),
            context_width: 1,
            layers: 1,
            repeated_context_mask: false,
        };
        let mut t = ContextTracker::new(cfg);
        for &tok in &[1u32, 1, 1, 1] {
            let ps = t.peek();
            assert!(ps.watermarked);
            t.advance(ps, tok);
        }
    }
}
