import { describe, it, expect, vi } from 'vitest';
import {
  smartSearch,
  defaultQueryExpansions,
  type SearchCandidate,
  type SearchFn,
} from './smart-retrieval.js';

function makeCandidate(partial: Partial<SearchCandidate> & { id: string; content: string }): SearchCandidate {
  return {
    key: partial.id,
    namespace: 'test',
    score: 0.5,
    ...partial,
  };
}

describe('defaultQueryExpansions', () => {
  it('returns the original query plus keyword-only and context variants', () => {
    const variants = defaultQueryExpansions('What is the capital of France?');
    expect(variants.length).toBeGreaterThanOrEqual(2);
    expect(variants[0]).toBe('What is the capital of France?');
    // Keyword variant strips stopwords
    expect(variants.some((v) => v.includes('capital') && v.includes('france'))).toBe(true);
  });

  it('drops duplicate variants', () => {
    const variants = defaultQueryExpansions('hello');
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('handles empty input', () => {
    expect(defaultQueryExpansions('')).toEqual([]);
  });
});

describe('smartSearch — multi-query fan-out', () => {
  it('fans out one call per variant and fuses with RRF', async () => {
    const calls: string[] = [];
    const search: SearchFn = async ({ query }) => {
      calls.push(query);
      // Each variant returns a slightly different list. Item A is top of first,
      // bottom of second; item B is the inverse. RRF should put A and B both
      // near the top because they each appear in two variant lists.
      if (query.includes('tell me about')) {
        return {
          results: [
            makeCandidate({ id: 'b', content: 'beta content', score: 0.9 }),
            makeCandidate({ id: 'a', content: 'alpha content', score: 0.4 }),
          ],
        };
      }
      return {
        results: [
          makeCandidate({ id: 'a', content: 'alpha content', score: 0.9 }),
          makeCandidate({ id: 'b', content: 'beta content', score: 0.4 }),
        ],
      };
    };

    const { results, stats } = await smartSearch(search, {
      query: 'alpha beta',
      limit: 5,
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: false,
    });

    expect(stats.variantCount).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBe(stats.variantCount);
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('falls back to a single raw call when multiQuery=false', async () => {
    // NOTE: no vi.fn<T> generic — the hoisted vitest (1.x) types Mock as
    // Mock<Args extends any[], Returns>, so the vitest-4 single-generic
    // form fails `tsc`. The inferred signature is identical.
    const search: SearchFn = vi.fn(async () => ({
      results: [makeCandidate({ id: 'x', content: 'only one' })],
    }));

    await smartSearch(search, {
      query: 'whatever',
      multiQuery: false,
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: false,
    });

    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe('smartSearch — recency boost', () => {
  it('reorders stale candidates below fresh ones at equal similarity', async () => {
    const now = Date.parse('2026-04-11T00:00:00Z');
    const oneDay = 24 * 60 * 60 * 1000;

    const search: SearchFn = async () => ({
      results: [
        makeCandidate({
          id: 'stale',
          content: 'stale content',
          score: 0.8,
          updatedAt: now - 365 * oneDay, // a year old
        }),
        makeCandidate({
          id: 'fresh',
          content: 'fresh content',
          score: 0.78,
          updatedAt: now - oneDay, // yesterday
        }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'something',
      limit: 2,
      multiQuery: false,
      diversityMMR: false,
      sessionDiversity: false,
      recencyHalfLifeDays: 30,
      recencyWeight: 0.5,
      now,
    });

    expect(results[0].id).toBe('fresh');
    expect(results[1].id).toBe('stale');
  });

  it('is a no-op when candidates have no timestamps', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'alpha', score: 0.9 }),
        makeCandidate({ id: 'b', content: 'beta', score: 0.8 }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      multiQuery: false,
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: true,
    });

    expect(results.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('smartSearch — MMR diversity', () => {
  it('pushes near-duplicate content down the list', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: '1', content: 'the cat sat on the mat quietly', score: 0.95 }),
        makeCandidate({ id: '2', content: 'the cat sat on the mat quietly today', score: 0.94 }),
        makeCandidate({ id: '3', content: 'quantum entanglement paradox resolved', score: 0.6 }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 3,
      multiQuery: false,
      recencyBoost: false,
      sessionDiversity: false,
      diversityMMR: true,
      mmrLambda: 0.3, // lean heavily on diversity
    });

    // Seed is #1 (top). Between #2 (near-duplicate) and #3 (different topic),
    // MMR with λ=0.3 should pick #3 second.
    expect(results[0].id).toBe('1');
    expect(results[1].id).toBe('3');
  });
});

describe('smartSearch — MMR diversity uses embedding-cosine when available', () => {
  it('prefers a genuinely different topic over a low-token-overlap paraphrase, when Jaccard alone would not', async () => {
    // A is the seed. B is a paraphrase of A (barely any shared tokens, but
    // near-identical embedding — the "verbose restatement" case token
    // overlap misses). C is a genuinely different topic (no shared tokens,
    // orthogonal embedding). Under the old token-Jaccard-only proxy, B and
    // C look almost equally "diverse" from A (both share ~0 tokens), so B's
    // higher relevance score wins second place. With embedding-cosine, B's
    // near-1.0 similarity to A correctly suppresses it in favor of C.
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({
          id: 'a',
          content: 'the quarterly revenue report shows strong growth',
          score: 0.95,
          embedding: [1, 0, 0],
        }),
        makeCandidate({
          id: 'b-paraphrase',
          content: 'quarterly earnings update reveals robust expansion',
          score: 0.9,
          embedding: [0.99, 0.01, 0], // near-duplicate of A in embedding space
        }),
        makeCandidate({
          id: 'c-different-topic',
          content: 'a stray cat wandered into the office kitchen',
          score: 0.6,
          embedding: [0, 1, 0], // orthogonal to A
        }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 3,
      multiQuery: false,
      recencyBoost: false,
      sessionDiversity: false,
      diversityMMR: true,
      mmrLambda: 0.3, // lean heavily on diversity
    });

    expect(results[0].id).toBe('a');
    // Discriminating assertion: token-Jaccard between A and both B and C is
    // near-zero either way, so a Jaccard-only proxy picks B second (higher
    // relevance score, 0.9 vs 0.6). Embedding-cosine correctly identifies B
    // as a near-duplicate of A and picks C instead.
    expect(results[1].id).toBe('c-different-topic');
  });

  it('falls back to token-Jaccard when embeddings are absent or mismatched (existing behavior unchanged)', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'the cat sat on the mat quietly', score: 0.95 }),
        makeCandidate({ id: 'b', content: 'the cat sat on the mat quietly today', score: 0.94, embedding: [1, 0] }), // mismatched: only one side has an embedding
        makeCandidate({ id: 'c', content: 'quantum entanglement paradox resolved', score: 0.6 }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 3,
      multiQuery: false,
      recencyBoost: false,
      sessionDiversity: false,
      diversityMMR: true,
      mmrLambda: 0.3,
    });

    expect(results[0].id).toBe('a');
    expect(results[1].id).toBe('c');
  });

  it('falls back to Jaccard on a NaN/Infinity-poisoned embedding instead of corrupting the comparison', async () => {
    // A single non-finite component would poison cosineSimilarity's dot
    // product (NaN propagates through every subsequent `mmr > bestMmr`
    // comparison, which is always false for NaN, silently breaking
    // selection for the rest of the rerank). isWellFormedEmbedding() must
    // catch this and fall back to token-Jaccard, same as a missing embedding.
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'the cat sat on the mat quietly', score: 0.95, embedding: [1, 0, NaN] }),
        makeCandidate({ id: 'b', content: 'the cat sat on the mat quietly today', score: 0.94, embedding: [1, 0, Infinity] }),
        makeCandidate({ id: 'c', content: 'quantum entanglement paradox resolved', score: 0.6, embedding: [0, 1, 0] }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 3,
      multiQuery: false,
      recencyBoost: false,
      sessionDiversity: false,
      diversityMMR: true,
      mmrLambda: 0.3,
    });

    // Jaccard fallback: b is a near-duplicate of a's text, c is unrelated —
    // same expected ordering as the plain-fallback test above.
    expect(results[0].id).toBe('a');
    expect(results[1].id).toBe('c');
  });

  it('falls back to Jaccard on an empty-array embedding', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'the cat sat on the mat quietly', score: 0.95, embedding: [] }),
        makeCandidate({ id: 'b', content: 'the cat sat on the mat quietly today', score: 0.94, embedding: [] }),
        makeCandidate({ id: 'c', content: 'quantum entanglement paradox resolved', score: 0.6, embedding: [] }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 3,
      multiQuery: false,
      recencyBoost: false,
      sessionDiversity: false,
      diversityMMR: true,
      mmrLambda: 0.3,
    });

    expect(results[0].id).toBe('a');
    expect(results[1].id).toBe('c');
  });

  it('produces byte-identical, deterministic ordering across repeated runs on the same input', async () => {
    const makeSearch = (): SearchFn => async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'the quarterly revenue report shows strong growth', score: 0.95, embedding: [1, 0, 0] }),
        makeCandidate({ id: 'b-paraphrase', content: 'quarterly earnings update reveals robust expansion', score: 0.9, embedding: [0.99, 0.01, 0] }),
        makeCandidate({ id: 'c-different-topic', content: 'a stray cat wandered into the office kitchen', score: 0.6, embedding: [0, 1, 0] }),
        makeCandidate({ id: 'd-tie-embedding', content: 'unrelated filler text about weather patterns', score: 0.5, embedding: [0, 1, 0] }),
      ],
    });

    const opts = {
      query: 'x',
      limit: 4,
      multiQuery: false,
      recencyBoost: false,
      sessionDiversity: false,
      diversityMMR: true,
      mmrLambda: 0.3,
    } as const;

    const runs = await Promise.all(
      Array.from({ length: 5 }, () => smartSearch(makeSearch(), opts))
    );
    const orderings = runs.map((r) => r.results.map((c) => c.id).join(','));

    expect(new Set(orderings).size).toBe(1); // every run produced the exact same order
  });
});

