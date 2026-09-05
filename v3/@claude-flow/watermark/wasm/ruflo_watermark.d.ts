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
