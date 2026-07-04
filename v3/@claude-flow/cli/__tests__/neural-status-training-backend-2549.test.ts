/**
 * #2549 regression — `neural status` misreported the native @ruvector/ruvllm
 * training path as Unavailable.
 *
 * Two defects: `_trainingBackend` was a dead variable (declared 'unavailable',
 * returned, never assigned), and contrastive availability was read only from
 * an in-process global that a fresh read-only status process never populates.
 * Both made a bundled, working module invisible — with a remediation hint
 * ("Install @ruvector/ruvllm") that was actively wrong.
 *
 * These tests pin the capability contract: when @ruvector/ruvllm RESOLVES,
 * the stats layer must never report the training path as unavailable.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolveTrainingBackend } from '../src/ruvector/lora-adapter.js';
import { getIntelligenceStats } from '../src/memory/intelligence.js';

function ruvllmResolves(): boolean {
  try {
    createRequire(import.meta.url).resolve('@ruvector/ruvllm');
    return true;
  } catch {
    return false;
  }
}

describe('#2549 — training backend capability reporting', () => {
  it('resolveTrainingBackend reflects module resolution, not in-process load state', () => {
    // The probe must not depend on a prior in-process train having run.
    const backend = resolveTrainingBackend();
    if (ruvllmResolves()) {
      expect(backend).toBe('ruvllm');
    } else {
      expect(backend).toBe('js-fallback');
    }
  });

  it('getIntelligenceStats populates _trainingBackend (the dead-variable regression)', () => {
    const stats = getIntelligenceStats() as { _trainingBackend?: string };
    // Whatever the environment, the field must carry a real verdict —
    // 'unavailable' is only legitimate when the probe itself threw.
    if (ruvllmResolves()) {
      expect(stats._trainingBackend).toBe('ruvllm');
    } else {
      expect(stats._trainingBackend).toBe('js-fallback');
    }
  });

  it('contrastive trainer reads available (not unavailable) in a fresh process when the module resolves', () => {
    const stats = getIntelligenceStats() as { _contrastiveTrainer?: unknown };
    if (!ruvllmResolves()) return; // nothing to assert without the module
    // Fresh process ⇒ no __claudeFlowSonaStats global ⇒ must fall back to
    // the capability probe, never to 'unavailable'.
    expect(stats._contrastiveTrainer).not.toBe('unavailable');
  });
});

describe('#2549 follow-up — native checkpoint capability gate', () => {
  it('nativeCheckpointsSupported reflects the resolved ruvllm version (>=2.5.7)', async () => {
    const { nativeCheckpointsSupported } = await import('../src/ruvector/lora-adapter.js');
    if (!ruvllmResolves()) {
      expect(nativeCheckpointsSupported()).toBe(false);
      return;
    }
    const req = createRequire(import.meta.url);
    const { dirname, join } = await import('node:path');
    const { existsSync, readFileSync } = await import('node:fs');
    let dir = dirname(req.resolve('@ruvector/ruvllm'));
    let version = '0.0.0';
    for (let i = 0; i < 5; i++) {
      const p = join(dir, 'package.json');
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        if (pkg.name === '@ruvector/ruvllm') { version = pkg.version; break; }
      }
      dir = dirname(dir);
    }
    const [maj, min, pat] = version.split('.').map(Number);
    const expected = maj > 2 || (maj === 2 && (min > 5 || (min === 5 && pat >= 7)));
    expect(nativeCheckpointsSupported()).toBe(expected);
  });
});

describe('#2549 follow-up — native training routing', () => {
  it('runNativeTraining trains and checkpoints through the native pipeline', async () => {
    const { runNativeTraining, nativeTrainingAvailable } = await import('../src/services/native-training.js');
    if (!nativeTrainingAvailable()) {
      expect(await runNativeTraining({ embeddings: [], epochs: 1, batchSize: 2, learningRate: 0.01, dim: 8 })).toBeNull();
      return;
    }
    const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'native-train-'));
    try {
      const embeddings = Array.from({ length: 6 }, (_, s) =>
        Float32Array.from({ length: 8 }, (_, i) => Math.sin(s + i)));
      const cp = join(dir, 'ckpt.json');
      const r = await runNativeTraining({
        embeddings, epochs: 2, batchSize: 2, learningRate: 0.01, dim: 8, checkpointPath: cp,
      });
      expect(r).not.toBeNull();
      expect(typeof r!.finalLoss).toBe('number');
      expect(r!.steps).toBeGreaterThan(0);
      expect(r!.checkpointPath).toBe(cp);
      expect(existsSync(cp)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null rather than throwing on degenerate input', async () => {
    const { runNativeTraining } = await import('../src/services/native-training.js');
    expect(await runNativeTraining({ embeddings: [new Float32Array(8)], epochs: 1, batchSize: 2, learningRate: 0.01, dim: 8 })).toBeNull();
  });
});
