//! WASM bindings (`--features wasm --target wasm32-unknown-unknown`).
//!
//! A thin, allocation-light surface over the core so JS/TS hosts (ruflo,
//! metaharness) can watermark a token stream and detect from a browser or Node
//! without a native addon. Token/probability slices marshal as typed arrays
//! (`Uint32Array` / `Float32Array`); detection results are a small struct with
//! getters.
//!
//! Schemes are selected by string: `"tournament"`, `"tournament_nd"`, or
//! `"gumbel"`. Detectors exposed: the per-scheme detector, the indel-robust
//! self-sync detector, and the exact-Gamma short-text detector (Gumbel).

use wasm_bindgen::prelude::*;

use crate::context::WatermarkConfig;
use crate::hash::WatermarkKey;
use crate::midstream::MidStream;
use crate::proxy::{ProxyConfig, StreamProxy};
use crate::{Scheme, Watermarker};

fn cfg_from(material: &[u8], context_width: usize, layers: u32) -> WatermarkConfig {
    WatermarkConfig::new(WatermarkKey::from_bytes(material))
        .with_context_width(context_width)
        .with_layers(layers)
}

fn scheme_of(scheme: &str) -> Scheme {
    match scheme {
        "tournament" => Scheme::Tournament,
        "tournament_nd" => Scheme::TournamentNd,
        _ => Scheme::Gumbel, // default: distortion-free
    }
}

/// Streaming watermarked sampler, JS-facing.
#[wasm_bindgen]
pub struct WasmWatermarker {
    inner: Watermarker,
}

#[wasm_bindgen]
impl WasmWatermarker {
    /// `key_material`: arbitrary secret bytes (e.g. a hex string's bytes).
    /// `scheme`: `"tournament"` | `"tournament_nd"` | `"gumbel"` (default gumbel).
    #[wasm_bindgen(constructor)]
    pub fn new(key_material: &[u8], context_width: usize, layers: u32, scheme: &str) -> WasmWatermarker {
        let cfg = cfg_from(key_material, context_width, layers);
        WasmWatermarker {
            inner: Watermarker::new(cfg, scheme_of(scheme)),
        }
    }

    /// Emit one token: returns the index into `tokens`/`probs` of the chosen
    /// candidate. Advances the rolling context.
    pub fn step(&mut self, tokens: &[u32], probs: &[f32]) -> usize {
        self.inner.step(tokens, probs)
    }
}

/// Detection result, JS-facing (fields via getters).
#[wasm_bindgen]
pub struct WasmDetection {
    scored_positions: usize,
    z_score: f64,
    p_value: f64,
    log10_p: f64,
}

#[wasm_bindgen]
impl WasmDetection {
    #[wasm_bindgen(getter)]
    pub fn scored_positions(&self) -> usize {
        self.scored_positions
    }
    #[wasm_bindgen(getter)]
    pub fn z_score(&self) -> f64 {
        self.z_score
    }
    #[wasm_bindgen(getter)]
    pub fn p_value(&self) -> f64 {
        self.p_value
    }
    #[wasm_bindgen(getter)]
    pub fn log10_p(&self) -> f64 {
        self.log10_p
    }
}

impl From<crate::detect::DetectionResult> for WasmDetection {
    fn from(r: crate::detect::DetectionResult) -> Self {
        WasmDetection {
            scored_positions: r.scored_positions,
            z_score: r.z_score,
            p_value: r.p_value,
            log10_p: r.log10_p,
        }
    }
}

/// Detect a watermark over an emitted token id sequence, using the named scheme.
#[wasm_bindgen]
pub fn detect(
    tokens: &[u32],
    key_material: &[u8],
    context_width: usize,
    layers: u32,
    scheme: &str,
) -> WasmDetection {
    let cfg = cfg_from(key_material, context_width, layers);
    match scheme_of(scheme) {
        Scheme::Tournament => crate::detect::detect_tournament(tokens, cfg),
        Scheme::TournamentNd => crate::detect::detect_tournament_nd(tokens, cfg),
        Scheme::Gumbel => crate::detect::detect_gumbel(tokens, cfg),
    }
    .into()
}

/// Indel-robust detection (Gumbel self-sync): far stronger than the standard
/// detector on edited / repetitive text. See `align.rs`.
#[wasm_bindgen]
pub fn detect_selfsync(tokens: &[u32], key_material: &[u8], context_width: usize) -> WasmDetection {
    let cfg = cfg_from(key_material, context_width, 1);
    crate::align::detect_gumbel_selfsync(tokens, cfg).into()
}

/// Exact-null short-text detection (Gumbel, exact Gamma tail): correct p-values
/// at small token counts where the normal approximation misleads. See `bayes.rs`.
#[wasm_bindgen]
pub fn detect_exact(tokens: &[u32], key_material: &[u8], context_width: usize) -> WasmDetection {
    let cfg = cfg_from(key_material, context_width, 1);
    crate::bayes::detect_gumbel_exact(tokens, cfg).into()
}

/// Ultra-low-latency streaming watermark **proxy**, JS-facing.
///
/// Wraps [`StreamProxy`]: feed it a decode step's **logits** (or a truncated
/// top-k `(ids, logprobs)` set from an OpenAI-compatible API) and it returns
/// the watermarked **token id** to emit, applying temperature + top-k/top-p to
/// match the host sampler. Scratch buffers are reused, so per-step cost is a
/// fixed amount on top of the sampler you already run.
#[wasm_bindgen]
pub struct WasmStreamProxy {
    inner: StreamProxy,
}

