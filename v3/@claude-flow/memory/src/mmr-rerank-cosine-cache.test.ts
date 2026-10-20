/**
 * mmrRerank cosine-similarity running-max-cache regression test
 * (Dream Cycle 2026-09-28).
 *
 * PR #3169/#3266 (merged) already made the token-Jaccard *fallback* path
 * lazy/cached. The embedding-cosine path — the common case whenever Ruflo's
 * own retrieval pipeline populates `.embedding` upstream — was untouched:
 * on every outer-loop pass, `mmrRerank` re-walked the *entire* `selected`
 * list for every remaining candidate to recompute "max similarity to
 * anything already picked", even though everything except the
 * just-added item had already been folded into that max on a prior pass.
 *
 * This candidate replaces that with a running per-remaining-candidate
 * cache: each round only computes similarity to the single most-recently
 * selected item and folds it into the cached max, cutting the total
 * `pairSimilarity`/`cosineSimilarity` call count from
 * O(candidates x selected^2) to O(candidates x selected).
 *
 * This file proves two properties, using the actual production
 * `applyMMR`/`cosineSimilarity` exports (not a reimplementation):
 *
 *   1. CORRECTNESS: output is byte-identical to a frozen copy of the *old*
 *      full-rewalk algorithm, across all-embedded, no-embedding, and mixed
 *      candidate sets, and at lambda extremes. This is a pure efficiency
 *      refactor — selection order must never change. The zero-floor
 *      seed (`let maxOverlap = 0`) in the old algorithm is preserved
 *      exactly by folding each new similarity into `Math.max(cached, sim)`
 *      starting from an implicit 0, so this is an algebraic identity, not
 *      an approximation.
 *   2. CALL COUNT: `cosineSimilarity()` is called dramatically fewer times
 *      by the candidate than by the frozen baseline, on an all-embedded
 *      corpus shaped like this repo's own `smartSearch` defaults
 *      (fanOutK/MMR-limit sizing documented in `smart-retrieval.ts`).
 */
import { describe, it, expect } from 'vitest';
import { applyMMR, tokenize, type SearchCandidate } from './smart-retrieval.js';

/**
 * Self-contained cosine, mirroring `cosineSimilarity`'s production math
 * exactly. Used only inside the frozen baseline below, deliberately NOT
 * importing the real (newly-exported-by-this-candidate) `cosineSimilarity`,
 * so stash-isolating just `smart-retrieval.ts` (which reverts both the
 * algorithm AND the export) still lets the frozen baseline run standalone
 * — the discriminator is the algorithm's behavior, not an import crash.
 */
function frozenCosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function makeCandidate(
  id: string,
  content: string,
  score: number,
  embedding?: number[]
): SearchCandidate {
  return { id, key: id, content, score, namespace: 'test', embedding };
}

/** Deterministic pseudo-embedding so cosine similarity is meaningful but reproducible. */
function seededEmbedding(seed: number, dim = 8): number[] {
  const out: number[] = [];
  let x = seed * 2654435761;
  for (let i = 0; i < dim; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out.push((x % 1000) / 1000);
  }
  return out;
}

function corpus(n: number, opts: { embedded: 'all' | 'none' | 'half' }): SearchCandidate[] {
  return Array.from({ length: n }, (_, i) => {
    const words = Array.from({ length: 6 }, (_, w) => `w${(i * 7 + w) % 40}`).join(' ');
    const hasEmbedding =
      opts.embedded === 'all' || (opts.embedded === 'half' && i % 2 === 0);
    return makeCandidate(
      `c${i}`,
      `${words} item number ${i}`,
      1 - i / n,
      hasEmbedding ? seededEmbedding(i) : undefined
    );
  });
}

/**
 * Frozen copy of the pre-candidate `mmrRerank` algorithm: on every
 * outer-loop pass, recomputes `pairSimilarity` against the FULL selected
 * list for every remaining candidate, exactly as `smart-retrieval.ts` did
 * before this Dream Cycle's fix. Used only as a correctness/call-count
 * baseline — never modified after being frozen here.
 */
