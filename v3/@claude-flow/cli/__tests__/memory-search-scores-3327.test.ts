import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawSearchRequest } from '../../memory/src/smart-retrieval.js';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false), mkdirSync: vi.fn(), readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => '{}'), unlinkSync: vi.fn(), writeFileSync: vi.fn(),
}));

const { searchEntries } = vi.hoisted(() => ({ searchEntries: vi.fn() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  searchEntries,
  storeEntry: vi.fn(), listEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
}));

const entry = (key: string, score: number) => ({
  id: key, key, content: JSON.stringify({ note: key }), score, namespace: 'test',
  provenanceType: 'tool_result', embedding: [1, 0, 0],
});
interface SearchResponse {
  results: Array<{ key: string; namespace: string; value: unknown; similarity: number; rankingScore?: number }>;
  total: number;
  backend: string;
  smartFallback?: string;
  stats?: { variantCount: number; rawCandidateCount: number };
}
let memoryModuleFactory: () => object | Promise<object>;
async function search(input: Record<string, unknown>): Promise<SearchResponse> {
  // Register once per search: two queued doMock calls for this resolved ID
  // can finish out of order while Vite resolves their module IDs.
  vi.doMock('/@id/@claude-flow/memory', memoryModuleFactory);
  const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
  return memoryTools.find(t => t.name === 'memory_search')!.handler(input) as Promise<SearchResponse>;
}

beforeEach(() => {
  vi.resetModules();
  searchEntries.mockReset();
  // Run the actual pipeline from this checkout. Only the store/initialization
  // are faked; this exercises the real MCP handler and its response whitelist.
  // The CLI's externalize-optional-deps plugin rewrites this dynamic import
  // to /@id/...; mock that resolved ID so Vitest 4 intercepts the import.
  memoryModuleFactory = async () => import('../../memory/src/smart-retrieval.js');
});
afterEach(() => vi.restoreAllMocks());

describe('memory_search score contract (#3327 Finding B)', () => {
  it('returns raw relevance as similarity, never the RRF ranking score', async () => {
    searchEntries.mockImplementation(async ({ query }: RawSearchRequest) => ({
      success: true, results: query === 'alpha'
        ? [entry('a', 0.8)] : [entry('b', 0.9), entry('a', 0.65)],
    }));
    const result = await search({ query: 'alpha', smart: true });
    expect(result.backend).toBe('SmartRetrieval (RRF + MMR + Recency)');
    expect(result.results.map(r => r.key)).toEqual(['a', 'b']);
    // Baseline fails here: similarity is 0.03252247488101534, not 0.8.
    expect(result.results[0].similarity).toBe(0.8);
    expect(result.results[0].rankingScore).toBe(1 / 61 + 1 / 62);
    expect(result.results[0]).toEqual({
      key: 'a', namespace: 'test', value: { note: 'a' }, similarity: 0.8,
      rankingScore: 1 / 61 + 1 / 62, provenanceType: 'tool_result',
    }); // embedding, rawScore, and other internal fields must not leak
    expect(result.total).toBe(2);
  });

  it('uses the highest retrieval relevance across all expanded queries', async () => {
    const scores: Record<string, number> = {
      'What is alpha?': 0.41, alpha: 0.73, 'tell me about what is alpha': 0.52,
    };
    searchEntries.mockImplementation(async ({ query }: RawSearchRequest) => ({
      success: true, results: [entry('a', scores[query])],
    }));
    const result = await search({ query: 'What is alpha?', smart: true });
    expect(searchEntries).toHaveBeenCalledTimes(3);
    expect(result.results[0].similarity).toBe(0.73);
    expect(result.results[0].rankingScore).toBe(3 / 61);
  });

  it('retains admitted results even when final ranking is below threshold', async () => {
    searchEntries.mockImplementation(async ({ threshold }: RawSearchRequest) => ({
      success: true, results: [entry('a', 0.7), entry('b', 0.2)]
        .filter(r => r.score >= (threshold ?? 0)),
    }));
    const result = await search({
      query: 'alpha', smart: true, threshold: 0.3, namespace: 'test',
      provenance_filter: ['tool_result'],
    });
    expect(result.results.map(r => r.key)).toEqual(['a']);
    expect(result.results[0].similarity).toBe(0.7);
    expect(result.results[0].rankingScore).toBe(2 / 61);
    for (const [request] of searchEntries.mock.calls) {
      expect(request).toMatchObject({ threshold: 0.3, namespace: 'test', provenanceFilter: ['tool_result'] });
    }
    expect(result.stats).toMatchObject({ rawCandidateCount: 2, variantCount: 2 });
  });

  it('preserves zero similarity instead of falling back to a positive ranking score', async () => {
    searchEntries.mockResolvedValue({ success: true, results: [entry('a', 0)] });
    const result = await search({ query: 'alpha', smart: true, threshold: 0 });
    expect(result.results[0].similarity).toBe(0);
    expect(result.results[0].rankingScore).toBe(2 / 61);
  });

  it('keeps standard search output compatible without rankingScore', async () => {
    searchEntries.mockResolvedValue({ success: true, results: [entry('a', 0.49)] });
    const result = await search({ query: 'alpha', smart: false });
    expect(result.results).toEqual([{
      key: 'a', namespace: 'test', value: { note: 'a' }, similarity: 0.49, provenanceType: 'tool_result',
    }]);
    expect(searchEntries).toHaveBeenCalledTimes(1);
  });

  it.each(['missing export', 'import failure'])('preserves standard fallback on %s', async (reason) => {
    memoryModuleFactory = () => {
      if (reason === 'import failure') throw new Error('unavailable package');
      return { smartSearch: undefined };
    };
    searchEntries.mockResolvedValue({ success: true, results: [entry('a', 0.49)] });
    const result = await search({ query: 'alpha', smart: true });
    expect(result.results).toEqual([{
      key: 'a', namespace: 'test', value: { note: 'a' }, similarity: 0.49, provenanceType: 'tool_result',
    }]);
    expect(result.smartFallback).toContain(reason === 'import failure' ? 'failed to load' : 'not exported');
    expect(result.backend).toBe('HNSW + sql.js');
    expect(searchEntries).toHaveBeenCalledTimes(1);
  });

  it('supplies rawScore to older SmartRetrieval implementations that preserve candidate fields', async () => {
    memoryModuleFactory = () => ({
      // The existing return projection is {...candidate, score}. This fake
      // deliberately does not create rawScore: the MCP adapter must supply it.
      smartSearch: async (rawSearch: (request: RawSearchRequest) => Promise<{ results: object[] }>) => {
        const raw = await rawSearch({ query: 'alpha' });
        return { results: raw.results.map(r => ({ ...r, score: 0.05 })), stats: {} };
      },
    });
    searchEntries.mockResolvedValue({ success: true, results: [entry('a', 0)] });
    const result = await search({ query: 'alpha', smart: true, threshold: 0 });
    expect(result.results[0].similarity).toBe(0);
    expect(result.results[0].rankingScore).toBe(0.05);
  });
});
