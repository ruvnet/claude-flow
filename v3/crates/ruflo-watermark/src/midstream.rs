//! MidStream — **inflight analysis** of a live watermarked token stream.
//!
//! Inspired by `ruvnet/midstream` ("real-time LLM streaming with inflight
//! analysis", crates.io 0.2.0) and its `temporal-compare` / `nanosecond-scheduler`
//! primitives. Those crates target native servers (and `quic-multistream`, the
//! transport piece named in rupixel ADR-266, is not published); this module
//! re-expresses the *WASM-safe, transport-free* capabilities natively so the
//! watermark crate keeps its no-dependency, browser-ready core. QUIC transport
//! and multi-feed fan-in belong in the gateway tier (ADR-387), not here.
//!
//! The headline is **online detection**: where [`crate::detect`] scores a
//! finished sequence, [`InflightDetector`] scores it *one token at a time*,
//! maintaining running statistics so a serving system knows the watermark's
//! strength **while the text is still being generated** — same statistic, same
//! z-score, no second pass. [`MidStream`] fuses generation ([`StreamProxy`]) and
//! inflight detection into a single object: feed it logits, get back the
//! watermarked token *and* the live confidence.
//!
//! Two lighter primitives ride along:
//! * [`TemporalWindow`] — rolling n-gram redundancy ("temporal-compare"-style):
//!   flags low-novelty spans where repeated context masks the mark.
//! * [`Backpressure`] — a bounded in-flight window ("nanosecond-scheduler"-style
//!   pacing): signals a slow consumer so the producer can throttle.
//!
//! ```
//! use ruflo_watermark::{MidStream, ProxyConfig, WatermarkConfig, WatermarkKey, Scheme};
//!
//! let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"secret")).with_layers(6);
//! let mut ms = MidStream::new(cfg, Scheme::Gumbel, ProxyConfig::default(), 64);
//! let logits = vec![0.0f32; 128];
//! let ev = ms.push_logits(&logits);      // watermark one token + analyze it
//! let _token = ev.token;
//! let _live_z = ev.z_score;              // watermark confidence so far
//! ```

use crate::context::{ContextTracker, WatermarkConfig};
use crate::detect::{normal_upper_tail, DetectionResult, Scheme};
use crate::gumbel::score_term;
use crate::hash::{g_bit, g_unit};
use crate::proxy::{ProxyConfig, StreamProxy};

/// Online watermark detector: `push` one emitted token at a time; `result()`
/// (or [`Self::z_score`]) reports the current evidence. Feeding it the full
/// sequence yields **exactly** the same statistic as the batch detector in
/// [`crate::detect`] — it is that loop, exposed incrementally.
pub struct InflightDetector {
    tracker: ContextTracker,
    scheme: Scheme,
    depth: u32,
    sum: f64,  // Gumbel score-sum / TournamentNd centered-sum
    ones: u64, // Tournament g-bit ones
    scored: usize,
}

impl InflightDetector {
    /// Build a detector matching a generator's `cfg` and `scheme`.
    pub fn new(cfg: WatermarkConfig, scheme: Scheme) -> Self {
        let depth = cfg.layers.max(1);
        InflightDetector {
            tracker: ContextTracker::new(cfg),
            scheme,
            depth,
            sum: 0.0,
            ones: 0,
            scored: 0,
        }
    }

    /// Feed the next emitted token id. Advances the rolling context and, if this
    /// position is watermarked (unmasked), accumulates its detection contribution.
    pub fn push(&mut self, tok: u32) {
        let ps = self.tracker.peek();
        if ps.watermarked {
            match self.scheme {
                Scheme::Gumbel => self.sum += score_term(ps.seed, tok),
                Scheme::Tournament => {
                    for layer in 1..=self.depth {
                        if g_bit(ps.seed, tok, layer) {
                            self.ones += 1;
                        }
                    }
                }
                Scheme::TournamentNd => {
                    for layer in 1..=self.depth {
                        self.sum += g_unit(ps.seed, tok, layer) - 0.5;
                    }
                }
            }
            self.scored += 1;
        }
        self.tracker.advance(ps, tok);
    }

    /// Positions scored (watermarked) so far. Detection power grows with this.
    pub fn scored(&self) -> usize {
        self.scored
    }

    /// Current standardized evidence (z-score) from the accumulated statistic.
    pub fn z_score(&self) -> f64 {
        self.result().z_score
    }

