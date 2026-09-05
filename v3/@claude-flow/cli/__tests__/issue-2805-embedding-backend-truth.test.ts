import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/memory/memory-initializer.js', () => ({
  generateEmbedding: vi.fn(async (text: string) => ({
    embedding: Array.from({ length: 8 }, (_, i) => Math.sin(text.length + i)),
    dimensions: 8,
    model: 'hash-fallback',
    backend: 'mock',
  })),
  searchEntries: vi.fn(async () => ({ results: [] })),
}));

const { embeddingsTools } = await import('../src/mcp-tools/embeddings-tools.js');
const init = embeddingsTools.find(tool => tool.name === 'embeddings_init')!;
const status = embeddingsTools.find(tool => tool.name === 'embeddings_status')!;
const compare = embeddingsTools.find(tool => tool.name === 'embeddings_compare')!;

let originalCwd: string;
let workdir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  workdir = mkdtempSync(join(tmpdir(), 'ruflo-2805-'));
  process.chdir(workdir);
  await init.handler({ force: true });
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

describe('#2805 embedding backend truthfulness', () => {
  it('removes semantic-search claims while the hash fallback is active', async () => {
    const result = await status.handler({}) as any;
    expect(result.embeddingBackend).toBe('mock');
    expect(result.semanticGrounded).toBe(false);
    expect(result.capabilities.features).not.toContain('semantic search');
    expect(result.warning).toMatch(/not semantically meaningful/i);
  });

  it('does not interpret hash similarity as semantic similarity', async () => {
    const result = await compare.handler({ text1: 'a cat', text2: 'banking regulation' }) as any;
    expect(result.embeddingBackend).toBe('mock');
    expect(result.semanticGrounded).toBe(false);
    expect(result.interpretation).toBeNull();
    expect(result.warning).toMatch(/not semantically meaningful/i);
  });
});
