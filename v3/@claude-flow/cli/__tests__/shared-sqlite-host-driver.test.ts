/**
 * #3693/#3883 single-copy invariant after @claude-flow/memory started opening
 * AgentDB with its own better-sqlite3 (Node 24 Statement-GC abort): the CLI's
 * shared loader must hand out the exact constructor AgentDB's handle uses.
 *
 * The installed @claude-flow/memory may be the workspace source (>= 3.0.4,
 * routes AgentDB through getHostSqliteDriver) or a published copy that does
 * not (<= 3.0.3, AgentDB loads its own); both must keep one copy.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
// This package's vitest config externalizes both; import the resolved files natively.
const importInstalled = (name: string): Promise<any> => import(pathToFileURL(req.resolve(name)).href);
const memoryEntry = req.resolve('@claude-flow/memory');
const memoryRoutesAgentDB = existsSync(join(dirname(memoryEntry), 'agentdb-native-driver.js'));

describe('shared-sqlite follows the copy AgentDB opens its handle with', () => {
  it('owner is @claude-flow/memory when it routes AgentDB, else agentdb', async () => {
    const { resolveSqliteOwnerEntry } = await import('../src/memory/shared-sqlite.js');

    expect(resolveSqliteOwnerEntry()).toBe(memoryRoutesAgentDB ? memoryEntry : req.resolve('agentdb'));
  });

  it.skipIf(!memoryRoutesAgentDB)("loadBetterSqlite3() is the constructor of AgentDB's handle", async () => {
    const memory = await importInstalled('@claude-flow/memory');
    const { AgentDB } = await importInstalled('agentdb');
    const { loadBetterSqlite3 } = await import('../src/memory/shared-sqlite.js');
    const agentdb = new AgentDB({ dbPath: ':memory:' });

    expect(memory.useHostSqliteDriver(agentdb)).toBe(true);
    const handle = await agentdb.initializeDatabase(':memory:');
    try {
      expect(await loadBetterSqlite3()).toBe(memory.getHostSqliteDriver());
      expect(handle.constructor).toBe(await loadBetterSqlite3());
    } finally {
      handle.close();
    }
  });
});