    /// Full detection result computed from the current running state.
    pub fn result(&self) -> DetectionResult {
        match self.scheme {
            Scheme::Gumbel => {
                let n = self.scored as f64;
                let std = n.sqrt();
                let z = if std > 0.0 { (self.sum - n) / std } else { 0.0 };
                let (p, lp) = normal_upper_tail(z);
                DetectionResult {
                    scheme: Scheme::Gumbel,
                    scored_positions: self.scored,
                    statistic: self.sum,
                    null_mean: n,
                    z_score: z,
                    p_value: p,
                    log10_p: lp,
                }
            }
            Scheme::Tournament => {
                let n = (self.scored as u64 * self.depth as u64) as f64;
                let null_mean = 0.5 * n;
                let std = (0.25 * n).sqrt();
                let z = if std > 0.0 {
                    (self.ones as f64 - null_mean) / std
                } else {
                    0.0
                };
                let (p, lp) = normal_upper_tail(z);
                DetectionResult {
                    scheme: Scheme::Tournament,
                    scored_positions: self.scored,
                    statistic: self.ones as f64,
                    null_mean,
                    z_score: z,
                    p_value: p,
                    log10_p: lp,
                }
            }
            Scheme::TournamentNd => {
                let n = (self.scored as u64 * self.depth as u64) as f64;
                let std = (n / 12.0).sqrt();
                let z = if std > 0.0 { self.sum / std } else { 0.0 };
                let (p, lp) = normal_upper_tail(z);
                DetectionResult {
                    scheme: Scheme::TournamentNd,
                    scored_positions: self.scored,
                    statistic: self.sum,
                    null_mean: 0.0,
                    z_score: z,
                    p_value: p,
                    log10_p: lp,
                }
            }
        }
    }
}

/// Rolling n-gram redundancy detector ("temporal-compare"-style, WASM-safe).
/// Reports whether the token just pushed closes a repeated k-gram seen recently —
/// a proxy for low-novelty spans where the watermark carries little signal.
pub struct TemporalWindow {
    k: usize,
    window: usize,
    recent: Vec<u32>, // ring of the last `window` tokens (oldest-first, truncated)
    novel: u64,
    repeated: u64,
}

impl TemporalWindow {
    /// `k` = n-gram length to match on; `window` = how far back to look.
    pub fn new(k: usize, window: usize) -> Self {
        TemporalWindow {
            k: k.max(1),
            window: window.max(k),
            recent: Vec::new(),
            novel: 0,
            repeated: 0,
        }
    }

    /// Push a token; returns `true` if it is **novel** (its trailing k-gram was
    /// not already present earlier in the window), `false` if it repeats one.
    pub fn push(&mut self, tok: u32) -> bool {
        self.recent.push(tok);
        if self.recent.len() > self.window {
            let overflow = self.recent.len() - self.window;
            self.recent.drain(0..overflow);
        }
        let n = self.recent.len();
        let is_novel = if n < self.k {
            true
        } else {
            let tail = &self.recent[n - self.k..n];
            // Search for an earlier occurrence of the same k-gram (excluding the
            // just-appended one at the very end).
            let mut found = false;
            if n > self.k {
                for start in 0..=(n - self.k - 1) {
                    if &self.recent[start..start + self.k] == tail {
                        found = true;
                        break;
                    }
                }
            }
            !found
        };
        if is_novel {
            self.novel += 1;
        } else {
            self.repeated += 1;
        }
        is_novel
    }

    /// Fraction of pushed tokens judged novel (1.0 = all novel). High redundancy
    /// (low novelty) predicts a weak watermark.
    pub fn novelty_ratio(&self) -> f64 {
        let total = self.novel + self.repeated;
        if total == 0 {
            1.0
        } else {
            self.novel as f64 / total as f64
        }
    }
}

/// Bounded in-flight window ("nanosecond-scheduler"-style pacing, WASM-safe).
/// Producer calls [`Self::produced`] per emitted token; consumer calls
/// [`Self::acked`] as it drains. [`Self::backpressure`] is `true` when the
/// unacked count has reached capacity — the signal to throttle the producer.
pub struct Backpressure {
    capacity: usize,
    inflight: usize,
}

impl Backpressure {
    pub fn new(capacity: usize) -> Self {
        Backpressure {
            capacity: capacity.max(1),
            inflight: 0,
        }
    }
    pub fn produced(&mut self) {
        self.inflight += 1;
    }
    pub fn acked(&mut self, n: usize) {
        self.inflight = self.inflight.saturating_sub(n);
    }
    pub fn inflight(&self) -> usize {
        self.inflight
    }
    /// `true` when the consumer is keeping up poorly and the producer should slow.
    pub fn backpressure(&self) -> bool {
        self.inflight >= self.capacity
    }
}

/// One inflight step: the watermarked token plus the live analysis after it.
#[derive(Clone, Copy, Debug)]
pub struct StreamEvent {
    /// The watermarked token id to emit.
    pub token: u32,
    /// Watermark evidence accumulated **through this token** (z-score).
    pub z_score: f64,
    /// Watermarked positions scored so far.
    pub scored: usize,
    /// Was this token novel (vs. a repeated k-gram)?
    pub novel: bool,
    /// Is the consumer behind (throttle signal)?
    pub backpressure: bool,
}

/// MidStream: generate a watermarked token stream and analyze it **inflight**,
/// in one pass. Wraps a [`StreamProxy`] (generation) + [`InflightDetector`]
/// (online detection, same key/scheme) + [`TemporalWindow`] + [`Backpressure`].
pub struct MidStream {
    proxy: StreamProxy,
    detector: InflightDetector,
    temporal: TemporalWindow,
    pressure: Backpressure,
}

