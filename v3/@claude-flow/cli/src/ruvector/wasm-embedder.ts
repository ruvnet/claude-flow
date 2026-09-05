/**
 * Optional WASM embedder tier — a pluggable PRIMARY embedding tier ahead of
 * ruvector-ONNX → hash.
 *
 * OPT-IN by design: there is NO default package (an earlier iteration defaulted
 * to `@ruvector/lattice-wasm`, which does not exist — npm 404). Point
 * `RUFLO_EMBED_WASM_PKG` at any real WASM embedder that follows the ruvnet
 * wasm-bindgen convention (a text→vector embed export). With the env unset, this
 * tier is INERT and everything resolves exactly as before (ruvector ONNX). Fully
 * fail-closed; never throws.
 *
 * The adapter probes the module's API tolerantly and verifies a real embed
 * succeeds before accepting the tier (guards the ADR-086 loads-but-runtime-fails
 * trap), so an incompatible package simply reports unavailable.
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require_ = createRequire(import.meta.url);

/**
 * Package specifier for the optional WASM embedder. EMPTY by default (opt-in).
 * `RUFLO_LATTICE_WASM_PKG` is accepted as a back-compat alias.
 */
export const EMBED_WASM_PKG = process.env.RUFLO_EMBED_WASM_PKG || process.env.RUFLO_LATTICE_WASM_PKG || '';
export const DEFAULT_EMBED_MODEL = process.env.RUFLO_EMBED_MODEL || 'default';

/* eslint-disable @typescript-eslint/no-explicit-any */
let _mod: any = null;
let _ready = false;
let _probed = false;
let _available = false;
let _models: string[] = [];

async function loadModule(): Promise<any> {
  if (!EMBED_WASM_PKG) return null;           // opt-in: no package configured ⇒ inert
  if (_mod) return _mod;
  _mod = await import(EMBED_WASM_PKG).catch(() => null); // optional — absent ⇒ null ⇒ unavailable
  return _mod;
}

async function ensureInit(): Promise<boolean> {
  if (_ready) return true;
  const mod = await loadModule();
  if (!mod) return false;
  try {
    if (typeof mod.initSync === 'function') {
      let wasmBytes: Buffer | undefined;
      for (const cand of ['index_bg.wasm', 'embedder_bg.wasm', 'wasm_bg.wasm']) {
        try { wasmBytes = readFileSync(require_.resolve(`${EMBED_WASM_PKG}/${cand}`)); break; } catch { /* try next */ }
      }
      mod.initSync(wasmBytes ? { module: wasmBytes } : undefined);
    } else if (typeof mod.default === 'function') {
      await mod.default();
    }
    _ready = true;
    return true;
  } catch {
    return false;
  }
}

function toVec(r: unknown): number[] | null {
  const v = (r && typeof r === 'object' && 'embedding' in (r as any)) ? (r as any).embedding : r;
  if (!v) return null;
  if (Array.isArray(v)) return v as number[];
  if ((v as ArrayLike<number>).length !== undefined) return Array.from(v as ArrayLike<number>);
  return null;
}

async function embedRaw(text: string, model: string): Promise<number[] | null> {
  const mod = _mod;
  if (!mod) return null;
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

/** Is an optional WASM embedder configured + installed + initializable? Cached; never throws. */
export async function wasmEmbedderAvailable(): Promise<boolean> {
  if (_probed) return _available;
  _probed = true;
  try {
    if (!EMBED_WASM_PKG) { _available = false; return false; } // opt-in; not configured
    if (!(await ensureInit())) { _available = false; return false; }
    const mod = _mod;
    try {
      const list = typeof mod.listModels === 'function' ? mod.listModels() : (mod.models ?? mod.MODELS);
      if (Array.isArray(list) && list.length) _models = list as string[];
    } catch { /* leave default */ }
    if (!_models.length) _models = [DEFAULT_EMBED_MODEL];
    const probe = await embedRaw('probe', DEFAULT_EMBED_MODEL);
    _available = !!probe && probe.length > 0;
    return _available;
  } catch {
    _available = false;
    return false;
  }
}

/** Models the configured WASM embedder reports (empty until available). */
export function wasmEmbedderModels(): string[] { return [..._models]; }

/** Embed via the optional WASM embedder, or null (caller falls through). Never throws. */
export async function wasmEmbed(text: string, model: string = DEFAULT_EMBED_MODEL): Promise<number[] | null> {
  try {
    if (!(await wasmEmbedderAvailable())) return null;
    return await embedRaw(text, model);
  } catch {
    return null;
  }
}
