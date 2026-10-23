/**
 * ADR-179 sub-feature 4 (MoE feedback loop) — daemon replay half, mock-first.
 *
 * @claude-flow/neural (MoERouter) and node:fs are fully MOCKED. Tests assert
 * the OBSERVABLE CONTRACT (qualification gate, idempotency cursor, degrade
 * when neural is unavailable, saveWeights batching, reward bounds) — NOT the
 * synthetic-embedding quality, which coder-2 flagged as a provisional v1
 * judgment call still under architect review.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { replayQualifiedPairs } from '../../src/services/moe-feedback-replay.js';
import type { CostOutcomePair } from '@claude-flow/hooks';

const neuralMocks = vi.hoisted(() => {
  const route = vi.fn();
  const updateExpertWeights = vi.fn();
  const saveWeights = vi.fn().mockResolvedValue(undefined);
  const initialize = vi.fn().mockResolvedValue(undefined);
  const router = { route, updateExpertWeights, saveWeights, initialize };
  const getMoERouter = vi.fn(() => router);
  return { route, updateExpertWeights, saveWeights, initialize, router, getMoERouter };
});

vi.mock('@claude-flow/neural', () => ({ getMoERouter: neuralMocks.getMoERouter }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const FEEDBACK = '/fake/moe-feedback.jsonl';
const CURSOR = '/fake/cursor.json';

function pair(overrides: Partial<CostOutcomePair> = {}): CostOutcomePair {
  return {
    cost_usd: 0.01,
    tier: 'haiku',
    expert: 'coder',
    provenance: 'oracle:test-exec',
    taskId: 't1',
    ts: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

function toJsonl(pairs: CostOutcomePair[]): string {
  return pairs.map((p) => JSON.stringify(p)).join('\n') + '\n';
}

/** Wire the fs mock: feedback file → these pairs, cursor file → this linesRead. */
function setupFs(pairs: CostOutcomePair[], linesRead: number): void {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockImplementation((p: unknown) => {
    if (p === FEEDBACK) return toJsonl(pairs);
    if (p === CURSOR) return JSON.stringify({ linesRead });
    throw new Error(`unexpected read: ${String(p)}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  neuralMocks.getMoERouter.mockReturnValue(neuralMocks.router);
  neuralMocks.saveWeights.mockResolvedValue(undefined);
  neuralMocks.initialize.mockResolvedValue(undefined);
});

describe('replayQualifiedPairs qualification gate', () => {
  it('promotes ONLY oracle pairs; proxy pairs are counted but never update the gate', async () => {
    setupFs(
      [
        pair({ taskId: 'o1', provenance: 'oracle:test-exec' }),
        pair({ taskId: 'p1', provenance: 'proxy:structural' }),
        pair({ taskId: 'o2', provenance: 'oracle:test-exec' }),
      ],
      0,
    );

    const res = await replayQualifiedPairs(FEEDBACK, CURSOR);

    expect(res).toMatchObject({ replayed: 2, skippedProxy: 1 });
    expect(neuralMocks.updateExpertWeights).toHaveBeenCalledTimes(2); // never for the proxy pair
    expect(neuralMocks.route).toHaveBeenCalledTimes(2);
    // cursor advances to total line count (idempotency anchor)
    expect(writeFileSync).toHaveBeenCalledWith(CURSOR, JSON.stringify({ linesRead: 3 }));
    // audit records: one per replayed oracle pair, tagged with the v1 embedding provenance
    expect(res.embeddingSource).toBe('synthetic-hash-fallback');
    expect(res.records.map((r) => r.taskId)).toEqual(['o1', 'o2']);
    for (const r of res.records) expect(r.embeddingSource).toBe('synthetic-hash-fallback');
  });
});

describe('replayQualifiedPairs idempotency', () => {
  it('is a no-op when the cursor already covers every line — never touches the router', async () => {
    setupFs([pair({ provenance: 'oracle:test-exec' }), pair({ provenance: 'oracle:test-exec' })], 2);

    const res = await replayQualifiedPairs(FEEDBACK, CURSOR);

    expect(res).toMatchObject({ replayed: 0, skippedProxy: 0 });
    expect(res.records).toEqual([]);
    expect(res.embeddingSource).toBe('synthetic-hash-fallback'); // tag present even on the no-new-pairs early return
    expect(neuralMocks.getMoERouter).not.toHaveBeenCalled(); // returns before importing neural
    expect(neuralMocks.updateExpertWeights).not.toHaveBeenCalled();
  });
});

describe('replayQualifiedPairs neural-unavailable degrade', () => {
  it('still returns valid counts and advances the cursor when the router cannot be obtained', async () => {
    setupFs(
      [
        pair({ provenance: 'oracle:test-exec' }),
        pair({ provenance: 'proxy:structural' }),
      ],
      0,
    );
    neuralMocks.getMoERouter.mockImplementation(() => {
      throw new Error('@claude-flow/neural unavailable');
    });

    let res: Awaited<ReturnType<typeof replayQualifiedPairs>> | undefined;
    await expect(
      (async () => {
        res = await replayQualifiedPairs(FEEDBACK, CURSOR);
      })(),
    ).resolves.toBeUndefined();

    expect(res).toMatchObject({ replayed: 1, skippedProxy: 1 }); // still counts, degrades to no gate update
    expect(res!.records).toHaveLength(1); // audit record retained even though the gate wasn't updated
    expect(neuralMocks.updateExpertWeights).not.toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalledWith(CURSOR, JSON.stringify({ linesRead: 2 })); // cursor still advances
  });
});

describe('replayQualifiedPairs saveWeights batching', () => {
  it('calls saveWeights exactly once when at least one pair replayed', async () => {
    setupFs([pair({ provenance: 'oracle:test-exec' }), pair({ provenance: 'oracle:test-exec' })], 0);
    await replayQualifiedPairs(FEEDBACK, CURSOR);
    expect(neuralMocks.saveWeights).toHaveBeenCalledTimes(1); // one batch save, not per-pair
  });

  it('does NOT call saveWeights when nothing qualified (all proxy)', async () => {
    setupFs([pair({ provenance: 'proxy:structural' }), pair({ provenance: 'proxy:structural' })], 0);
    const res = await replayQualifiedPairs(FEEDBACK, CURSOR);
    expect(res).toMatchObject({ replayed: 0, skippedProxy: 2 });
    expect(res.records).toEqual([]);
    expect(neuralMocks.saveWeights).not.toHaveBeenCalled();
  });
});

describe('replayQualifiedPairs reward signal', () => {
  it('passes a bounded reward in [-1,1] that decreases as cost rises', async () => {
    setupFs(
      [
        pair({ taskId: 'cheap', cost_usd: 0.01, provenance: 'oracle:test-exec' }),
        pair({ taskId: 'pricey', cost_usd: 0.04, provenance: 'oracle:test-exec' }),
      ],
      0,
    );

    await replayQualifiedPairs(FEEDBACK, CURSOR);

    const rewards = neuralMocks.updateExpertWeights.mock.calls.map((c) => c[1] as number);
    expect(rewards).toHaveLength(2);
    for (const r of rewards) expect(r).toBeGreaterThanOrEqual(-1);
    for (const r of rewards) expect(r).toBeLessThanOrEqual(1);
    expect(rewards[0]).toBeGreaterThan(rewards[1]); // cheaper task → larger reward
  });
});
