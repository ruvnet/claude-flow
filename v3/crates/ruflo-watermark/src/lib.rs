//! # ruflo-watermark
//!
//! High-speed LLM **text watermarking** (generation + detection) in the
//! SynthID-Text / Aaronson family, with an optional WASM build and a defensive
//! robustness-evaluation harness.
//!
//! The watermark never invents a token the model would not have produced. It
//! only changes the *source of randomness* used to break ties among plausible
//! tokens — the "digits of pi" analogy from Anthropic's explainer. A holder of
//! the secret key can then test whether a token sequence rode that stream and
//! assign a probability that a keyed model produced it.
//!
//! Two schemes, sharing one keyed PRF ([`hash`]) and context machinery
//! ([`context`]):
//!
//! - [`Scheme::Tournament`] — SynthID-Text tournament sampling (Dathathri et
//!   al., *Nature* 2024). Strong, mildly distortionary; strength scales with the
//!   tournament depth.
//! - [`Scheme::Gumbel`] — the Aaronson (2022) / Kuditipudi et al. (2024)
//!   exponential-min rule. Provably distortion-free (the marginal token
//!   distribution is unchanged).
//!
//! ## Boundary
//!
//! This crate does not run an LLM. At each step the caller supplies the model's
//! candidate token ids and their probabilities (typically a top-k slice); the
//! watermarker selects which candidate to emit. This matches the deployment
//! shape: logits in, watermarked sample out, no extra tokens, negligible cost.
//!
//! ```
//! use ruflo_watermark::{Watermarker, WatermarkConfig, WatermarkKey, Scheme,
//!                       detect_gumbel};
//!
//! let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"8F3A91C7"));
//! let mut wm = Watermarker::new(cfg, Scheme::Gumbel);
//!
//! // Two equally-plausible candidates (token ids 40 and 41), as in the diagram.
//! let tokens = [40u32, 41];
//! let probs  = [0.5f32, 0.5];
//! let emitted_index = wm.step(&tokens, &probs);
//! let _emitted_token = tokens[emitted_index];
//! ```

pub mod align;
pub mod bayes;
pub mod context;
pub mod detect;
pub mod evolve;
pub mod gumbel;
pub mod hash;
pub mod rng;
pub mod robustness;
pub mod tournament;
pub mod unmarked;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use context::{ContextTracker, PositionSeed, WatermarkConfig};
pub use detect::{detect_gumbel, detect_tournament, detect_tournament_nd, DetectionResult, Scheme};
pub use hash::WatermarkKey;

/// A streaming watermarked sampler. Holds the rolling context so successive
/// [`Watermarker::step`] calls form one coherent watermarked sequence.
pub struct Watermarker {
    tracker: ContextTracker,
    scheme: Scheme,
    depth: u32,
}

impl Watermarker {
    /// Create a watermarker. For [`Scheme::Tournament`], `cfg.layers` is the
    /// tournament depth `d` (`2^d` candidate draws per step).
    pub fn new(cfg: WatermarkConfig, scheme: Scheme) -> Self {
        let depth = cfg.layers.max(1);
        Watermarker {
            tracker: ContextTracker::new(cfg),
            scheme,
            depth,
        }
    }

    /// Emit one token given the model's candidate `tokens` and their `probs`
    /// (parallel slices). Returns the index of the chosen candidate and advances
    /// the rolling context. If this position is masked (repeated context), the
    /// token is drawn from the unmodified distribution — no watermark — keeping
    /// the scheme distribution-preserving and detector-aligned.
    pub fn step(&mut self, tokens: &[u32], probs: &[f32]) -> usize {
        debug_assert_eq!(tokens.len(), probs.len());
        let ps = self.tracker.peek();
        let idx = if ps.watermarked {
            match self.scheme {
                Scheme::Tournament => {
                    tournament::tournament_sample(tokens, probs, ps.seed, self.depth)
                }
                Scheme::TournamentNd => {
                    tournament::tournament_nd_sample(tokens, probs, ps.seed, self.depth)
                }
                Scheme::Gumbel => gumbel::gumbel_sample(tokens, probs, ps.seed),
            }
        } else {
            // Masked: plain draw from p, no watermark bias.
            rng::sample_index(probs, ps.seed, 0)
        };
        self.tracker.advance(ps, tokens[idx]);
        idx
    }

