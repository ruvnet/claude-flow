/**
 * ADR-472: a stored embedding as int8 + scale, for `memory list --embeddings`. Pure; no store access.
 */

/** Most embeddings `memory list --embeddings` will emit per call, and the longest vector it will encode. */
export const MAX_LIST_EMBEDDINGS = 500;
export const MAX_EMBEDDING_DIMS = 4096;

/** A stored embedding as int8 with one scale, base64: ~1/4 the bytes of rounded JSON floats, enough for a 2D projection or a cosine screen. */
export type EmbeddingQ8 = { dims: number; scale: number; b64: string };

/**
 * Read-only view of a stored embedding (a JSON array in the `embedding` column) as int8 + scale. Returns undefined for a missing,
 * malformed, non-finite, constant-zero or over-long vector, so a caller never gets a guessed one. Each value is within scale/2 of the
 * original (scale = max|v| / 127); cosine against the original stays above 0.9999 for unit-scale text embeddings.
 */
export function encodeEmbeddingQ8(stored: unknown): EmbeddingQ8 | undefined {
  if (stored === null || stored === undefined) return undefined;
  let values: unknown;
  try {
    values = typeof stored === 'string' ? JSON.parse(stored) : stored;
  } catch {
    return undefined;
  }
  if (!Array.isArray(values) || values.length < 2 || values.length > MAX_EMBEDDING_DIMS) return undefined;
  let max = 0;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    max = Math.max(max, Math.abs(v));
  }
  if (max === 0) return undefined;
  const scale = max / 127;
  const bytes = new Int8Array(values.length);
  for (let i = 0; i < values.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round((values[i] as number) / scale)));
  return { dims: values.length, scale: Number(scale.toPrecision(6)), b64: Buffer.from(bytes.buffer).toString('base64') };
}

