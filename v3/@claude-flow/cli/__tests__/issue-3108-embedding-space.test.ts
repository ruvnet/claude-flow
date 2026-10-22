/** A degraded AgentDB embedder can emit 384-d mock vectors until rescue finishes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const local = vi.hoisted(() => ({
  release: null as (() => void) | null,
  gate: Promise.resolve() as Promise<void>,
  vector: Array.from({ length: 384 }, (_, i) => i % 2),
}));

vi.mock('@huggingface/transformers', () => ({ pipeline: undefined }));
vi.mock('@xenova/transformers', () => ({ pipeline: undefined }));
vi.mock('agentic-flow/reasoningbank', () => ({ computeEmbedding: undefined }));
vi.mock('agentic-flow', () => ({ embeddings: undefined }));
vi.mock('ruvector', () => ({
  initOnnxEmbedder: async () => { await local.gate; },
  getOptimizedOnnxEmbedder: () => ({ embed: async () => local.vector }),
}));

let root: string;
let db: Database.Database;

beforeEach(() => {
  delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  root = mkdtempSync(join(tmpdir(), 'ruflo-3108-'));
  db = new Database(join(root, 'memory.db'));
  local.gate = new Promise<void>(resolve => { local.release = resolve; });
});

afterEach(async () => {
  local.release?.();
  const bridge = await import('../src/memory/memory-bridge.js');
  bridge.__setMemoryBridgeRegistryForTests(null);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function setup() {
  vi.resetModules();
  // Give the store path and the rescue a single loaded local-chain module.
  await import('../src/memory/memory-initializer.js');
  const bridge = await import('../src/memory/memory-bridge.js');
  let mockCalls = 0;
  const embedder = {
    pipeline: null,
    __ruvectorRescued: false,
    embed: async () => {
      mockCalls++;
      return new Float32Array(384).fill(0.25);
    },
  };
  bridge.__setMemoryBridgeRegistryForTests({
    getAgentDB: () => ({ database: db, embedder }),
    get: () => null,
  });
  return { bridge, embedder, getMockCalls: () => mockCalls };
}

describe('#3108 embedding-space integrity', () => {
  it('does not advertise an unrescued AgentDB mock vector as MiniLM', async () => {
    const { bridge, getMockCalls } = await setup();

    const result = await bridge.bridgeGenerateEmbedding('probe');
    const reportedModel = await bridge.bridgeLoadEmbeddingModel();

    expect(result).toBeNull();
    expect(reportedModel).toBeNull();
    expect(getMockCalls()).toBe(0);
  });

  it('does not store a mock vector while the local ONNX rescue is pending', async () => {
    const { bridge, getMockCalls } = await setup();
    const writing = bridge.bridgeStoreEntry({ key: 'episode', value: 'the cat sat on the mat' });

    // Keep the rescue pending long enough for the pre-fix fire-and-forget
    // path to use AgentDB's 384-d mock vector.
    await Promise.race([writing, new Promise(resolve => setTimeout(resolve, 100))]);
    local.release?.();
    const stored = await writing;

    expect(stored?.success).toBe(true);
    expect(stored?.rawEmbedding).toEqual(local.vector);
    const row = db.prepare('SELECT embedding FROM memory_entries WHERE key = ?').get('episode') as { embedding: string };
    expect(JSON.parse(row.embedding)).toEqual(local.vector);
    expect(getMockCalls()).toBe(0);
  });

});
