import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// #2922: the bridge's default search path (bridgeSearchBruteForceCosine, née
// bridgeSearchHNSW) is a full-table SELECT + brute-force cosine loop — it
// never touches @ruvector/core or an HNSW index. getHNSWStatus() used to
// report `available: true` whenever the bridge was loaded regardless of
// this, which is exactly the misleading-status-indicator bug the issue
// documents with line-numbered evidence. These tests exercise the real
// bridge (better-sqlite3 is present in this env) and assert the status
// functions stop claiming HNSW acceleration that isn't in the request path.
describe('#2922 getHNSWStatus() must not claim HNSW when the bridge (brute-force) path is active', () => {
  it('reports available=false and algorithm=brute-force-cosine once the bridge has loaded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2922-'));
    const dbPath = join(root, 'memory.db');

    try {
      const { initializeMemoryDatabase, storeEntry, getHNSWStatus } = await import('../src/memory/memory-initializer.js');

      await initializeMemoryDatabase({ dbPath, force: true, verbose: false });

      // Any real write forces the lazy bridge singleton to load (ADR-053).
      const result = await storeEntry({
        key: 'k1',
        value: 'hello world',
        namespace: 'test',
        dbPath,
      });
      expect(result.success).toBe(true);

      const status = getHNSWStatus();
      // #2922: `available` must be false while the bridge (brute-force cosine)
      // is the active search path — asserted unconditionally so a reverted
      // fix (missing `algorithm` field entirely) fails loudly here instead of
      // being silently skipped by a too-permissive environment guard.
      expect(status.available).toBe(false);
      expect(status.initialized).toBe(false);
      expect(status.algorithm).toBe('brute-force-cosine');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('#2922 memory-bridge status/search functions are honestly named', () => {
  it('bridgeGetVectorSearchStatus reports algorithm=brute-force-cosine, not silence about acceleration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2922-bridge-'));
    const dbPath = join(root, 'memory.db');

    try {
      const bridge = await import('../src/memory/memory-bridge.js');
      const { initializeMemoryDatabase, storeEntry } = await import('../src/memory/memory-initializer.js');
      await initializeMemoryDatabase({ dbPath, force: true, verbose: false });
      await storeEntry({ key: 'k1', value: 'hello', namespace: 'test', dbPath });

      const status = await bridge.bridgeGetVectorSearchStatus(dbPath);
      if (!status) return; // bridge unavailable in this environment — not what's under test
      expect(status.algorithm).toBe('brute-force-cosine');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
