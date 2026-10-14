/**
 * Node 24 abort in agentdb's nested better-sqlite3 11.x
 * (`Assertion failed: (env) != nullptr` in Statement::~Statement).
 *
 * useHostSqliteDriver() must make AgentDB open its handle with this
 * package's better-sqlite3, so the source-built 11.x addon is never loaded.
 */

import { afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { getHostSqliteDriver, useHostSqliteDriver } from './agentdb-native-driver.js';
import { AGENTDB_CONCURRENT_MODIFICATION_CODE } from './agentdb-lock-guard.js';

function fakeAgentDB(config: { forceWasm?: boolean } = {}) {
  const calls: string[] = [];
  const own = { own: true };
  const agentdb: {
    config: { forceWasm?: boolean };
    usingWasm: boolean;
    initializeDatabase: (dbPath: string) => Promise<any>;
  } = {
    config,
    usingWasm: true,
    async initializeDatabase(dbPath: string) {
      calls.push(dbPath);
      return own;
    },
  };
  return { agentdb, calls, own };
}

describe('useHostSqliteDriver', () => {
  it('opens the AgentDB handle with our better-sqlite3, not agentdb\'s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-agentdb-driver-'));
    const { agentdb, calls } = fakeAgentDB();
    try {
      useHostSqliteDriver(agentdb);
      const db = await agentdb.initializeDatabase(join(dir, 'agentdb-memory.db'));

      expect(db).toBeInstanceOf(Database);
      expect(calls).toEqual([]);
      expect(agentdb.usingWasm).toBe(false);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to AgentDB\'s own loader when ours cannot open the path', async () => {
    const { agentdb, calls, own } = fakeAgentDB();
    useHostSqliteDriver(agentdb);
    const missingDir = join(tmpdir(), 'cf-agentdb-driver-missing', 'nested', 'x.db');

    await expect(agentdb.initializeDatabase(missingDir)).resolves.toBe(own);
    expect(calls).toEqual([missingDir]);
  });

  it('leaves forceWasm instances on AgentDB\'s own loader', async () => {
    const { agentdb, calls, own } = fakeAgentDB({ forceWasm: true });
    useHostSqliteDriver(agentdb);

    await expect(agentdb.initializeDatabase(':memory:')).resolves.toBe(own);
    expect(calls).toEqual([':memory:']);
  });

  it('reports objects without initializeDatabase instead of throwing', () => {
    expect(useHostSqliteDriver(null)).toBe(false);
    expect(useHostSqliteDriver({})).toBe(false);
    expect(useHostSqliteDriver(fakeAgentDB().agentdb)).toBe(true);
  });

  it('getHostSqliteDriver is the better-sqlite3 this package resolves', () => {
    expect(getHostSqliteDriver()).toBe(Database);
  });

  it('hands the real AgentDB.initialize() a working handle', async () => {
    const { AgentDB } = (await import('agentdb')) as any;
    const agentdb = new AgentDB({ dbPath: ':memory:' });
    useHostSqliteDriver(agentdb);
    let opened: unknown;
    const wrapped = agentdb.initializeDatabase.bind(agentdb);
    agentdb.initializeDatabase = async (p: string) => (opened = await wrapped(p));
    try {
      await agentdb.initialize();
    } catch {
      // Embedder/vector-backend setup may fail offline; the handle is what matters.
    }

    expect(opened).toBeInstanceOf(Database);
    (opened as Database.Database | undefined)?.close();
  }, 60_000);
});

/**
 * A nested agentdb copy of better-sqlite3 — the installed layout that aborts on
 * Node 24. pnpm dedupes the workspace onto one copy, so build a second native
 * copy under a temp `node_modules/agentdb`, like graph-writer-shared-sqlite-3693.
 */
