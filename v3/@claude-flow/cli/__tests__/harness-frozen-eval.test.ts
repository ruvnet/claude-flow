/**
 * Frozen public human-labeled eval set (ADR-176 anti-overfitting).
 */
import { describe, it, expect } from 'vitest';
import {
  loadFrozenHumanEval, humanEvalHash, FROZEN_HUMAN_EVAL_HASH, FROZEN_HUMAN_EVAL_VERSION,
} from '../src/services/harness-frozen-eval.js';

describe('frozen human eval set', () => {
  it('loads and its content hash matches the pinned constant (frozen guarantee)', () => {
    const e = loadFrozenHumanEval();
    expect(e.version).toBe(FROZEN_HUMAN_EVAL_VERSION);
    expect(e.tasks.length).toBe(10);
    e.tasks.forEach((t) => { expect(t.q).toBeTruthy(); expect(t.labels.length).toBeGreaterThan(0); });
    expect(e.corpusHash).toBe(FROZEN_HUMAN_EVAL_HASH);
  });

  it('hash is order-independent but tamper-evident', () => {
    const e = loadFrozenHumanEval();
    expect(humanEvalHash([...e.tasks].reverse())).toBe(e.corpusHash);          // order-independent
    const tampered = e.tasks.map((t, i) => (i === 0 ? { ...t, labels: [...t.labels, 'injected'] } : t));
    expect(humanEvalHash(tampered)).not.toBe(e.corpusHash);                    // any edit changes the hash
  });
});
