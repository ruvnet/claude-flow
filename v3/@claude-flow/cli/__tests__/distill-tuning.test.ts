/**
 * ADR-174 Milestone 4 — self-optimization harness ("ruflo tuning ruflo").
 *
 * Proves `tuneDistillation`:
 *  - scores every grid point via runDistillation (M1, frozen) on isolated
 *    temp copies, never the source DB;
 *  - splits train/held-out by rowid with no overlap;
 *  - picks a winner by train score and scores it once on the true held-out
 *    set;
 *  - never mutates the source DB (checksum unchanged);
 *  - persists the winning config to a plain JSON-shaped object.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  tuneDistillation,
  computeTimeSplit,
  buildTunedConfigFile,
  writeTunedConfigFile,
  defaultTunedConfigPath,
  DEFAULT_GRID_BATCH_SIZE,
  DEFAULT_GRID_DEDUP_DISTANCE,
  DEFAULT_GRID_PROMOTE_THRESHOLD,
} from '../src/services/distill-tuning.js';

let Database: any;
let haveNative = false;
try {
  Database = (await import('better-sqlite3')).default;
  haveNative = true;
} catch {
  haveNative = false;
}

const TOPICS = [
  { label: 'auth', path: 'src/auth.ts', text: 'refactor the auth module in src/auth.ts to validate tokens' },
  { label: 'api', path: 'src/api/handler.ts', text: 'add validation to src/api/handler.ts for malformed input' },
  { label: 'db', path: 'src/db/store.ts', text: 'optimize the query in src/db/store.ts to cache results' },
  { label: 'memory', path: 'src/memory/bridge.ts', text: 'fix the memory leak in src/memory/bridge.ts on close' },
  { label: 'test', path: 'src/tests/runner.ts', text: 'debug the flaky test in src/tests/runner.ts and stub it' },
];

/** Deterministic per-topic vector cluster with a bit of jitter per row. */
function vec(topicIndex: number, jitterSeed: number): number[] {
  return Array.from({ length: 16 }, (_, i) => Math.sin(topicIndex * 10 + i) + 0.01 * Math.sin(jitterSeed + i));
}

/** Build a fixture DB with the source + agentdb target schemas (M1's shape). */
function seedDb(dbPath: string, rowCount: number): void {
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
  const commit = db.transaction(() => {
    for (let i = 0; i < rowCount; i++) {
      const topicIndex = i % TOPICS.length;
      const topic = TOPICS[topicIndex];
      const namespace = i % 3 === 0 ? 'feedback' : 'commands';
      const content =
        namespace === 'feedback'
          ? JSON.stringify({ taskId: `t${i}`, success: i % 2 === 0, note: topic.text })
          : `${topic.text} (row ${i})`;
      ins.run(`row-${i}`, `k${i}`, namespace, content, JSON.stringify(vec(topicIndex, i)));
    }
  });
  commit();
  db.close();
}

