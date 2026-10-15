/**
 * Regression for #3375: `rescueAgentdbEmbedder()` could never fire.
 *
 * The rescue exists for one situation: agentdb's EmbeddingService failed to
 * load transformers.js (`embedder.pipeline === null`) and is serving mock
 * vectors. It probes `generateLocalEmbedding()` and only patches agentdb's
 * embedder when the probe reports `backend === 'onnx'`.
 *
 * `generateLocalEmbedding()` is documented as "ONLY the local model chain —
 * never the AgentDB bridge", but it lazily loaded its model through
 * `loadEmbeddingModel()`, which is bridge-first. Whenever the bridge was up
 * (always, since the rescue is only ever called from inside the bridge),
 * `bridgeLoadEmbeddingModel()` succeeded against agentdb's MOCK embedder and
 * the local state was recorded as `{ loaded: true, model: null }`. `null` can
 * never pass `typeof state.model === 'function'`, so every call took the hash
 * branch and reported `backend: 'mock'`, and the rescue always bailed.
 *
 * The scenario is reproduced here with a real memory-bridge + memory-initializer,
 * a real better-sqlite3 database behind the documented registry seam, agentdb's
 * embedder in its degraded (pipeline=null, mock vectors) state, and a mocked
 * ruvector ONNX embedder standing in for a working local chain. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const local = vi.hoisted(() => ({
  ruvectorAvailable: true,
  // Deterministic, non-zero, text-dependent 384-d "ONNX" vector.
  vec(text: string): number[] {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return Array.from({ length: 384 }, (_, i) => Math.sin(h + i * 7) + 1.5);
  },
}));

// Every local-chain branch ahead of ruvector is made unavailable so the test
// is deterministic and never touches the network or a real model.
// (Explicit `undefined` exports: vitest throws on reading an export a mock
// factory did not define.)
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

let root: string;
let db: Database.Database;
let mockEmbedCalls: number;

/** agentdb's EmbeddingService after transformers.js failed to load. */
function degradedAgentdbEmbedder() {
  return {
    pipeline: null as unknown,
    backend: undefined as string | undefined,
    __ruvectorRescued: undefined as boolean | undefined,
    embed: async (_t: string) => {
      mockEmbedCalls++;
      return new Float32Array(384).fill(0.25);
    },
  };
}

async function freshModules(embedder: ReturnType<typeof degradedAgentdbEmbedder>) {
  vi.resetModules();
  const bridge = await import('../src/memory/memory-bridge.js');
  const init = await import('../src/memory/memory-initializer.js');
  bridge.__setMemoryBridgeRegistryForTests({
    getAgentDB: () => ({ database: db, embedder }),
    get: () => null,
  });
  return { bridge, init };
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 5));
  }
  return pred();
}

beforeEach(() => {
  delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  delete process.env.RUFLO_REQUIRE_REAL_EMBEDDINGS;
  local.ruvectorAvailable = true;
  mockEmbedCalls = 0;
  root = mkdtempSync(join(tmpdir(), 'ruflo-3375-'));
  db = new Database(join(root, 'memory.db'));
});

afterEach(async () => {
  const { __setMemoryBridgeRegistryForTests } = await import('../src/memory/memory-bridge.js');
  __setMemoryBridgeRegistryForTests(null);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('#3375 generateLocalEmbedding stays on the local chain', () => {
  it('reports onnx after loadEmbeddingModel() took the bridge branch', async () => {
    const emb = degradedAgentdbEmbedder();
    const { init } = await freshModules(emb);

    // The bridge branch is what poisoned the local state before the fix.
    const loaded = await init.loadEmbeddingModel();
    expect(loaded.success).toBe(true);

    const out = await init.generateLocalEmbedding('hello world');
    // Pre-fix: backend 'mock', model 'hash-fallback' (state.model === null).
    expect(out.backend).toBe('onnx');
    expect(out.embedding).toEqual(local.vec('hello world'));
  });

  it('never consults the agentdb embedder (the #2312 no-recursion contract)', async () => {
    const emb = degradedAgentdbEmbedder();
    const { init } = await freshModules(emb);

    await init.generateLocalEmbedding('probe');
    // Pre-fix, generateLocalEmbedding -> loadEmbeddingModel ->
    // bridgeLoadEmbeddingModel -> embedder.embed('test').
    expect(mockEmbedCalls).toBe(0);
  });

  it('still reports mock (no false positive) when no local embedder exists either', async () => {
    local.ruvectorAvailable = false;
    const emb = degradedAgentdbEmbedder();
    const { init } = await freshModules(emb);

    const out = await init.generateLocalEmbedding('hello world');
    expect(out.backend).toBe('mock');
  });
});

describe('#3375 rescueAgentdbEmbedder can fire', () => {
  it('patches a degraded agentdb embedder to the working local chain', async () => {
    const emb = degradedAgentdbEmbedder();
    const { bridge } = await freshModules(emb);

    // Any bridge operation runs getDb(), which kicks off the rescue.
    await bridge.bridgeGetEntry({ key: 'nothing', namespace: 'default' });
    const rescued = await waitFor(() => emb.__ruvectorRescued === true || emb.backend === 'mock');

    expect(rescued).toBe(true);
    // Pre-fix: the probe came back 'mock', so the rescue tagged the embedder
    // backend='mock' and left agentdb's mock embed() in place.
    expect(emb.backend).toBeUndefined();
    expect(emb.__ruvectorRescued).toBe(true);
    const v = await emb.embed('rescued text');
    expect(Array.from(v)).toEqual(local.vec('rescued text').map(x => Math.fround(x)));
  });

  it('declines the rescue and tags backend=mock when the local chain is degraded too', async () => {
    local.ruvectorAvailable = false;
    const emb = degradedAgentdbEmbedder();
    const { bridge } = await freshModules(emb);

    await bridge.bridgeGetEntry({ key: 'nothing', namespace: 'default' });
    await waitFor(() => emb.__ruvectorRescued === true || emb.backend === 'mock');

    expect(emb.__ruvectorRescued).not.toBe(true);
    expect(emb.backend).toBe('mock');
  });
});
