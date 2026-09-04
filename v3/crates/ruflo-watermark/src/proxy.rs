//! Ultra-low-latency streaming watermark **proxy**.
//!
//! Drops into an LLM decode loop between the model's per-step output and the
//! emitted token. Where [`crate::Watermarker::step`] expects an already
//! normalized probability slice over a caller-chosen candidate set, the proxy
//! accepts the raw **logits** a serving stack actually produces and does the
//! sampler-shaping the host would otherwise do — temperature, top-k, top-p
//! (nucleus) — so the watermark rides *exactly* the candidate set the model
//! would have sampled from. No distribution surprises, no extra tokens.
//!
//! "Ultra-low-latency" is a concrete claim, not a slogan:
//!
//! * **Allocation-free after warmup.** All scratch (candidate ids, logits,
//!   probs) lives in reusable buffers on the struct; each step `clear()`s them,
//!   keeping capacity. After the first step no heap traffic occurs.
//! * **Linear candidate selection.** Top-k uses `select_nth_unstable` (O(V)),
//!   not a full sort, so the per-step cost on top of the softmax you already run
//!   is bounded and small.
//! * **Same primitive as detection.** g-values key on the emitted *token id*,
//!   so a stream produced through the proxy detects identically to one produced
//!   through [`crate::Watermarker`] — the proxy is a front-end, not a new scheme.
//!
//! ## Two entry points
//!
//! * [`StreamProxy::push_logits`] — full-vocab logits (local serving: vLLM,
//!   llama.cpp, Candle, a custom sampler). The proxy applies temperature and
//!   truncation itself.
//! * [`StreamProxy::push_topk`] — you already hold a *truncated* candidate set
//!   with logprobs (e.g. an OpenAI-compatible API returning `top_logprobs`).
//!   The proxy watermarks that set directly, re-selecting the token to emit.
//!
//! ```
//! use ruflo_watermark::{StreamProxy, ProxyConfig, WatermarkConfig,
//!                       WatermarkKey, Scheme};
//!
//! let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"secret"));
//! let mut proxy = StreamProxy::new(cfg, Scheme::Gumbel,
//!     ProxyConfig { temperature: 1.0, top_k: 40, top_p: 1.0 });
//!
//! // Each decode step: hand the proxy the model's logits, get the token to emit.
//! let logits = vec![0.1f32, 2.0, 1.3, /* … one per vocab id … */];
//! let token_id = proxy.push_logits(&logits);
//! # let _ = token_id;
//! ```

use crate::context::WatermarkConfig;
use crate::{Scheme, Watermarker};

/// Sampler shaping the proxy applies to logits before watermarking, matching a
/// host decoder so the mark rides the true candidate set.
#[derive(Clone, Copy, Debug)]
pub struct ProxyConfig {
    /// Softmax temperature. `1.0` = model's native distribution; `<1` sharper,
    /// `>1` flatter. Clamped to a small positive floor.
    pub temperature: f32,
    /// Keep only the `top_k` highest-logit candidates (`0` = keep all).
    pub top_k: usize,
    /// Nucleus threshold: keep the smallest set of top candidates whose
    /// probability mass reaches `top_p` (`>= 1.0` = disabled).
    pub top_p: f32,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        ProxyConfig { temperature: 1.0, top_k: 0, top_p: 1.0 }
    }
}

/// A streaming watermark proxy over a decode loop. See the module docs.
pub struct StreamProxy {
    wm: Watermarker,
    pcfg: ProxyConfig,
    // Reusable scratch — grows to vocab once, then allocation-free.
    ids: Vec<u32>,
    logits: Vec<f32>,
    probs: Vec<f32>,
    pairs: Vec<(f32, u32)>, // top-k selection scratch
    order: Vec<u32>,        // top-p ranking scratch
    steps: u64,
}

impl StreamProxy {
    /// Build a proxy from a watermark config, scheme, and sampler shaping.
    pub fn new(cfg: WatermarkConfig, scheme: Scheme, pcfg: ProxyConfig) -> Self {
        StreamProxy {
            wm: Watermarker::new(cfg, scheme),
            pcfg,
            ids: Vec::new(),
            logits: Vec::new(),
            probs: Vec::new(),
            pairs: Vec::new(),
            order: Vec::new(),
            steps: 0,
        }
    }

