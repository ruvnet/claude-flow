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
