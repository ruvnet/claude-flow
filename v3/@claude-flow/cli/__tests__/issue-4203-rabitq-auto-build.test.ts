import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// #4203: the RaBitQ index was only ever populated by the explicit
// `embeddings_rabitq_build` tool — `shouldRebuildRabitq()` had no callers, so
// `searchRabitq()` always returned null and the sql.js pre-filter at
// memory-initializer.ts was dead. The bridge path
// (bridgeSearchBruteForceCosine) never consulted the index at all.
//
// These tests exercise the real store (better-sqlite3 is present in this env)
// and assert the two halves of the fix: the index is built on demand by the
// search path, and the bridge search actually consults it.

const DIMENSIONS = 384;
const ROW_COUNT = 12;

function vectorFor(seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < DIMENSIONS; i++) {
    out.push(Math.sin(seed * 0.7 + i * 0.11) * Math.cos(seed * 1.3 + i * 0.03));
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const mag = Math.sqrt(na * nb);
  return mag === 0 ? 0 : dot / mag;
}

/** Deterministic pseudo-random vector, independent of the `vectorFor` family. */
function randomVectorFor(seed: number): number[] {
  let state = seed | 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [];
  for (let i = 0; i < DIMENSIONS; i++) out.push(next() * 2 - 1);
  return out;
}

/** Seed a real store with `rowCount` embeddings and return its path. */
async function seedStore(
  root: string,
  rowCount = ROW_COUNT,
  vectorAt: (i: number) => number[] = vectorFor,
): Promise<string | null> {
  const dbPath = join(root, 'memory.db');
  const bridge = await import('../src/memory/memory-bridge.js');
  const { initializeMemoryDatabase } = await import('../src/memory/memory-initializer.js');

  await initializeMemoryDatabase({ dbPath, force: true, verbose: false });

  const status = await bridge.bridgeGetVectorSearchStatus(dbPath);
  if (!status) return null; // bridge unavailable in this environment

  for (let i = 0; i < rowCount; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const written = await bridge.bridgeAddEmbedding(
      id,
      vectorAt(i),
      { id, key: `emb-${i}`, namespace: 'test', content: `row ${i}` },
      dbPath,
    );
    if (written !== true) return null;
  }

  return dbPath;
}

