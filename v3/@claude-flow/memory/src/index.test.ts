/**
 * Phase 1 — Public API surface tests (ADR-125)
 *
 * Asserts that:
 * - `MemoryService` is the canonical exported entry point.
 * - `UnifiedMemoryService` remains exported as a deprecated alias to the same class.
 * - `HnswLite` and `RvfBackend` are NOT exported from the top-level package surface.
 */

import { describe, it, expect } from 'vitest';
import * as memoryPkg from './index.js';
import { createHybridService, MemoryService } from './index.js';
import { HybridBackend } from './hybrid-backend.js';

describe('Phase 1 — canonical public exports', () => {
  it('exports `MemoryService` as the canonical entry point', () => {
    expect(memoryPkg).toHaveProperty('MemoryService');
    expect(typeof (memoryPkg as any).MemoryService).toBe('function');
  });

  it('also exports `UnifiedMemoryService` as a deprecated alias', () => {
    expect(memoryPkg).toHaveProperty('UnifiedMemoryService');
    expect(typeof (memoryPkg as any).UnifiedMemoryService).toBe('function');
  });

  it('`MemoryService` and `UnifiedMemoryService` reference the same class', () => {
    expect((memoryPkg as any).MemoryService).toBe((memoryPkg as any).UnifiedMemoryService);
  });

  it('does NOT expose `HnswLite` from the top-level package', () => {
    expect(memoryPkg).not.toHaveProperty('HnswLite');
  });

  it('does NOT expose `RvfBackend` from the top-level package', () => {
    expect(memoryPkg).not.toHaveProperty('RvfBackend');
  });

  it('does NOT expose DDD layer types from the top-level package', () => {
    // These live under src/domain, src/application, src/infrastructure
    // and have never been re-exported from index.ts — assert that invariant.
    expect(memoryPkg).not.toHaveProperty('StoreMemoryCommandHandler');
    expect(memoryPkg).not.toHaveProperty('SearchMemoryQueryHandler');
    expect(memoryPkg).not.toHaveProperty('HybridMemoryRepository');
  });

  it('continues to expose the backend constructors that PR A keeps public', () => {
    // Backends that downstream packages import directly remain stable.
    expect(memoryPkg).toHaveProperty('AgentDBBackend');
    expect(memoryPkg).toHaveProperty('SQLiteBackend');
    expect(memoryPkg).toHaveProperty('SqlJsBackend');
    expect(memoryPkg).toHaveProperty('HybridBackend');
  });
});

describe('Phase 2 — createHybridService returns a real HybridBackend', () => {
  it('returns a MemoryService whose backend is a HybridBackend instance', async () => {
    // Trivial embedder for the test — returns a zero vector of the right shape.
    const embedder = async (_text: string) => new Float32Array(384);
    const svc = await createHybridService(':memory:', embedder, 384);

    try {
      expect(svc).toBeInstanceOf(MemoryService);
      expect(svc.backend).toBeDefined();
      expect(svc.backend).toBeInstanceOf(HybridBackend);
    } finally {
      // initialize is required before shutdown; do the minimal lifecycle.
      await svc.initialize().catch(() => undefined);
      await svc.shutdown().catch(() => undefined);
    }
  });

  it('initializes and shuts down without error', async () => {
    const embedder = async (_text: string) => new Float32Array(384);
    const svc = await createHybridService(':memory:', embedder, 384);

    await svc.initialize();
    expect(svc.isInitialized()).toBe(true);
    await svc.shutdown();
    expect(svc.isInitialized()).toBe(false);
  });
});
