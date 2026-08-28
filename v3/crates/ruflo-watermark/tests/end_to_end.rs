//! Black-box integration tests over the public API only — the shape a real
//! host (ruflo/metaharness) consumes.

use ruflo_watermark::{
    detect_gumbel, detect_tournament, robustness, Scheme, WatermarkConfig, WatermarkKey,
    Watermarker,
};

fn flat_candidates(vocab: u32) -> (Vec<u32>, Vec<f32>) {
    ((0..vocab).collect(), vec![1.0f32 / vocab as f32; vocab as usize])
}

fn generate(scheme: Scheme, cfg: WatermarkConfig, n: usize, vocab: u32) -> Vec<u32> {
    let (tokens, probs) = flat_candidates(vocab);
    let mut wm = Watermarker::new(cfg, scheme);
    (0..n).map(|_| tokens[wm.step(&tokens, &probs)]).collect()
}

#[test]
fn short_text_is_weaker_than_long_text() {
    // Anthropic's caveat: detection confidence grows with length. Verify the
    // z-score for a long watermarked stream exceeds that of a short one.
    let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"len-test")).with_layers(6);
    let short = generate(Scheme::Tournament, cfg, 40, 128);
    let long = generate(Scheme::Tournament, cfg, 1000, 128);
    let zs = detect_tournament(&short, cfg).z_score;
    let zl = detect_tournament(&long, cfg).z_score;
    assert!(zl > zs, "long text ({zl}) not stronger than short ({zs})");
}

#[test]
fn factual_low_entropy_text_carries_little_watermark() {
    // Where there is only one plausible next token (near-deterministic p), the
    // watermark has nothing to ride — mirroring the "Principia Mathematica" and
    // code examples. A near-one-hot distribution should yield a weak signal.
    let cfg = WatermarkConfig::new(WatermarkKey(5)).with_layers(6);
    let vocab = 128u32;
    let tokens: Vec<u32> = (0..vocab).collect();
    // 99.9% mass on token 0: almost no low-stakes choice at any position.
    let mut probs = vec![0.001f32 / (vocab as f32 - 1.0); vocab as usize];
    probs[0] = 0.999;
    let mut wm = Watermarker::new(cfg, Scheme::Tournament);
    let stream: Vec<u32> = (0..800).map(|_| tokens[wm.step(&tokens, &probs)]).collect();
    let r = detect_tournament(&stream, cfg);
    // Far weaker than the flat-distribution case (which clears z>6 in unit tests).
    assert!(r.z_score < 4.0, "low-entropy text unexpectedly strong: z={}", r.z_score);
}

#[test]
fn deletion_attack_degrades_but_is_measured() {
    // Deletion desynchronizes contexts — a harder attack. The harness must still
    // return a finite, lower detection result (measurement, not a crash).
    let cfg = WatermarkConfig::new(WatermarkKey(9)).with_layers(6);
    let vocab = 128u32;
    let stream = generate(Scheme::Gumbel, cfg, 1000, vocab);
    let clean = detect_gumbel(&stream, cfg).z_score;
    let attacked = robustness::attack_delete(&stream, 0.3, 0xBEEF);
    let after = detect_gumbel(&attacked, cfg).z_score;
    assert!(after.is_finite());
    assert!(after < clean, "deletion did not reduce detectability: {clean} -> {after}");
}

#[test]
fn all_schemes_detect_their_own_output() {
    use ruflo_watermark::detect_tournament_nd;
    for scheme in [Scheme::Tournament, Scheme::TournamentNd, Scheme::Gumbel] {
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"own")).with_layers(6);
        let stream = generate(scheme, cfg, 600, 128);
        let r = match scheme {
            Scheme::Tournament => detect_tournament(&stream, cfg),
            Scheme::TournamentNd => detect_tournament_nd(&stream, cfg),
            Scheme::Gumbel => detect_gumbel(&stream, cfg),
        };
        assert!(r.is_watermarked(1e-6), "{scheme:?} failed to detect its own output: z={}", r.z_score);
    }
}
