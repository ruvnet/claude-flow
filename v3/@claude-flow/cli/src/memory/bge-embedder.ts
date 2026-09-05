// BGE bi-encoder embedder — direct @xenova/transformers AutoTokenizer +
// AutoModel path (bypasses agentic-flow's transformers.js which needs sharp
// and fails on darwin-arm64 without libvips).
//
// Default model: Xenova/bge-base-en-v1.5 (110M params, 768-dim, int8
// quantised ~110MB). Comparable models published on Xenova:
//   - Xenova/bge-small-en-v1.5 (33M, 384-dim, ~40MB)
//   - Xenova/bge-base-en-v1.5  (110M, 768-dim, ~110MB)  ← default
//   - Xenova/bge-large-en-v1.5 (335M, 1024-dim, ~440MB)
//
// BGE outputs use CLS-token pooling + L2 normalisation (per BAAI's docs).
//
// ADR-085 (BEIR harness) + ADR-086 (BGE embedder).

type Embedder = {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  /** ADR-090: BGE-en-v1.5 query prefix per BAAI docs. Apply ONLY to
   *  queries (not documents). Measured +0.009 nDCG@10 on NFCorpus
   *  dense-alone (0.352 → 0.360). */
  embedQuery(text: string): Promise<Float32Array>;
  dim(): number;
  modelName(): string;
};

/** BAAI BGE-en-v1.5 (non-icl) query-side prefix per their docs. */
export const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

let singleton: Embedder | null = null;
let loadAttempted = false;
let loadError: string | null = null;

/**
 * Lazy-load the BGE bi-encoder. Defaults to Xenova/bge-base-en-v1.5.
 * Returns null on failure; caller should fall back.
 */
export async function getBgeEmbedder(modelName = 'Xenova/bge-base-en-v1.5'): Promise<Embedder | null> {
  if (singleton && singleton.modelName() === modelName) return singleton;
  if (loadAttempted && loadError) return null;
  loadAttempted = true;

  try {
    const mod = await import('@xenova/transformers').catch(() => null) as any;
    if (!mod?.AutoTokenizer || !mod?.AutoModel) {
      loadError = '@xenova/transformers missing AutoTokenizer / AutoModel';
      return null;
    }
    const tokenizer = await mod.AutoTokenizer.from_pretrained(modelName, { quantized: true });
    const model = await mod.AutoModel.from_pretrained(modelName, { quantized: true });

    // BGE uses CLS pooling + L2 normalisation per the BAAI README.
    // We do both manually since the lower-level API doesn't apply them.
    function clsPool(out: any): Float32Array {
      // last_hidden_state shape: [batch, seq_len, hidden_dim]
      const hidden = out.last_hidden_state ?? out.hiddenState ?? out[0];
      const data = hidden.data as Float32Array;
      const dims = hidden.dims as number[]; // [batch, seq, hidden]
      const [b, _seq, h] = dims;
      // CLS is position 0 of each batch row.
      const result = new Float32Array(b * h);
      for (let bi = 0; bi < b; bi++) {
        for (let hi = 0; hi < h; hi++) {
          // hidden[bi, 0, hi] = data[(bi * seq + 0) * h + hi]
          result[bi * h + hi] = data[(bi * _seq + 0) * h + hi];
        }
      }
      return result;
    }

    function l2norm(vec: Float32Array, offset: number, len: number): void {
      let n = 0;
      for (let i = 0; i < len; i++) n += vec[offset + i] * vec[offset + i];
      n = Math.sqrt(n);
      if (n > 1e-9) for (let i = 0; i < len; i++) vec[offset + i] /= n;
    }

    singleton = {
      async embed(text: string): Promise<Float32Array> {
        const inputs = await tokenizer(text, { padding: true, truncation: true, max_length: 512 });
        const out = await model(inputs);
        const pooled = clsPool(out);
        const h = pooled.length;
        l2norm(pooled, 0, h);
        return pooled;
      },
      async embedBatch(texts: string[]): Promise<Float32Array[]> {
        if (texts.length === 0) return [];
        const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 512 });
        const out = await model(inputs);
        const pooled = clsPool(out);
        const h = pooled.length / texts.length;
        const results: Float32Array[] = [];
        for (let i = 0; i < texts.length; i++) {
          const vec = pooled.slice(i * h, (i + 1) * h);
          l2norm(vec, 0, h);
          results.push(vec);
        }
        return results;
      },
      async embedQuery(text: string): Promise<Float32Array> {
        // ADR-090: prepend BAAI's BGE-en-v1.5 query prefix. Measured
        // +0.009 nDCG@10 on NFCorpus dense-alone (0.3517 → 0.3604).
        // Same encoding pathway as embed(); just modifies the input.
        const prefixed = BGE_QUERY_PREFIX + text;
        const inputs = await tokenizer(prefixed, { padding: true, truncation: true, max_length: 512 });
        const out = await model(inputs);
        const pooled = clsPool(out);
        const h = pooled.length;
        l2norm(pooled, 0, h);
        return pooled;
      },
      dim(): number {
        // Will be filled after first embed; conservative default 768 for base.
        return modelName.includes('small') ? 384 : modelName.includes('large') ? 1024 : 768;
      },
      modelName(): string { return modelName; },
    };
    return singleton;
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function getBgeStatus(): { loaded: boolean; attempted: boolean; error: string | null; modelName: string | null } {
  return {
    loaded: !!singleton,
    attempted: loadAttempted,
    error: loadError,
    modelName: singleton?.modelName() ?? null,
  };
}
