/**
 * ReasoningBank embedding regression tests
 *
 * Mock-embedding mode must never start a child process. Before this guard the
 * fallback embedding service ran `npx agentic-flow@alpha` synchronously on
 * every uncached embed, even with useMockEmbeddings: true, which cost about
 * 8 s per stored pattern on Linux CI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const spawnCalls = vi.hoisted(() => ({ count: 0, commands: [] as string[] }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const track = <T extends (...args: any[]) => any>(name: string, fn: T): T =>
    ((...args: any[]) => {
      spawnCalls.count++;
      spawnCalls.commands.push(`${name} ${String(args[0])}`);
      return fn(...args);
    }) as T;
  const mocked = {
    ...actual,
    exec: track('exec', actual.exec),
    execSync: track('execSync', actual.execSync),
    execFile: track('execFile', actual.execFile),
    execFileSync: track('execFileSync', actual.execFileSync),
    spawn: track('spawn', actual.spawn),
    spawnSync: track('spawnSync', actual.spawnSync),
    fork: track('fork', actual.fork),
  };
  return { ...mocked, default: mocked };
});

vi.mock('node:child_process', async () => import('child_process'));

import { ReasoningBank, AGENTIC_EMBEDDINGS_ENV } from '../reasoningbank/index.js';

describe('ReasoningBank mock embeddings', () => {
  let previousEnv: string | undefined;

  beforeEach(() => {
    spawnCalls.count = 0;
    spawnCalls.commands = [];
    previousEnv = process.env[AGENTIC_EMBEDDINGS_ENV];
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env[AGENTIC_EMBEDDINGS_ENV];
    } else {
      process.env[AGENTIC_EMBEDDINGS_ENV] = previousEnv;
    }
  });

  it('documents the opt-in environment variable name', () => {
    expect(AGENTIC_EMBEDDINGS_ENV).toBe('CLAUDE_FLOW_AGENTIC_EMBEDDINGS');
  });

  it('spawns no child process when storing and searching patterns', async () => {
    const bank = new ReasoningBank({ useMockEmbeddings: true, dimensions: 384 });
    await bank.initialize();

    const started = Date.now();
    for (let i = 0; i < 12; i++) {
      await bank.storePattern(`Unique strategy number ${i} for pattern ${i * 7}`, 'general');
    }
    const results = await bank.searchPatterns('Unique strategy number 3', 3);
    const elapsed = Date.now() - started;

    expect(results.length).toBeGreaterThan(0);
    expect(spawnCalls.commands).toStrictEqual([]);
    expect(spawnCalls.count).toBe(0);
    // Pure in-process hashing: 12 stores plus a search take milliseconds, not
    // the ~8 s per store the npx subprocess used to cost.
    expect(elapsed).toBeLessThan(5000);
  });

  it('spawns no child process in mock mode even when agentic embeddings are opted in', async () => {
    process.env[AGENTIC_EMBEDDINGS_ENV] = '1';
    const bank = new ReasoningBank({ useMockEmbeddings: true, dimensions: 384 });
    await bank.initialize();

    await bank.storePattern('Opted-in strategy that must still hash locally', 'security');
    await bank.searchPatterns('Opted-in strategy', 1);

    expect(spawnCalls.commands).toStrictEqual([]);
    expect(spawnCalls.count).toBe(0);
  });

  it('produces deterministic embeddings in mock mode', async () => {
    const first = new ReasoningBank({ useMockEmbeddings: true, dimensions: 384 });
    const second = new ReasoningBank({ useMockEmbeddings: true, dimensions: 384 });
    await first.initialize();
    await second.initialize();

    await first.storePattern('Deterministic embedding check', 'general');
    await second.storePattern('Deterministic embedding check', 'general');

    const [a] = await first.searchPatterns('Deterministic embedding check', 1);
    const [b] = await second.searchPatterns('Deterministic embedding check', 1);

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.similarity).toBeCloseTo(b.similarity, 10);
    expect(Array.from(a.pattern.embedding)).toStrictEqual(Array.from(b.pattern.embedding));
    expect(spawnCalls.count).toBe(0);
  });
});