    /// Number of tokens emitted so far.
    pub fn steps(&self) -> u64 {
        self.steps
    }

    /// The active sampler shaping.
    pub fn config(&self) -> &ProxyConfig {
        &self.pcfg
    }

    /// Full-vocab path: `logits[i]` is the model's logit for token id `i`.
    /// Applies temperature + top-k/top-p, watermarks the resulting candidate
    /// set, and returns the **token id** to emit. Advances the rolling context.
    pub fn push_logits(&mut self, logits: &[f32]) -> u32 {
        // 1. Candidate id set (top-k selection over indices, or all).
        self.ids.clear();
        self.logits.clear();
        let inv_t = 1.0 / self.pcfg.temperature.max(1e-4);

        if self.pcfg.top_k > 0 && self.pcfg.top_k < logits.len() {
            // O(V) partial selection: gather (logit, id) into persistent scratch,
            // select_nth on the k-th so the k largest occupy pairs[..k].
            let k = self.pcfg.top_k;
            self.pairs.clear();
            for (i, &l) in logits.iter().enumerate() {
                self.pairs.push((l, i as u32));
            }
            self.pairs.select_nth_unstable_by(k - 1, |a, b| {
                b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
            });
            for &(l, id) in self.pairs.iter().take(k) {
                self.ids.push(id);
                self.logits.push(l * inv_t);
            }
        } else {
            for (i, &l) in logits.iter().enumerate() {
                self.ids.push(i as u32);
                self.logits.push(l * inv_t);
            }
        }

        self.softmax_into_probs();
        self.apply_top_p();
        self.emit()
    }

    /// Truncated path: you already hold a candidate set of `(token_id, logprob)`
    /// (e.g. an OpenAI `top_logprobs` slice). The proxy softmaxes the logprobs
    /// (temperature applied), optionally top-p filters, watermarks, and returns
    /// the token id to emit. `top_k` is ignored here — the set is already small.
    pub fn push_topk(&mut self, token_ids: &[u32], logprobs: &[f32]) -> u32 {
        debug_assert_eq!(token_ids.len(), logprobs.len());
        self.ids.clear();
        self.logits.clear();
        let inv_t = 1.0 / self.pcfg.temperature.max(1e-4);
        for (&id, &lp) in token_ids.iter().zip(logprobs) {
            self.ids.push(id);
            self.logits.push(lp * inv_t);
        }
        self.softmax_into_probs();
        self.apply_top_p();
        self.emit()
    }

    /// Numerically-stable softmax of `self.logits` into `self.probs`.
    fn softmax_into_probs(&mut self) {
        self.probs.clear();
        let max = self
            .logits
            .iter()
            .copied()
            .fold(f32::NEG_INFINITY, f32::max);
        let mut sum = 0.0f32;
        for &l in &self.logits {
            let e = (l - max).exp();
            self.probs.push(e);
            sum += e;
        }
        if sum > 0.0 {
            let inv = 1.0 / sum;
            for p in &mut self.probs {
                *p *= inv;
            }
        }
    }