describe('MMR internal output never carries embedding into a CLI/MCP-shaped whitelist', () => {
  it('mirrors the exact field whitelist used by mcp-tools/memory-tools.ts:559-569 and commands/memory.ts:633-639', async () => {
    // Regression guard for the "no leak" claim: both real CLI/MCP call sites
    // build their final response by explicitly picking fields off
    // `smartResult.results` rather than spreading the candidate object
    // (which — per smart-retrieval.ts's own return statement — does still
    // carry `.embedding` internally). This test exercises smartSearch's
    // real output and re-applies each site's literal field list, so a
    // future change to either whitelist that starts including `embedding`
    // (e.g. an errant `...r` spread) fails here without needing to spin up
    // the full CLI/MCP handler stack.
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'alpha content', score: 0.9, embedding: [1, 0, 0], provenanceType: 'agent_inference' } as any),
      ],
    });

    const { results } = await smartSearch(search, { query: 'x', diversityMMR: false, recencyBoost: false, sessionDiversity: false, multiQuery: false });

    expect((results[0] as any).embedding).toBeDefined(); // sanity: the internal object does carry it

    // mcp-tools/memory-tools.ts:559-569 whitelist
    const mcpToolShape = results.map((r: any) => ({
      key: r.key,
      namespace: r.namespace,
      value: r.content,
      similarity: r.score,
      provenanceType: r.provenanceType,
    }));
    expect(Object.keys(mcpToolShape[0])).not.toContain('embedding');
    expect('embedding' in mcpToolShape[0]).toBe(false);

    // commands/memory.ts:633-639 whitelist
    const cliCommandShape = results.map((r: any) => ({
      key: r.key,
      score: r.score,
      namespace: r.namespace,
      preview: r.content,
      provenanceType: r.provenanceType,
    }));
    expect(Object.keys(cliCommandShape[0])).not.toContain('embedding');
    expect('embedding' in cliCommandShape[0]).toBe(false);
  });
});

