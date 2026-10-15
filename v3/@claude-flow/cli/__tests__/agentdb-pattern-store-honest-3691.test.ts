/**
 * Regression for #3691: agentdb_pattern-store acknowledged persistence
 * ("success: true") even when the underlying write returned {success:false}.
 *  - registry-null fallback ignored storeEntry's result
 *  - bridgeStorePattern's bridge-fallback only checked `!result`, so a
 *    structured {success:false} became a successful receipt
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const bridgeStorePattern = vi.fn();
const storeEntry = vi.fn();
vi.mock('../src/memory/memory-bridge.js', async (orig) => ({
  ...(await orig<any>()),
  bridgeStorePattern: (...a: unknown[]) => bridgeStorePattern(...a),
}));
vi.mock('../src/memory/memory-initializer.js', async (orig) => ({
  ...(await orig<any>()),
  storeEntry: (...a: unknown[]) => storeEntry(...a),
}));

import { agentdbPatternStore } from '../src/mcp-tools/agentdb-tools.js';

beforeEach(() => { bridgeStorePattern.mockReset(); storeEntry.mockReset(); });

describe('#3691 agentdb_pattern-store reports failed persistence honestly', () => {
  it('registry-null fallback: storeEntry {success:false} is NOT acknowledged', async () => {
    bridgeStorePattern.mockResolvedValue(null);
    storeEntry.mockResolvedValue({ success: false, id: '', error: 'disk full' });
    const r: any = await agentdbPatternStore.handler({ pattern: 'p', type: 't' });
    expect(r.success).toBe(false);
    expect(r.patternId).toBeUndefined();
    expect(JSON.stringify(r)).toContain('disk full');
  });

  it('registry-null fallback: storeEntry success still acknowledged as degraded', async () => {
    bridgeStorePattern.mockResolvedValue(null);
    storeEntry.mockResolvedValue({ success: true, id: 'x' });
    const r: any = await agentdbPatternStore.handler({ pattern: 'p', type: 't' });
    expect(r.success).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it('bridge returning structured success:false is passed through as failure', async () => {
    bridgeStorePattern.mockResolvedValue({ success: false, patternId: '', controller: 'bridge-fallback', error: 'guard rejected' });
    const r: any = await agentdbPatternStore.handler({ pattern: 'p', type: 't' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('guard rejected');
    expect(r.degraded).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/persisted via/i);
  });
});

describe('#3691 bridgeStorePattern bridge-fallback refuses a failed write', () => {
  it('returns success:false (not a receipt) when the SQL write throws/returns failure', async () => {
    const real = await vi.importActual<typeof import('../src/memory/memory-bridge.js')>('../src/memory/memory-bridge.js');
    const stub = {
      prepare() { return { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }; },
      exec() { /* schema no-op */ },
      pragma() { return []; },
    };
    real.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: stub, embedder: null }),
      get: () => null,
    } as any);
    try {
      const r: any = await real.bridgeStorePattern({ pattern: 'p', type: 't', confidence: 0.5, dbPath: '/nonexistent/x.db' });
      // A write that persisted nothing (changes=0) must never become a success receipt
      expect(r).not.toBeNull();
      expect(r.success).toBe(false);
      expect(r.patternId).toBeFalsy();
    } finally {
      real.__setMemoryBridgeRegistryForTests(null);
    }
  });
});
