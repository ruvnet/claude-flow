import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = {
  calls: [] as string[],
  closed: [] as string[],
  failPath: '' as string,
  failOperationPath: '' as string,
  initializeGate: null as Promise<void> | null,
};

class FakeRegistry {
  private dbPath = '';
  async initialize(options: { dbPath: string }) {
    this.dbPath = options.dbPath;
    state.calls.push(options.dbPath);
    if (state.initializeGate) await state.initializeGate;
    if (options.dbPath === state.failPath) throw new Error('database A unavailable');
  }
  get() {
    if (this.dbPath === state.failOperationPath) throw new Error('database A pattern operation failed');
    return null;
  }
  getAgentDB() { return null; }
  async shutdown() { state.closed.push(this.dbPath); }
}

vi.mock('../src/memory/intelligence.js', () => ({
  initializeIntelligence: vi.fn(async () => ({ reasoningBankEnabled: false, sonaEnabled: false })),
}));

const bridge = await import('../src/memory/memory-bridge.js');

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-bridge-path-3143-')));
  state.calls.length = 0;
  state.closed.length = 0;
  state.failPath = '';
  state.failOperationPath = '';
  state.initializeGate = null;
  bridge._resetRegistryCacheForTest();
  bridge.__setMemoryBridgeRegistryFactoryForTests(() => new FakeRegistry());
});
afterEach(async () => {
  await bridge.shutdownBridge();
  rmSync(root, { recursive: true, force: true });
});

describe('#3143 bridge state belongs to a canonical database path', () => {
  it('a failed database does not disable a healthy database in the same process', async () => {
    const a = join(root, 'a.db');
    const b = join(root, 'b.db');
    state.failPath = a;

    expect(await bridge.getControllerRegistry(a)).toBeNull();
    expect(bridge.getBridgeFailureReason(a)).toContain('database A unavailable');
    expect(bridge.getBridgeFailureReason(b)).toBeNull();

    const healthy = await bridge.getControllerRegistry(b);
    expect(healthy).not.toBeNull();
    expect(await bridge.isBridgeAvailable(b)).toBe(true);
    expect(await bridge.isBridgeAvailable(a)).toBe(false);
    expect(state.calls).toEqual([a, b]);
    expect(state.closed).toEqual([a]);
  });

  it('symlink aliases and direct paths share one registry', async () => {
    const db = join(root, 'memory.db');
    const aliasDir = join(root, 'alias');
    writeFileSync(db, '');
    mkdirSync(aliasDir);
    const alias = join(aliasDir, 'memory.db');
    symlinkSync(db, alias);

    const directRegistry = await bridge.getControllerRegistry(db);
    const aliasRegistry = await bridge.getControllerRegistry(alias);

    expect(aliasRegistry).toBe(directRegistry);
    expect(state.calls).toEqual([db]);
  });

  it('canonicalizes a symlinked directory before the database file exists', async () => {
    const db = join(root, 'new.db');
    const aliasDir = join(root, 'alias-dir');
    symlinkSync(root, aliasDir, 'dir');

    const directRegistry = await bridge.getControllerRegistry(db);
    const aliasRegistry = await bridge.getControllerRegistry(join(aliasDir, 'new.db'));

    expect(aliasRegistry).toBe(directRegistry);
    expect(state.calls).toEqual([db]);
  });

  it('can retry a failed database after shutdown without affecting another database', async () => {
    const a = join(root, 'a.db');
    const b = join(root, 'b.db');
    state.failPath = a;
    expect(await bridge.getControllerRegistry(a)).toBeNull();
    expect(await bridge.getControllerRegistry(b)).not.toBeNull();

    await bridge.shutdownBridge();
    expect(bridge.getBridgeFailureReason(a)).toBeNull();
    expect(state.closed.sort()).toEqual([a, b].sort());
    state.failPath = '';
    bridge.__setMemoryBridgeRegistryFactoryForTests(() => new FakeRegistry());

    expect(await bridge.getControllerRegistry(a)).not.toBeNull();
    expect(state.calls).toEqual([a, b, a]);
  });

  it('keeps a per-operation diagnostic on the database whose controller failed', async () => {
    const a = join(root, 'a.db');
    const b = join(root, 'b.db');
    await bridge.getControllerRegistry(a);
    await bridge.getControllerRegistry(b);
    state.failOperationPath = a;

    expect(await bridge.bridgeStorePattern({ pattern: 'p', type: 'test', confidence: 1, dbPath: a })).toBeNull();
    expect(bridge.getBridgeFailureReason(a)).toContain('database A pattern operation failed');
    expect(bridge.getBridgeFailureReason(b)).toBeNull();
    expect(await bridge.isBridgeAvailable(b)).toBe(true);
  });

  it('concurrent opens deduplicate per path and shutdown closes each registry once', async () => {
    const a = join(root, 'a.db');
    const b = join(root, 'b.db');
    const [first, again, second] = await Promise.all([
      bridge.getControllerRegistry(a),
      bridge.getControllerRegistry(a),
      bridge.getControllerRegistry(b),
    ]);
    expect(first).toBe(again);
    expect(second).not.toBe(first);
    expect(state.calls.filter((path) => path === a)).toHaveLength(1);
    expect(state.calls.filter((path) => path === b)).toHaveLength(1);

    await bridge.shutdownBridge();
    expect(state.closed.sort()).toEqual([a, b].sort());
  });

  it('waits for an in-flight open before closing its native handle', async () => {
    const a = join(root, 'a.db');
    let release!: () => void;
    state.initializeGate = new Promise<void>((resolve) => { release = resolve; });

    const opening = bridge.getControllerRegistry(a);
    const shutdown = bridge.shutdownBridge();
    release();
    await Promise.all([opening, shutdown]);

    expect(state.closed).toEqual([a]);
    expect(bridge.getBridgeFailureReason(a)).toBeNull();
  });
});
