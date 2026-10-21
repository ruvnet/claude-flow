/**
 * ADR-472: `memory list --embeddings` (listEntries includeEmbedding) emits each stored vector as int8 + scale, read-only and bounded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeEmbeddingQ8, MAX_EMBEDDING_DIMS, MAX_LIST_EMBEDDINGS } from '../src/memory/embedding-q8.js';

// The command module pulls in the MCP tool graph, whose password hasher needs a native dep a bare worktree may lack; the list action needs none of it.
vi.mock('bcryptjs', () => ({}));

const decode = (q: { dims: number; scale: number; b64: string }): number[] => Array.from(new Int8Array(Buffer.from(q.b64, 'base64'))).map(v => v * q.scale);
const cosine = (a: number[], b: number[]): number => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return dot / Math.sqrt(na * nb);
};
const unit = (n: number, seed: number): number[] => {
  const v = Array.from({ length: n }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / norm);
};

describe('encodeEmbeddingQ8', () => {
  it('round-trips a 384-dim unit vector at cosine > 0.9999 in ~1/4 the bytes of 4-decimal JSON', () => {
    const v = unit(384, 3);
    const q = encodeEmbeddingQ8(JSON.stringify(v))!;

    expect(q.dims).toBe(384);
    expect(cosine(decode(q), v)).toBeGreaterThan(0.9999);
    expect(q.b64.length).toBeLessThan(JSON.stringify(v.map(x => Number(x.toFixed(4)))).length / 3);
  });

  it('accepts an already-parsed array and refuses anything it cannot encode faithfully', () => {
    expect(encodeEmbeddingQ8([0.5, -0.5])?.dims).toBe(2);
    for (const bad of [null, undefined, '', 'not json', '{"a":1}', '[1]', '[0,0,0]', '[1,"x"]', '[1,null,2]', `[${Array(MAX_EMBEDDING_DIMS + 1).fill(0.1).join(',')}]`, 7]) {
      expect(encodeEmbeddingQ8(bad), String(bad).slice(0, 20)).toBeUndefined();
    }
    expect(encodeEmbeddingQ8('[1e999,1]')).toBeUndefined();
  });
});

describe('listEntries includeEmbedding (sql.js path, fixture store)', () => {
  let root: string;
  const saved = { path: process.env.CLAUDE_FLOW_MEMORY_PATH, bridge: process.env.CLAUDE_FLOW_DISABLE_BRIDGE };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ruflo-472-list-'));
    process.env.CLAUDE_FLOW_MEMORY_PATH = root;
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    if (saved.path === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH; else process.env.CLAUDE_FLOW_MEMORY_PATH = saved.path;
    if (saved.bridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE; else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = saved.bridge;
    rmSync(root, { recursive: true, force: true });
  });

  it('adds embeddingQ8 only when asked, never content, never writes the store, and caps the rows', async () => {
    const memory = await import('../src/memory/memory-initializer.js');

    expect((await memory.initializeMemoryDatabase({ force: true, migrate: false })).success).toBe(true);
    for (const key of ['alpha', 'beta', 'gamma']) expect((await memory.storeEntry({ key, namespace: 'n', value: `value for ${key}`, generateEmbeddingFlag: true } as never)).success).toBe(true);

    const dbPath = memory.resolveDbPath(undefined);
    const before = readFileSync(dbPath);
    const plain = await memory.listEntries({ limit: 10, dbPath });
    const withVectors = await memory.listEntries({ limit: 10, dbPath, includeEmbedding: true });

    expect(plain.entries.every(e => e.embeddingQ8 === undefined)).toBe(true);
    expect(withVectors.entries.length).toBe(plain.entries.length);
    expect(withVectors.entries.every(e => e.content === undefined)).toBe(true);

    const embedded = withVectors.entries.filter(e => e.hasEmbedding);

    expect(embedded.length).toBeGreaterThan(0);
    expect(embedded.every(e => e.embeddingQ8 !== undefined && e.embeddingQ8.dims > 1)).toBe(true);
    expect(withVectors.entries.filter(e => !e.hasEmbedding).every(e => e.embeddingQ8 === undefined)).toBe(true);
    expect(statSync(dbPath).size).toBe(before.length);
    expect(MAX_LIST_EMBEDDINGS).toBe(500);

    const capped = await memory.listEntries({ limit: 100_000, dbPath, includeEmbedding: true });

    expect(capped.entries.length).toBeLessThanOrEqual(MAX_LIST_EMBEDDINGS);
  });

  it('the `memory list --format json --embeddings` command prints embeddingQ8, and without the flag it does not', async () => {
    const memory = await import('../src/memory/memory-initializer.js');
    const { output } = await import('../src/output.js');
    const { memoryCommand } = await import('../src/commands/memory.js');
    const list = memoryCommand.subcommands!.find(c => c.name === 'list')!;
    const printed: unknown[] = [];
    const spy = vi.spyOn(output, 'printJson').mockImplementation((value: unknown) => { printed.push(value); });

    await memory.initializeMemoryDatabase({ force: true, migrate: false });
    await memory.storeEntry({ key: 'k1', namespace: 'n', value: 'some value', generateEmbeddingFlag: true } as never);

    const run = (flags: Record<string, unknown>) => list.action!({ args: [], flags: { format: 'json', limit: 20, ...flags }, cwd: root } as never);

    await run({});
    await run({ embeddings: true });
    await run({ embeddings: true, format: 'table' });
    spy.mockRestore();

    const [without, withVec] = printed as { embeddingQ8?: { dims: number } }[][];

    expect(without?.every(e => e.embeddingQ8 === undefined)).toBe(true);
    expect(withVec?.[0]?.embeddingQ8?.dims).toBeGreaterThan(1);
    expect(printed).toHaveLength(2);
  });
});
