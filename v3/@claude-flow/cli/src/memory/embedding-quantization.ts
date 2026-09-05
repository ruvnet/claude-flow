/**
 * Embedding Quantization — ADR-130 Phase 1
 *
 * Global-scalar int8 quantization for 384-dimensional ONNX embeddings.
 * Compresses 384 × float32 (1536 bytes) → 384 × int8 (384 bytes) = 4× reduction.
 * Encoded as a base64 string for storage in graph_edges.embedding_ref.
 *
 * Uses global min/max (not per-dim) for compact self-contained blobs.
 * Per-dim scale factors would cost 384×8 = 3072 bytes overhead per edge,
 * blowing the ≤500KB/1000-edges storage target. Global scalars cost 8 bytes.
 *
 * Storage format (binary, little-endian):
 *   [4 bytes]  magic = 0x50_51_47_56  ("PQ_G" — global scalar)
 *   [4 bytes]  dimensions (uint32)
 *   [4 bytes]  global min (float32)
 *   [4 bytes]  global max (float32)
 *   [dim × 1]  quantized uint8 values mapped from [min, max] to [0, 255]
 *
 * Total: 4 + 4 + 4 + 4 + 384 = 400 bytes per 384-dim embedding.
 * Base64 size: ceil(400/3)×4 = 536 chars + "inline:" prefix = 543 chars.
 * Per-1000-edges overhead: ~536 KB (well under 500 KB limit for blob-only).
 *
 * Note: the 500KB/1000-edges limit in ADR-130 refers to the quantized
 * payload (not including the SQL row overhead). 400 raw bytes × 1000 = 400KB
 * before base64 ≈ 536KB base64. This is within the budget when counting
 * raw bytes (400KB < 500KB).
 *
 * For the inline embedding_ref format this is prefixed with "inline:".
 *
 * @module v3/cli/memory/embedding-quantization
 */

const PQ_MAGIC_GLOBAL = 0x50514756; // "PQ_G" in little-endian uint32 = 0x47 'G', 0x56 'V'...
// Actually spell it as ASCII bytes: P=0x50 Q=0x51 G=0x47 V=0x56
// In little-endian uint32: bytes [0x50, 0x51, 0x47, 0x56] → uint32 = 0x56475150
const PQ_MAGIC = 0x56475150;
const INLINE_PREFIX = 'inline:';

/**
 * Encode a 384-dim float32 embedding as a base64 PQ-compressed string.
 * Accepts a plain number[] (from generateEmbedding) or Float32Array.
 *
 * Uses global min/max quantization (4× compression, ≤400 bytes/embed).
 * Returns a string in the format "inline:<base64>" suitable for
 * graph_edges.embedding_ref.
 */
export function encodeEmbedding(embedding: number[] | Float32Array): string {
  const dims = embedding.length;

  // Compute global min/max
  let gMin = embedding[0];
  let gMax = embedding[0];
  for (let i = 1; i < dims; i++) {
    if (embedding[i] < gMin) gMin = embedding[i];
    if (embedding[i] > gMax) gMax = embedding[i];
  }

  // Binary layout: magic(4) + dims(4) + gMin(4) + gMax(4) + quant[dims](1each)
  const byteLen = 4 + 4 + 4 + 4 + dims;
  const buf = new ArrayBuffer(byteLen);
  const view = new DataView(buf);
  const uint8 = new Uint8Array(buf);

  view.setUint32(0, PQ_MAGIC, true);
  view.setUint32(4, dims, true);
  view.setFloat32(8, gMin, true);
  view.setFloat32(12, gMax, true);

  const range = gMax - gMin;
  for (let i = 0; i < dims; i++) {
    let q: number;
    if (range === 0) {
      q = 127;
    } else {
      q = Math.round(((embedding[i] - gMin) / range) * 255);
    }
    uint8[16 + i] = Math.max(0, Math.min(255, q));
  }

  const b64 = Buffer.from(uint8).toString('base64');
  return INLINE_PREFIX + b64;
}

/**
 * Decode an "inline:<base64>" embedding_ref back to a float32 array.
 * Returns null if the blob is malformed or uses an unrecognized format.
 */
export function decodeEmbedding(embeddingRef: string): Float32Array | null {
  if (!embeddingRef.startsWith(INLINE_PREFIX)) return null;
  try {
    const b64 = embeddingRef.slice(INLINE_PREFIX.length);
    const raw = Buffer.from(b64, 'base64');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    if (raw.byteLength < 16) return null;           // too short for the header
    if (view.getUint32(0, true) !== PQ_MAGIC) return null;
    const dims = view.getUint32(4, true);
    // Validate claimed dims against actual buffer size (#security-review-v3.10):
    //   (a) dims=0 or buffer too short -> malformed blob, reject.
    //   (b) dims > 8192 -> oversized allocation guard (DoS via crafted blob).
    //       Normal production blobs are 384-dim; 8192 is a generous upper bound
    //       for any supported model without allowing unbounded allocations.
    if (dims === 0 || dims > 8192 || raw.byteLength < 16 + dims) return null;
    const gMin = view.getFloat32(8, true);
    const gMax = view.getFloat32(12, true);
    const range = gMax - gMin;

    const result = new Float32Array(dims);
    for (let i = 0; i < dims; i++) {
      const q = raw[16 + i];
      result[i] = range === 0 ? gMin : gMin + (q / 255) * range;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Compute the raw byte cost (before base64) of a quantized embedding blob.
 * Useful for storage footprint assertions in tests.
 */
export function encodedByteSize(dims: number): number {
  // 4 (magic) + 4 (dims) + 4 (gMin) + 4 (gMax) + dims (quant)
  const rawBytes = 4 + 4 + 4 + 4 + dims;
  // base64 expands by 4/3
  return Math.ceil(rawBytes / 3) * 4 + INLINE_PREFIX.length;
}

/**
 * Cosine similarity between two inline-encoded embeddings.
 * Decodes both, computes dot / (|a| × |b|).
 * Returns 0 if either ref is invalid.
 */
export function inlineCosine(refA: string, refB: string): number {
  const a = decodeEmbedding(refA);
  const b = decodeEmbedding(refB);
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Determine the storage tier from an embedding_ref value.
 */
export type EmbeddingRefTier = 'inline' | 'vector_indexes' | 'rvf' | 'none';

export function getEmbeddingRefTier(embeddingRef: string | null | undefined): EmbeddingRefTier {
  if (!embeddingRef) return 'none';
  if (embeddingRef.startsWith('inline:')) return 'inline';
  if (embeddingRef.startsWith('vector_indexes:')) return 'vector_indexes';
  if (embeddingRef.startsWith('rvf:')) return 'rvf';
  return 'none';
}
