/**
 * #4410 memory scan: the AgentDB embedder rescue was guarded by one
 * process-wide boolean. Each dbPath registry owns a different embedder, so
 * after the first store succeeded, every later store kept AgentDB's mock
 * embedder. The rescue must be idempotent per embedder, not per process.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/memory/memory-initializer.js', () => ({
  generateLocalEmbedding: vi.fn(async () => ({
    embedding: [0.5, 0.25],
    dimensions: 2,
    model: 'test',
    backend: 'onnx',
  })),
}));

import { rescueAgentdbEmbedder } from '../src/memory/memory-bridge.js';

function mockEmbedder() {
  return {
    pipeline: null,
    embed: async () => new Float32Array([0, 0]),
    embedBatch: async () => [],
    __ruvectorRescued: false as boolean | undefined,
  };
}

describe('AgentDB embedder rescue is per store (#4410)', () => {
  it('rescues both distinct embedders, not just the first in the process', async () => {
    const first = mockEmbedder();
    const second = mockEmbedder();

    await rescueAgentdbEmbedder({ embedder: first });
    await rescueAgentdbEmbedder({ embedder: second });

    expect(first.__ruvectorRescued).toBe(true);
    expect(second.__ruvectorRescued).toBe(true);
    expect(Array.from(await second.embed('probe'))).toEqual([0.5, 0.25]);
  });
});