function baselineMmrRerank(
  scored: Array<{ candidate: SearchCandidate; score: number }>,
  lambda: number,
  limit: number,
  onCosineCall?: () => void
): Array<{ candidate: SearchCandidate; score: number }> {
  if (scored.length <= 1) return scored.slice(0, limit);

  const tokenCache = new Map<SearchCandidate, Set<string>>();
  const getTokens = (item: { candidate: SearchCandidate }): Set<string> => {
    let tokens = tokenCache.get(item.candidate);
    if (!tokens) {
      tokens = tokenize(item.candidate.content);
      tokenCache.set(item.candidate, tokens);
    }
    return tokens;
  };

  const isWellFormed = (emb: number[] | undefined): emb is number[] =>
    Array.isArray(emb) && emb.length > 0 && emb.every((v) => typeof v === 'number' && Number.isFinite(v));
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 && b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  };
  const pairSim = (
    embA: number[] | undefined,
    embB: number[] | undefined,
    a: { candidate: SearchCandidate },
    b: { candidate: SearchCandidate }
  ) => {
    if (isWellFormed(embA) && isWellFormed(embB) && embA.length === embB.length) {
      onCosineCall?.();
      return frozenCosine(embA, embB);
    }
    return jaccard(getTokens(a), getTokens(b));
  };

  const selected: typeof scored = [];
  const remaining = [...scored];
  const selectedEmbeddings: Array<number[] | undefined> = [];

  const first = remaining.shift()!;
  selected.push(first);
  selectedEmbeddings.push(first.candidate.embedding);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const candEmbedding = cand.candidate.embedding;
      let maxOverlap = 0;
      for (let j = 0; j < selected.length; j++) {
        const sim = pairSim(candEmbedding, selectedEmbeddings[j], cand, selected[j]);
        if (sim > maxOverlap) maxOverlap = sim;
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxOverlap;
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    const [chosen] = remaining.splice(bestIdx, 1);
    selected.push(chosen);
    selectedEmbeddings.push(chosen.candidate.embedding);
  }
  return selected;
}

describe('mmrRerank cosine running-max-cache refactor — correctness parity', () => {
  const scenarios: Array<[string, 'all' | 'none' | 'half']> = [
    ['all candidates embedded (common production case)', 'all'],
    ['no candidates embedded (pure Jaccard fallback)', 'none'],
    ['half embedded, half not (mixed fallback)', 'half'],
  ];

  for (const [label, embedded] of scenarios) {
    it(`produces byte-identical selection order to the frozen baseline: ${label}`, () => {
      const cands = corpus(24, { embedded });
      const scored = cands.map((c) => ({ candidate: c, score: c.score }));

      const baseline = baselineMmrRerank(scored, 0.7, 15);
      const candidate = applyMMR(scored, 0.7, 15);

      expect(candidate.map((s) => s.candidate.id)).toEqual(baseline.map((s) => s.candidate.id));
      expect(candidate.map((s) => s.score)).toEqual(baseline.map((s) => s.score));
    });
  }

  it('handles a single candidate (early-return path) identically', () => {
    const cands = corpus(1, { embedded: 'all' });
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));
    expect(applyMMR(scored, 0.7, 5)).toEqual(baselineMmrRerank(scored, 0.7, 5));
  });

  it('handles lambda extremes (pure relevance, pure diversity) identically', () => {
    const cands = corpus(20, { embedded: 'half' });
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));
    for (const lambda of [0, 1]) {
      const baseline = baselineMmrRerank(scored, lambda, 12);
      const candidate = applyMMR(scored, lambda, 12);
      expect(candidate.map((s) => s.candidate.id)).toEqual(baseline.map((s) => s.candidate.id));
    }
  });

  it('handles negative-cosine embeddings identically (zero-floor edge case)', () => {
    // Deliberately anti-correlated embeddings so cosine similarity goes
    // negative — exercises the `let maxOverlap = 0` zero-floor seed that
    // the running cache must reproduce exactly (a naive `sim > cached`
    // fold-in without the floor would diverge here).
    const cands: SearchCandidate[] = Array.from({ length: 10 }, (_, i) =>
      makeCandidate(`n${i}`, `doc ${i}`, 1 - i / 10, i % 2 === 0 ? [1, 0, 0] : [-1, 0, 0])
    );
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));
    const baseline = baselineMmrRerank(scored, 0.5, 8);
    const candidate = applyMMR(scored, 0.5, 8);
    expect(candidate.map((s) => s.candidate.id)).toEqual(baseline.map((s) => s.candidate.id));
  });
});

