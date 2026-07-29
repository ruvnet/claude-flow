/**
 * Regression coverage for #2815: HNSW vectors are secondary indexes over
 * the authoritative (namespace,key) memory row. Upsert and delete therefore
 * have to invalidate every historical vector for that logical key, including
 * duplicates left by older releases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let root: string;
const originalRoot = process.env.CLAUDE_FLOW_MEMORY_PATH;
const originalDisableBridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ruflo-memory-2815-'));
  process.env.CLAUDE_FLOW_MEMORY_PATH = root;
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
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

describe('memory vector lifecycle (#2815)', () => {
  it('upsert and delete remove every historical vector for a logical key', async () => {
    const memory = await import('../src/memory/memory-initializer.js');
    const initialized = await memory.initializeMemoryDatabase({
      force: true,
      migrate: false,
    });
    expect(initialized.success).toBe(true);

    const first = await memory.storeEntry({
      key: 'routing-policy',
      namespace: 'patterns',
      value: 'first policy observation',
      upsert: true,
    });
    expect(first.success).toBe(true);

    // Reproduce the stale metadata state created by older versions: several
    // vector IDs resolve to the same logical memory key. The invalidation
    // primitive must remove all of them rather than stopping at the first.
    const vectors = new Map([
      ['current', { id: 'current', key: 'routing-policy', namespace: 'patterns', content: 'current' }],
      ['historical-a', { id: 'historical-a', key: 'routing-policy', namespace: 'patterns', content: 'stale A' }],
      ['historical-b', { id: 'historical-b', key: 'routing-policy', namespace: 'patterns', content: 'stale B' }],
      ['other', { id: 'other', key: 'other-key', namespace: 'patterns', content: 'keep' }],
    ]);
    expect(
      memory.removeHNSWEntriesByLogicalKey(vectors, 'routing-policy', 'patterns'),
    ).toBe(3);
    expect([...vectors.keys()]).toEqual(['other']);

    const replacement = await memory.storeEntry({
      key: 'routing-policy',
      namespace: 'patterns',
      value: 'replacement policy observation',
      upsert: true,
    });
    expect(replacement.success).toBe(true);
    const active = await memory.listEntries({
      namespace: 'patterns',
      includeContent: true,
    });
    expect(active.total).toBe(1);
    expect(active.entries[0]?.content).toBe('replacement policy observation');

    const deleted = await memory.deleteEntry({
      key: 'routing-policy',
      namespace: 'patterns',
    });
    expect(deleted.success).toBe(true);
    expect(deleted.deleted).toBe(true);
    const remaining = await memory.listEntries({ namespace: 'patterns' });
    expect(remaining.total).toBe(0);
  });
});
