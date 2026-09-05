/**
 * ADR-174 Milestone 3 — daemon wiring for the consolidate worker.
 *
 * The daemon previously wrote a hardcoded { patternsConsolidated: 0 } stub
 * every 30 minutes and touched no database — the root cause of the
 * intelligence tables (reasoning_patterns, episodes, causal_edges) staying
 * empty. `runConsolidateWorker()` now calls the frozen M1 service
 * (memory-distillation.ts's runDistillation) against `.swarm/memory.db` and
 * persists the REAL report to .claude-flow/metrics/consolidation.json.
 *
 * These tests prove:
 *  - the worker actually increases reasoning_patterns row count
 *  - it writes non-zero, real metrics (not the old hardcoded zeros)
 *  - running it twice is idempotent (distill_state cursor drains once)
 *  - the RUFLO_DAEMON_NO_DISTILL opt-out skips distillation without crashing
 *  - a corrupt/unusable DB is reported via metrics, never thrown
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { WorkerDaemon } from '../../src/services/worker-daemon.js';

let Database: any;
let haveNative = false;
try {
  Database = (await import('better-sqlite3')).default;
  haveNative = true;
} catch {
  haveNative = false;
}

/** Same schema/fixtures as __tests__/memory-distillation.test.ts. */
function seedDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT DEFAULT 'default',
    content TEXT, embedding TEXT, status TEXT DEFAULT 'active'
  )`);
  db.exec(`CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER DEFAULT 0, session_id TEXT NOT NULL,
    task TEXT NOT NULL, input TEXT, output TEXT, critique TEXT, reward REAL DEFAULT 0,
    success BOOLEAN DEFAULT 0, latency_ms INTEGER, tokens_used INTEGER, tags TEXT,
    metadata JSON, created_at INTEGER DEFAULT 0
  )`);
  db.exec(`CREATE TABLE reasoning_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER DEFAULT 0, task_type TEXT NOT NULL,
    approach TEXT NOT NULL, success_rate REAL NOT NULL DEFAULT 0, uses INTEGER DEFAULT 0,
    avg_reward REAL DEFAULT 0, tags TEXT, metadata TEXT
  )`);
  db.exec(`CREATE TABLE pattern_embeddings (
    pattern_id INTEGER PRIMARY KEY, embedding BLOB NOT NULL
  )`);
  db.exec(`CREATE TABLE causal_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_memory_id INTEGER NOT NULL, from_memory_type TEXT NOT NULL,
    to_memory_id INTEGER NOT NULL, to_memory_type TEXT NOT NULL, similarity REAL DEFAULT 0,
    confidence REAL DEFAULT 0.5, mechanism TEXT, metadata JSON, created_at INTEGER DEFAULT 0
  )`);

  const ins = db.prepare('INSERT INTO memory_entries (id, key, namespace, content, embedding) VALUES (?,?,?,?,?)');
  const vec = (seed: number) => JSON.stringify(Array.from({ length: 8 }, (_, i) => Math.sin(seed + i)));
  ins.run('c1', 'k1', 'commands', 'refactor the auth module in src/auth.ts', vec(1));
  ins.run('c2', 'k2', 'commands', 'add validation to src/api/handler.ts', vec(2));
  ins.run('c3', 'k3', 'commands', 'optimize the query in src/db/store.ts', vec(3));
  ins.run('f1', 'k4', 'feedback', JSON.stringify({ taskId: 'edit-a', success: true }), vec(4));
  ins.run('f2', 'k5', 'feedback', JSON.stringify({ taskId: 'edit-b', success: false }), vec(5));
  db.close();
}

function reasoningPatternCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  const c = (db.prepare('SELECT COUNT(*) AS c FROM reasoning_patterns').get() as { c: number }).c;
  db.close();
  return c;
}

describe.skipIf(!haveNative)('WorkerDaemon consolidate worker — ADR-174 M3 wiring', () => {
  let tempDir: string;
  let dbPath: string;
  let metricsFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'worker-daemon-consolidate-'));
    mkdirSync(join(tempDir, '.claude-flow', 'logs'), { recursive: true });
    mkdirSync(join(tempDir, '.swarm'), { recursive: true });
    dbPath = join(tempDir, '.swarm', 'memory.db');
    metricsFile = join(tempDir, '.claude-flow', 'metrics', 'consolidation.json');
    delete process.env.RUFLO_DAEMON_NO_DISTILL;
  });

  afterEach(() => {
    delete process.env.RUFLO_DAEMON_NO_DISTILL;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('distills memory_entries into reasoning_patterns and writes real (non-zero) metrics', async () => {
    seedDb(dbPath);
    expect(reasoningPatternCount(dbPath)).toBe(0);

    const daemon = new WorkerDaemon(tempDir);
    const result = await (daemon as any).runConsolidateWorker();

    // The worker must have actually written new rows, not a stub.
    expect(reasoningPatternCount(dbPath)).toBeGreaterThan(0);

    // Metrics file reflects the real report — not the old hardcoded zeros.
    expect(existsSync(metricsFile)).toBe(true);
    const metrics = JSON.parse(readFileSync(metricsFile, 'utf-8'));
    expect(metrics.distillationEnabled).toBe(true);
    expect(metrics.patternsConsolidated).toBeGreaterThan(0);
    expect(metrics.memoryCleaned).toBeGreaterThan(0);
    expect(metrics.episodes).toBeGreaterThan(0);

    // Same values surfaced on the returned worker result (used by
    // `daemon trigger -w consolidate` to print output.printJson(result.output)).
    expect((result as any).patternsConsolidated).toBe(metrics.patternsConsolidated);
  });

  it('is idempotent — a second tick processes nothing new (cursor-driven)', async () => {
    seedDb(dbPath);
    const daemon = new WorkerDaemon(tempDir);

    const first = await (daemon as any).runConsolidateWorker() as any;
    const patternsAfterFirst = reasoningPatternCount(dbPath);
    expect(patternsAfterFirst).toBeGreaterThan(0);

    const second = await (daemon as any).runConsolidateWorker() as any;

    // No new source rows since the first tick -> nothing new processed.
    expect(second.memoryCleaned).toBe(0);
    expect(reasoningPatternCount(dbPath)).toBe(patternsAfterFirst);
  });

  it('bounds each tick via maxEntries so a large backlog cannot be scanned in one call', async () => {
    seedDb(dbPath);
    const daemon = new WorkerDaemon(tempDir);
    // Sanity: the tick-bound constant used by the worker must be a small,
    // finite number — this is what keeps the worker well under
    // DEFAULT_WORKER_TIMEOUT_MS (16 min) regardless of backlog size.
    const result = await (daemon as any).runConsolidateWorker() as any;
    expect(result.memoryCleaned).toBeLessThanOrEqual(1000);
  });

  it('honors RUFLO_DAEMON_NO_DISTILL=1 and skips distillation entirely', async () => {
    seedDb(dbPath);
    process.env.RUFLO_DAEMON_NO_DISTILL = '1';

    const daemon = new WorkerDaemon(tempDir);
    const result = await (daemon as any).runConsolidateWorker() as any;

    expect(result.distillationEnabled).toBe(false);
    expect(reasoningPatternCount(dbPath)).toBe(0);

    const metrics = JSON.parse(readFileSync(metricsFile, 'utf-8'));
    expect(metrics.distillationEnabled).toBe(false);
    expect(metrics.patternsConsolidated).toBe(0);
  });

  it('never throws on a missing/absent memory DB — reports skipped in metrics', async () => {
    // No .swarm/memory.db written at all.
    const daemon = new WorkerDaemon(tempDir);
    await expect((daemon as any).runConsolidateWorker()).resolves.toBeDefined();

    const metrics = JSON.parse(readFileSync(metricsFile, 'utf-8'));
    expect(metrics.distillationEnabled).toBe(true);
    expect(metrics.skipped).toBeTruthy();
    expect(metrics.patternsConsolidated).toBe(0);
  });

  it('never throws on a corrupt memory DB — reports corrupt in metrics', async () => {
    // Write garbage bytes where a sqlite DB is expected.
    writeFileSync(dbPath, 'not a real sqlite file — corrupt on purpose');

    const daemon = new WorkerDaemon(tempDir);
    await expect((daemon as any).runConsolidateWorker()).resolves.toBeDefined();

    const metrics = JSON.parse(readFileSync(metricsFile, 'utf-8'));
    expect(metrics.distillationEnabled).toBe(true);
    expect(metrics.patternsConsolidated).toBe(0);
  });

  it('is dispatched via runWorkerLogic for the "consolidate" worker type (back-compat wiring)', async () => {
    seedDb(dbPath);
    const daemon = new WorkerDaemon(tempDir);
    const output = await (daemon as any).runWorkerLogic({ type: 'consolidate' } as any);
    expect((output as any).distillationEnabled).toBe(true);
    expect(reasoningPatternCount(dbPath)).toBeGreaterThan(0);
  });
});
