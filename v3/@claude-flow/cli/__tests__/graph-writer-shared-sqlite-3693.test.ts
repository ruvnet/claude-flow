/**
 * #3693: a CLI-owned better-sqlite3 handle opened through a DIFFERENT installed
 * copy than AgentDB's must not delete the -wal/-shm sidecars of a live AgentDB
 * handle when the graph writer's idle release closes it.
 *
 * Deterministic: real native modules (a second copy of the built binary is
 * placed in a temp "agentdb" tree), fake timers drive the idle close.
 *
 * Mock hermeticity (the flake this file used to have): vitest queues every
 * vi.doMock/vi.doUnmock and applies the whole queue with
 * `Promise.all(pending.map(async (m) => { await resolvePath(...); apply(m) }))`
 * on the next import, so two queued entries for ONE path are applied in
 * resolve-completion order, not call order. The old `afterEach(doUnmock)` +
 * next-test `doMock` pair therefore occasionally applied the unmock LAST, the
 * writer silently loaded the real shared-sqlite (a different native copy than
 * the holder's) and the sidecars were deleted. Never queue two entries for the
 * same path: setSharedSqliteMock() drains the queue between them, and the
 * `adversarial scheduler` below makes the bad order happen on every run.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const req = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'ruflo-3693-'));
const agentdbDir = join(root, 'node_modules', 'agentdb');
const agentdbEntry = join(agentdbDir, 'index.js');
let HolderCtor: any;
let native = true;

beforeAll(() => {
  try {
    const pkgDir = dirname(req.resolve('better-sqlite3/package.json'));
    const nm = join(agentdbDir, 'node_modules');
    mkdirSync(nm, { recursive: true });
    writeFileSync(agentdbEntry, '');
    cpSync(pkgDir, join(nm, 'better-sqlite3'), { recursive: true });
    for (const dep of ['bindings', 'file-uri-to-path']) {
      try { symlinkSync(dirname(req.resolve(`${dep}/package.json`)), join(nm, dep)); } catch { /* optional */ }
    }
    HolderCtor = createRequire(agentdbEntry)('better-sqlite3');
    const probe = new HolderCtor(':memory:'); probe.close();
  } catch { native = false; }
});

const SHARED_SQLITE = '../src/memory/shared-sqlite.js';

/**
 * Install (factory) or clear (no factory) the shared-sqlite mock without ever
 * leaving two queued entries for the same path: the import below forces vitest
 * to apply the unmock completely before the mock is queued.
 */
async function setSharedSqliteMock(factory?: () => unknown) {
  vi.resetModules();
  vi.doUnmock(SHARED_SQLITE);
  await import(SHARED_SQLITE);
  vi.resetModules();
  if (factory) vi.doMock(SHARED_SQLITE, factory as never);
}

// Adversarial scheduler: inside one mock-queue drain, the FIRST queued entry
// resolves LAST. That is the order that used to lose the mock intermittently;
// here it is forced, so a doUnmock queued before a doMock can never pass.
const mocker: any = (globalThis as any).__vitest_mocker__;
const adversary = typeof mocker?.resolveMocks === 'function' && typeof mocker?.resolvePath === 'function';
const realResolveMocks = adversary ? mocker.resolveMocks : null;
const realResolvePath = adversary ? mocker.resolvePath : null;
let drainCalls = 0;
const realSetTimeout = globalThis.setTimeout; // fake timers replace the global; the scheduler must not
beforeEach(() => {
  if (!adversary) return;
  mocker.resolveMocks = function (this: unknown, ...a: unknown[]) { drainCalls = 0; return realResolveMocks.apply(this, a); };
  mocker.resolvePath = async function (this: unknown, ...a: unknown[]) {
    if (drainCalls++ === 0) await new Promise((r) => realSetTimeout(r, 40));
    return realResolvePath.apply(this, a);
  };
});

afterEach(async () => {
  vi.useRealTimers();
  await setSharedSqliteMock(); // clear any mock, drained, so the next test starts from the real module
  if (adversary) { mocker.resolveMocks = realResolveMocks; mocker.resolvePath = realResolvePath; }
});

const ino = (f: string) => (existsSync(f) ? statSync(f).ino : null);

async function scenario(useShared: boolean) {
  const dbPath = join(root, `m-${useShared}.db`);
  const holder = new HolderCtor(dbPath);
  holder.pragma('journal_mode=WAL');
  holder.exec('create table memory_entries(x)');
  holder.prepare('insert into memory_entries values(1)').run();
  const before = [ino(dbPath + '-wal'), ino(dbPath + '-shm')];

  process.env.CLAUDE_FLOW_GRAPH_EDGE_IDLE_MS = '50';
  await setSharedSqliteMock(useShared ? () => ({
    loadBetterSqlite3: async () => HolderCtor,
    resolveAgentdbBetterSqlite3: () => HolderCtor,
  }) : undefined);
  vi.useFakeTimers();
  const gw = await import('../src/memory/graph-edge-writer.js');
  const db = await gw.getBridgeDb(dbPath);
  expect(db).not.toBeNull();
  // The writer must really be on the copy this scenario intends (never a silent fallback).
  expect(db instanceof HolderCtor).toBe(useShared);
  db.prepare('insert into memory_entries values(2)').run();
  vi.advanceTimersByTime(60); // idle release fires: checkpoint(TRUNCATE) + close
  vi.useRealTimers();
  const after = [ino(dbPath + '-wal'), ino(dbPath + '-shm')];
  holder.prepare('insert into memory_entries values(3)').run();
  const integrity = holder.pragma('integrity_check');
  holder.close();
  return { before, after, integrity };
}

