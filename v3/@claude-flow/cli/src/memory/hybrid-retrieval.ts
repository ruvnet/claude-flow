// Hybrid retrieval — sparse (BM25) + dense (cosine) + MMR diversity.
//
// Why: on small corpora (N<1k) a bi-encoder like all-MiniLM-L6-v2 produces
// noisy cosine scores — random short commits with low-IDF token overlap can
// outrank exact-keyword matches. BM25 over the same text recovers the
// "did the query's content tokens actually appear?" signal. We linearly
// combine the two on normalised scores, then MMR-rerank to suppress
// near-duplicate top-K.
//
// Pure functions, no external deps. Tested via __tests__/hybrid-retrieval.test.ts
// and the live A/B in scripts/benchmark-pretrained-retrieval.mjs (HYBRID=0|1).

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','of','in','to','for','on','at',
  'by','with','from','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','should','could','can','may','might','must','this',
  'that','these','those','it','its','as','also','not','no','so','too','very',
]);

/** Tokenise text into lowercase content tokens (drops stopwords + length<3). */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\-/.]+/g)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export interface CorpusStats {
  /** docFreq: how many documents contain each token */
  df: Map<string, number>;
  /** idf: log((N - df + 0.5) / (df + 0.5) + 1) — BM25's smoothed IDF */
  idf: Map<string, number>;
  /** averageDocumentLength in tokens */
  avgDocLen: number;
  /** total docs in corpus */
  N: number;
}

/** Build BM25 corpus statistics from a set of tokenised documents. */
export function buildCorpusStats(tokenisedDocs: string[][]): CorpusStats {
  const N = tokenisedDocs.length;
  const df = new Map<string, number>();
  let totalLen = 0;

  for (const doc of tokenisedDocs) {
    totalLen += doc.length;
    const seen = new Set<string>();
    for (const tok of doc) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [tok, dfVal] of df) {
    // BM25 smoothed IDF — never negative, always > 0
    idf.set(tok, Math.log(1 + (N - dfVal + 0.5) / (dfVal + 0.5)));
  }

  return { df, idf, avgDocLen: N > 0 ? totalLen / N : 0, N };
}

/**
 * Type penalty for meta-commits — multiplies the hybrid score by `factor`
 * when the document's name matches the meta-commit regex (release bumps,
 * merge commits, badge updates, etc.). These commits bundle every issue
 * number from a release window and steal top-1 from real work commits.
 *
 * Defaults: factor 0.5, regex covers `chore(release)`, `Merge `, `bump `,
 * `[Dream Cycle]`, `publish 3.x.y`. Tune via env or call site.
 */
export const META_COMMIT_REGEX = /^(chore\(release\)|Merge\s|bump\s|publish\s+\d|\[Dream Cycle\b)/i;

export function typePenalty(name: string | undefined, factor = 0.5, regex = META_COMMIT_REGEX): number {
  if (!name) return 1.0;
  return regex.test(name) ? factor : 1.0;
}

/**
 * BM25 score of one document against a query.
 * Standard Okapi formula with k1=1.5 and b=0.75.
 */
export function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  stats: CorpusStats,
  k1 = 1.5,
  b = 0.75,
): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  // Term frequency in this document
  const tf = new Map<string, number>();
  for (const tok of docTokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);

  const docLen = docTokens.length;
  const norm = docLen / (stats.avgDocLen || 1);

  let score = 0;
  for (const qt of queryTokens) {
    const f = tf.get(qt);
    if (!f) continue;
    const idf = stats.idf.get(qt) ?? 0;
    if (idf === 0) continue;
    const numerator = f * (k1 + 1);
    const denominator = f + k1 * (1 - b + b * norm);
    score += idf * (numerator / denominator);
  }
  return score;
}

/**
 * Min-max normalise a score vector to [0, 1].
 * Returns the original vector if it is constant (avoid divide-by-zero).
 */
export function normalise(scores: number[]): number[] {
  if (scores.length === 0) return scores;
  let lo = Infinity, hi = -Infinity;
  for (const s of scores) {
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  const range = hi - lo;
  if (range < 1e-9) return scores.map(() => 0.5);
  return scores.map((s) => (s - lo) / range);
}

/**
 * Combine cosine and BM25 scores. Both vectors must be aligned by docIndex.
 * Returns hybridScores[] aligned to the same index.
 * alpha controls the cosine weight; (1-alpha) is the BM25 weight.
 */
export function hybridScores(
  cosine: number[],
  bm25: number[],
  alpha = 0.6,
): number[] {
  if (cosine.length !== bm25.length) {
    throw new Error('hybridScores: cosine and bm25 length mismatch');
  }
  const cN = normalise(cosine);
  const bN = normalise(bm25);
  return cN.map((c, i) => alpha * c + (1 - alpha) * bN[i]);
}

/**
 * Multi-field BM25 score — treats subject and body as separate fields with
 * independent token frequencies, then combines `subjectWeight * subjectBM25
 * + bodyWeight * bodyBM25`. Subject (commit title / pattern name) carries
 * the high-signal tokens (file names, action verbs, ADR refs); body is
 * often boilerplate. Default 3:1 weight reflects that asymmetry.
 *
 * Caller must build separate CorpusStats for subjects and bodies (their
 * IDF distributions differ — subjects are short, bodies long).
 */
export function multiFieldBM25(
  queryTokens: string[],
  subjectTokens: string[],
  bodyTokens: string[],
  subjectStats: CorpusStats,
  bodyStats: CorpusStats,
  subjectWeight = 3.0,
  bodyWeight = 1.0,
): number {
  const sScore = bm25Score(queryTokens, subjectTokens, subjectStats);
  const bScore = bm25Score(queryTokens, bodyTokens, bodyStats);
  return subjectWeight * sScore + bodyWeight * bScore;
}

/**
 * Cosine similarity between two equal-length numeric vectors.
 * Returns 0 if either has zero norm.
 */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 1e-9 ? dot / denom : 0;
}

/**
 * Maximal Marginal Relevance rerank.
 *
 * Greedy selection: at each step pick the candidate that maximises
 *   lambda * relevance(c) - (1-lambda) * max(similarity(c, picked))
 *
 * lambda=1.0 → pure relevance (no diversity adjustment)
 * lambda=0.0 → pure diversity
 *
 * Default lambda=0.5 balances both.
 */
export function mmrRerank<T extends { embedding: number[] }>(
  candidates: Array<T & { relevance: number }>,
  k: number,
  lambda = 0.5,
): Array<T & { relevance: number; mmrScore: number }> {
  if (candidates.length === 0 || k === 0) return [];

  const picked: Array<T & { relevance: number; mmrScore: number }> = [];
  const remaining = candidates.slice();

  while (picked.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let maxSimToPicked = 0;
      for (const p of picked) {
        const s = cosineSim(cand.embedding, p.embedding);
        if (s > maxSimToPicked) maxSimToPicked = s;
      }
      const mmrScore = lambda * cand.relevance - (1 - lambda) * maxSimToPicked;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    picked.push({ ...chosen, mmrScore: bestScore });
  }

  return picked;
}
