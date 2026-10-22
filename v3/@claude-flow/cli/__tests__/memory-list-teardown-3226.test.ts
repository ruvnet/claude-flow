/**
 * #3226: `memory list` printed the correct rows and then intermittently
 * aborted on Windows with a libuv UV_HANDLE_CLOSING assertion. The bin
 * wrapper called process.exit(0) immediately after the command resolved,
 * racing the memory ControllerRegistry/sql.js teardown.
 *
 * This is a bin-level regression test: it spawns the built CLI (and the
 * `ruflo` wrapper) repeatedly against a small sql.js store and requires every
 * run to exit 0 with complete output. The store is built directly with
 * sql.js so the test does not depend on a native AgentDB install or download
 * an embedding model.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MEMORY_SCHEMA_V3 } from '../src/memory/memory-initializer.js';

const CLI_BIN = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const CLI_DIST = fileURLToPath(new URL('../dist/src/index.js', import.meta.url));
const RUFLO_BIN = fileURLToPath(new URL('../../../../ruflo/bin/ruflo.js', import.meta.url));
const CLI_BUILT = existsSync(CLI_DIST);
const RUFLO_BUILT = CLI_BUILT && existsSync(RUFLO_BIN);

async function makeStore(): Promise<{ root: string; dbPath: string; cleanup: () => void }> {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-list-teardown-'));
  const dbPath = join(root, 'memory.db');
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(MEMORY_SCHEMA_V3);
    const now = Date.now();
    for (const [i, key] of ['alpha', 'beta', 'gamma'].entries()) {
      db.run(
        `INSERT INTO memory_entries
           (id, key, namespace, content, access_count, created_at, updated_at, status)
         VALUES (?, ?, 'default', ?, 0, ?, ?, 'active')`,
        [`id-${i}`, key, `value for ${key}`, now, now],
      );
    }
    const bytes = db.export();
    writeFileSync(dbPath, Buffer.from(bytes));
  } finally {
    db.close();
  }
  return { root, dbPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runMemory(bin: string, cwd: string, args: string[]) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      // Exercise the sql.js path that the issue reproduces on.
      CLAUDE_FLOW_DISABLE_BRIDGE: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  });
}

function runList(bin: string, cwd: string, dbPath: string) {
  return runMemory(bin, cwd, ['memory', 'list', '--path', dbPath]);
}

function expectStableListRuns(bin: string, cwd: string, dbPath: string, runs = 15) {
  for (let i = 1; i <= runs; i++) {
    const result = runList(bin, cwd, dbPath);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    expect(result.error, `run ${i} failed to spawn: ${result.error?.message}`).toBeUndefined();
    expect(result.signal, `run ${i} was killed: ${output}`).toBeNull();
    expect(result.status, `run ${i} exited ${result.status}:\n${output}`).toBe(0);
    expect(output, `run ${i} omitted the result summary`).toContain('Showing 3 of 3 entries');
    expect(output, `run ${i} hit the libuv teardown assertion`).not.toMatch(
      /UV_HANDLE_CLOSING|Assertion failed|libuv/,
    );
  }
}

describe.skipIf(!CLI_BUILT)('#3226 memory list teardown', () => {
  it('the built CLI exits cleanly on every run', async () => {
    const store = await makeStore();
    try {
      expectStableListRuns(CLI_BIN, store.root, store.dbPath);
    } finally {
      store.cleanup();
    }
  }, 120_000);

  it.skipIf(!RUFLO_BUILT)('the ruflo wrapper exits cleanly on every run', async () => {
    const store = await makeStore();
    try {
      expectStableListRuns(RUFLO_BIN, store.root, store.dbPath);
    } finally {
      store.cleanup();
    }
  }, 120_000);

  it('a one-shot memory write still terminates without the forced exit', async () => {
    const store = await makeStore();
    try {
      const result = runMemory(CLI_BIN, store.root, [
        'memory', 'store', '-k', 'delta', '--value', 'delta value',
        '--no-embedding', '--path', store.dbPath,
      ]);
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.error, `store failed to spawn: ${result.error?.message}`).toBeUndefined();
      expect(result.status, `store exited ${result.status}:\n${output}`).toBe(0);
      expect(output).toContain('Data stored successfully');
    } finally {
      store.cleanup();
    }
  }, 30_000);
});