    /// Nucleus (top-p) truncation over the current candidate set. Candidates
    /// outside the nucleus have their probability zeroed (never sampled, and
    /// invisible to the id-keyed g-values); the kept mass is renormalized.
    /// `ids`/`probs` stay the same length and aligned, so no reallocation.
    /// No-op when `top_p >= 1`. Uses the persistent `order` scratch buffer.
    fn apply_top_p(&mut self) {
        if self.pcfg.top_p >= 1.0 || self.probs.len() <= 1 {
            return;
        }
        let n = self.probs.len();
        self.order.clear();
        for i in 0..n {
            self.order.push(i as u32);
        }
        // Rank candidate indices by descending probability.
        let probs = &self.probs;
        self.order.sort_unstable_by(|&a, &b| {
            probs[b as usize]
                .partial_cmp(&probs[a as usize])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        // Walk the ranking until cumulative mass reaches top_p; that prefix is
        // the nucleus. Sum the kept mass in the same pass.
        let mut cum = 0.0f32;
        let mut keep = 0usize;
        for (rank, &oi) in self.order.iter().enumerate() {
            cum += self.probs[oi as usize];
            keep = rank + 1;
            if cum >= self.pcfg.top_p {
                break;
            }
        }
        let inv = if cum > 0.0 { 1.0 / cum } else { 1.0 };
        // Zero the tail, renormalize the nucleus — in place.
        for (rank, &oi) in self.order.iter().enumerate() {
            self.probs[oi as usize] = if rank < keep {
                self.probs[oi as usize] * inv
            } else {
                0.0
            };
        }
    }

    /// Watermark-select from the current `(ids, probs)` and advance context.
    fn emit(&mut self) -> u32 {
        let idx = self.wm.step(&self.ids, &self.probs);
        self.steps += 1;
        self.ids[idx]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detect::{detect_gumbel, detect_tournament};
    use crate::hash::WatermarkKey;

    fn uniform_logits(v: usize) -> Vec<f32> {
        vec![0.0f32; v]
    }

    #[test]
    fn proxy_stream_is_detected() {
        // A stream produced through the proxy must detect just like the raw
        // Watermarker — the proxy is a front-end, not a new scheme.
        let vocab = 128usize;
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"proxy")).with_layers(6);
        let mut proxy = StreamProxy::new(cfg, Scheme::Gumbel, ProxyConfig::default());
        let logits = uniform_logits(vocab);
        let stream: Vec<u32> = (0..600).map(|_| proxy.push_logits(&logits)).collect();
        let r = detect_gumbel(&stream, cfg);
        assert!(r.is_watermarked(1e-6), "proxy stream not detected: z={}", r.z_score);
        assert_eq!(proxy.steps(), 600);
    }

    #[test]
    fn topk_shaping_still_detects() {
        let vocab = 256usize;
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"tk")).with_layers(6);
        let mut proxy = StreamProxy::new(
            cfg,
            Scheme::Tournament,
            ProxyConfig { temperature: 0.8, top_k: 40, top_p: 0.95 },
        );
        // Mildly non-uniform logits so top-k/top-p actually bite.
        let logits: Vec<f32> = (0..vocab).map(|i| ((i % 17) as f32) * 0.1).collect();
        let stream: Vec<u32> = (0..800).map(|_| proxy.push_logits(&logits)).collect();
        // Every emitted id must be a real vocab id.
        assert!(stream.iter().all(|&t| (t as usize) < vocab));
        let r = detect_tournament(&stream, cfg);
        assert!(r.is_watermarked(1e-6), "top-k proxy stream not detected: z={}", r.z_score);
    }

    #[test]
    fn push_topk_matches_candidate_ids() {
        // The OpenAI-logprobs path: emitted token must come from the supplied set.
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"api")).with_layers(1);
        let mut proxy = StreamProxy::new(cfg, Scheme::Gumbel, ProxyConfig::default());
        let ids = [7u32, 42, 100, 3];
        let logprobs = [-0.2f32, -0.4, -0.9, -1.1];
        for _ in 0..50 {
            let t = proxy.push_topk(&ids, &logprobs);
            assert!(ids.contains(&t), "emitted id {t} not in candidate set");
        }
    }

    #[test]
    fn allocation_free_after_warmup() {
        // Capacity of scratch buffers must not grow after the first full-vocab
        // step — the allocation-free-after-warmup guarantee.
        let vocab = 512usize;
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"warm"));
        // Exercise the heaviest path: temperature + top-k + top-p all active.
        let mut proxy = StreamProxy::new(
            cfg,
            Scheme::Gumbel,
            ProxyConfig { temperature: 0.9, top_k: 64, top_p: 0.9 },
        );
        // Non-uniform so top-p actually truncates.
        let logits: Vec<f32> = (0..vocab).map(|i| ((i % 23) as f32) * 0.13).collect();
        proxy.push_logits(&logits);
        let caps = (
            proxy.ids.capacity(),
            proxy.logits.capacity(),
            proxy.probs.capacity(),
            proxy.pairs.capacity(),
            proxy.order.capacity(),
        );
        for _ in 0..200 {
            proxy.push_logits(&logits);
        }
        assert_eq!(proxy.ids.capacity(), caps.0, "ids buffer reallocated");
        assert_eq!(proxy.logits.capacity(), caps.1, "logits buffer reallocated");
        assert_eq!(proxy.probs.capacity(), caps.2, "probs buffer reallocated");
        assert_eq!(proxy.pairs.capacity(), caps.3, "pairs buffer reallocated");
        assert_eq!(proxy.order.capacity(), caps.4, "order buffer reallocated");
    }
}
