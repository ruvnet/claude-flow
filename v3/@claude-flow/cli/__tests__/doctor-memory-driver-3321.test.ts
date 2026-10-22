/** #3321: schema size cannot identify a database's driver or write history. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { initializeMemoryDatabase, _resetMemoryRootCache } from '../src/memory/memory-initializer.js';
import { encryptBuffer } from '../src/encryption/vault.js';

type Check = { name: string; status: string; message: string; fix?: string };
const originalCwd = process.cwd();
let workdir: string;
let dbPath: string;

async function runDoctor() {
  const { doctorCommand } = await import('../src/commands/doctor.js');
  const result = await doctorCommand.action!({
    flags: { component: 'memory' }, args: [], config: {},
  } as Parameters<NonNullable<typeof doctorCommand.action>>[0]);
  const checks = (result.data as { results: Check[] }).results;
  const driver = checks.find((check) => check.name === 'Memory Persistence Driver');
  expect(driver).toBeDefined();
  return { result, checks, driver: driver! };
}

// #3552: `loadBetterSqlite3` is passed directly rather than via `vi.doMock`.
// The old approach raced `beforeEach`'s real, unmocked driver init against
// the mock registration — reliable in isolation, flaky under the full suite.
// Passing the fake in as a parameter removes the module-loader timing
// entirely, so it no longer matters what else is importing 'better-sqlite3'
// concurrently.
async function runDriver(deps?: { loadBetterSqlite3?: () => Promise<{ default: any }> }) {
  const { checkMemoryPersistenceDriver } = await import('../src/commands/doctor.js');
  return checkMemoryPersistenceDriver(deps);
}

function expectNoDriverInference(check: Check) {
  expect(check.message).not.toMatch(/active driver:|likely created|writes made before|native schema ~|fallback schema shape/i);
  expect(check.fix ?? '').not.toMatch(/init --force/);
}

// Wrap real native handles; only the driver check's count query is replaced.
// Returned as a `loadBetterSqlite3` the caller passes straight to
// `runDriver()` — no `vi.doMock` timing involved (#3552).
function mockCountQuery(getCount: () => unknown) {
  const query = vi.fn(getCount);
  const handles: Array<{ db: InstanceType<typeof Database>; close: ReturnType<typeof vi.fn> }> = [];
  const construct = vi.fn(function (filename: string, options: object) {
    const db = new Database(filename, options);
    const close = vi.fn(() => db.close());
    handles.push({ db, close });
    return {
      prepare(sql: string) {
        if (sql === "SELECT count(*) AS c FROM sqlite_master WHERE type='table'") {
          return { get: query };
        }
        return db.prepare(sql);
      },
      pragma: (sql: string) => db.pragma(sql),
      close,
    };
  });
  const loadBetterSqlite3 = async () => ({ default: construct });
  return { handles, construct, query, loadBetterSqlite3 };
}

beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'doctor-3321-'));
  process.chdir(workdir);
  dbPath = join(workdir, '.swarm', 'memory.db');
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', join(workdir, '.swarm'));
  vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE', '1');
  vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '');
  vi.stubEnv('CLAUDE_FLOW_ENCRYPTION_KEY', '');
  _resetMemoryRootCache();
  // Real current initializer and sql.js schema/storage. The existing bridge
  // opt-out avoids unrelated AgentDB controllers and model downloads.
  const initialized = await initializeMemoryDatabase({
    dbPath, backend: 'hybrid', force: true, migrate: false,
  });
  expect(initialized.success).toBe(true);
});

afterEach(() => {
  vi.doUnmock('better-sqlite3');
  vi.doUnmock('sql.js');
  vi.resetModules();
  vi.unstubAllEnvs();
  process.chdir(originalCwd);
  _resetMemoryRootCache();
  rmSync(workdir, { recursive: true, force: true });
});

describe('doctor Memory Persistence Driver (#3321)', () => {
  it('does not recommend rebuilding a freshly initialized, readable schema', async () => {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      'memory_entries', 'patterns', 'metadata', 'vector_indexes', 'graph_edges',
    ]));
    // Establish that this real fixture exercises the former <20 branch.
    expect(tables.length).toBeLessThan(20);
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    db.close();
    const before = readFileSync(dbPath);
    const { driver } = await runDoctor();
    expectNoDriverInference(driver);
    expect(driver.message).toContain(`${tables.length} tables`);
    expect(driver.message).toMatch(/read-only/i);
    expect(driver.message).toMatch(/not verified/i);
    expect(readFileSync(dbPath)).toEqual(before);
  });

  it('reports a larger schema with the same limits on what was verified', async () => {
    const db = new Database(dbPath);
    for (let i = 0; i < 40; i++) db.exec(`CREATE TABLE extra_${i} (id INTEGER)`);
    const count = (db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'").get() as { c: number }).c;
    db.close();
    const { driver } = await runDoctor();
    expect(driver.status).toBe('pass');
    expect(driver.message).toContain(`${count} tables`);
    expect(driver.message).toMatch(/not verified/i);
    expectNoDriverInference(driver);
  });

  it('warns when the native package cannot be imported even if sql.js reads the schema', async () => {
    const driver = await runDriver({
      loadBetterSqlite3: async () => { throw new Error('Cannot find package better-sqlite3'); },
    });
    expect(driver.status).toBe('warn');
    expect(driver.message).toMatch(/unavailable|not installed/i);
    expect(driver.fix).toMatch(/better-sqlite3/);
    expectNoDriverInference(driver);
  });

  it('warns when the wrapper loads but its native binding cannot be constructed', async () => {
    // #3552: the driver check below is fed the fake directly. `vi.doMock`
    // here only needs to cover doctor's other checks (via `runDoctor()`),
    // which the #3321 comment already established as safe to leave mocked.
    const brokenBinding = () => ({ default: class {
      constructor() { throw new Error('Could not locate the bindings file. Tried:\n better_sqlite3.node'); }
    } });
    vi.doMock('better-sqlite3', brokenBinding);
    const driver = await runDriver({ loadBetterSqlite3: async () => brokenBinding() });
    const { checks } = await runDoctor();
    expect(driver.status).toBe('warn');
    expect(driver.message).toMatch(/binding unavailable/i);
    expect(driver.message).not.toMatch(/better_sqlite3.node/);
    expectNoDriverInference(driver);
    expect(checks.find((c) => c.name === 'Memory Integrity')?.status).toBe('warn');
  });

  it('does not let a large sql.js table count mask a native open failure', async () => {
    const db = new Database(dbPath);
    for (let i = 0; i < 40; i++) db.exec(`CREATE TABLE extra_${i} (id INTEGER)`);
    db.close();
    const cantOpen = () => ({ default: class {
      constructor() { throw new Error('SQLITE_CANTOPEN: unable to open database file'); }
    } });
    vi.doMock('better-sqlite3', cantOpen);
    const driver = await runDriver({ loadBetterSqlite3: async () => cantOpen() });
    const { checks, result } = await runDoctor();
    expect(driver.status).toBe('warn');
    expect(driver.message).toMatch(/could not open.*SQLITE_CANTOPEN/i);
    expectNoDriverInference(driver);
    expect(checks.find((c) => c.name === 'Memory Integrity')?.status).toBe('fail');
    expect(result.success).toBe(false);
  });

  it('warns on a count query exception and closes every owned native handle', async () => {
    const db = new Database(dbPath);
    for (let i = 0; i < 40; i++) db.exec(`CREATE TABLE extra_${i} (id INTEGER)`);
    db.close();
    const { handles, construct, loadBetterSqlite3 } = mockCountQuery(() => { throw new Error('count probe failed'); });
    const driver = await runDriver({ loadBetterSqlite3 });
    expect(driver.status).toBe('warn');
    expect(driver.message).toMatch(/table count.*(unavailable|failed)/i);
    expect(driver.message).toContain('count probe failed');
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) {
      expect(handle.close).toHaveBeenCalledTimes(1);
      expect(handle.db.open).toBe(false);
    }
    for (const [filename, options] of construct.mock.calls) {
      expect(filename).toBe(dbPath);
      expect(options).toEqual({ readonly: true, fileMustExist: true });
    }
  });

  it.each([undefined, {}, { c: null }, { c: NaN }, { c: -1 }, { c: 1.5 }, { c: Infinity }])(
    'warns when the count query provides no reliable result: %j', async (row) => {
      const { handles, query, loadBetterSqlite3 } = mockCountQuery(() => row);
      const driver = await runDriver({ loadBetterSqlite3 });
      expect(driver.status).toBe('warn');
      expect(driver.message).toMatch(/table count.*(unavailable|failed)/i);
      expectNoDriverInference(driver);
      expect(query).toHaveBeenCalledTimes(1);
      expect(handles).toHaveLength(1);
      for (const handle of handles) expect(handle.db.open).toBe(false);
    },
  );

  it('closes successful native probes without changing logical data', async () => {
    const before = readFileSync(dbPath);
    const { handles, query, loadBetterSqlite3 } = mockCountQuery(() => ({ c: 11 }));
    const driver = await runDriver({ loadBetterSqlite3 });
    expect(driver.message).toMatch(/read-only/i);
    expect(readFileSync(dbPath)).toEqual(before);
    expect(query).toHaveBeenCalledTimes(1);
    expect(handles).toHaveLength(1);
    for (const handle of handles) {
      expect(handle.close).toHaveBeenCalledTimes(1);
      expect(handle.db.open).toBe(false);
    }
  });

  it.each(['throw', 'missing', 'invalid'])('keeps an unavailable fallback count unknown: %s', async (mode) => {
    const close = vi.fn();
    const exec = vi.fn(() => {
      if (mode === 'throw') throw new Error('fallback query failed');
      return mode === 'missing' ? [] : [{ values: [[NaN]] }];
    });
    vi.doMock('sql.js', () => ({ default: async () => ({
      Database: class { exec = exec; close = close; },
    }) }));
    const before = readFileSync(dbPath);
    const driver = await runDriver({
      loadBetterSqlite3: async () => { throw new Error('Cannot find package better-sqlite3'); },
    });
    expect(driver.status).toBe('warn');
    expect(driver.message).toContain('table count unavailable');
    expectNoDriverInference(driver);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(readFileSync(dbPath)).toEqual(before);
  });

  it('keeps encrypted databases unprobed and unchanged', async () => {
    writeFileSync(dbPath, encryptBuffer(readFileSync(dbPath), Buffer.alloc(32, 7)));
    const before = readFileSync(dbPath);
    const { construct, loadBetterSqlite3 } = mockCountQuery(() => ({ c: 11 }));
    const driver = await runDriver({ loadBetterSqlite3 });
    expect(driver.status).toBe('warn');
    expect(driver.message).toMatch(/RFE1-encrypted/);
    expect(construct).not.toHaveBeenCalled();
    expect(readFileSync(dbPath)).toEqual(before);
  });

  it('retains real corruption failures in the integrity check', async () => {
    writeFileSync(dbPath, 'not a SQLite database');
    const { driver, checks, result } = await runDoctor();
    expect(driver.status).toBe('warn');
    expect(checks.find((c) => c.name === 'Memory Integrity')?.status).toBe('fail');
    expect(result.success).toBe(false);
  });

  it('warns without creating a missing database', async () => {
    unlinkSync(dbPath);
    const { construct, loadBetterSqlite3 } = mockCountQuery(() => ({ c: 11 }));
    const driver = await runDriver({ loadBetterSqlite3 });
    expect(driver.status).toBe('warn');
    expect(driver.message).toMatch(/no memory.db found/);
    expect(construct).not.toHaveBeenCalled();
    expect(existsSync(dbPath)).toBe(false);
  });
});
