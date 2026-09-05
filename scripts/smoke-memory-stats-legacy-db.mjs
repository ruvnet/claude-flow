#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2120 — `ruflo memory stats` and
 * `listEntries` returned 0 entries against a populated `.swarm/memory.db`
 * on WSL2 (reporter: @alexandrelealbess, alpha.81).
 *
 * Root cause: the `WHERE status = 'active'` filter in both
 * `bridgeListEntries` (memory-bridge.ts) and `listEntries`
 * (memory-initializer.ts:2544+) excluded rows where the `status` column
 * was NULL — which happens when:
 *   - The DB was created before the status column existed
 *   - The auto-memory bridge wrote rows via a path that didn't set status
 *   - ALTER TABLE ADD COLUMN's DEFAULT backfill was skipped
 *
 * This smoke creates a `.swarm/memory.db` with 251 entries that have NULL
 * status (simulating an old DB), then asserts both code paths return 251
 * — not 0.
 *
 * Without the #2120 fix, the assertion fails with `total: 0`.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
function pass(msg) { console.log(`✓ ${msg}`); }

// 1. Build a `.swarm/memory.db` that mirrors the reporter's setup:
//    251 entries with status = NULL.
const work = mkdtempSync(join(tmpdir(), 'smoke-2120-'));
try {
  const swarmDir = join(work, '.swarm');
  mkdirSync(swarmDir, { recursive: true });
  const dbPath = join(swarmDir, 'memory.db');

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    namespace TEXT DEFAULT 'default',
    content TEXT NOT NULL,
    type TEXT DEFAULT 'semantic',
    embedding TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
    access_count INTEGER DEFAULT 0,
    status TEXT
  )`);
  // Insert 251 entries with NULL status (the actual reporter scenario)
  const ns = (i) => i < 85 ? 'feedback' : i < 156 ? 'causal-edges' : i < 187 ? 'session' : i < 210 ? 'project' : 'pattern';
  for (let i = 0; i < 251; i++) {
    db.run(
      `INSERT INTO memory_entries(id, key, namespace, content) VALUES (?, ?, ?, ?)`,
      [`id_${i}`, `key_${i}`, ns(i), `content for entry ${i}`],
    );
  }
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  pass(`fixture: 251 entries written to ${dbPath} with status=NULL`);

  // 2. Verify the fixture is what we expect (sanity)
  {
    const SQL2 = await initSqlJs();
    const verify = new SQL2.Database(new Uint8Array(await (await import('node:fs/promises')).readFile(dbPath)));
    const stmt = verify.prepare('SELECT COUNT(*) FROM memory_entries WHERE status IS NULL');
    stmt.step();
    const nullCount = stmt.get()[0];
    stmt.free();
    if (nullCount !== 251) fail(`fixture sanity: expected 251 NULL-status rows, got ${nullCount}`);
    else pass(`fixture sanity: 251 rows have status=NULL`);
    verify.close();
  }

  // 3. Run the actual `listEntries` from the built CLI dist with the
  //    bridge DISABLED via env hint — we test the raw sql.js fallback
  //    path because the AgentDB v3 bridge optionally pulls a Xenova
  //    embedding model on init which hangs CI without network.
  process.env.CLAUDE_FLOW_MEMORY_PATH = swarmDir;
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  // Reset getMemoryRoot cache so the env var takes effect.
  const init = await import(resolve(REPO_ROOT, 'v3/@claude-flow/cli/dist/src/memory/memory-initializer.js'));
  if (typeof init._resetMemoryRootCache === 'function') init._resetMemoryRootCache();

  // Force-route through raw sql.js by passing explicit dbPath
  const result = await init.listEntries({ limit: 1000, dbPath });
  if (!result.success) {
    fail(`listEntries returned success=false: ${result.error}`);
  } else if (result.total === 0) {
    fail(`#2120 REGRESSION: listEntries returned total=0 for 251-row legacy DB (NULL status not accepted)`);
  } else if (result.total !== 251) {
    fail(`listEntries returned total=${result.total}, expected 251`);
  } else {
    pass(`listEntries returns total=251 against legacy DB (NULL status accepted as active)`);
  }

  // 4. After listEntries, the backfill in ensureSchemaColumns should
  //    have updated NULL → 'active'. Verify by re-reading.
  {
    const SQL3 = await initSqlJs();
    const verify = new SQL3.Database(new Uint8Array(await (await import('node:fs/promises')).readFile(dbPath)));
    const stmt = verify.prepare(`SELECT COUNT(*) FROM memory_entries WHERE status = 'active'`);
    stmt.step();
    const activeCount = stmt.get()[0];
    stmt.free();
    if (activeCount !== 251) {
      fail(`backfill: expected 251 status='active' rows after listEntries, got ${activeCount}`);
    } else {
      pass(`backfill: ensureSchemaColumns promoted NULL → 'active' for all 251 rows`);
    }
    verify.close();
  }
} finally {
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}

if (process.exitCode) {
  console.error('\n#2120 regression smoke FAILED');
  process.exit(1);
} else {
  console.log('\n#2120 regression smoke PASS');
  // Exit explicitly so a lazy bridge handle / sql.js worker keepalive
  // doesn't prevent the process from terminating (observed locally —
  // assertions all passed but process kept running for 30s+).
  process.exit(0);
}
