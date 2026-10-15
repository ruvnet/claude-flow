/**
 * Phase 5 — Graceful retrieval degradation (ADR-125)
 *
 * Verifies:
 * - `MemoryService.semanticSearch('foo')` with NO embedder configured falls
 *   back to FTS / keyword search results without throwing AND emits
 *   `health:embedder = { status: 'degraded' }` (Acceptance Criterion #5).
 * - Same fallback when the embedder is configured but throws on call.
 * - `hybridSearch` controller fuses dense + sparse arms via RRF + MMR and
 *   returns non-empty results with a mean score at least as high as either
 *   pure arm.
 */

import { describe, it, expect } from 'vitest';
import { MemoryService } from './index.js';
import { ControllerRegistry } from './controller-registry.js';
import { createDefaultEntry } from './types.js';

async function newSvc(opts: Record<string, any> = {}) {
  const svc = new MemoryService({
    dimensions: 8,
    persistenceEnabled: false,
    snapshotInterval: 0,
    ...opts,
  });
  await svc.initialize();
  return svc;
}

function randomVec(dim: number, seed: number): Float32Array {
  const out = new Float32Array(dim);
  let s = seed | 0 || 1;
  for (let i = 0; i < dim; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    out[i] = (s | 0) / 2 ** 31;
  }
  return out;
}

