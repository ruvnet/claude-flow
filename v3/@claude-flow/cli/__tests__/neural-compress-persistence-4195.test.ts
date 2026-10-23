import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalCwd = process.cwd();
const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;
afterEach(() => {
  process.chdir(originalCwd);
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('neural_compress quantize persistence (#4195)', () => {
  it('does not claim or persist compression while consumers require full-precision embeddings', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ruflo-4195-'));
    process.env.CLAUDE_FLOW_CWD = scratch;
    const neuralDir = join(scratch, '.claude-flow', 'neural');
    mkdirSync(neuralDir, { recursive: true });
    const storePath = join(neuralDir, 'models.json');
    const store = {
      models: {},
      patterns: {
        p1: {
          id: 'p1', name: 'pattern', type: 'test', embedding: [0.25, -0.5, 1],
          metadata: {}, createdAt: '2026-01-01T00:00:00.000Z', usageCount: 0,
        },
      },
      version: '3.0.0',
    };
    writeFileSync(storePath, JSON.stringify(store, null, 2));
    const originalBytes = readFileSync(storePath);

    const { neuralTools } = await import('../src/mcp-tools/neural-tools.js');
    const tool = neuralTools.find((candidate) => candidate.name === 'neural_compress')!;
    const result = await tool.handler({ method: 'quantize' }) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.patternsCompressed).toBe(0);
    expect(result.beforeBytes).toBe(result.afterBytes);
    expect(result.compressionRatio).toBe('1.00x (unchanged JSON storage)');
    expect(String(result.error)).toMatch(/readers require full-precision embedding arrays/);
    expect(readFileSync(storePath)).toEqual(originalBytes);
    expect(JSON.parse(readFileSync(storePath, 'utf8')).patterns.p1.embedding).toEqual([0.25, -0.5, 1]);
  });
});

describe('neural_compress prune (#4423)', () => {
  it.each([{ targetSize: 0.1 }, { targetSize: 1 }, {}])('refuses %o and leaves models.json byte-identical', async (input) => {
    const scratch = mkdtempSync(join(tmpdir(), 'ruflo-4423-'));
    process.env.CLAUDE_FLOW_CWD = scratch;
    const neuralDir = join(scratch, '.claude-flow', 'neural');
    mkdirSync(neuralDir, { recursive: true });
    const storePath = join(neuralDir, 'models.json');
    // usageCount 0 is what neural_train writes; nothing in the neural store increments it.
    const pattern = (id: string, usageCount: number) => ({
      id, name: id, type: 'test', embedding: [0.25, -0.5, 1],
      metadata: {}, createdAt: '2026-01-01T00:00:00.000Z', usageCount,
    });
    writeFileSync(storePath, JSON.stringify({ models: {}, patterns: { fresh: pattern('fresh', 0), merged: pattern('merged', 2) }, version: '3.0.0' }, null, 2));
    const originalBytes = readFileSync(storePath);

    const { neuralTools } = await import('../src/mcp-tools/neural-tools.js');
    const tool = neuralTools.find((candidate) => candidate.name === 'neural_compress')!;
    const result = await tool.handler({ method: 'prune', ...input }) as Record<string, unknown>;

    // Baseline: success true, the usageCount-0 pattern deleted and the deletion saved.
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/do not record usage/);
    expect(result).toMatchObject({ patternsRemoved: 0, patternsBefore: 2, patternsAfter: 2 });
    expect(readFileSync(storePath)).toEqual(originalBytes);
  });

  it('no longer documents targetSize as a 0-1 size reduction', async () => {
    const { neuralTools } = await import('../src/mcp-tools/neural-tools.js');
    const tool = neuralTools.find((candidate) => candidate.name === 'neural_compress')!;
    const schema = tool.inputSchema as { properties: { targetSize: { description: string } } };
    expect(schema.properties.targetSize.description).not.toMatch(/reduction|0-1/);
  });
});