#[wasm_bindgen]
impl WasmStreamProxy {
    /// `key_material`: secret bytes. `scheme`: `"tournament"` | `"tournament_nd"`
    /// | `"gumbel"`. `temperature` (>0), `top_k` (0 = all), `top_p` (>=1 = off)
    /// shape the candidate set exactly as the host decoder would.
    #[wasm_bindgen(constructor)]
    pub fn new(
        key_material: &[u8],
        context_width: usize,
        layers: u32,
        scheme: &str,
        temperature: f32,
        top_k: usize,
        top_p: f32,
    ) -> WasmStreamProxy {
        let cfg = cfg_from(key_material, context_width, layers);
        let pcfg = ProxyConfig { temperature, top_k, top_p };
        WasmStreamProxy {
            inner: StreamProxy::new(cfg, scheme_of(scheme), pcfg),
        }
    }

    /// Full-vocab path: `logits[i]` is the logit for token id `i`. Returns the
    /// watermarked token id to emit and advances the rolling context.
    pub fn push_logits(&mut self, logits: &[f32]) -> u32 {
        self.inner.push_logits(logits)
    }

    /// Truncated path: watermark an already-small candidate set of
    /// `(token_ids, logprobs)` (e.g. OpenAI `top_logprobs`). Returns the token
    /// id to emit. `top_k` is ignored; the set is already truncated.
    pub fn push_topk(&mut self, token_ids: &[u32], logprobs: &[f32]) -> u32 {
        self.inner.push_topk(token_ids, logprobs)
    }

    /// Tokens emitted so far.
    #[wasm_bindgen(getter)]
    pub fn steps(&self) -> u32 {
        self.inner.steps() as u32
    }
}

/// MidStream — inflight analysis of a live watermarked stream, JS-facing.
///
/// Wraps [`MidStream`]: `push_logits` (or `push_topk`) watermarks one token and
/// analyzes it in the same pass. After each call the getters report the live
/// watermark confidence (`z_score`), scored positions, novelty, and backpressure —
/// so a serving loop knows the mark's strength *while* it generates.
#[wasm_bindgen]
pub struct WasmMidStream {
    inner: MidStream,
    last_token: u32,
    last_novel: bool,
    last_bp: bool,
}

#[wasm_bindgen]
impl WasmMidStream {
    /// Same shaping args as `WasmStreamProxy`, plus `capacity` = the backpressure
    /// window (unacked tokens before the throttle signal fires).
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        key_material: &[u8],
        context_width: usize,
        layers: u32,
        scheme: &str,
        temperature: f32,
        top_k: usize,
        top_p: f32,
        capacity: usize,
    ) -> WasmMidStream {
        let cfg = cfg_from(key_material, context_width, layers);
        let pcfg = ProxyConfig { temperature, top_k, top_p };
        WasmMidStream {
            inner: MidStream::new(cfg, scheme_of(scheme), pcfg, capacity.max(1)),
            last_token: 0,
            last_novel: true,
            last_bp: false,
        }
    }

    /// Watermark + analyze one full-vocab-logits step. Returns the token id;
    /// read `z_score` / `scored` / `novel` / `backpressure` for the live analysis.
    pub fn push_logits(&mut self, logits: &[f32]) -> u32 {
        let ev = self.inner.push_logits(logits);
        self.last_token = ev.token;
        self.last_novel = ev.novel;
        self.last_bp = ev.backpressure;
        ev.token
    }

    /// Watermark + analyze one truncated `(ids, logprobs)` step.
    pub fn push_topk(&mut self, token_ids: &[u32], logprobs: &[f32]) -> u32 {
        let ev = self.inner.push_topk(token_ids, logprobs);
        self.last_token = ev.token;
        self.last_novel = ev.novel;
        self.last_bp = ev.backpressure;
        ev.token
    }

    /// Consumer drained `n` tokens — relieve backpressure.
    pub fn ack(&mut self, n: usize) {
        self.inner.ack(n);
    }

    /// Live watermark evidence over the stream so far.
    #[wasm_bindgen(getter)]
    pub fn z_score(&self) -> f64 {
        self.inner.z_score()
    }
    /// Watermarked positions scored so far.
    #[wasm_bindgen(getter)]
    pub fn scored(&self) -> usize {
        self.inner.detection().scored_positions
    }
    /// `log10(p_value)` of the current evidence.
    #[wasm_bindgen(getter)]
    pub fn log10_p(&self) -> f64 {
        self.inner.detection().log10_p
    }
    /// Fraction of tokens judged novel (low ⇒ repetitive ⇒ weak mark).
    #[wasm_bindgen(getter)]
    pub fn novelty_ratio(&self) -> f64 {
        self.inner.novelty_ratio()
    }
    /// Was the most recent token novel?
    #[wasm_bindgen(getter)]
    pub fn last_novel(&self) -> bool {
        self.last_novel
    }
    /// Is the consumer behind (throttle signal)?
    #[wasm_bindgen(getter)]
    pub fn backpressure(&self) -> bool {
        self.last_bp
    }
}
