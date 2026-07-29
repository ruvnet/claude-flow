import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const HELPER = resolve(__dirname, '../.claude/helpers/intelligence.cjs');

type Entry = {
  id: string;
  content: string;
  namespace: string;
  metadata?: { sourceFile?: string };
};

function consolidate(root: string): { entries: number; edges: number } {
  const script = [
    `const intelligence = require(${JSON.stringify(HELPER)});`,
    'process.stdout.write(JSON.stringify(intelligence.consolidate()));',
  ].join('');
  const stdout = execFileSync(process.execPath, ['-e', script], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf-8',
    timeout: 2_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

function writeStore(root: string, entries: Entry[]): string {
  const dataDir = join(root, '.claude-flow', 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'auto-memory-store.json'), JSON.stringify(entries), 'utf-8');
  return dataDir;
}

describe('#2628 session-end intelligence consolidation', () => {
  it('deduplicates identical content with fresh IDs and persists the compacted store', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2628-dedup-'));
    const unique = Array.from({ length: 10 }, (_, i) => ({
      content: `unique memory section ${i} with stable semantic content`,
      namespace: 'auto-memory',
    }));
    const entries = Array.from({ length: 12 }, (_, batch) =>
      unique.map((entry, i) => ({ ...entry, id: `fresh-${batch}-${i}` })),
    ).flat();

    try {
      const dataDir = writeStore(root, entries);
      const result = consolidate(root);
      const persisted = JSON.parse(
        readFileSync(join(dataDir, 'auto-memory-store.json'), 'utf-8'),
      ) as Entry[];
      const graph = JSON.parse(
        readFileSync(join(dataDir, 'graph-state.json'), 'utf-8'),
      ) as { nodeCount: number };

      expect(result.entries).toBe(unique.length);
      expect(persisted).toHaveLength(unique.length);
      expect(graph.nodeCount).toBe(unique.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves temporal and similarity graph behavior for stores within the pair budget', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2628-small-'));
    const entries: Entry[] = [
      {
        id: 'a',
        content: 'authentication token refresh security pattern',
        namespace: 'patterns',
        metadata: { sourceFile: 'auth.ts' },
      },
      {
        id: 'b',
        content: 'authentication token refresh security patterns',
        namespace: 'patterns',
        metadata: { sourceFile: 'auth.ts' },
      },
    ];

    try {
      const dataDir = writeStore(root, entries);
      consolidate(root);
      const graph = JSON.parse(
        readFileSync(join(dataDir, 'graph-state.json'), 'utf-8'),
      ) as { edges: Array<{ sourceId: string; targetId: string; type: string }> };

      expect(graph.edges).toEqual(
        expect.arrayContaining([
          { sourceId: 'a', targetId: 'b', type: 'temporal', weight: 0.5 },
          expect.objectContaining({ sourceId: 'a', targetId: 'b', type: 'similar' }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bounds large unique stores while retaining their linear temporal graph', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2628-bound-'));
    const entries: Entry[] = Array.from({ length: 600 }, (_, i) => ({
      id: `entry-${i}`,
      content: `distinct project fact number ${i} token-${i.toString(36)}`,
      namespace: 'one-large-category',
      metadata: { sourceFile: 'MEMORY.md' },
    }));

    try {
      const dataDir = writeStore(root, entries);
      const result = consolidate(root);
      const graph = JSON.parse(
        readFileSync(join(dataDir, 'graph-state.json'), 'utf-8'),
      ) as { edges: Array<{ type: string }> };

      expect(result.entries).toBe(entries.length);
      expect(graph.edges).toHaveLength(entries.length - 1);
      expect(graph.edges.every((edge) => edge.type === 'temporal')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
