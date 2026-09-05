// Cross-encoder reranker — scores (query, document) pairs jointly via a
// small MS MARCO cross-encoder (Xenova/ms-marco-MiniLM-L-6-v2, ~80MB ONNX).
//
// Why a cross-encoder after hybrid? The bi-encoder + BM25 pipeline returns
// the top-K candidates fast. A cross-encoder re-reads each (query, doc) pair
// jointly and produces a calibrated relevance score — paper-proven path
// for closing the residual top-1 gap.
//
// Cost: ~20-40 ms per (query, doc) pair, plus ~80 MB model download on first
// run. We lazy-load and cache the singleton. If the model fails to load,
// rerank() is a no-op (returns input order with score=0) — never breaks the
// caller.
//
// ADR-080.

type CrossEncoder = {
  /** Score a list of (query, doc) pairs. Returns an array of scores aligned to input. */
  scoreBatch(query: string, docs: string[]): Promise<number[]>;
  isReady(): boolean;
};

let singleton: CrossEncoder | null = null;
let loadAttempted = false;
let loadError: string | null = null;

/**
 * Lazy-load the cross-encoder singleton. Returns null if the model can't be
 * loaded (no network, no model cache, package missing). Subsequent calls
 * after a failure return null immediately — we don't retry.
 */
export async function getCrossEncoder(modelName = 'Xenova/ms-marco-MiniLM-L-6-v2'): Promise<CrossEncoder | null> {
  if (singleton) return singleton;
  if (loadAttempted) return null;
  loadAttempted = true;

  try {
    // @xenova/transformers ambient typing in optional-modules.d.ts only
    // covers `default`, `pipeline`, `env` — cross-encoder needs the
    // AutoTokenizer/AutoModelForSequenceClassification entries. Cast through
    // any rather than expanding the ambient decl (this module is the only
    // caller).
    const mod = await import('@xenova/transformers').catch(() => null) as any;
    if (!mod?.AutoTokenizer || !mod?.AutoModelForSequenceClassification) {
      loadError = '@xenova/transformers missing AutoTokenizer / AutoModelForSequenceClassification';
      return null;
    }
    // Direct tokenizer + model load — pipeline('text-classification') can't
    // ingest {text, text_pair} pairs reliably in xenova v2.x. Doing the pair
    // encoding ourselves lets us call `tokenizer(query, {text_pair: doc, ...})`
    // which is the documented BERT pair-encoding signature.
    const tokenizer = await mod.AutoTokenizer.from_pretrained(modelName, {
      quantized: true,
    });
    const model = await mod.AutoModelForSequenceClassification.from_pretrained(modelName, {
      quantized: true,  // ~30MB int8 instead of ~80MB fp32
    });

    singleton = {
      async scoreBatch(query: string, docs: string[]): Promise<number[]> {
        if (docs.length === 0) return [];
        // Encode each (query, doc) pair separately, then batch through model.
        // MS MARCO cross-encoders output a single logit per pair — sigmoid it
        // to get a relevance probability.
        const scores: number[] = [];
        for (const doc of docs) {
          const inputs = await tokenizer(query, { text_pair: doc, padding: true, truncation: true });
          const out = await model(inputs);
          // Output: { logits: Tensor([1, 1]) } for MS MARCO scoring head.
          // Some variants emit [1, 2] (binary classifier) — handle both.
          const logits = out.logits?.data ?? out.logits ?? out;
          const raw = Array.isArray(logits) ? logits : Array.from(logits as ArrayLike<number>);
          let score: number;
          if (raw.length === 1) {
            // Single logit → sigmoid
            score = 1 / (1 + Math.exp(-raw[0]));
          } else if (raw.length >= 2) {
            // Binary softmax → P(relevant) = exp(l1) / (exp(l0) + exp(l1))
            const e0 = Math.exp(raw[0]);
            const e1 = Math.exp(raw[1]);
            score = e1 / (e0 + e1);
          } else {
            score = 0;
          }
          scores.push(score);
        }
        return scores;
      },
      isReady() { return true; },
    };
    return singleton;
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/**
 * Rerank a list of candidate documents against a query. Returns the input
 * indices reordered by cross-encoder score (descending), each annotated with
 * the calibrated score.
 *
 * If the cross-encoder isn't available, returns the input indices in their
 * original order with score=0 — caller should fall back gracefully.
 */
export async function crossEncoderRerank(
  query: string,
  docs: string[],
  topK?: number,
): Promise<Array<{ index: number; score: number }>> {
  const ce = await getCrossEncoder();
  if (!ce) {
    // Graceful fallback — original order, zero scores.
    return docs.map((_, i) => ({ index: i, score: 0 }))
      .slice(0, topK ?? docs.length);
  }
  const scores = await ce.scoreBatch(query, docs);
  const ranked = scores
    .map((score, index) => ({ index, score }))
    .sort((a, b) => b.score - a.score);
  return topK != null ? ranked.slice(0, topK) : ranked;
}

/** Diagnostic — surface whether the model is loaded and any load error. */
export function getCrossEncoderStatus(): { loaded: boolean; attempted: boolean; error: string | null } {
  return { loaded: !!singleton, attempted: loadAttempted, error: loadError };
}

/** Reset singleton (for tests). */
export function resetCrossEncoder(): void {
  singleton = null;
  loadAttempted = false;
  loadError = null;
}
