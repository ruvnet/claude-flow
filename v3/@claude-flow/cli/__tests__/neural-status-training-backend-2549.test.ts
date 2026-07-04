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

describe('training flywheel — validation split (--val-split)', () => {
  it('validationSplit>0 surfaces a non-null bestValLoss when there are enough batches', async () => {
    const { runNativeTraining, nativeTrainingAvailable } = await import('../src/services/native-training.js');
    const embeddings = Array.from({ length: 16 }, (_, s) =>
      Float32Array.from({ length: 8 }, (_, i) => Math.sin(s + i)));
    if (!nativeTrainingAvailable()) {
      // No native pipeline ⇒ no validation possible; runNativeTraining stays null.
      expect(await runNativeTraining({ embeddings, epochs: 3, batchSize: 2, learningRate: 0.05, dim: 8, validationSplit: 0.25 })).toBeNull();
      return;
    }
    const r = await runNativeTraining({
      embeddings, epochs: 3, batchSize: 2, learningRate: 0.05, dim: 8, validationSplit: 0.25,
    });
    expect(r).not.toBeNull();
    expect(r!.bestValLoss).not.toBeNull();
    expect(typeof r!.bestValLoss).toBe('number');
    expect(typeof r!.earlyStopped).toBe('boolean');
  });

  it('validationSplit=0 (disabled) leaves bestValLoss null', async () => {
    const { runNativeTraining, nativeTrainingAvailable } = await import('../src/services/native-training.js');
    if (!nativeTrainingAvailable()) return;
    const embeddings = Array.from({ length: 12 }, (_, s) =>
      Float32Array.from({ length: 8 }, (_, i) => Math.cos(s + i)));
    const r = await runNativeTraining({ embeddings, epochs: 2, batchSize: 2, learningRate: 0.05, dim: 8, validationSplit: 0 });
    expect(r).not.toBeNull();
    expect(r!.bestValLoss).toBeNull();
  });
});

describe('training flywheel — resume (--resume)', () => {
  it('a missing --resume checkpoint fails loudly (throws), never silently fresh-trains', async () => {
    const { runNativeTraining, nativeTrainingAvailable, ResumeFailedError } = await import('../src/services/native-training.js');
    const embeddings = Array.from({ length: 6 }, (_, s) =>
      Float32Array.from({ length: 8 }, (_, i) => Math.sin(s + i)));
    const missing = '/definitely/does/not/exist/lora-checkpoint-0.json';
    if (!nativeTrainingAvailable()) {
      // Without the native module the whole path degrades to null (the
      // resume check lives past module construction) — nothing to assert loudly.
      expect(await runNativeTraining({ embeddings, epochs: 1, batchSize: 2, learningRate: 0.01, dim: 8, resumeFrom: missing })).toBeNull();
      return;
    }
    await expect(
      runNativeTraining({ embeddings, epochs: 1, batchSize: 2, learningRate: 0.01, dim: 8, resumeFrom: missing }),
    ).rejects.toBeInstanceOf(ResumeFailedError);
  });

  it('resuming from a real checkpoint succeeds and records the resume mode', async () => {
    const { runNativeTraining, nativeTrainingAvailable } = await import('../src/services/native-training.js');
    if (!nativeTrainingAvailable()) return;
    const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'resume-train-'));
    try {
      const embeddings = Array.from({ length: 8 }, (_, s) =>
        Float32Array.from({ length: 8 }, (_, i) => Math.sin(s + i)));
      const cp = join(dir, 'ckpt.json');
      const first = await runNativeTraining({ embeddings, epochs: 2, batchSize: 2, learningRate: 0.02, dim: 8, checkpointPath: cp });
      expect(first).not.toBeNull();
      expect(existsSync(cp)).toBe(true);
      const second = await runNativeTraining({ embeddings, epochs: 2, batchSize: 2, learningRate: 0.02, dim: 8, resumeFrom: cp });
      expect(second).not.toBeNull();
      expect(second!.resumed).toBe(true);
      // 2.5.7 has no resumeFrom() ⇒ weights-only loadCheckpoint fallback.
      expect(['resumeFrom', 'loadCheckpoint']).toContain(second!.resumeMode);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('training flywheel — checkpoint auto-load (loadLatestCheckpoint)', () => {
  it('latestCheckpointInfo picks the newest lora-checkpoint-*.json by timestamp', async () => {
    const { latestCheckpointInfo } = await import('../src/ruvector/lora-adapter.js');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'cp-newest-'));
    const cwd = process.cwd();
    try {
      const neuralDir = join(root, '.claude-flow', 'neural');
      mkdirSync(neuralDir, { recursive: true });
      const older = 1000000000000;
      const newer = 2000000000000;
      writeFileSync(join(neuralDir, `lora-checkpoint-${older}.json`), JSON.stringify({ A: [0], B: [0], scaling: 1 }));
      writeFileSync(join(neuralDir, `lora-checkpoint-${newer}.json`), JSON.stringify({ A: [0], B: [0], scaling: 1 }));
      writeFileSync(join(neuralDir, 'not-a-checkpoint.json'), '{}');
      process.chdir(root);
      const info = latestCheckpointInfo();
      expect(info).not.toBeNull();
      expect(info!.filename).toBe(`lora-checkpoint-${newer}.json`);
      expect(typeof info!.ageLabel).toBe('string');
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('respects the CLAUDE_FLOW_NO_CHECKPOINT_AUTOLOAD kill-switch', async () => {
    const { loadLatestCheckpoint, LoRAAdapter } = await import('../src/ruvector/lora-adapter.js');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'cp-killswitch-'));
    const cwd = process.cwd();
    const prev = process.env.CLAUDE_FLOW_NO_CHECKPOINT_AUTOLOAD;
    try {
      const neuralDir = join(root, '.claude-flow', 'neural');
      mkdirSync(neuralDir, { recursive: true });
      writeFileSync(join(neuralDir, 'lora-checkpoint-3000000000000.json'), JSON.stringify({ A: [0], B: [0], scaling: 1 }));
      process.chdir(root);
      process.env.CLAUDE_FLOW_NO_CHECKPOINT_AUTOLOAD = '1';
      const res = await loadLatestCheckpoint(new LoRAAdapter());
      expect(res.loaded).toBe(false);
      expect(res.path).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_FLOW_NO_CHECKPOINT_AUTOLOAD;
      else process.env.CLAUDE_FLOW_NO_CHECKPOINT_AUTOLOAD = prev;
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
