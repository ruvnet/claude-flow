// @claude-flow/watermark — ergonomic wrapper over the ruflo-watermark WASM core.
//
// SynthID-Text-style LLM text watermarking (generation + detection). The
// watermark rides the tie-break randomness among plausible tokens — it never
// injects an out-of-distribution word, costs no extra tokens, and is detectable
// only with the key. This package deliberately does NOT include a watermark
// remover / laundering tool.
'use strict';

const wasm = require('./wasm/ruflo_watermark.js');

const SCHEMES = new Set(['tournament', 'tournament_nd', 'gumbel']);

function toKeyBytes(key) {
  if (typeof key === 'string') return new TextEncoder().encode(key);
  if (key instanceof Uint8Array) return key;
  throw new TypeError('key must be a string or Uint8Array');
}
function toU32(a) {
  return a instanceof Uint32Array ? a : Uint32Array.from(a);
}
function toF32(a) {
  return a instanceof Float32Array ? a : Float32Array.from(a);
}
function normScheme(scheme) {
  const s = scheme || 'gumbel';
  if (!SCHEMES.has(s)) throw new RangeError(`unknown scheme "${s}" (use tournament | tournament_nd | gumbel)`);
  return s;
}

/** Shape a raw WasmDetection into a plain object with an `isWatermarked` helper. */
function shape(r) {
  const out = {
    zScore: r.z_score,
    pValue: r.p_value,
    log10P: r.log10_p,
    scoredPositions: r.scored_positions,
    /** True if the evidence clears the given false-positive rate (e.g. 1e-6). */
    isWatermarked(alpha = 1e-6) {
      return out.log10P <= Math.log10(alpha);
    },
  };
  r.free();
  return out;
}

/**
 * Streaming watermarked sampler. Hold one per generated sequence; feed it the
 * model's candidate token ids and their probabilities per step.
 */
class Watermarker {
  /**
   * @param {object} opts
   * @param {string|Uint8Array} opts.key   secret key material (carries no user info)
   * @param {'tournament'|'tournament_nd'|'gumbel'} [opts.scheme='gumbel']
   * @param {number} [opts.contextWidth=4]  H — preceding tokens seeding each draw
   * @param {number} [opts.layers=6]        tournament depth (ignored by gumbel)
   */
  constructor({ key, scheme = 'gumbel', contextWidth = 4, layers = 6 } = {}) {
    this._inner = new wasm.WasmWatermarker(toKeyBytes(key), contextWidth, layers, normScheme(scheme));
  }
  /** Emit one token: returns the index of the chosen candidate. */
  step(tokens, probs) {
    return this._inner.step(toU32(tokens), toF32(probs));
  }
  /** Release the WASM instance. */
  free() {
    this._inner.free();
  }
}

/** Detect a watermark over an emitted token-id sequence using the named scheme. */
function detect(tokens, { key, scheme = 'gumbel', contextWidth = 4, layers = 6 } = {}) {
  return shape(wasm.detect(toU32(tokens), toKeyBytes(key), contextWidth, layers, normScheme(scheme)));
}

/** Indel-robust detection (Gumbel self-sync) — stronger on edited/repetitive text. */
function detectSelfSync(tokens, { key, contextWidth = 4 } = {}) {
  return shape(wasm.detect_selfsync(toU32(tokens), toKeyBytes(key), contextWidth));
}

/** Exact-null short-text detection (Gumbel, exact Gamma tail). */
function detectExact(tokens, { key, contextWidth = 4 } = {}) {
  return shape(wasm.detect_exact(toU32(tokens), toKeyBytes(key), contextWidth));
}

module.exports = { Watermarker, detect, detectSelfSync, detectExact, SCHEMES };
