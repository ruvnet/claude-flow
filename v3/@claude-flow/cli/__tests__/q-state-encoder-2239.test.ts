// Regression tests for #2239 — Q-state encoder discarded the keyword block.
//
// The previous 31-bit truncating fold collapsed four routing-keyword-distinct
// tasks (`test/review/architect/optimize the new module now`) to ONE Q-state.
// After the FNV-1a fold and encoder-version=2 migration, keyword-distinct
// tasks must produce distinct state keys, and a persisted v1 model must
// reset its Q-table on load (keys are not comparable across encoder versions).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QLearningRouter } from '../src/ruvector/q-learning-router.js';

const r = new QLearningRouter();
const stateKey = (s: string) => r.getStateKey(s);

describe('Q-state encoder (#2239)', () => {
  it('produces distinct state keys for the reporter\'s six keyword-distinct tasks', () => {
    const tasks = [
      'implement the new module now',
      'test the new module now',
      'review the new module now',
      'architect the new module now',
      'research the new module now',
      'optimize the new module now',
    ];
    const keys = tasks.map(stateKey);
    expect(new Set(keys).size).toBe(tasks.length); // no collapse to one Q-state
  });

  it('still produces the SAME key for the SAME input (deterministic)', () => {
    expect(stateKey('test this module')).toBe(stateKey('test this module'));
  });

  it('produces a `fstate_…` shape', () => {
    expect(stateKey('refactor the API')).toMatch(/^fstate_[0-9a-z]+$/);
  });
});

describe('encoder-version migration (#2239)', () => {
  it('resets the Q-table on encoder-version mismatch (v1 persisted → v2 current)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'q-mig-'));
    const modelPath = join(dir, 'q-learning-model.json');
    // A v1 persisted model with one fake state — v1 keys are not portable.
    writeFileSync(modelPath, JSON.stringify({
      version: '1.0.0',
      // encoderVersion missing → treated as 1
      config: { numActions: 8 },
      qTable: { 'fstate_legacy': { qValues: [99, 99, 99, 99, 99, 99, 99, 99], visits: 50 } },
      stats: { stepCount: 100, updateCount: 50, avgTDError: 0.1, epsilon: 0.5 },
      metadata: { savedAt: new Date(0).toISOString(), totalExperiences: 100 },
    }));

    const router = new QLearningRouter({ modelPath });
    const loaded = await router.loadModel(modelPath);
    expect(loaded).toBe(true);

    // The legacy state must NOT survive (its key was computed by the old fold).
    const exported = router.export();
    expect(Object.keys(exported)).not.toContain('fstate_legacy');

    rmSync(dir, { recursive: true, force: true });
  });

  it('a v2 persisted model loads its Q-table intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'q-v2-'));
    const modelPath = join(dir, 'q-learning-model.json');
    // Compute a real v2 key from the live encoder.
    const seed = new QLearningRouter();
    const realKey = seed.getStateKey('keep this entry across restart');

    writeFileSync(modelPath, JSON.stringify({
      version: '1.0.0',
      encoderVersion: 2,
      config: { numActions: 8 },
      qTable: { [realKey]: { qValues: [1, 2, 3, 4, 5, 6, 7, 8], visits: 7 } },
      stats: { stepCount: 0, updateCount: 0, avgTDError: 0, epsilon: 0.5 },
      metadata: { savedAt: new Date().toISOString(), totalExperiences: 0 },
    }));

    const router = new QLearningRouter({ modelPath });
    expect(await router.loadModel(modelPath)).toBe(true);
    expect(Object.keys(router.export())).toContain(realKey);

    rmSync(dir, { recursive: true, force: true });
  });
});