describe('useHostSqliteDriver with a nested agentdb copy', () => {
  const req = createRequire(import.meta.url);
  const root = mkdtempSync(join(tmpdir(), 'cf-agentdb-nested-'));
  const agentdbDir = join(root, 'node_modules', 'agentdb');
  let NestedCtor: any;
  let FakeAgentDB: any;
  try {
    const nm = join(agentdbDir, 'node_modules');
    mkdirSync(nm, { recursive: true });
    cpSync(dirname(req.resolve('better-sqlite3/package.json')), join(nm, 'better-sqlite3'), { recursive: true });
    for (const dep of ['bindings', 'file-uri-to-path']) {
      try { symlinkSync(dirname(req.resolve(`${dep}/package.json`)), join(nm, dep)); } catch { /* optional */ }
    }
    // Same shape as AgentDB.initializeDatabase(): load better-sqlite3 from agentdb's own location.
    writeFileSync(join(agentdbDir, 'index.cjs'), `
      class AgentDB {
        constructor(config = {}) { this.config = config; this.usingWasm = true; }
        async initializeDatabase(dbPath) {
          const Database = require('better-sqlite3');
          const db = new Database(dbPath);
          db.pragma('journal_mode = WAL');
          this.usingWasm = false;
          return db;
        }
        async initialize() { this.db = await this.initializeDatabase(this.config.dbPath || ':memory:'); }
        get database() { return this.db; }
      }
      module.exports = { AgentDB, NestedDatabase: require('better-sqlite3') };
    `);
    ({ AgentDB: FakeAgentDB, NestedDatabase: NestedCtor } = createRequire(join(agentdbDir, 'index.cjs'))('./index.cjs'));
  } catch { NestedCtor = null; }

  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  it.skipIf(!NestedCtor)('control: without the helper AgentDB opens its handle with the nested copy', async () => {
    expect(NestedCtor).not.toBe(Database);
    const agentdb = new FakeAgentDB({ dbPath: ':memory:' });
    await agentdb.initialize();

    expect(agentdb.database).toBeInstanceOf(NestedCtor);
    agentdb.database.close();
  });

  it.skipIf(!NestedCtor)('with the helper the handle comes from getHostSqliteDriver(), not the nested copy', async () => {
    const agentdb = new FakeAgentDB({ dbPath: ':memory:' });
    useHostSqliteDriver(agentdb);
    await agentdb.initialize();

    expect(agentdb.database).toBeInstanceOf(getHostSqliteDriver());
    expect(agentdb.database).not.toBeInstanceOf(NestedCtor);
    agentdb.database.close();
  });
});

/**
 * Fake agentdb module whose AgentDB records the handle its initialize() opened.
 * With `failFirstInit`, the first instance fails like agentdb alpha.20 does on a
 * stale `<db>.agentdb.lock`, so withAgentdbLockRecovery retries with a new instance.
 */
function agentdbModuleRecordingHandle(failFirstInit = false) {
  const opened: unknown[] = [];
  let instances = 0;
  class AgentDB {
    config: Record<string, unknown>;
    usingWasm = true;
    database: unknown = null;
    readonly instance = ++instances;
    constructor(config: Record<string, unknown> = {}) { this.config = config; }
    async initializeDatabase(_dbPath: string): Promise<unknown> { return { agentdbOwnLoader: true }; }
    async initialize() {
      if (failFirstInit && this.instance === 1) {
        throw Object.assign(new Error('concurrent modification'), { code: AGENTDB_CONCURRENT_MODIFICATION_CODE });
      }
      this.database = await this.initializeDatabase((this.config.dbPath as string) || ':memory:');
      opened.push(this.database);
    }
  }
  return { opened, instances: () => instances, module: { AgentDB, default: AgentDB } };
}

/** A db path whose `<db>.agentdb.lock` belongs to a dead writer (provably stale). */
function dbWithStaleLock(dir: string): string {
  const dbPath = join(dir, 'agentdb-memory.db');
  const lock = `${dbPath}.agentdb.lock`;
  writeFileSync(lock, '2147483000\n');
  const old = new Date(Date.now() - 3600_000);
  utimesSync(lock, old, old);
  return dbPath;
}

