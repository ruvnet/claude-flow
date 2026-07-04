// #2558 regression: `memory search` recall was broken in v3.19.0/3.20.0 —
// confirmed-stored entries were not recalled by keyword OR semantic search,
// while store/list/retrieve/delete worked, and the HNSW index reported 0
// vectors. Root cause was in the AgentDB bridge search path
// (`bridgeSearchEntries`): it fused
//   0.7 * cosine + 0.3 * (BM25 / 10)
// and BM25's IDF collapses toward zero when a term appears in most/all
// documents (routine on small memory corpora), so an exact-keyword hit scored
// well below the default 0.3 threshold and was dropped. Separately,
// better-sqlite3's WAL was never checkpointed and `vector_indexes.total_vectors`
// was never updated, so WAL-blind readers reported "HNSW index: 0 vectors".
//
// This is an end-to-end guard: it drives the built CLI in a throwaway cwd
// exactly like the bug report (store → list → search), because the AgentDB
// bridge (better-sqlite3 + embedder) is the path that regressed and it only
// activates in a real CLI process, not under the vitest transform.
//
// The test is skipped when the CLI has not been built (`bin/cli.js` absent).
// The documented flow is `npm run build && npm test`, so the guard is active
// in the standard dev/release pipeline.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'cli.js');
const CLI_BUILT = fs.existsSync(CLI);

const NS = 'recall2558';
const ENTRIES = [
  { key: 'note/alpha', value: 'ruflo memory connectivity health probe alpha', unique: 'probe' },
  { key: 'note/beta', value: 'ruflo memory connectivity latency check beta', unique: 'latency' },
  { key: 'note/gamma', value: 'ruflo memory connectivity throughput report gamma', unique: 'throughput' },
];

let cwd = '';

function cli(args: string[]): string {
  return execFileSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// The CLI prints a human `[INFO] …` line before the JSON body; slice from the
// first `{` so we parse only the JSON document.
function searchJson(query: string): { results: Array<{ key: string; score: number }> } {
  const out = cli(['memory', 'search', '--query', query, '-n', NS, '--format', 'json']);
  const start = out.indexOf('{');
  expect(start).toBeGreaterThanOrEqual(0);
  return JSON.parse(out.slice(start));
}

describe.skipIf(!CLI_BUILT)('memory search recall (#2558, end-to-end)', () => {
  beforeAll(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-2558-'));
    cli(['memory', 'init']);
    for (const e of ENTRIES) {
      cli(['memory', 'store', '-k', e.key, '-n', NS, '--value', e.value]);
    }
  }, 180_000);

  afterAll(() => {
    if (cwd) {
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('list shows all stored entries (CRUD path is unaffected)', () => {
    const out = cli(['memory', 'list', '-n', NS]);
    for (const e of ENTRIES) expect(out).toContain(e.key);
  });

  it('recalls EVERY stored entry by a shared keyword (the core regression)', () => {
    // Pre-fix this returned zero results at the default 0.3 threshold.
    const r = searchJson('connectivity');
    const keys = r.results.map((x) => x.key);
    for (const e of ENTRIES) expect(keys).toContain(e.key);
  });

  it('discriminates by a unique keyword (recall is targeted, not a blanket dump)', () => {
    const r = searchJson('throughput');
    const keys = r.results.map((x) => x.key);
    expect(keys).toContain('note/gamma');
    // Entries that never mention "throughput" must NOT be pulled in — otherwise
    // "recall" would be meaningless.
    expect(keys).not.toContain('note/alpha');
    expect(keys).not.toContain('note/beta');
  });

  it('reports N vectors, not 0, and is visible to WAL-blind readers', async () => {
    // The bridge writes via better-sqlite3 in WAL mode. sql.js does NOT apply
    // the -wal file, so reading the main DB file only sees rows that were
    // checkpointed into it — exactly the "0 vectors" failure mode. The
    // store-side WAL checkpoint (#2558) makes committed rows visible here.
    const dbPath = path.join(cwd, '.swarm', 'memory.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    const rowCount = Number(
      db.exec(`SELECT COUNT(*) FROM memory_entries WHERE namespace = '${NS}'`)[0]
        ?.values?.[0]?.[0] ?? 0,
    );
    expect(rowCount).toBe(ENTRIES.length);

    const embedded = Number(
      db.exec(
        `SELECT COUNT(*) FROM memory_entries WHERE namespace = '${NS}' AND embedding IS NOT NULL`,
      )[0]?.values?.[0]?.[0] ?? 0,
    );

    // When the embedder produced vectors (the default), the surfaced vector
    // count must reflect them rather than staying pinned at 0.
    if (embedded > 0) {
      expect(embedded).toBe(ENTRIES.length);
      const totalVectors = db.exec(
        `SELECT total_vectors FROM vector_indexes WHERE name = '${NS}'`,
      )[0]?.values?.[0]?.[0];
      if (totalVectors !== undefined) {
        expect(Number(totalVectors)).toBe(ENTRIES.length);
      }
    }

    db.close();
  }, 30_000);
});
