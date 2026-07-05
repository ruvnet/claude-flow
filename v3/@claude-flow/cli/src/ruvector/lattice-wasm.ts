/**
 * Lattice WASM embedder adapter — the primary embedding tier (ADR: embedding
 * substrate upgrade). Replaces hash placeholders with real semantic embeddings
 * and adds multiple models (miniLM, bge, multi-paraphrase-miniLM, GPU qwen3-0.6B).
 *
 * Built on the proven `@ruvector/ruvllm-wasm` optional-dependency convention:
 *   - dynamically imported (never a hard dependency),
 *   - WASM initialized from bundled bytes,
 *   - fully FAIL-CLOSED: if the package is absent, the WASM fails to init, or the
 *     embed API differs, `latticeAvailable()` returns false and callers fall
 *     through to the existing ruvector-ONNX → hash tiers with ZERO regression.
 *
 * The package specifier is configurable (`RUFLO_LATTICE_WASM_PKG`) so the exact
 * published name can be set without a code change; the API is probed tolerantly.
 * Opt-in for the GPU model: qwen3 is only selected when explicitly requested.
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require_ = createRequire(import.meta.url);

/** Default package name (ruvnet WASM convention); override with RUFLO_LATTICE_WASM_PKG. */
export const LATTICE_WASM_PKG = process.env.RUFLO_LATTICE_WASM_PKG || '@ruvector/lattice-wasm';

export type LatticeModel = 'minilm' | 'bge' | 'paraphrase-minilm' | 'qwen3-0.6b' | string;
export const DEFAULT_LATTICE_MODEL: LatticeModel = (process.env.RUFLO_EMBED_MODEL as LatticeModel) || 'minilm';

/* eslint-disable @typescript-eslint/no-explicit-any */
let _mod: any = null;
let _ready = false;
let _probed = false;
let _available = false;
let _models: LatticeModel[] = [];

async function loadModule(): Promise<any> {
  if (_mod) return _mod;
  const spec: string = LATTICE_WASM_PKG;
  _mod = await import(spec).catch(() => null); // optional — absent ⇒ null ⇒ unavailable
  return _mod;
}

async function ensureInit(): Promise<boolean> {
  if (_ready) return true;
  const mod = await loadModule();
  if (!mod) return false;
  try {
    // ruvnet WASM convention: initSync({ module: <wasm bytes> }); tolerate variants.
    if (!_ready && typeof mod.initSync === 'function') {
      let wasmBytes: Buffer | undefined;
      for (const cand of ['lattice_wasm_bg.wasm', 'lattice_bg.wasm', 'index_bg.wasm']) {
        try { wasmBytes = readFileSync(require_.resolve(`${LATTICE_WASM_PKG}/${cand}`)); break; } catch { /* try next */ }
      }
      mod.initSync(wasmBytes ? { module: wasmBytes } : undefined);
    } else if (typeof mod.default === 'function') {
      await mod.default(); // some wasm-bindgen builds export an async default init
    }
    _ready = true;
    return true;
  } catch {
    return false; // init failed ⇒ fail closed
  }
}

/** Extract a plain number[] from whatever shape the module's embed returns. */
function toVec(r: unknown): number[] | null {
  const v = (r && typeof r === 'object' && 'embedding' in (r as any)) ? (r as any).embedding : r;
  if (!v) return null;
  if (Array.isArray(v)) return v as number[];
  if ((v as ArrayLike<number>).length !== undefined) return Array.from(v as ArrayLike<number>);
  return null;
}

/** Is the Lattice WASM embedder installed + initializable? Cached; never throws. */
export async function latticeAvailable(): Promise<boolean> {
  if (_probed) return _available;
  _probed = true;
  try {
    if (!(await ensureInit())) { _available = false; return false; }
    const mod = _mod;
    // discover models (tolerant): listModels() / models / MODELS
    try {
      const list = typeof mod.listModels === 'function' ? mod.listModels() : (mod.models ?? mod.MODELS);
      if (Array.isArray(list) && list.length) _models = list as LatticeModel[];
    } catch { /* leave default */ }
    if (!_models.length) _models = [DEFAULT_LATTICE_MODEL];
    // verify an actual embed succeeds (the ADR-086 "loads but runtime-fails" trap).
    const probe = await latticeEmbedRaw('probe', DEFAULT_LATTICE_MODEL);
    _available = !!probe && probe.length > 0;
    return _available;
  } catch {
    _available = false;
    return false;
  }
}

/** The models Lattice reports (empty until availability is probed). */
export function latticeModels(): LatticeModel[] { return [..._models]; }

async function latticeEmbedRaw(text: string, model: LatticeModel): Promise<number[] | null> {
  const mod = _mod;
  if (!mod) return null;
  // tolerant API probing across plausible wasm-bindgen surfaces.
  const attempts: Array<() => Promise<unknown> | unknown> = [
    () => typeof mod.embed === 'function' ? mod.embed(text, model) : undefined,
    () => typeof mod.embed === 'function' ? mod.embed(text) : undefined,
    () => typeof mod.embedText === 'function' ? mod.embedText(text, model) : undefined,
    () => typeof mod.Embedder === 'function' ? new mod.Embedder(model).embed(text) : undefined,
  ];
  for (const a of attempts) {
    try { const r = await a(); const v = toVec(r); if (v) return v; } catch { /* try next surface */ }
  }
  return null;
}

/**
 * Embed `text` with `model` via Lattice WASM. Returns null on any failure so the
 * caller can fall through to the next tier. Never throws.
 */
export async function latticeEmbed(text: string, model: LatticeModel = DEFAULT_LATTICE_MODEL): Promise<number[] | null> {
  try {
    if (!(await latticeAvailable())) return null;
    return await latticeEmbedRaw(text, model);
  } catch {
    return null;
  }
}
