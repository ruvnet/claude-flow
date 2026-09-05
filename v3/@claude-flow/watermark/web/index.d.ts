// Types for @claude-flow/watermark/web (browser / Deno / bundler entry).
import type { Detection, Scheme, WatermarkerOptions, SelfSyncOptions } from '../index.d.ts';

export type { Detection, Scheme, WatermarkerOptions, SelfSyncOptions };

/** WASM init input: fetched URL/Response, raw bytes, or a compiled module. */
export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

/** Instantiate the WASM module. Await once before any other call. */
export function init(input?: InitInput | Promise<InitInput>): Promise<void>;

/** True once `init()` has completed. */
export function isReady(): boolean;

export class Watermarker {
  constructor(opts: WatermarkerOptions);
  step(tokens: Uint32Array | number[], probs: Float32Array | number[]): number;
  free(): void;
}

export function detect(tokens: Uint32Array | number[], opts: WatermarkerOptions): Detection;
export function detectSelfSync(tokens: Uint32Array | number[], opts: SelfSyncOptions): Detection;
export function detectExact(tokens: Uint32Array | number[], opts: SelfSyncOptions): Detection;

export const SCHEMES: ReadonlySet<Scheme>;