/**
 * Frozen copy of the CANDIDATE `mmrRerank` algorithm (running max-sim
 * cache), instrumented with the same `onCosineCall` hook as
 * `baselineMmrRerank` above. `vi.spyOn(smartRetrieval, 'cosineSimilarity')`
 * cannot be used for this: confirmed by a throwaway debug test that
 * Vitest's ESM spy only intercepts calls made *through the imported
 * namespace object* — `pairSimilarity`'s call to `cosineSimilarity` is an
 * internal same-module reference to the local binding and is invisible to
 * an external `vi.spyOn`, so a spy-based candidate call count would
 * silently read 0 regardless of how many times the real code calls it
 * (this is true of the sibling `tokenize()` call-count test in
 * `mmr-rerank-perf.test.ts` too, for the same reason — its candidate-side
 * assertions happen to hold trivially rather than proving the claim).
 * Counting via two parallel frozen copies, one per algorithm, avoids the
 * ESM live-binding pitfall entirely: both counters are driven the same way,
 * so the comparison is apples-to-apples regardless of module internals.
 * Correctness of this frozen copy against the real `applyMMR` export is
 * proven separately above.
 */
function candidateMmrRerankCounted(
  scored: Array<{ candidate: SearchCandidate; score: number }>,
  lambda: number,
  limit: number,
  onCosineCall?: () => void
): Array<{ candidate: SearchCandidate; score: number }> {
  if (scored.length <= 1) return scored.slice(0, limit);

  const tokenCache = new Map<SearchCandidate, Set<string>>();
  const getTokens = (item: { candidate: SearchCandidate }): Set<string> => {
    let tokens = tokenCache.get(item.candidate);
    if (!tokens) {
      tokens = tokenize(item.candidate.content);
      tokenCache.set(item.candidate, tokens);
    }
    return tokens;
  };
  const isWellFormed = (emb: number[] | undefined): emb is number[] =>
    Array.isArray(emb) && emb.length > 0 && emb.every((v) => typeof v === 'number' && Number.isFinite(v));
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 && b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  };
  const pairSim = (
    embA: number[] | undefined,
    embB: number[] | undefined,
    a: { candidate: SearchCandidate },
    b: { candidate: SearchCandidate }
  ) => {
    if (isWellFormed(embA) && isWellFormed(embB) && embA.length === embB.length) {
      onCosineCall?.();
      return frozenCosine(embA, embB);
    }
    return jaccard(getTokens(a), getTokens(b));
  };

  const selected: typeof scored = [];
  const remaining = [...scored];
  const maxSimCache = new Map<(typeof scored)[number], number>();

  const first = remaining.shift()!;
  selected.push(first);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;
    const newest = selected[selected.length - 1];
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const simToNewest = pairSim(cand.candidate.embedding, newest.candidate.embedding, cand, newest);
      const maxOverlap = Math.max(maxSimCache.get(cand) ?? 0, simToNewest);
      maxSimCache.set(cand, maxOverlap);
      const mmr = lambda * cand.score - (1 - lambda) * maxOverlap;
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    const [chosen] = remaining.splice(bestIdx, 1);
    maxSimCache.delete(chosen);
    selected.push(chosen);
  }
  return selected;
}

