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
