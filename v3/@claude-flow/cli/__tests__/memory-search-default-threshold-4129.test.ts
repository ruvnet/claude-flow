import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEARCH_THRESHOLD, nearMisses } from '../src/memory/search-defaults.js';

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
  id: key, key, content: JSON.stringify({ note: key }), score, namespace: 'rules', provenanceType: 'tool_result',
});
interface Resp { results: Array<{ key: string; similarity: number }>; total: number; nearMisses?: Array<{ key: string; similarity: number }>; hint?: string }
async function search(input: Record<string, unknown>): Promise<Resp> {
  const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
  return memoryTools.find(t => t.name === 'memory_search')!.handler(input) as Promise<Resp>;
}
/** A store that honours the threshold like the real one. */
const store = (rows: Array<ReturnType<typeof entry>>) =>
  searchEntries.mockImplementation(async ({ threshold, limit }: { threshold?: number; limit?: number }) => ({
    success: true, results: rows.filter(r => r.score >= (threshold ?? 0)).slice(0, limit ?? 10),
  }));

beforeEach(() => { vi.resetModules(); searchEntries.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe('memory_search default threshold (#4129)', () => {
  it('the default floor is below the 0.28 a correct paraphrase scores and above the 0.4 recall-fusion limit (#2558)', () => {
    expect(DEFAULT_SEARCH_THRESHOLD).toBeLessThan(0.28);
    expect(DEFAULT_SEARCH_THRESHOLD).toBeLessThanOrEqual(0.4);
    expect(DEFAULT_SEARCH_THRESHOLD).toBeGreaterThan(0.15); // unrelated text sits at 0.0-0.15
  });

  it('returns a 0.28 paraphrase match with the threshold omitted', async () => {
    store([entry('rls-policies', 0.28), entry('concrete-cure', 0.07)]);
    const r = await search({ query: "stop one customer from seeing another customer's records in the database" });
    expect(r.results.map(x => x.key)).toEqual(['rls-policies']);
    expect(r.nearMisses).toBeUndefined();
    expect(searchEntries.mock.calls[0][0].threshold).toBe(DEFAULT_SEARCH_THRESHOLD);
  });

  it('still drops unrelated text at the default and says what was closest', async () => {
    store([entry('concrete-cure', 0.09), entry('oauth-pkce', 0.05)]);
    const r = await search({ query: 'completely different topic' });
    expect(r.total).toBe(0);
    expect(r.nearMisses?.map(n => n.key)).toEqual(['concrete-cure', 'oauth-pkce']);
    expect(r.nearMisses?.[0].similarity).toBe(0.09);
    expect(r.hint).toMatch(/threshold: 0/);
    const second = searchEntries.mock.calls[1][0];
    expect(second.threshold).toBe(0);
    expect(second.limit).toBe(3);
  });

  it('an explicit threshold is honoured, including 0, and adds no near-miss query', async () => {
    store([entry('a', 0.05)]);
    const strict = await search({ query: 'q', threshold: 0.9 });
    expect(strict.total).toBe(0);
    expect(strict.nearMisses).toBeUndefined();
    expect(searchEntries).toHaveBeenCalledTimes(1);
    searchEntries.mockClear();
    const zero = await search({ query: 'q', threshold: 0 });
    expect(zero.results.map(x => x.key)).toEqual(['a']);
    expect(searchEntries).toHaveBeenCalledTimes(1);
  });

  it('nearMisses never throws and is absent when the store has nothing at all', async () => {
    expect(await nearMisses(async () => { throw new Error('db gone'); }, { query: 'x' })).toBeUndefined();
    expect(await nearMisses(async () => ({ success: true, results: [] }), { query: 'x' })).toBeUndefined();
    expect(await nearMisses(async () => ({ success: false }), { query: 'x' })).toBeUndefined();
  });
});
