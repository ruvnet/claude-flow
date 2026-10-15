import { describe, expect, it } from 'vitest';
import { smartSearch, type SearchCandidate, type SearchFn } from './smart-retrieval.js';

const candidate = (id: string, score: number): SearchCandidate => ({
  id, key: id, content: id, namespace: 'test', score,
});
const isolated = {
  query: 'original', recencyBoost: false, diversityMMR: false, sessionDiversity: false,
};

describe('smartSearch raw retrieval score (#3327 Finding B)', () => {
  it('retains raw relevance separately from multi-query RRF ranking', async () => {
    const search: SearchFn = async ({ query }) => ({ results: query === 'original'
      ? [candidate('a', 0.8)]
      : [candidate('b', 0.9), candidate('a', 0.65)],
    });
    const result = await smartSearch(search, {
      ...isolated, queryExpansions: () => ['original', 'expanded'],
    });
    expect(result.results.map(r => r.id)).toEqual(['a', 'b']);
    expect(result.results[0].score).toBe(1 / 61 + 1 / 62);
    expect(result.results[0]).toMatchObject({ rawScore: 0.8 });
  });

  it('retains the highest raw score across query variants', async () => {
    const scores: Record<string, number> = { a: 0.41, b: 0.73, c: 0.52 };
    const result = await smartSearch(async ({ query }) => ({
      results: [candidate('same-document', scores[query])],
    }), { ...isolated, queryExpansions: () => ['a', 'b', 'c'] });
    expect(result.results[0].score).toBe(3 / 61);
    expect(result.results[0]).toMatchObject({ rawScore: 0.73 });
  });

  it('preserves single-query scores and order, including zero', async () => {
    const inputs = [candidate('a', 0.8), candidate('b', 0)];
    const result = await smartSearch(async () => ({ results: inputs }), {
      ...isolated, multiQuery: false, threshold: 0,
    });
    expect(result.results).toEqual(inputs.map(r => ({ ...r, rawScore: r.score })));
    expect(inputs[0]).not.toHaveProperty('rawScore'); // no mutation of SearchFn results
  });

  it('keeps raw zero while recency changes the final ranking score', async () => {
    const result = await smartSearch(async () => ({ results: [{
      ...candidate('a', 0), updatedAt: 1000,
    }] }), {
      ...isolated, queryExpansions: () => ['a', 'b'], threshold: 0,
      recencyBoost: true, now: 1000,
    });
    expect(result.results[0].score).toBe((2 / 61) * 1.2);
    expect(result.results[0]).toMatchObject({ rawScore: 0 });
  });

  it('preserves an explicitly supplied rawScore of zero', async () => {
    const result = await smartSearch(async () => ({ results: [{
      ...candidate('a', 0.4), rawScore: 0,
    }] }), { ...isolated, multiQuery: false });
    expect(result.results[0]).toMatchObject({ score: 0.4, rawScore: 0 });
  });

  it('applies threshold only through raw candidate admission', async () => {
    const admitted: string[][] = [];
    const thresholds: Array<number | undefined> = [];
    const search: SearchFn = async ({ threshold }) => {
      thresholds.push(threshold);
      const results = [candidate('a', 0.7), candidate('b', 0.2)]
        .filter(r => r.score >= (threshold ?? 0));
      admitted.push(results.map(r => r.id));
      return { results };
    };
    const result = await smartSearch(search, {
      ...isolated, threshold: 0.3, queryExpansions: () => ['a', 'b'],
    });
    expect(thresholds).toEqual([0.3, 0.3]);
    expect(admitted).toEqual([['a'], ['a']]);
    expect(result.results.map(r => r.id)).toEqual(['a']);
    expect(result.results[0].score).toBe(2 / 61);
    expect(result.results[0].score).toBeLessThan(0.3);
    expect(result.results[0]).toMatchObject({ rawScore: 0.7 });
  });
});
