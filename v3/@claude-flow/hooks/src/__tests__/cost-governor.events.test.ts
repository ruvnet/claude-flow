/**
 * ADR-179 sub-feature 3 (cost tracking / harness:cost-event) — mock-first tests.
 *
 * node:fs is fully MOCKED at the named-import granularity (events.ts imports
 * appendFileSync/existsSync/mkdirSync/statSync/renameSync/unlinkSync directly)
 * so nothing touches disk. costUsd is an injected mock. The module-scoped ring
 * buffer is reset before every test via the exported test helper.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import {
  emitCostEvent,
  getRecentCostEvents,
  __resetCostEventRingBufferForTests,
  type CostUsdFn,
  type EmitCostEventArgs,
} from '../cost-governor/events.js';
import type { CostGovernorConfig } from '../cost-governor/types.js';

vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const PATH = '.swarm/cost-events.jsonl';
const DIR = '.swarm';
const BACKUP = `${PATH}.1`;
const MAX_BYTES = 10 * 1024 * 1024;

const ENABLED: CostGovernorConfig['costEvents'] = { enabled: true, path: PATH };
const DISABLED: CostGovernorConfig['costEvents'] = { enabled: false, path: PATH };

const baseArgs: EmitCostEventArgs = {
  correlation_id: 'corr-1',
  session_id: 'sess-1',
  model: 'claude-opus-4-8',
  tier: 'sonnet-opus',
  tokens_in: 100,
  tokens_out: 50,
};

const costUsd: CostUsdFn & ReturnType<typeof vi.fn> = vi.fn(() => 0.123) as never;

/** zod mirror of the CostEvent contract (incl. D2 additive optional fields). */
const CostEventSchema = z
  .object({
    v: z.literal(1),
    ts: z.string().datetime(),
    correlation_id: z.string(),
    task_id: z.string().optional(),
    agent_id: z.string().optional(),
    session_id: z.string(),
    model: z.string(),
    tier: z.enum(['codemod', 'haiku', 'sonnet-opus']),
    tokens_in: z.number(),
    tokens_out: z.number(),
    cost_usd: z.number(),
    trimmed_entries: z.number().optional(),
    batched_calls: z.number().optional(),
    diversity_score: z.number().optional(),
  })
  .strict();

beforeEach(() => {
  __resetCostEventRingBufferForTests();
  vi.clearAllMocks();
  vi.mocked(costUsd).mockReturnValue(0.123);
  // Defaults: dir + file absent → mkdir runs, no stat/rotate.
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(statSync).mockReturnValue({ size: 0 } as never);
});

// --- opt-in gate ----------------------------------------------------------

describe('emitCostEvent opt-in gate', () => {
  it('returns null and does NOTHING when cfg.enabled is false', () => {
    const throwingCostUsd = vi.fn(() => {
      throw new Error('costUsd must not be called when disabled');
    }) as never as CostUsdFn;
    const ev = emitCostEvent(baseArgs, DISABLED, throwingCostUsd);
    expect(ev).toBeNull();
    expect(appendFileSync).not.toHaveBeenCalled();
    expect(getRecentCostEvents()).toHaveLength(0);
  });
});

// --- schema conformance ---------------------------------------------------

describe('emitCostEvent schema', () => {
  it('emits an event that satisfies the full CostEvent schema', () => {
    const ev = emitCostEvent(baseArgs, ENABLED, costUsd)!;
    expect(ev).not.toBeNull();
    expect(() => CostEventSchema.parse(ev)).not.toThrow();
    expect(ev.v).toBe(1);
    expect(ev.cost_usd).toBe(0.123);
    expect(costUsd).toHaveBeenCalledWith('claude-opus-4-8', 100, 50);
  });

  it('carries the D2 additive fields (trimmed_entries/batched_calls/diversity_score) when supplied', () => {
    const ev = emitCostEvent(
      { ...baseArgs, task_id: 't1', agent_id: 'a1', trimmed_entries: 3, batched_calls: 5, diversity_score: 0.4 },
      ENABLED,
      costUsd,
    )!;
    expect(CostEventSchema.parse(ev)).toMatchObject({
      trimmed_entries: 3,
      batched_calls: 5,
      diversity_score: 0.4,
      task_id: 't1',
      agent_id: 'a1',
    });
  });

  it('emits exactly ONE event per completion (per-completion granularity, not per-token)', () => {
    emitCostEvent(baseArgs, ENABLED, costUsd);
    expect(appendFileSync).toHaveBeenCalledTimes(1);
    expect(getRecentCostEvents()).toHaveLength(1);
  });
});

