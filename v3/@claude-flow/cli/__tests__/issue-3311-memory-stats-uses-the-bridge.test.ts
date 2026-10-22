/**
 * #3311: `memory_stats` decided whether memory existed with a raw whole-image
 * sql.js probe, which cannot see live SQLite WAL frames. A store the bridge
 * read and searched perfectly well came back `initialized: false` from this
 * one tool, and a listing that failed came back as a store with no entries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkMemoryInitialization = vi.fn();
const listEntries = vi.fn();

vi.mock('../src/memory/memory-initializer.js', () => ({
  checkMemoryInitialization: (...args: unknown[]) => checkMemoryInitialization(...args),
  listEntries: (...args: unknown[]) => listEntries(...args),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  storeEntry: vi.fn(async () => ({ success: true })),
  searchEntries: vi.fn(async () => ({ results: [] })),
  getEntry: vi.fn(async () => null),
  deleteEntry: vi.fn(async () => ({ success: true })),
  getHNSWStatus: () => ({ algorithm: 'brute-force' }),
}));

const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const stats = memoryTools.find(tool => tool.name === 'memory_stats')!;

const row = (namespace: string, hasEmbedding = false) => ({
  id: `id-${namespace}-${Math.random()}`,
  key: 'k',
  namespace,
  size: 1,
  accessCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  hasEmbedding,
});

/** One page of rows, the way the store answers a successful listing. */
const page = (entries: ReturnType<typeof row>[], total = entries.length) => ({
  success: true,
  entries,
  total,
});

beforeEach(() => {
  checkMemoryInitialization.mockReset();
  listEntries.mockReset();
  // The probe answers for a store it cannot see: this is the reported
  // failure, and the default for every case below unless a test says
  // otherwise.
  checkMemoryInitialization.mockResolvedValue({ initialized: false });
});

describe('#3311 memory_stats', () => {
  it('reports a store the bridge can list, even when the raw probe says no', async () => {
    listEntries.mockResolvedValue(page([row('default', true), row('default')]));

    const result = await stats.handler({}) as any;

    expect(result.initialized).toBe(true);
    expect(result.totalEntries).toBe(2);
    expect(result.entriesWithEmbeddings).toBe(1);
    expect(result.embeddingCoverage).toBe('50.0%');
  });

  it('does not consult the probe for whether the store is there', async () => {
    listEntries.mockResolvedValue(page([row('default')]));
    checkMemoryInitialization.mockRejectedValue(new Error('raw whole-image read refused (WAL)'));

    const result = await stats.handler({}) as any;

    // The probe is the only source of the version and feature labels, so it
    // is still read -- it just cannot veto a store that answered.
    expect(result.initialized).toBe(true);
    expect(result.totalEntries).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('reports a failed listing as unavailable, not as an empty store', async () => {
    listEntries.mockResolvedValue({
      success: false,
      entries: [],
      total: 0,
      error: 'raw WAL safety guard refused a whole-image read',
    });

    const result = await stats.handler({}) as any;

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/WAL/);
    // The point of the cell: no fabricated zero for a question that was
    // never answered.
    expect(result.totalEntries).toBeUndefined();
    expect(result.initialized).not.toBe(false);
  });

  it('reports a thrown listing as unavailable too', async () => {
    listEntries.mockRejectedValue(new Error('registry unavailable'));

    const result = await stats.handler({}) as any;

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/registry unavailable/);
    expect(result.totalEntries).toBeUndefined();
  });

  it('still reports an empty store as empty', async () => {
    // The accept control for the two cells above: "nothing there" and
    // "could not tell" must stay different answers.
    listEntries.mockResolvedValue(page([], 0));

    const result = await stats.handler({}) as any;

    expect(result.initialized).toBe(true);
    expect(result.available).toBeUndefined();
    expect(result.totalEntries).toBe(0);
    expect(result.embeddingCoverage).toBe('0%');
  });

  it('counts a namespace named __proto__ instead of losing it', async () => {
    listEntries.mockResolvedValue(page([row('__proto__'), row('__proto__'), row('constructor')]));

    const result = await stats.handler({}) as any;

    expect(result.namespaces.__proto__).toBe(2);
    expect(result.namespaces.constructor).toBe(1);
    expect(result.totalEntries).toBe(3);
  });

  it('pages past the old 100000 cap rather than counting a prefix', async () => {
    const total = 25000;
    listEntries.mockImplementation(async ({ offset = 0, limit = 10000 }) => ({
      success: true,
      entries: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, () =>
        row(offset < 10000 ? 'early' : 'late')),
      total,
    }));

    const result = await stats.handler({}) as any;

    expect(result.totalEntries).toBe(total);
    expect(result.entriesCounted).toBe(total);
    expect(result.truncated).toBeUndefined();
    expect(result.namespaces.early + result.namespaces.late).toBe(total);
    // Asked for in pages, not in one 100000-row gulp.
    expect(listEntries.mock.calls.length).toBeGreaterThan(1);
    for (const [options] of listEntries.mock.calls) {
      expect(options.limit).toBeLessThanOrEqual(10000);
    }
  });

  it('says so when it could not count every row', async () => {
    // A `total` the rows never reach: the loop has to stop, and what it
    // reports then must not read as a complete breakdown.
    listEntries.mockImplementation(async () => ({
      success: true,
      entries: Array.from({ length: 10000 }, () => row('default')),
      total: 10_000_000,
    }));

    const result = await stats.handler({}) as any;

    expect(result.truncated).toBe(true);
    expect(result.totalEntries).toBe(10_000_000);
    expect(result.entriesCounted).toBeLessThan(10_000_000);
  });
});
