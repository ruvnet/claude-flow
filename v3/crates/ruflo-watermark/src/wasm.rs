//! WASM bindings (`--features wasm --target wasm32-unknown-unknown`).
//!
//! A thin, allocation-light surface over the core so JS/TS hosts (ruflo,
//! metaharness) can watermark a token stream and detect from a browser or Node
//! without a native addon. Token/probability slices marshal as typed arrays
//! (`Uint32Array` / `Float32Array`); detection results are a small struct with
//! getters.

use wasm_bindgen::prelude::*;

use crate::context::WatermarkConfig;
use crate::detect::{detect_gumbel, detect_tournament};
use crate::hash::WatermarkKey;
use crate::{Scheme, Watermarker};

fn cfg_from(material: &[u8], context_width: usize, layers: u32) -> WatermarkConfig {
    WatermarkConfig::new(WatermarkKey::from_bytes(material))
        .with_context_width(context_width)
        .with_layers(layers)
}

#[inline]
fn scheme_of(gumbel: bool) -> Scheme {
    if gumbel {
        Scheme::Gumbel
    } else {
        Scheme::Tournament
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
    /// `gumbel`: `true` for the distortion-free scheme, `false` for tournament.
    #[wasm_bindgen(constructor)]
    pub fn new(key_material: &[u8], context_width: usize, layers: u32, gumbel: bool) -> WasmWatermarker {
        let cfg = cfg_from(key_material, context_width, layers);
        WasmWatermarker {
            inner: Watermarker::new(cfg, scheme_of(gumbel)),
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

/// Detect a watermark over an emitted token id sequence.
#[wasm_bindgen]
pub fn detect(
    tokens: &[u32],
    key_material: &[u8],
    context_width: usize,
    layers: u32,
    gumbel: bool,
) -> WasmDetection {
    let cfg = cfg_from(key_material, context_width, layers);
    let r = if gumbel {
        detect_gumbel(tokens, cfg)
    } else {
        detect_tournament(tokens, cfg)
    };
    WasmDetection {
        scored_positions: r.scored_positions,
        z_score: r.z_score,
        p_value: r.p_value,
        log10_p: r.log10_p,
    }
}
