/**
 * Harness loop daemon worker (ADR-176 phase 8b) — opt-in, $0, bounded, staged.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runHarnessLoopWorker, STAGED_CHAMPION_FILE, type HarnessWorkerInput } from '../src/services/harness-worker.js';
import { hashCorpus, type BenchTask } from '../src/services/harness-benchmark.js';
import type { Trajectory, ReplayFn } from '../src/services/harness-qualification.js';
import type { CanaryRunner } from '../src/services/harness-canary.js';

const tasks: BenchTask[] = Array.from({ length: 40 }, (_, i) => ({ id: 't' + i, input: i, expected: 2 * i }));
const trajectories: Trajectory[] = [
  { id: 'a', steps: [{ action: 'x', tier: 'oracle:test-exec' }], outcome: 'success', benchmarkTaskId: 'k', inputs: {}, recordedOutputs: { ok: 1 } },
];
const replay: ReplayFn = (t) => t.recordedOutputs;
const canaryRunner: CanaryRunner<number> = (_i, m) => ({ ok: m === 2, rolledBack: m !== 2, latencyMs: 5, costUsd: 0.001, accepted: m === 2 });

function fullInput(): HarnessWorkerInput {
  return {
    trajectories, corpus: { version: 'v1', tasks, corpusHash: hashCorpus(tasks) },
    baseline: 3, candidate: 2, evalFn: (i, m) => (i as number) * (m as number), gradeFn: (o, e) => (o === e ? 1 : 0),
    replay, verify: { redblue: async () => 'PASS', drift: async () => 0.01 }, canaryRunner,
    policyRefOf: (c) => 'sha256:' + c, layer: 'framework/node-cli',
  } as HarnessWorkerInput;
}

describe('runHarnessLoopWorker', () => {
  it('is a no-op when not opted in (RUFLO_HARNESS_LOOP off) — safe default', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hw-'));
    const r = await runHarnessLoopWorker(cwd, { optInOverride: false, loadInput: fullInput });
    expect(r.ran).toBe(false);
    expect(r.reason).toMatch(/opt-in/);
  });

  it('is a no-op when opted in but no input is configured ($0 default)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hw-'));
    const r = await runHarnessLoopWorker(cwd, { optInOverride: true }); // default loadInput = null
    expect(r.ran).toBe(false);
    expect(r.reason).toMatch(/no harness input/);
  });

  it('runs + stages the unsigned champion when opted in with a promotable input', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hw-'));
    const r = await runHarnessLoopWorker(cwd, { optInOverride: true, loadInput: fullInput });
    expect(r.ran).toBe(true);
    expect(r.accepted).toBe(true);
    expect(r.staged).toBe(true);
    const staged = join(cwd, '.claude-flow', STAGED_CHAMPION_FILE);
    expect(existsSync(staged)).toBe(true);
    const manifest = JSON.parse(readFileSync(staged, 'utf-8'));
    expect(manifest.policy.ref).toBe('sha256:2');
    expect(manifest.signature).toBeUndefined(); // UNSIGNED — publish signs
  });

  it('runs but stages nothing when the candidate is rejected', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hw-'));
    const bad = () => ({ ...fullInput(), baseline: 2, candidate: 3 }); // candidate worse
    const r = await runHarnessLoopWorker(cwd, { optInOverride: true, loadInput: bad });
    expect(r.ran).toBe(true);
    expect(r.accepted).toBe(false);
    expect(r.staged).toBe(false);
    expect(existsSync(join(cwd, '.claude-flow', STAGED_CHAMPION_FILE))).toBe(false);
  });
});