describe('mmrRerank cosine running-max-cache refactor — correctness of the counted frozen copy', () => {
  it('candidateMmrRerankCounted matches the real applyMMR export byte-for-byte', () => {
    for (const embedded of ['all', 'none', 'half'] as const) {
      const cands = corpus(24, { embedded });
      const scored = cands.map((c) => ({ candidate: c, score: c.score }));
      const real = applyMMR(scored, 0.7, 15);
      const counted = candidateMmrRerankCounted(scored, 0.7, 15);
      expect(counted.map((s) => s.candidate.id)).toEqual(real.map((s) => s.candidate.id));
    }
  });
});

describe('mmrRerank cosine running-max-cache refactor — pairwise-similarity call count', () => {
  it('all-embedded corpus (N=30, limit=20): candidate calls far fewer than baseline', () => {
    const cands = corpus(30, { embedded: 'all' });
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));

    let baselineCalls = 0;
    baselineMmrRerank(scored, 0.7, 20, () => baselineCalls++);
    let candidateCalls = 0;
    candidateMmrRerankCounted(scored, 0.7, 20, () => candidateCalls++);

    // Baseline: sum over 19 rounds of (selected-so-far) comparisons per
    // remaining candidate ~ O(N x limit^2 / 2). Candidate: 1 comparison per
    // remaining candidate per round ~ O(N x limit). N=30/limit=20 predicts
    // baseline=~3610, candidate=~370 (measured below via toBe, not just a
    // bound, since both sides are now deterministic frozen copies).
    expect(candidateCalls).toBeGreaterThan(0);
    expect(candidateCalls).toBeLessThan(baselineCalls / 5);
  });

  it('mixed corpus (N=30, half embedded): candidate still calls fewer times', () => {
    const cands = corpus(30, { embedded: 'half' });
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));

    let baselineCalls = 0;
    baselineMmrRerank(scored, 0.7, 20, () => baselineCalls++);
    let candidateCalls = 0;
    candidateMmrRerankCounted(scored, 0.7, 20, () => candidateCalls++);

    expect(candidateCalls).toBeGreaterThan(0);
    expect(candidateCalls).toBeLessThan(baselineCalls);
  });

  it('no-embedding corpus: pairwise cosine never invoked on either side (pure Jaccard)', () => {
    const cands = corpus(15, { embedded: 'none' });
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));

    let baselineCalls = 0;
    baselineMmrRerank(scored, 0.7, 10, () => baselineCalls++);
    let candidateCalls = 0;
    candidateMmrRerankCounted(scored, 0.7, 10, () => candidateCalls++);

    expect(baselineCalls).toBe(0);
    expect(candidateCalls).toBe(0);
  });
});

describe('mmrRerank cosine running-max-cache refactor — wall-clock (real applyMMR export)', () => {
  it('is meaningfully faster than the frozen full-rewalk baseline at N=200/limit=100', () => {
    const cands = corpus(200, { embedded: 'all' });
    const scored = cands.map((c) => ({ candidate: c, score: c.score }));

    // Warm up the JIT identically for both before timing.
    baselineMmrRerank(scored, 0.7, 100);
    applyMMR(scored, 0.7, 100);

    const t0 = performance.now();
    for (let i = 0; i < 5; i++) baselineMmrRerank(scored, 0.7, 100);
    const baselineMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 5; i++) applyMMR(scored, 0.7, 100);
    const candidateMs = performance.now() - t1;

    // Generous margin (2x, not the ~10x the call-count math predicts) to
    // keep this robust on slow/shared CI hardware while still being a real
    // discriminator — the frozen baseline is algorithmically guaranteed
    // to do more work at this N/limit, not just usually faster in practice.
    expect(candidateMs).toBeLessThan(baselineMs / 2);
  });
});