    /// The emitted token ids so far are the caller's responsibility to collect;
    /// this exposes the config for a detector to be built with matching settings.
    pub fn config(&self) -> &WatermarkConfig {
        self.tracker.config()
    }
}

#[cfg(test)]
mod integration {
    use super::*;

    // End-to-end: generate a watermarked stream, then confirm the detector
    // flags it with overwhelming confidence while a null stream is not flagged.
    fn run_scheme(scheme: Scheme) -> (DetectionResult, DetectionResult) {
        let vocab = 128u32;
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"secret")).with_layers(6);
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs = vec![1.0f32 / vocab as f32; vocab as usize];

        let mut wm = Watermarker::new(cfg, scheme);
        let watermarked: Vec<u32> = (0..600).map(|_| tokens[wm.step(&tokens, &probs)]).collect();

        // A null stream: independent pseudo-random tokens, no key involved.
        let null: Vec<u32> = (0..600u32)
            .map(|i| (hash::mix64(i as u64 ^ 0xFEED) % vocab as u64) as u32)
            .collect();

        let detect = |t: &[u32]| match scheme {
            Scheme::Tournament => detect_tournament(t, cfg),
            Scheme::TournamentNd => detect_tournament_nd(t, cfg),
            Scheme::Gumbel => detect_gumbel(t, cfg),
        };
        (detect(&watermarked), detect(&null))
    }

    #[test]
    fn tournament_end_to_end() {
        let (wm, null) = run_scheme(Scheme::Tournament);
        assert!(wm.is_watermarked(1e-6), "watermarked text not detected: z={}", wm.z_score);
        assert!(!null.is_watermarked(1e-6), "null text false-positive: z={}", null.z_score);
        assert!(wm.z_score > null.z_score + 5.0);
    }

    #[test]
    fn gumbel_end_to_end() {
        let (wm, null) = run_scheme(Scheme::Gumbel);
        assert!(wm.is_watermarked(1e-6), "watermarked text not detected: z={}", wm.z_score);
        assert!(!null.is_watermarked(1e-6), "null text false-positive: z={}", null.z_score);
        assert!(wm.z_score > null.z_score + 5.0);
    }

    #[test]
    fn tournament_nd_end_to_end() {
        let vocab = 128u32;
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"nd")).with_layers(6);
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs = vec![1.0f32 / vocab as f32; vocab as usize];
        let mut wm = Watermarker::new(cfg, Scheme::TournamentNd);
        let watermarked: Vec<u32> = (0..600).map(|_| tokens[wm.step(&tokens, &probs)]).collect();
        let null: Vec<u32> = (0..600u32).map(|i| (hash::mix64(i as u64 ^ 0xBEEF) % vocab as u64) as u32).collect();
        let wm_r = detect_tournament_nd(&watermarked, cfg);
        let null_r = detect_tournament_nd(&null, cfg);
        assert!(wm_r.is_watermarked(1e-6), "TournamentNd not detected: z={}", wm_r.z_score);
        assert!(!null_r.is_watermarked(1e-6), "TournamentNd null false-positive: z={}", null_r.z_score);
    }

    #[test]
    fn wrong_key_does_not_detect() {
        // Detection with a DIFFERENT key must see nothing — the watermark is
        // key-specific (one provider's mark is invisible to another's detector).
        let vocab = 128u32;
        let gen_cfg = WatermarkConfig::new(WatermarkKey(1)).with_layers(6);
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs = vec![1.0f32 / vocab as f32; vocab as usize];
        let mut wm = Watermarker::new(gen_cfg, Scheme::Gumbel);
        let stream: Vec<u32> = (0..600).map(|_| tokens[wm.step(&tokens, &probs)]).collect();

        let wrong_cfg = WatermarkConfig::new(WatermarkKey(2)).with_layers(6);
        let r = detect_gumbel(&stream, wrong_cfg);
        assert!(!r.is_watermarked(1e-6), "detected under the wrong key: z={}", r.z_score);
    }
}
