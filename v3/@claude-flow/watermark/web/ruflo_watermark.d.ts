/* tslint:disable */
/* eslint-disable */

/**
 * Detection result, JS-facing (fields via getters).
 */
export class WasmDetection {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly log10_p: number;
    readonly p_value: number;
    readonly scored_positions: number;
    readonly z_score: number;
}

/**
 * Streaming watermarked sampler, JS-facing.
 */
export class WasmWatermarker {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `key_material`: arbitrary secret bytes (e.g. a hex string's bytes).
     * `scheme`: `"tournament"` | `"tournament_nd"` | `"gumbel"` (default gumbel).
     */
    constructor(key_material: Uint8Array, context_width: number, layers: number, scheme: string);
    /**
     * Emit one token: returns the index into `tokens`/`probs` of the chosen
     * candidate. Advances the rolling context.
     */
    step(tokens: Uint32Array, probs: Float32Array): number;
}

/**
 * Detect a watermark over an emitted token id sequence, using the named scheme.
 */
export function detect(tokens: Uint32Array, key_material: Uint8Array, context_width: number, layers: number, scheme: string): WasmDetection;

/**
 * Exact-null short-text detection (Gumbel, exact Gamma tail): correct p-values
 * at small token counts where the normal approximation misleads. See `bayes.rs`.
 */
export function detect_exact(tokens: Uint32Array, key_material: Uint8Array, context_width: number): WasmDetection;

/**
 * Indel-robust detection (Gumbel self-sync): far stronger than the standard
 * detector on edited / repetitive text. See `align.rs`.
 */
export function detect_selfsync(tokens: Uint32Array, key_material: Uint8Array, context_width: number): WasmDetection;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmdetection_free: (a: number, b: number) => void;
    readonly __wbg_wasmwatermarker_free: (a: number, b: number) => void;
    readonly detect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly detect_exact: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly detect_selfsync: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly wasmdetection_log10_p: (a: number) => number;
    readonly wasmdetection_p_value: (a: number) => number;
    readonly wasmdetection_scored_positions: (a: number) => number;
    readonly wasmdetection_z_score: (a: number) => number;
    readonly wasmwatermarker_new: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly wasmwatermarker_step: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
