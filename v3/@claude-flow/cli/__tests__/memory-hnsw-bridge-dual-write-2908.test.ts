/**
 * Regression coverage for #2908: a successful AgentDB bridge write must not
 * suppress the persistent local HNSW update. `hooks_post-task --store-results`
 * stores through the canonical memory path, and semantic routing reads the
 * `.swarm/hnsw.index` + `.swarm/hnsw.metadata.json` pair. Both indexes must
 * therefore be updated by the same write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({
  bridgeAddToHNSW: vi.fn(async () => true),
}));

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeAddToHNSW: state.bridgeAddToHNSW,
}));

let root: string;
const originalRoot = process.env.CLAUDE_FLOW_MEMORY_PATH;
const originalDisableBridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ruflo-memory-2908-'));
  process.env.CLAUDE_FLOW_MEMORY_PATH = root;
  delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  state.bridgeAddToHNSW.mockClear();
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  if (originalRoot === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  else process.env.CLAUDE_FLOW_MEMORY_PATH = originalRoot;
  if (originalDisableBridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = originalDisableBridge;
  rmSync(root, { recursive: true, force: true });
});

describe('persistent HNSW dual-write (#2908)', () => {
  it('updates the local HNSW index even when the AgentDB bridge succeeds', async () => {
    const memory = await import('../src/memory/memory-initializer.js');
    const id = 'post-task-2908';
    const embedding = [0.2, 0.4, 0.8];

    const indexed = await memory.addToHNSWIndex(id, embedding, {
      id,
      key: 'routing-decision:task-2908',
      namespace: 'patterns',
      content: 'quenzibar regression marker',
    });

    expect(indexed).toBe(true);
    expect(state.bridgeAddToHNSW).toHaveBeenCalledTimes(1);
    expect(state.bridgeAddToHNSW).toHaveBeenCalledWith(
      id,
      embedding,
      expect.objectContaining({
        key: 'routing-decision:task-2908',
        namespace: 'patterns',
      }),
    );

    expect(memory.getHNSWStatus()).toMatchObject({
      available: true,
      initialized: true,
      entryCount: 1,
      dimensions: embedding.length,
    });

    const metadataPath = path.join(root, 'hnsw.metadata.json');
    expect(existsSync(metadataPath)).toBe(true);
    const metadata = new Map<string, { key: string; namespace: string }>(
      JSON.parse(readFileSync(metadataPath, 'utf8')),
    );
    expect(metadata.get(id)).toMatchObject({
      key: 'routing-decision:task-2908',
      namespace: 'patterns',
    });
  });
});
