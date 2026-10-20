import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/memory/intelligence.js', () => ({ initializeIntelligence: async () => ({}), recordSignalProcessed() {} }));
vi.mock('../src/memory/memory-initializer.js', () => ({ addToHNSWIndex: async () => {} }));
const bridge = await import('../src/memory/memory-bridge.js');
afterEach(async () => { try { await bridge.shutdownBridge(); } catch { /* asserted below */ } bridge._resetRegistryCacheForTest(); });

it('shutdownBridge surfaces an AgentDB persist failure (after full cleanup) instead of swallowing it', async () => {
  let closes = 0;
  bridge.__setMemoryBridgeRegistryFactoryForTests(() => ({
    async initialize() {},
    get() { return null; },
    getAgentDB() { return null; },
    async shutdown() { closes++; throw Object.assign(new Error('AgentDB failed to persist "x.db"; pending changes were NOT saved'), { code: 'AGENTDB_LOCK_UNRECOVERABLE' }); },
  }));
  await bridge.bridgeStorePattern({ pattern: 'p', type: 'test', confidence: 0.9, dbPath: '/tmp/ruflo-lock-surface/x.db' }).catch(() => {});
  await expect(bridge.shutdownBridge()).rejects.toMatchObject({ code: 'AGENTDB_LOCK_UNRECOVERABLE' });
  expect(closes).toBe(1);
  // state fully cleared: a second shutdown is a clean no-op
  await expect(bridge.shutdownBridge()).resolves.toBeUndefined();
});

it('other shutdown errors stay best-effort', async () => {
  bridge.__setMemoryBridgeRegistryFactoryForTests(() => ({
    async initialize() {}, get() { return null; }, getAgentDB() { return null; },
    async shutdown() { throw new Error('boom'); },
  }));
  await bridge.bridgeStorePattern({ pattern: 'p', type: 'test', confidence: 0.9, dbPath: '/tmp/ruflo-lock-surface/y.db' }).catch(() => {});
  await expect(bridge.shutdownBridge()).resolves.toBeUndefined();
});