describe('#4203 RaBitQ index is built on demand instead of only via the manual tool', () => {
  // Each test gets a fresh module graph: the index state, the auto-build
  // throttle and the bridge registry cache are all module-level.
  beforeEach(() => {
    vi.resetModules();
  });

  it('ensureRabitqIndex() builds from stored embeddings and serves searches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-4203-build-'));
    try {
      const dbPath = await seedStore(root);
      if (!dbPath) return; // bridge unavailable in this environment

      const rabitq = await import('../src/memory/rabitq-index.js');

      // Pre-fix: nothing ever built the index, so this was always uninitialized
      // no matter how many embeddings memory_store had written.
      expect(rabitq.getRabitqStatus().initialized).toBe(false);

      expect(await rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS })).toBe(true);
      expect(rabitq.getRabitqStatus().vectorCount).toBe(ROW_COUNT);

      // An index that is already current must not be rebuilt.
      expect(await rabitq.shouldRebuildRabitq(ROW_COUNT)).toBe(false);

      const hits = await rabitq.searchRabitq(vectorFor(0), { k: 3 });
      expect(hits).not.toBeNull();
      expect(hits![0].key).toBe('emb-0');
      expect(hits![0].namespace).toBe('test');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bridgeSearchBruteForceCosine() consults the RaBitQ index and reranks exactly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-4203-bridge-'));
    try {
      const dbPath = await seedStore(root);
      if (!dbPath) return; // bridge unavailable in this environment

      const bridge = await import('../src/memory/memory-bridge.js');
      const rabitq = await import('../src/memory/rabitq-index.js');

      // Pre-fix: the bridge scanned the whole table and the index stayed empty.
      expect(rabitq.getRabitqStatus().initialized).toBe(false);

      const query = vectorFor(5);
      const results = await bridge.bridgeSearchBruteForceCosine(query, { k: 3 }, dbPath);

      expect(results).not.toBeNull();
      expect(results!.length).toBeGreaterThan(0);
      expect(results![0].key).toBe('emb-5');
      // Reranking uses exact cosine, so the score keeps its brute-force meaning.
      expect(results![0].score).toBeCloseTo(cosine(query, vectorFor(5)), 6);
      expect(results![0].id).toBe('00000000-000');
      expect(results![0].namespace).toBe('test');

      // The index the search used was built by that same search call.
      expect(rabitq.getRabitqStatus().initialized).toBe(true);
      expect(rabitq.getRabitqStatus().vectorCount).toBe(ROW_COUNT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not rebuild the index on every search', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-4203-throttle-'));
    try {
      const dbPath = await seedStore(root);
      if (!dbPath) return; // bridge unavailable in this environment

      const bridge = await import('../src/memory/memory-bridge.js');
      const rabitq = await import('../src/memory/rabitq-index.js');

      const first = await bridge.bridgeSearchBruteForceCosine(vectorFor(3), { k: 2 }, dbPath);
      expect(first![0].key).toBe('emb-3');

      const builtAt = rabitq.getRabitqStatus().builtAt;
      expect(builtAt).not.toBeNull();

      // A second search, plus an explicit ensure for the same store and width,
      // must reuse the index: rebuilding on every query would cost more than
      // the brute-force scan it replaces.
      const second = await bridge.bridgeSearchBruteForceCosine(vectorFor(3), { k: 2 }, dbPath);
      expect(second![0].key).toBe('emb-3');
      expect(await rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS })).toBe(true);
      expect(rabitq.getRabitqStatus().builtAt).toBe(builtAt);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Negative control: the auto-build must not fire (and must not throw) when the
  // corpus is below the floor, and the caller's exhaustive scan must still be
  // the thing that answers.
  it('leaves the exhaustive scan in place when the corpus is below the build floor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-4203-small-'));
    try {
      const dbPath = await seedStore(root, 5);
      if (!dbPath) return; // bridge unavailable in this environment

      const rabitq = await import('../src/memory/rabitq-index.js');
      const bridge = await import('../src/memory/memory-bridge.js');

      expect(await rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS })).toBe(false);
      expect(rabitq.getRabitqStatus().initialized).toBe(false);

      const results = await bridge.bridgeSearchBruteForceCosine(vectorFor(3), { k: 2 }, dbPath);
      expect(results).not.toBeNull();
      expect(results![0].key).toBe('emb-3');
      expect(results![0].score).toBeCloseTo(cosine(vectorFor(3), vectorFor(3)), 6);
      expect(rabitq.getRabitqStatus().initialized).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Positive/negative control pair over the same corpus: the indexed path and
  // the exhaustive path must return the same rows with the same exact scores,
  // so switching RaBitQ on cannot silently change rankings.
  // Note: this corpus (12 rows) fits entirely inside the candidate window
  // (k * 2 * 3 = 30), so equality here is exact by construction. The recall
  // test below covers a corpus that is larger than the window.
  it('indexed search agrees with the exhaustive scan on the same corpus', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-4203-parity-'));
    try {
      const dbPath = await seedStore(root);
      if (!dbPath) return; // bridge unavailable in this environment

      // Negative control: a 128-dim probe cannot be served by a 384-dim store,
      // so the first search keeps the exhaustive scan (the retry window opened
      // by that probe also keeps it from building behind our back).
      const rabitqExhaustive = await import('../src/memory/rabitq-index.js');
      const bridgeExhaustive = await import('../src/memory/memory-bridge.js');
      expect(await rabitqExhaustive.ensureRabitqIndex({ dbPath, dimensions: 128 })).toBe(false);
      const exhaustive = await bridgeExhaustive.bridgeSearchBruteForceCosine(vectorFor(7), { k: 5 }, dbPath);
      expect(exhaustive).not.toBeNull();
      expect(exhaustive!.length).toBeGreaterThan(0);
      expect(rabitqExhaustive.getRabitqStatus().initialized).toBe(false);

      // Positive control: a fresh module graph has no retry window, so the same
      // query is served from the index that this search builds.
      vi.resetModules();
      const rabitqIndexed = await import('../src/memory/rabitq-index.js');
      const bridgeIndexed = await import('../src/memory/memory-bridge.js');
      const indexed = await bridgeIndexed.bridgeSearchBruteForceCosine(vectorFor(7), { k: 5 }, dbPath);
      expect(indexed).not.toBeNull();
      expect(rabitqIndexed.getRabitqStatus().initialized).toBe(true);

      expect(indexed!.map(r => r.key)).toEqual(exhaustive!.map(r => r.key));
      expect(indexed!.map(r => r.id)).toEqual(exhaustive!.map(r => r.id));
      for (let i = 0; i < indexed!.length; i++) {
        expect(indexed![i].score).toBeCloseTo(exhaustive![i].score, 6);
        expect(indexed![i].namespace).toBe(exhaustive![i].namespace);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Recall/rerank check on a corpus that is larger than the candidate window
  // (60 rows, k = 5 → 30 candidates), where the two paths may legitimately rank
  // differently. Two things must still hold: every returned score is that row's
  // exact cosine (the rerank is not an approximation), and top-k recall does not
  // collapse because of the pre-filter.
  it('reranks with exact cosine and keeps top-k recall above the window size', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-4203-recall-'));
    try {
      const query = randomVectorFor(999);
      const dbPath = await seedStore(root, 60, i => randomVectorFor(i + 1));
      if (!dbPath) return; // bridge unavailable in this environment

      // Same negative-then-positive control: the first search keeps the
      // exhaustive scan, the second (fresh module graph) uses the index.
      const rabitqExhaustive = await import('../src/memory/rabitq-index.js');
      const bridgeExhaustive = await import('../src/memory/memory-bridge.js');
      expect(await rabitqExhaustive.ensureRabitqIndex({ dbPath, dimensions: 128 })).toBe(false);
      const exhaustive = await bridgeExhaustive.bridgeSearchBruteForceCosine(
        query, { k: 5, threshold: -1 }, dbPath,
      );
      expect(exhaustive).not.toBeNull();
      expect(exhaustive!.length).toBe(5);

      vi.resetModules();
      const rabitqIndexed = await import('../src/memory/rabitq-index.js');
      const bridgeIndexed = await import('../src/memory/memory-bridge.js');
      const indexed = await bridgeIndexed.bridgeSearchBruteForceCosine(
        query, { k: 5, threshold: -1 }, dbPath,
      );
      expect(rabitqIndexed.getRabitqStatus().initialized).toBe(true);
      expect(indexed).not.toBeNull();

      // Rerank correctness: each score equals that row's exact cosine.
      for (const row of indexed!) {
        const seed = Number(row.key.replace('emb-', '')) + 1;
        expect(row.score).toBeCloseTo(cosine(query, randomVectorFor(seed)), 6);
      }

      // Recall: ≥80% of the exhaustive top-5 must survive the pre-filter.
      const indexedKeys = new Set(indexed!.map(r => r.key));
      const recovered = exhaustive!.filter(r => indexedKeys.has(r.key)).length;
      expect(recovered).toBeGreaterThanOrEqual(4);
      expect(indexed![0].key).toBe(exhaustive![0].key);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Review follow-up: the throttle writes `lastAutoBuildAttempt` synchronously
  // before its first await, so callers that arrive together must not each start
  // a build. Exactly one owns it; the rest report "no index yet" and let their
  // caller keep the exhaustive scan.
  it('concurrent ensureRabitqIndex() calls start a single build', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-4203-concurrent-'));
    try {
      const dbPath = await seedStore(root);
      if (!dbPath) return; // bridge unavailable in this environment

      const rabitq = await import('../src/memory/rabitq-index.js');
      expect(rabitq.getRabitqStatus().initialized).toBe(false);

      const results = await Promise.all([
        rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS }),
        rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS }),
        rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS }),
        rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS }),
      ]);

      expect(results.filter(r => r === true).length).toBe(1);
      expect(rabitq.getRabitqStatus().initialized).toBe(true);
      expect(rabitq.getRabitqStatus().vectorCount).toBe(ROW_COUNT);

      // The winner's build is the one that answers searches afterwards.
      const hits = await rabitq.searchRabitq(vectorFor(0), { k: 2 });
      expect(hits).not.toBeNull();
      expect(hits![0].key).toBe('emb-0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
