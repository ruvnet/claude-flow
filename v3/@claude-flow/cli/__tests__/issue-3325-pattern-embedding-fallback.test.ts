/**
 * Regression for #3325 — patterns written through the `bridge-fallback` path
 * (ReasoningBank unusable, key shape `pattern_<ts>_<hex>`) were persisted with
 * embedding=NULL, so Tier-1 (semantic) pattern search could never match them.
 *
 * `bridgeStoreEntry` embedded only through `ctx.agentdb.embedder`:
 *
 *   if (embedder) { emb = await embedder.embed(value) ... } catch { /* store without *\/ }
 *
 * so BOTH an absent embedder and a throwing `embed()` silently wrote a NULL
 * vector and returned success with nothing to say so. The query side of
 * `bridgeSearchEntries` had the same shape, so even a vector-bearing row could
 * not be matched semantically when the agentdb embedder was down.
 *
 * Fix: fall back to the LOCAL chain (`generateLocalEmbedding`, never the
 * bridge-first `generateEmbedding` — #2312) on both sides; when no real vector
 * can be produced, report `hasEmbedding: false` + `embeddingError` instead of
 * staying silent. Also: `bridgeGetEntry` reported `hasEmbedding: false` on
 * every TieredCache hit, which is one way a `memory_retrieve` can show
 * `hasEmbedding: false` for a row that does have a vector.
 *
 * The local chain is a mocked ruvector ONNX embedder whose vectors are
 * CONCEPT-keyed, so the search below can only succeed semantically: the query
 * shares no words with the stored pattern. No network, no real model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const local = vi.hoisted(() => ({
  ruvectorAvailable: true,
  // Two orthogonal "concepts"; any text about retrying-with-delay maps to A.
  vec(text: string): number[] {
    const a = /backoff|retry|retries|reconnect|wait/i.test(text);
    return Array.from({ length: 384 }, (_, i) => (a ? (i % 2 === 0 ? 1 : 0) : (i % 2 === 0 ? 0 : 1)));
  },
}));

vi.mock('@huggingface/transformers', () => ({ pipeline: undefined }));
vi.mock('@xenova/transformers', () => ({ pipeline: undefined }));
vi.mock('agentic-flow/reasoningbank', () => ({ computeEmbedding: undefined }));
vi.mock('agentic-flow', () => ({ embeddings: undefined }));
vi.mock('ruvector', () => ({
  get initOnnxEmbedder() {
    return local.ruvectorAvailable ? async () => {} : undefined;
  },
  getOptimizedOnnxEmbedder: () => ({ embed: async (t: string) => local.vec(t) }),
}));

const PATTERN = 'use exponential backoff for flaky network retries';
// No token of length > 1 in common with PATTERN (or its JSON envelope).
const QUERY = 'wait longer between reconnect attempts';

let root: string;
let dbPath: string;
let db: Database.Database;

type AgentdbEmbedder = { pipeline?: unknown; embed: (t: string) => Promise<Float32Array> } | null;

async function setup(embedder: AgentdbEmbedder, cache?: Map<string, unknown>) {
  vi.resetModules();
  // Load memory-initializer up front. When the bridge's fire-and-forget rescue
  // and the write path dynamic-import modules at the same moment, vitest's
  // module runner was observed to hand one caller a partially-evaluated
  // memory-initializer (TDZ error) or the real, un-mocked `ruvector`. Native
  // ESM awaits one evaluation for both, so this removes a test-runner
  // artifact. The cases below also keep the rescue out of the picture (either
  // no embedder, or `pipeline` set) so they test the write path alone.
  await import('../src/memory/memory-initializer.js');
  const bridge = await import('../src/memory/memory-bridge.js');
  bridge.__setMemoryBridgeRegistryForTests({
    getAgentDB: () => ({ database: db, embedder }),
    // reasoningBank → null forces bridgeStorePattern into `bridge-fallback`.
    get: (name: string) => (name === 'tieredCache' && cache ? cache : null),
  });
  const tools = await import('../src/mcp-tools/agentdb-tools.js');
  return { bridge, tools };
}

function storedEmbedding(patternId: string): string | null {
  const row = db.prepare('SELECT embedding FROM memory_entries WHERE key = ?').get(patternId) as
    | { embedding: string | null }
    | undefined;
  return row ? row.embedding : null;
}

beforeEach(() => {
  delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  delete process.env.RUFLO_REQUIRE_REAL_EMBEDDINGS;
  local.ruvectorAvailable = true;
  root = mkdtempSync(join(tmpdir(), 'ruflo-3325-'));
  dbPath = join(root, 'memory.db');
  db = new Database(dbPath);
});

afterEach(async () => {
  const { __setMemoryBridgeRegistryForTests } = await import('../src/memory/memory-bridge.js');
  __setMemoryBridgeRegistryForTests(null);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('#3325 bridge-fallback pattern writes get an embedding', () => {
  it.each([
    ['agentdb embedder absent', null],
    // transformers.js loaded (pipeline set, so the rescue stays out of it) but
    // inference throws — the realistic way agentdb's embed() fails.
    ['agentdb embed() throws', { pipeline: {}, embed: async () => { throw new Error('onnx session failed'); } }],
  ] as Array<[string, AgentdbEmbedder]>)('%s -> falls back to the local chain', async (_label, embedder) => {
    const { bridge } = await setup(embedder);

    const stored = await bridge.bridgeStorePattern({ pattern: PATTERN, type: 'error-recovery', confidence: 0.9, dbPath });

    expect(stored?.controller).toBe('bridge-fallback');
    // Pre-fix: embedding column NULL, and no field saying so.
    expect(storedEmbedding(stored!.patternId)).not.toBeNull();
    expect(stored!.hasEmbedding).toBe(true);
    expect(stored!.embeddingError).toBeUndefined();
  });

  it('when no real vector is available anywhere, the write says so', async () => {
    local.ruvectorAvailable = false;
    const { bridge } = await setup(null);

    const stored = await bridge.bridgeStorePattern({ pattern: PATTERN, type: 'error-recovery', confidence: 0.9, dbPath });

    expect(stored?.success).toBe(true);
    expect(storedEmbedding(stored!.patternId)).toBeNull();
    // Pre-fix: neither field existed — a vector-less write was indistinguishable
    // from a healthy one.
    expect(stored!.hasEmbedding).toBe(false);
    expect(stored!.embeddingError).toMatch(/agentdb embedder unavailable/);
    expect(stored!.embeddingError).toMatch(/backend=mock/);
  });

  it('does not store agentdb mock vectors as if they were real', async () => {
    local.ruvectorAvailable = false;
    // What the rescue leaves behind when it cannot replace a degraded embedder.
    const mock = { pipeline: {}, backend: 'mock', embed: async () => new Float32Array(384).fill(0.25) };
    const { bridge } = await setup(mock as AgentdbEmbedder);

    const stored = await bridge.bridgeStorePattern({ pattern: PATTERN, type: 'error-recovery', confidence: 0.9, dbPath });

    expect(storedEmbedding(stored!.patternId)).toBeNull();
    expect(stored!.hasEmbedding).toBe(false);
    expect(stored!.embeddingError).toMatch(/serving mock vectors/);
  });

  it('agentdb_pattern-store surfaces the missing embedding on the degraded response', async () => {
    local.ruvectorAvailable = false;
    const { tools } = await setup(null);

    const r = (await tools.agentdbPatternStore.handler({ pattern: PATTERN, type: 'error-recovery' })) as Record<string, unknown>;
    expect(r.degraded).toBe(true);
    expect(r.hasEmbedding).toBe(false);
    expect(String(r.embeddingError)).toMatch(/agentdb embedder unavailable/);
  });
});

describe('#3325 a bridge-fallback pattern is found semantically', () => {
  it('agentdb_pattern-search finds it with a query that shares no words with it', async () => {
    const { tools } = await setup(null);

    const stored = (await tools.agentdbPatternStore.handler({ pattern: PATTERN, type: 'error-recovery', confidence: 0.9 })) as {
      patternId: string;
    };
    const found = (await tools.agentdbPatternSearch.handler({ query: QUERY, topK: 5 })) as {
      results: Array<{ id?: string; patternId?: string; content?: string; pattern?: string }>;
    };

    // Pre-fix: row embedding NULL and query embedding null -> BM25 only -> 0
    // hits -> tier 2 substring -> no match -> [].
    const ids = found.results.map(r => r.patternId ?? r.id);
    const texts = found.results.map(r => String(r.pattern ?? r.content ?? ''));
    expect(found.results.length).toBeGreaterThan(0);
    expect(texts.some(t => t.includes('exponential backoff')) || ids.includes(stored.patternId)).toBe(true);
  });
});

describe('#3325 bridgeGetEntry reports hasEmbedding truthfully on a cache hit', () => {
  it('second (cached) read of an embedded row still says hasEmbedding: true', async () => {
    const cache = new Map<string, unknown>();
    // A healthy agentdb embedder, so this case isolates the cache read.
    const healthy = { pipeline: {}, embed: async (t: string) => new Float32Array(local.vec(t)) };
    const { bridge } = await setup(healthy, cache);
    const stored = await bridge.bridgeStorePattern({ pattern: PATTERN, type: 'error-recovery', confidence: 0.9, dbPath });
    expect(storedEmbedding(stored!.patternId)).not.toBeNull();

    const first = await bridge.bridgeGetEntry({ key: stored!.patternId, namespace: 'pattern', dbPath });
    const second = await bridge.bridgeGetEntry({ key: stored!.patternId, namespace: 'pattern', dbPath });

    expect(first?.cacheHit).toBe(false);
    expect(first?.entry?.hasEmbedding).toBe(true);
    expect(second?.cacheHit).toBe(true);
    // Pre-fix: `!!cached.embedding` — the cached entry has no `embedding` field.
    expect(second?.entry?.hasEmbedding).toBe(true);
  });
});
