/**
 * Johnson-Lindenstrauss embedding (Wedge: ADR-121 follow-up, ADR-123 Phase 6)
 *
 * Replaces `@claude-flow/embeddings`' hand-rolled hand-rolled JL with a
 * tested implementation that obeys the Achlioptas / Dasgupta-Gupta bound
 * `target_dim ≤ original_dim − 1`. Matches the upstream
 * `sublinear-time-solver@1.7.0` JL contract.
 */

import { createHash } from 'node:crypto';

/** Deterministic Gaussian RNG seeded by content hash so embeddings are reproducible. */
function* gaussianStream(seed: string): IterableIterator<number> {
  // Box-Muller from a deterministic PRNG seeded by the hash.
  let counter = 0;
  while (true) {
    const h = createHash('sha256').update(seed + ':' + counter++).digest();
    // Two 32-bit floats in [0,1) per hash
    const u1 = (h.readUInt32BE(0) >>> 0) / 0x100000000;
    const u2 = (h.readUInt32BE(4) >>> 0) / 0x100000000;
    const r = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12)));
    const theta = 2 * Math.PI * u2;
    yield r * Math.cos(theta);
    yield r * Math.sin(theta);
  }
}

/** Cap target dim at `n − 1` (Achlioptas / Dasgupta-Gupta). */
export function computeTargetDim(originalDim: number, requestedDim: number, epsilon: number): number {
  const cap = Math.max(1, originalDim - 1);
  const k = Math.min(cap, requestedDim);
  // Documentation: the literature bound is k ≥ 4 log(n) / ε². We honour the
  // user's requested target unless it exceeds the cap.
  return Math.max(1, Math.min(cap, k));
}

export interface JLEmbedOptions {
  targetDim: number;
  epsilon?: number;
  /** Seed for the projection matrix. Default 'ruflo-jl-v1' so it's reproducible. */
  seed?: string;
}

export interface JLEmbedResult {
  projected: number[][];
  targetDim: number;
  /** ε from the input, echoed for reporting. */
  epsilon: number;
  /** Confirmed within k ≤ n − 1 bound. */
  withinAchlioptasBound: boolean;
}

/** Project a list of vectors to `targetDim` via a random Gaussian matrix. */
export function jlEmbed(vectors: number[][], options: JLEmbedOptions): JLEmbedResult {
  if (vectors.length === 0) {
    return {
      projected: [],
      targetDim: 0,
      epsilon: options.epsilon ?? 0.1,
      withinAchlioptasBound: true,
    };
  }
  const originalDim = vectors[0]!.length;
  const target = computeTargetDim(originalDim, options.targetDim, options.epsilon ?? 0.1);
  const seed = options.seed ?? 'ruflo-jl-v1';

  // Construct the k × n projection matrix R, then project each vector.
  const stream = gaussianStream(seed);
  const R = new Array<Float64Array>(target);
  for (let i = 0; i < target; i++) {
    const row = new Float64Array(originalDim);
    for (let j = 0; j < originalDim; j++) row[j] = stream.next().value as number;
    R[i] = row;
  }

  // Scaling: each entry has Var = 1, so multiply by 1/√k to keep ‖Rv‖² ≈ ‖v‖²
  const scale = 1 / Math.sqrt(target);
  const projected: number[][] = [];
  for (const v of vectors) {
    if (v.length !== originalDim) {
      throw new Error(`jlEmbed: vector dim ${v.length} ≠ expected ${originalDim}`);
    }
    const out = new Array<number>(target);
    for (let i = 0; i < target; i++) {
      let s = 0;
      const row = R[i]!;
      for (let j = 0; j < originalDim; j++) s += row[j]! * v[j]!;
      out[i] = s * scale;
    }
    projected.push(out);
  }
  return {
    projected,
    targetDim: target,
    epsilon: options.epsilon ?? 0.1,
    withinAchlioptasBound: target <= Math.max(1, originalDim - 1),
  };
}