impl MidStream {
    /// `cfg`/`scheme` drive both generation and the matched inflight detector;
    /// `pcfg` shapes the sampler (temperature/top-k/top-p); `capacity` is the
    /// backpressure window.
    pub fn new(cfg: WatermarkConfig, scheme: Scheme, pcfg: ProxyConfig, capacity: usize) -> Self {
        MidStream {
            proxy: StreamProxy::new(cfg, scheme, pcfg),
            detector: InflightDetector::new(cfg, scheme),
            temporal: TemporalWindow::new(3, 128),
            pressure: Backpressure::new(capacity),
        }
    }

    /// Full-vocab path: watermark one token from `logits`, analyze it, return the
    /// event. Advances generation, detection, redundancy, and backpressure.
    pub fn push_logits(&mut self, logits: &[f32]) -> StreamEvent {
        let token = self.proxy.push_logits(logits);
        self.finish(token)
    }

    /// Truncated (OpenAI-`top_logprobs`) path.
    pub fn push_topk(&mut self, ids: &[u32], logprobs: &[f32]) -> StreamEvent {
        let token = self.proxy.push_topk(ids, logprobs);
        self.finish(token)
    }

    fn finish(&mut self, token: u32) -> StreamEvent {
        self.detector.push(token);
        let novel = self.temporal.push(token);
        self.pressure.produced();
        StreamEvent {
            token,
            z_score: self.detector.z_score(),
            scored: self.detector.scored(),
            novel,
            backpressure: self.pressure.backpressure(),
        }
    }

    /// Consumer drained `n` tokens — relieve backpressure.
    pub fn ack(&mut self, n: usize) {
        self.pressure.acked(n);
    }

    /// Current watermark evidence over the whole stream so far.
    pub fn detection(&self) -> DetectionResult {
        self.detector.result()
    }
    /// Live z-score.
    pub fn z_score(&self) -> f64 {
        self.detector.z_score()
    }
    /// Fraction of tokens judged novel so far.
    pub fn novelty_ratio(&self) -> f64 {
        self.temporal.novelty_ratio()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detect::detect_gumbel;
    use crate::hash::WatermarkKey;
    use crate::{Scheme, Watermarker};

    #[test]
    fn inflight_matches_batch_detector() {
        // Generate a watermarked stream, then score it two ways: the batch
        // detector and the online InflightDetector. They must agree exactly.
        let vocab = 128u32;
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"inflight")).with_layers(6);
        let tokens: Vec<u32> = (0..vocab).collect();
        let probs = vec![1.0f32 / vocab as f32; vocab as usize];
        let mut wm = Watermarker::new(cfg, Scheme::Gumbel);
        let stream: Vec<u32> = (0..600).map(|_| tokens[wm.step(&tokens, &probs)]).collect();

        let batch = detect_gumbel(&stream, cfg);
        let mut online = InflightDetector::new(cfg, Scheme::Gumbel);
        for &t in &stream {
            online.push(t);
        }
        let live = online.result();
        assert_eq!(online.scored(), batch.scored_positions);
        assert!(
            (live.z_score - batch.z_score).abs() < 1e-9,
            "online z {} != batch z {}",
            live.z_score,
            batch.z_score
        );
    }

    #[test]
    fn inflight_confidence_grows_monotonically_ish() {
        // On watermarked text the live z-score should climb into strong territory.
        let vocab = 128u32;
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"grow")).with_layers(6);
        let mut ms = MidStream::new(cfg, Scheme::Gumbel, ProxyConfig::default(), 64);
        let logits = vec![0.0f32; vocab as usize];
        let mut z_at_100 = 0.0;
        for i in 0..600 {
            let ev = ms.push_logits(&logits);
            if i == 99 {
                z_at_100 = ev.z_score;
            }
        }
        let z_final = ms.z_score();
        assert!(z_final > 6.0, "final z too weak: {z_final}");
        assert!(z_final > z_at_100, "z should grow with length: {z_at_100} -> {z_final}");
        assert!(ms.detection().is_watermarked(1e-6));
    }

    #[test]
    fn temporal_window_flags_repeats() {
        let mut tw = TemporalWindow::new(3, 64);
        // Novel prefix.
        for t in [1u32, 2, 3, 4, 5] {
            assert!(tw.push(t));
        }
        // Repeat the 3-gram [3,4,5] -> the closing token should be non-novel.
        tw.push(3);
        tw.push(4);
        let novel = tw.push(5); // closes k-gram [3,4,5] which appeared earlier
        assert!(!novel, "repeated k-gram should be flagged non-novel");
        assert!(tw.novelty_ratio() < 1.0);
    }

    #[test]
    fn backpressure_signals_when_consumer_lags() {
        let mut ms = MidStream::new(
            WatermarkConfig::new(WatermarkKey::from_bytes(b"bp")),
            Scheme::Gumbel,
            ProxyConfig::default(),
            4,
        );
        let logits = vec![0.0f32; 64];
        let mut hit = false;
        for _ in 0..10 {
            if ms.push_logits(&logits).backpressure {
                hit = true;
                break;
            }
        }
        assert!(hit, "backpressure never signalled with a small capacity");
        ms.ack(10);
        assert!(!ms.push_logits(&logits).backpressure, "ack should relieve backpressure");
    }
}