afterAll(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* */ } });

describe('#3693 graph writer idle close vs live AgentDB handle', () => {
  it.skipIf(!adversary)('mock harness: the adversarial scheduler really inverts a naive doUnmock -> doMock pair', async () => {
    // Pins the vitest behaviour the helper exists for. If vitest ever applies
    // queued mocks in call order this fails: delete the scheduler + helper then.
    vi.resetModules();
    vi.doUnmock(SHARED_SQLITE);
    vi.doMock(SHARED_SQLITE, () => ({ loadBetterSqlite3: async () => 'mocked' }) as never);
    const m: any = await import(SHARED_SQLITE);
    expect(await m.loadBetterSqlite3()).not.toBe('mocked'); // mock lost: the real module was served
  });

  it.skipIf(!adversary)('mock harness: setSharedSqliteMock survives the same adversarial order', async () => {
    const marker = function Marker() {};
    await setSharedSqliteMock(() => ({ loadBetterSqlite3: async () => marker }));
    const m: any = await import(SHARED_SQLITE);
    expect(await m.loadBetterSqlite3()).toBe(marker);
  });

  it('helper resolves the constructor from the agentdb dependency owner', async () => {
    if (!native) return;
    const { resolveAgentdbBetterSqlite3 } = await import('../src/memory/shared-sqlite.js');
    expect(resolveAgentdbBetterSqlite3(agentdbEntry)).toBe(HolderCtor);
  });

  // @claude-flow/memory >= 3.0.4 opens AgentDB's handle with ITS better-sqlite3
  // (agentdb-native-driver.js), so that copy is the holder the CLI must share.
  it('owner is @claude-flow/memory when it routes AgentDB through its own driver', async (ctx) => {
    if (!native) ctx.skip(); // reported as skipped, never a silent pass
    const memDist = join(root, 'node_modules', '@claude-flow', 'memory', 'dist');
    const memNm = join(root, 'node_modules', '@claude-flow', 'memory', 'node_modules');
    mkdirSync(memDist, { recursive: true });
    mkdirSync(memNm, { recursive: true });
    writeFileSync(join(memDist, 'index.js'), '');
    writeFileSync(join(memDist, 'agentdb-native-driver.js'), '');
    cpSync(dirname(req.resolve('better-sqlite3/package.json')), join(memNm, 'better-sqlite3'), { recursive: true });
    for (const dep of ['bindings', 'file-uri-to-path']) {
      try { symlinkSync(dirname(req.resolve(`${dep}/package.json`)), join(memNm, dep)); } catch { /* optional */ }
    }
    const memEntry = join(memDist, 'index.js');
    const MemoryCtor = createRequire(memEntry)('better-sqlite3');
    const { resolveSqliteOwnerEntry, resolveAgentdbBetterSqlite3 } = await import('../src/memory/shared-sqlite.js');

    expect(resolveSqliteOwnerEntry(memEntry)).toBe(memEntry);
    expect(resolveAgentdbBetterSqlite3(memEntry)).toBe(MemoryCtor);
    expect(MemoryCtor).not.toBe(HolderCtor);
  });

  it('owner falls back to agentdb when @claude-flow/memory has no driver (memory <= 3.0.3)', async () => {
    const oldMemDist = join(root, 'old-memory', 'dist');
    mkdirSync(oldMemDist, { recursive: true });
    writeFileSync(join(oldMemDist, 'index.js'), '');
    const { resolveSqliteOwnerEntry } = await import('../src/memory/shared-sqlite.js');

    expect(resolveSqliteOwnerEntry(join(oldMemDist, 'index.js'))).toBe(req.resolve('agentdb'));
  });

  it("control: a different native copy DOES strip the live holder's sidecars (the hazard)", async () => {
    if (!native) return;
    const r = await scenario(false);
    expect(r.before[0]).not.toBeNull();
    expect(r.after).toEqual([null, null]);
  });

  it('graph writer sharing the holder copy leaves the WAL/SHM sidecars intact', async () => {
    if (!native) return;
    const r = await scenario(true);
    expect(r.before[0]).not.toBeNull();
    expect(r.after).toEqual(r.before);
    expect(r.integrity).toEqual([{ integrity_check: 'ok' }]);
  });
});

