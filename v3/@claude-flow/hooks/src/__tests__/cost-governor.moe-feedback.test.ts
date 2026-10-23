/**
 * ADR-179 sub-feature 4 (MoE feedback loop) — hot-path half, mock-first tests.
 *
 * The hot path only QUEUES cost-outcome pairs (JSONL append, same recorder
 * discipline as events.ts) — it never touches the MoE gate. node:fs is fully
 * mocked; nothing touches disk.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import {
  isPromotable,
  queueCostOutcomePair,
  MOE_FEEDBACK_DEFAULT_PATH,
  type CostOutcomePair,
} from '../cost-governor/moe-feedback.js';

vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReturnValue(false); // dir + file absent by default
  vi.mocked(statSync).mockReturnValue({ size: 0 } as never);
});

describe('isPromotable (qualification predicate)', () => {
  it('promotes ONLY oracle:test-exec provenance', () => {
    expect(isPromotable({ provenance: 'oracle:test-exec' })).toBe(true);
    expect(isPromotable({ provenance: 'proxy:structural' })).toBe(false);
  });
});

describe('queueCostOutcomePair', () => {
  it('is a no-op when moeFeedback is disabled — nothing appended', () => {
    queueCostOutcomePair(pair(), { enabled: false });
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('appends the serialized pair + newline when enabled', () => {
    const p = pair();
    queueCostOutcomePair(p, { enabled: true }, '/tmp/mf.jsonl');
    expect(appendFileSync).toHaveBeenCalledWith('/tmp/mf.jsonl', JSON.stringify(p) + '\n');
  });

  it('queues both oracle AND proxy pairs (proxy is auditable, filtered only at replay)', () => {
    queueCostOutcomePair(pair({ provenance: 'proxy:structural' }), { enabled: true }, '/tmp/mf.jsonl');
    expect(appendFileSync).toHaveBeenCalledTimes(1); // recorded regardless of promotability
  });

  it('defaults to MOE_FEEDBACK_DEFAULT_PATH when no path is supplied', () => {
    queueCostOutcomePair(pair(), { enabled: true });
    expect(vi.mocked(appendFileSync).mock.calls[0][0]).toBe(MOE_FEEDBACK_DEFAULT_PATH);
    expect(MOE_FEEDBACK_DEFAULT_PATH).toBe('.swarm/moe-feedback.jsonl');
  });

  it('NEVER throws on an fs write failure', () => {
    vi.mocked(appendFileSync).mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(() => queueCostOutcomePair(pair(), { enabled: true }, '/tmp/mf.jsonl')).not.toThrow();
  });

  it('auto-creates the target directory when missing', () => {
    queueCostOutcomePair(pair(), { enabled: true }, '/tmp/nested/mf.jsonl');
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/nested', { recursive: true });
  });
});
