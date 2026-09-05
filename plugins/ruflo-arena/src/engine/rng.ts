// Deterministic, seedable PRNG (mulberry32). Same seed => same stream, so every run is
// bit-for-bit reproducible — a precondition Wolfram stresses (a competition is only
// meaningful if it can be re-run).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

export function choice<T>(rng: () => number, arr: readonly T[]): T {
  return arr[randInt(rng, arr.length)];
}

/** Derive an independent stream seed from a base seed (keeps player streams uncorrelated). */
export function derive(seed: number, salt: number): number {
  return (Math.imul(seed >>> 0, 0x9e3779b1) ^ (salt >>> 0)) >>> 0;
}