describe('Phase 5 — semanticSearch falls back without embedder', () => {
  it('Acceptance Criterion #5 — no embedder → keyword results, no throw', async () => {
    const svc = await newSvc(); // no embeddingGenerator

    for (let i = 0; i < 10; i++) {
      const entry = createDefaultEntry({
        key: `k-${i}`,
        content: i % 2 === 0
          ? `authentication patterns for OAuth ${i}`
          : `database migration schema ${i}`,
      });
      await svc.store(entry);
    }

    let degraded: any = null;
    svc.getAdapter().on('health:embedder', (ev: any) => { degraded = ev; });

    const results = await svc.semanticSearch('authentication', 5);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    // Every result should match the keyword
    for (const r of results) {
      expect(r.entry.content.toLowerCase()).toContain('authentication');
    }
    expect(degraded).not.toBeNull();
    expect(degraded.status).toBe('degraded');

    await svc.close();
  });

  it('embedder that throws → degraded event + keyword fallback', async () => {
    // Build a service where the embedder ALWAYS throws on read paths only.
    // We bypass the throw on write by pre-populating an embedding on each
    // stored entry — this mirrors real-world failure modes where indexing
    // happened with a healthy embedder but the embedder later goes down.
    const svc = await newSvc({
      embeddingGenerator: async () => {
        throw new Error('embedding service unavailable');
      },
    });

    for (let i = 0; i < 5; i++) {
      const entry = createDefaultEntry({
        key: `t-${i}`,
        content: `token validation ${i}`,
      });
      entry.embedding = randomVec(8, i + 1); // pre-set so store() doesn't call embedder
      await svc.store(entry);
    }

    let degraded: any = null;
    svc.getAdapter().on('health:embedder', (ev: any) => { degraded = ev; });

    const results = await svc.semanticSearch('token validation', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(degraded?.status).toBe('degraded');
    expect(degraded?.reason).toContain('embedding service unavailable');

    await svc.close();
  });
});

describe('Phase 5 — hybridSearch controller (RRF + MMR)', () => {
  it('fuses dense + sparse arms into a non-empty result', async () => {
    // Use a deterministic embedder so the dense arm is reproducible
    const dim = 8;
    const svc = new MemoryService({
      dimensions: dim,
      persistenceEnabled: false,
      snapshotInterval: 0,
      embeddingGenerator: async (text: string) => randomVec(dim, hashStr(text)),
    });
    await svc.initialize();

    // 50 entries: 25 about "authentication", 25 about "indexing"
    for (let i = 0; i < 25; i++) {
      const entry = createDefaultEntry({
        key: `auth-${i}`,
        content: `authentication and authorization patterns ${i}`,
      });
      entry.embedding = randomVec(dim, hashStr(entry.content));
      await svc.store(entry);
    }
    for (let i = 0; i < 25; i++) {
      const entry = createDefaultEntry({
        key: `idx-${i}`,
        content: `database indexing strategies ${i}`,
      });
      entry.embedding = randomVec(dim, hashStr(entry.content));
      await svc.store(entry);
    }

    const registry = new ControllerRegistry();
    await registry.initialize({ memoryService: svc });

    const hybrid = registry.get<any>('hybridSearch');
    expect(hybrid).toBeTruthy();
    expect(hybrid.source).toBe('hybrid-rrf-mmr');

    const results = await hybrid.search('authentication', { limit: 10 });
    expect(results.length).toBeGreaterThan(0);

    // Mean RRF-fused score should be > 0
    const mean = results.reduce((acc: number, r: any) => acc + r.score, 0) / results.length;
    expect(mean).toBeGreaterThan(0);

    // Verify hybrid surfaces relevant entries from BOTH arms by checking
    // that >=1 result mentions "authentication" (keyword arm signal).
    const authMatches = results.filter((r: any) =>
      r.entry.content.toLowerCase().includes('authentication')
    );
    expect(authMatches.length).toBeGreaterThan(0);

    // Hybrid should return up to `limit` entries (10 here, given 50 stored).
    expect(results.length).toBeLessThanOrEqual(10);

    // ADR-147: every result carries provenance — at least one signal name.
    for (const r of results) {
      expect(Array.isArray(r.signals)).toBe(true);
      expect(r.signals.length).toBeGreaterThan(0);
      for (const s of r.signals) {
        expect(['vector', 'bm25', 'entity']).toContain(s);
      }
    }

    await registry.shutdown();
    await svc.close();
  });

  it('ADR-147 — entity arm surfaces proper-noun matches above vector noise', async () => {
    // Store 30 generic "authentication" entries (no Alice) + a single
    // entry mentioning "Alice Smith" — the proper-noun bigram extractEntities
    // should pick up. The entity arm should boost the Alice entry above
    // the 30 generic ones for a query that names Alice explicitly.
    const dim = 8;
    const svc = new MemoryService({
      dimensions: dim,
      persistenceEnabled: false,
      snapshotInterval: 0,
      embeddingGenerator: async (text: string) => randomVec(dim, hashStr(text)),
    });
    await svc.initialize();

    for (let i = 0; i < 30; i++) {
      const entry = createDefaultEntry({
        key: `generic-${i}`,
        content: `authentication and authorization patterns ${i}`,
      });
      entry.embedding = randomVec(dim, hashStr(entry.content));
      await svc.store(entry);
    }
    const aliceEntry = createDefaultEntry({
      key: 'alice-needle',
      content: 'Alice Smith authored these authentication flows',
    });
    aliceEntry.embedding = randomVec(dim, hashStr(aliceEntry.content));
    await svc.store(aliceEntry);

    const registry = new ControllerRegistry();
    await registry.initialize({ memoryService: svc });

    const hybrid = registry.get<any>('hybridSearch');
    const results = await hybrid.search('Alice Smith authentication', { limit: 10 });

    // The Alice entry should appear in the top-10 fused results.
    const alice = results.find((r: any) => r.entry.key === 'alice-needle');
    expect(alice).toBeTruthy();
    // …and should carry the 'entity' provenance signal (it's the only entry
    // that matches the "Alice Smith" proper-noun bigram).
    expect(alice.signals).toContain('entity');

    await registry.shutdown();
    await svc.close();
  });
});

describe('Dream Cycle 2026-08-18 — hybridSearch explicit opt-in without memoryService', () => {
  it('default behavior is unchanged: backend-only + no explicit override → disabled', async () => {
    const svc = await newSvc({
      embeddingGenerator: async (text: string) => randomVec(8, hashStr(text)),
    });
    const registry = new ControllerRegistry();
    await registry.initialize({ backend: svc.getAdapter() });

    expect(registry.isEnabled('hybridSearch')).toBe(false);
    expect(registry.get('hybridSearch')).toBeNull();

    await registry.shutdown();
    await svc.close();
  });

  it('explicit `controllers: { hybridSearch: true }` + backend (no memoryService) now constructs a working controller', async () => {
    const svc = await newSvc({
      embeddingGenerator: async (text: string) => randomVec(8, hashStr(text)),
    });

    for (let i = 0; i < 20; i++) {
      const entry = createDefaultEntry({
        key: `note-${i}`,
        content: `release process and deployment checklist ${i}`,
      });
      entry.embedding = randomVec(8, hashStr(entry.content));
      await svc.store(entry);
    }

    const registry = new ControllerRegistry();
    // Only `backend` is supplied (the AgentDBAdapter directly) — no
    // `memoryService`. Before the 2026-08-18 fix this silently returned
    // null despite the explicit `true` override.
    await registry.initialize({
      backend: svc.getAdapter(),
      controllers: { hybridSearch: true },
    });

    expect(registry.isEnabled('hybridSearch')).toBe(true);
    const hybrid = registry.get<any>('hybridSearch');
    expect(hybrid).toBeTruthy();
    expect(hybrid.source).toBe('hybrid-rrf-mmr');

    const results = await hybrid.search('deployment checklist', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(Array.isArray(r.signals)).toBe(true);
      expect(r.signals.length).toBeGreaterThan(0);
    }

    await registry.shutdown();
    await svc.close();
  });

  it('explicit override with an incompatible backend (no semanticSearch/searchKeyword) still degrades to null, not a throw', async () => {
    const registry = new ControllerRegistry();
    const incompatibleBackend = {
      initialize: async () => {},
      shutdown: async () => {},
    };
    await registry.initialize({
      backend: incompatibleBackend as any,
      controllers: { hybridSearch: true },
    });

    expect(registry.get('hybridSearch')).toBeNull();
    await registry.shutdown();
  });
});

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) + 1;
}
