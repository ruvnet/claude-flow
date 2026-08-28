// @claude-flow/watermark/web — browser / Deno / bundler ESM entry.
//
// The WASM must be instantiated before use: `await init()` once, then use the
// same ergonomic API as the Node build. In a browser, `init()` with no argument
// fetches the sibling `ruflo_watermark_bg.wasm`; pass a URL / Response /
// BufferSource / WebAssembly.Module to override (e.g. in Node tests).
//
// Generation + detection only — no watermark-removal surface.

import initWasm, {
  WasmWatermarker,
  detect as _detect,
  detect_selfsync as _detectSelfSync,
  detect_exact as _detectExact,
} from './ruflo_watermark.js';

let _ready = false;

/** Instantiate the WASM module. Await once before any other call. */
export async function init(input) {
  if (_ready) return;
  // Non-deprecated wasm-bindgen call shape; no arg => browser auto-fetch.
  await initWasm(input === undefined ? undefined : { module_or_path: input });
  _ready = true;
}

/** True once `init()` has completed. */
export function isReady() {
  return _ready;
}

function assertReady() {
  if (!_ready) throw new Error('@claude-flow/watermark/web: call `await init()` before use');
}

const SCHEMES = new Set(['tournament', 'tournament_nd', 'gumbel']);
const enc = new TextEncoder();
const toKeyBytes = (k) => (typeof k === 'string' ? enc.encode(k) : k);
const toU32 = (a) => (a instanceof Uint32Array ? a : Uint32Array.from(a));
const toF32 = (a) => (a instanceof Float32Array ? a : Float32Array.from(a));
function normScheme(s) {
  const v = s || 'gumbel';
  if (!SCHEMES.has(v)) throw new RangeError(`unknown scheme "${v}" (tournament | tournament_nd | gumbel)`);
  return v;
}
function shape(r) {
  const out = {
    zScore: r.z_score,
    pValue: r.p_value,
    log10P: r.log10_p,
    scoredPositions: r.scored_positions,
    isWatermarked(alpha = 1e-6) {
      return out.log10P <= Math.log10(alpha);
    },
  };
  r.free();
  return out;
}

/** Streaming watermarked sampler (call `await init()` first). */
export class Watermarker {
  constructor({ key, scheme = 'gumbel', contextWidth = 4, layers = 6 } = {}) {
    assertReady();
    this._inner = new WasmWatermarker(toKeyBytes(key), contextWidth, layers, normScheme(scheme));
  }
  step(tokens, probs) {
    return this._inner.step(toU32(tokens), toF32(probs));
  }
  free() {
    this._inner.free();
  }
}

export function detect(tokens, { key, scheme = 'gumbel', contextWidth = 4, layers = 6 } = {}) {
  assertReady();
  return shape(_detect(toU32(tokens), toKeyBytes(key), contextWidth, layers, normScheme(scheme)));
}

export function detectSelfSync(tokens, { key, contextWidth = 4 } = {}) {
  assertReady();
  return shape(_detectSelfSync(toU32(tokens), toKeyBytes(key), contextWidth));
}

export function detectExact(tokens, { key, contextWidth = 4 } = {}) {
  assertReady();
  return shape(_detectExact(toU32(tokens), toKeyBytes(key), contextWidth));
}

export { SCHEMES };