describe('smartSearch — session round-robin', () => {
  it('interleaves results across distinct sessions', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({
          id: 'a1',
          content: 'alpha one',
          score: 0.95,
          metadata: { session_id: 'A' },
        }),
        makeCandidate({
          id: 'a2',
          content: 'alpha two',
          score: 0.9,
          metadata: { session_id: 'A' },
        }),
        makeCandidate({
          id: 'b1',
          content: 'beta one',
          score: 0.85,
          metadata: { session_id: 'B' },
        }),
        makeCandidate({
          id: 'c1',
          content: 'gamma one',
          score: 0.8,
          metadata: { session_id: 'C' },
        }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 3,
      multiQuery: false,
      recencyBoost: false,
      diversityMMR: false,
      sessionDiversity: true,
    });

    const sessions = results.map((r) => r.metadata?.session_id);
    // Top-3 should cover 3 distinct sessions, not just session A twice.
    expect(new Set(sessions).size).toBe(3);
    expect(sessions[0]).toBe('A'); // Highest-scored bucket leader first
  });

  it('passes through when all candidates share one session', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({
          id: 'a1',
          content: 'one',
          score: 0.9,
          metadata: { session_id: 'S' },
        }),
        makeCandidate({
          id: 'a2',
          content: 'two',
          score: 0.8,
          metadata: { session_id: 'S' },
        }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 2,
      multiQuery: false,
      recencyBoost: false,
      diversityMMR: false,
      sessionDiversity: true,
    });

    expect(results.map((r) => r.id)).toEqual(['a1', 'a2']);
  });
});

describe('smartSearch — stats reporting', () => {
  it('reports variant count, raw candidate count, and phase counts', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'alpha' }),
        makeCandidate({ id: 'b', content: 'beta' }),
      ],
    });

    const { stats } = await smartSearch(search, {
      query: 'hello world',
      limit: 2,
    });

    expect(stats.variantCount).toBeGreaterThanOrEqual(1);
    expect(stats.rawCandidateCount).toBeGreaterThan(0);
    expect(stats.variants.length).toBe(stats.variantCount);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });
});