/**
 * vitest applies the queued doMock/doUnmock entries for one path in
 * resolve-completion order, not call order (see graph-writer-shared-sqlite-3693
 * in the CLI). Never leave two queued: apply each change with an import
 * before the next is queued.
 */
async function clearAgentdbMock(): Promise<void> {
  vi.resetModules();
  vi.doUnmock('agentdb');
  await import('agentdb').catch(() => null);
  vi.resetModules();
}

async function mockAgentdb(module: unknown): Promise<void> {
  await clearAgentdbMock();
  vi.doMock('agentdb', () => module as never);
  await import('agentdb');
}

describe('AgentDB construction sites apply useHostSqliteDriver', () => {
  afterEach(clearAgentdbMock);

  it('ControllerRegistry.initAgentDB', async () => {
    const fake = agentdbModuleRecordingHandle();
    await mockAgentdb(fake.module);
    const { ControllerRegistry } = await import('./controller-registry.js');

    await (new ControllerRegistry() as any).initAgentDB({ dbPath: ':memory:' });

    expect(fake.opened).toHaveLength(1);
    expect(fake.opened[0]).toBeInstanceOf(Database);
    (fake.opened[0] as Database.Database).close();
  });

  it('AgentDBBackend.initialize', async () => {
    const fake = agentdbModuleRecordingHandle();
    await mockAgentdb(fake.module);
    const { AgentDBBackend } = await import('./agentdb-backend.js');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Schema setup after initialize() may fail against the fake; the handle is what matters.
    await new AgentDBBackend({ dbPath: ':memory:' } as any).initialize();
    errors.mockRestore();

    expect(fake.opened).toHaveLength(1);
    expect(fake.opened[0]).toBeInstanceOf(Database);
    (fake.opened[0] as Database.Database).close();
  });
});

describe('AgentDB construction sites reroute the stale-lock retry instance too', () => {
  afterEach(clearAgentdbMock);

  it('ControllerRegistry.initAgentDB retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-agentdb-retry-'));
    try {
      const fake = agentdbModuleRecordingHandle(true);
      await mockAgentdb(fake.module);
      const { ControllerRegistry } = await import('./controller-registry.js');

      await (new ControllerRegistry() as any).initAgentDB({ dbPath: dbWithStaleLock(dir) });

      expect(fake.instances()).toBe(2);
      expect(fake.opened).toHaveLength(1);
      expect(fake.opened[0]).toBeInstanceOf(Database);
      (fake.opened[0] as Database.Database).close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AgentDBBackend.initialize retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-agentdb-retry-'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fake = agentdbModuleRecordingHandle(true);
      await mockAgentdb(fake.module);
      const { AgentDBBackend } = await import('./agentdb-backend.js');

      await new AgentDBBackend({ dbPath: dbWithStaleLock(dir) } as any).initialize();

      expect(fake.instances()).toBe(2);
      expect(fake.opened).toHaveLength(1);
      expect(fake.opened[0]).toBeInstanceOf(Database);
      (fake.opened[0] as Database.Database).close();
    } finally {
      errors.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Drift guard: useHostSqliteDriver replaces AgentDB.initializeDatabase(). If
 * agentdb renames it or stops routing initialize() through it, the helper would
 * silently do nothing — fail here instead.
 */
describe('agentdb AgentDB contract the helper depends on', () => {
  it('initialize() opens its handle through initializeDatabase(dbPath) with native better-sqlite3', async () => {
    const { AgentDB } = (await import('agentdb')) as any;
    const source = readFileSync(createRequire(import.meta.url).resolve('agentdb').replace(/index\.js$/, 'core/AgentDB.js'), 'utf8');

    expect(typeof AgentDB.prototype.initializeDatabase).toBe('function');
    expect(useHostSqliteDriver(new AgentDB({ dbPath: ':memory:' }))).toBe(true);
    expect(source).toMatch(/this\.db\s*=\s*await\s+this\.initializeDatabase\(dbPath\)/);
    expect(source).toMatch(/import\('better-sqlite3'\)/);
    expect(source).toMatch(/pragma\('journal_mode = WAL'\)/);
  });
});