function sha256(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

describe.skipIf(!haveNative)('tuneDistillation — Milestone 4 self-optimization harness', () => {
  let workdir: string;
  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'distill-tune-'));
  });

  it('exposes the ADR-174 default grid (batchSize x dedupDistance x promoteThreshold)', () => {
    expect(DEFAULT_GRID_BATCH_SIZE).toEqual([100, 200, 500]);
    expect(DEFAULT_GRID_DEDUP_DISTANCE).toEqual([0.05, 0.1, 0.15, 0.2, 0.3]);
    expect(DEFAULT_GRID_PROMOTE_THRESHOLD).toEqual(['execution-only', 'execution+corroborated']);
  });

  it(
    'scores every grid point, picks a winner, and scores held-out exactly once',
    async () => {
      const dbPath = join(workdir, 'main.db');
      seedDb(dbPath, 90);
      const before = sha256(dbPath);

      const report = await tuneDistillation({
        dbPath,
        grid: {
          batchSize: [50, 200],
          dedupDistance: [0.1, 0.2],
          promoteThreshold: ['execution-only', 'execution+corroborated'],
        },
        tmpDir: join(workdir, 'tmp'),
        now: 1750000000000,
      });

      // All grid points scored.
      expect(report.candidates.length).toBe(2 * 2 * 2);
      for (const c of report.candidates) {
        expect(typeof c.trainScore).toBe('number');
        expect(c.trainScore).toBeGreaterThanOrEqual(0);
      }

      // Winner is a real candidate with the best train score among scored ones.
      const scored = report.candidates.filter((c) => !c.skipped);
      const maxScore = Math.max(...scored.map((c) => c.trainScore));
      expect(report.winner.trainScore).toBe(maxScore);
      expect(report.candidates).toContainEqual(report.winner);

      // Held-out scored once, with its own query count and a baseline comparison.
      expect(report.heldOut.queryCount).toBeGreaterThan(0);
      expect(typeof report.heldOut.mrrAt10).toBe('number');
      expect(typeof report.heldOut.baselineMrrAt10).toBe('number');
      expect(typeof report.overfit).toBe('boolean');

      // Provenance is stamped from the caller-supplied `now`, not Date.now().
      expect(report.provenance.tunedAt).toBe(1750000000000);
      expect(report.provenance.gridSize).toBe(8);
      expect(report.provenance.trainSize + report.provenance.heldOutSize).toBe(report.provenance.corpusSize);

      // Source DB byte-for-byte unchanged.
      const after = sha256(dbPath);
      expect(after).toBe(before);
      expect(report.provenance.sourceChecksumSha256).toBe(after);
    },
    30000,
  );

  it('splits train/held-out by rowid with no overlap', () => {
    const dbPath = join(workdir, 'split.db');
    seedDb(dbPath, 40);
    const db = new Database(dbPath, { readonly: true });
    try {
      const split = computeTimeSplit(db, 0.8);
      expect(split.totalRows).toBe(40);
      expect(split.trainRowids.length + split.heldOutRowids.length).toBe(40);
      const trainSet = new Set(split.trainRowids);
      const overlap = split.heldOutRowids.filter((r) => trainSet.has(r));
      expect(overlap).toEqual([]);
      // Earliest ~80% is train: every train rowid precedes every held-out rowid.
      expect(Math.max(...split.trainRowids)).toBeLessThan(Math.min(...split.heldOutRowids));
    } finally {
      db.close();
    }
  });

  it('flags overfitting only when held-out is meaningfully worse than train', async () => {
    const dbPath = join(workdir, 'overfit.db');
    seedDb(dbPath, 60);
    const report = await tuneDistillation({
      dbPath,
      grid: { batchSize: [50], dedupDistance: [0.1], promoteThreshold: ['execution-only'] },
      tmpDir: join(workdir, 'tmp2'),
      now: 1750000000001,
    });
    // Deterministic check on the documented rule, not a specific outcome
    // (which depends on the synthetic corpus): overfit iff heldOut < 0.8*train.
    const expected = report.winner.trainScore > 0 && report.heldOut.mrrAt10 < report.winner.trainScore * 0.8;
    expect(report.overfit).toBe(expected);
  });

  it('builds a persistable config artifact carrying provenance', async () => {
    const dbPath = join(workdir, 'persist.db');
    seedDb(dbPath, 50);
    const report = await tuneDistillation({
      dbPath,
      grid: { batchSize: [100], dedupDistance: [0.15], promoteThreshold: ['execution-only'] },
      tmpDir: join(workdir, 'tmp3'),
      now: 1750000000002,
    });

    const artifact = buildTunedConfigFile(report);
    expect(artifact.batchSize).toBe(100);
    expect(artifact.dedupDistance).toBe(0.15);
    expect(artifact.promoteThreshold).toBe('execution-only');
    expect(artifact.provenance.tunedAt).toBe(1750000000002);
    expect(artifact.provenance.winnerTrainScore).toBe(report.winner.trainScore);

    const outPath = join(workdir, 'out', 'distill-tuned.json');
    writeTunedConfigFile(report, outPath);
    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(written).toEqual(artifact);

    expect(defaultTunedConfigPath('/tmp/some-project')).toBe(join('/tmp/some-project', '.claude-flow', 'distill-tuned.json'));
  });
});