// --- ring buffer ----------------------------------------------------------

describe('cost-event ring buffer', () => {
  it('is bounded to 500, evicting oldest first', () => {
    for (let i = 1; i <= 501; i++) {
      emitCostEvent({ ...baseArgs, correlation_id: `c${i}` }, ENABLED, costUsd);
    }
    const recent = getRecentCostEvents();
    expect(recent).toHaveLength(500);
    expect(recent[0].correlation_id).toBe('c2'); // c1 evicted
    expect(recent[499].correlation_id).toBe('c501'); // newest retained
  });

  it('getRecentCostEvents(limit) returns the most-recent `limit`', () => {
    for (let i = 1; i <= 3; i++) emitCostEvent({ ...baseArgs, correlation_id: `c${i}` }, ENABLED, costUsd);
    const two = getRecentCostEvents(2);
    expect(two.map((e) => e.correlation_id)).toEqual(['c2', 'c3']);
  });
});

// --- JSONL append + never-throws ------------------------------------------

describe('cost-event JSONL append', () => {
  it('appends the serialized event + newline to cfg.path', () => {
    const ev = emitCostEvent(baseArgs, ENABLED, costUsd)!;
    expect(appendFileSync).toHaveBeenCalledWith(PATH, JSON.stringify(ev) + '\n');
  });

  it('auto-creates the target directory when missing', () => {
    emitCostEvent(baseArgs, ENABLED, costUsd);
    expect(mkdirSync).toHaveBeenCalledWith(DIR, { recursive: true });
  });

  it('NEVER throws on an fs write failure — still returns the event and keeps the ring push', () => {
    vi.mocked(appendFileSync).mockImplementation(() => {
      throw new Error('disk full');
    });
    let ev: unknown;
    expect(() => {
      ev = emitCostEvent(baseArgs, ENABLED, costUsd);
    }).not.toThrow();
    expect(ev).not.toBeNull();
    expect(getRecentCostEvents()).toHaveLength(1); // push precedes the append
  });
});

// --- size-based rotation --------------------------------------------------

describe('cost-event rotation', () => {
  it('rotates path → path.1 before appending when the file is at/over the size cap', () => {
    vi.mocked(existsSync).mockImplementation((p) => p === PATH); // file present, backup absent
    vi.mocked(statSync).mockReturnValue({ size: MAX_BYTES } as never);
    emitCostEvent(baseArgs, ENABLED, costUsd);

    expect(renameSync).toHaveBeenCalledWith(PATH, BACKUP);
    expect(vi.mocked(renameSync).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(appendFileSync).mock.invocationCallOrder[0],
    );
  });

  it('unlinks a pre-existing backup before renaming', () => {
    vi.mocked(existsSync).mockImplementation((p) => p === PATH || p === BACKUP);
    vi.mocked(statSync).mockReturnValue({ size: MAX_BYTES } as never);
    emitCostEvent(baseArgs, ENABLED, costUsd);

    expect(unlinkSync).toHaveBeenCalledWith(BACKUP);
    expect(vi.mocked(unlinkSync).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(renameSync).mock.invocationCallOrder[0],
    );
  });

  it('does NOT rotate when the file is below the size cap', () => {
    vi.mocked(existsSync).mockImplementation((p) => p === PATH);
    vi.mocked(statSync).mockReturnValue({ size: 1024 } as never);
    emitCostEvent(baseArgs, ENABLED, costUsd);

    expect(renameSync).not.toHaveBeenCalled();
    expect(appendFileSync).toHaveBeenCalledTimes(1);
  });
});
