import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('../src/memory/intelligence.js', () => ({ initializeIntelligence: async () => ({ reasoningBankEnabled: false, sonaEnabled: false }) }));
const bridge = await import('../src/memory/memory-bridge.js');
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
let root: string;
let instances: Registry[];
let openGate: ReturnType<typeof deferred> | undefined;
let effectGate: ReturnType<typeof deferred> | undefined;
let closeGate: ReturnType<typeof deferred> | undefined;
let entered: ReturnType<typeof deferred>;
class Registry {
  closed = 0;
  writes = 0;
  path = '';
  async initialize({ dbPath }: { dbPath: string }) { this.path = dbPath; if (openGate) await openGate.promise; }
  get(name: string) {
    if (name !== 'reasoningBank') return null;
    return { storePattern: async () => {
      entered.resolve();
      if (effectGate) await effectGate.promise;
      if (this.closed) throw new Error('database closed during write');
      this.writes++;
      return this.writes;
    } };
  }
  getAgentDB() { return null; }
  async shutdown() { this.closed++; if (closeGate) await closeGate.promise; }
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-lifecycle-'));
  instances = []; openGate = undefined; effectGate = undefined; closeGate = undefined; entered = deferred();
  bridge._resetRegistryCacheForTest();
  bridge.__setMemoryBridgeRegistryFactoryForTests(() => { const r = new Registry(); instances.push(r); return r; });
});
afterEach(async () => {
  openGate?.resolve(); effectGate?.resolve(); closeGate?.resolve();
  await bridge.shutdownBridge(); bridge._resetRegistryCacheForTest();
  rmSync(root, { recursive: true, force: true });
});
const tick = () => new Promise(r => setTimeout(r, 0));
const store = (name = 'a.db') => bridge.bridgeStorePattern({ pattern: 'retained', type: 'test', confidence: 1, dbPath: join(root, name) });

describe('bridge shutdown owns admitted effects', () => {
  it('drains an admitted write before closing the database', async () => {
    effectGate = deferred();
    const write = store(); await entered.promise;
    let finished = false;
    const shutdown = bridge.shutdownBridge().then(() => { finished = true; });
    await tick();
    const closedBeforeRelease = instances[0].closed;
    const finishedBeforeRelease = finished;
    effectGate.resolve();
    const result = await write; await shutdown;
    expect(closedBeforeRelease).toBe(0);
    expect(finishedBeforeRelease).toBe(false);
    expect(result).toMatchObject({ success: true });
    expect(instances[0].writes).toBe(1);
    expect(instances[0].closed).toBe(1);
  });
  it('shares retirement across concurrent shutdown callers', async () => {
    await store(); closeGate = deferred();
    const first = bridge.shutdownBridge(); const second = bridge.shutdownBridge();
    await tick(); const closes = instances[0].closed;
    closeGate.resolve(); await Promise.all([first, second]);
    expect(closes).toBe(1);
  });
  it('queues opens arriving during shutdown into the next lifecycle', async () => {
    openGate = deferred();
    const first = store();
    const shutdown = bridge.shutdownBridge();
    const second = store('b.db');
    await tick(); const openedBeforeRelease = instances.length;
    openGate.resolve();
    const [a, , b] = await Promise.all([first, shutdown, second]);
    expect(openedBeforeRelease).toBe(1);
    expect(a).toMatchObject({ success: true }); expect(b).toMatchObject({ success: true });
    expect(instances).toHaveLength(2);
    expect(instances[0].closed).toBe(1); expect(instances[1].closed).toBe(0);
  });
});
