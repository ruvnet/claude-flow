/**
 * @claude-flow/browser - Signed Trajectory Tests (ADR-122 Phase 1)
 *
 * Acceptance criteria covered:
 *  - Recorded trajectory round-trips through record → sign → distribute → verify
 *  - Forging a step (modifying the trajectory JSON in the envelope) fails verification
 *  - Tamper-evidence: changing one element ref breaks `verify`
 *  - replay plan correctly applies mutations
 */

import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  sealTrajectory,
  verifySealedTrajectory,
  writeSealedTrajectory,
  readSealedTrajectory,
  planReplay,
  buildReplayDelta,
} from '../src/application/signed-trajectory-service.js';
import { generateWitnessKey, canonicalJSON, sha256Hex } from '../src/infrastructure/witness-signer.js';
import type { BrowserTrajectory } from '../src/domain/types.js';
import type { SignedTrajectoryEnvelope } from '../src/domain/signed-trajectory.js';

function buildTrajectory(overrides: Partial<BrowserTrajectory> = {}): BrowserTrajectory {
  return {
    id: 'traj-test-1',
    sessionId: 'sess-abc',
    goal: 'Login to example.com and read welcome banner',
    startedAt: '2026-05-18T20:00:00.000Z',
    completedAt: '2026-05-18T20:00:05.000Z',
    success: true,
    verdict: 'login succeeded',
    steps: [
      { action: 'open', input: { url: 'https://example.com/login' }, result: { success: true }, timestamp: '2026-05-18T20:00:00.500Z' },
      { action: 'fill', input: { target: '@e1', value: 'user@example.com' }, result: { success: true }, timestamp: '2026-05-18T20:00:01.500Z' },
      { action: 'fill', input: { target: '@e2', value: 'hunter2' }, result: { success: true }, timestamp: '2026-05-18T20:00:02.500Z' },
      { action: 'click', input: { target: '@e3' }, result: { success: true }, timestamp: '2026-05-18T20:00:03.500Z' },
    ],
    ...overrides,
  };
}

describe('SignedTrajectoryService', () => {
  describe('canonicalJSON', () => {
    it('produces identical output for structurally-equal objects with different key order', () => {
      const a = { a: 1, b: { c: 2, d: 3 }, e: [1, 2, 3] };
      const b = { e: [1, 2, 3], b: { d: 3, c: 2 }, a: 1 };
      expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    });

    it('preserves array order', () => {
      expect(canonicalJSON([3, 1, 2])).toBe('[3,1,2]');
    });
  });

  describe('seal + verify round-trip', () => {
    it('verifies a freshly sealed trajectory', () => {
      const trajectory = buildTrajectory();
      const key = generateWitnessKey();
      const { envelope } = sealTrajectory({ trajectory, witnessKey: key, projectId: 'test-project' });
      const result = verifySealedTrajectory(envelope);
      expect(result.valid).toBe(true);
      expect(result.signatureValid).toBe(true);
      expect(result.schemaValid).toBe(true);
      expect(result.publicKey).toBe(key.publicKeyHex);
    });

    it('round-trips through writeSealedTrajectory + readSealedTrajectory', async () => {
      const trajectory = buildTrajectory();
      const key = generateWitnessKey();
      const { envelope } = sealTrajectory({ trajectory, witnessKey: key });
      const path = join(tmpdir(), `cf-browser-test-${randomBytes(4).toString('hex')}.rvf.json`);
      await writeSealedTrajectory(envelope, path);
      const reloaded = await readSealedTrajectory(path);
      expect(verifySealedTrajectory(reloaded).valid).toBe(true);
    });

    it('includes sha256 hashes for screenshots', () => {
      const trajectory = buildTrajectory();
      const screenshot = Buffer.from('PNGfake-bytes-for-test', 'utf8');
      const { envelope } = sealTrajectory({
        trajectory,
        screenshots: { 'step-0.png': screenshot },
      });
      const expectedHash = sha256Hex(screenshot);
      expect(envelope.payload.screenshotHashes['step-0.png']).toBe(expectedHash);
    });
  });

  describe('tamper detection', () => {
    it('rejects a forged element ref in a trajectory step', () => {
      const trajectory = buildTrajectory();
      const { envelope } = sealTrajectory({ trajectory });

      // Tamper: change @e2's fill value (steal-the-password attack)
      const forged: SignedTrajectoryEnvelope = JSON.parse(JSON.stringify(envelope));
      const step2 = forged.payload.trajectory.steps[2] as Record<string, Record<string, unknown>>;
      step2.input!.value = 'stolen-password';

      const result = verifySealedTrajectory(forged);
      expect(result.valid).toBe(false);
      expect(result.signatureValid).toBe(false);
      expect(result.reason).toMatch(/signature verification failed/);
    });

    it('rejects a forged goal', () => {
      const trajectory = buildTrajectory();
      const { envelope } = sealTrajectory({ trajectory });
      const forged: SignedTrajectoryEnvelope = JSON.parse(JSON.stringify(envelope));
      forged.payload.trajectory.goal = 'malicious replacement goal';
      expect(verifySealedTrajectory(forged).valid).toBe(false);
    });

    it('rejects a forged screenshot hash', () => {
      const trajectory = buildTrajectory();
      const { envelope } = sealTrajectory({
        trajectory,
        screenshots: { 'step-0.png': Buffer.from('original') },
      });
      const forged: SignedTrajectoryEnvelope = JSON.parse(JSON.stringify(envelope));
      forged.payload.screenshotHashes['step-0.png'] = sha256Hex('replaced');
      expect(verifySealedTrajectory(forged).valid).toBe(false);
    });

    it('rejects schema-invalid envelopes', () => {
      const result = verifySealedTrajectory({ payload: 'not-an-object', signature: 'x', algorithm: 'ed25519' });
      expect(result.valid).toBe(false);
      expect(result.schemaValid).toBe(false);
    });
  });

  describe('trust list', () => {
    it('rejects envelopes signed by untrusted keys when a trust list is supplied', () => {
      const trajectory = buildTrajectory();
      const stranger = generateWitnessKey();
      const { envelope } = sealTrajectory({ trajectory, witnessKey: stranger });

      const result = verifySealedTrajectory(envelope, { trustedPublicKeys: ['00'.repeat(32)] });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not in trusted list/);
    });

    it('accepts envelopes signed by trusted keys', () => {
      const trajectory = buildTrajectory();
      const friend = generateWitnessKey();
      const { envelope } = sealTrajectory({ trajectory, witnessKey: friend });
      const result = verifySealedTrajectory(envelope, { trustedPublicKeys: [friend.publicKeyHex] });
      expect(result.valid).toBe(true);
    });
  });

  describe('replay planning', () => {
    it('plans replay with no mutations as a straight copy', () => {
      const trajectory = buildTrajectory();
      const { envelope } = sealTrajectory({ trajectory });
      const plan = planReplay(envelope);
      expect(plan.steps).toHaveLength(4);
      expect(plan.goal).toBe(trajectory.goal);
      expect(plan.steps[0].action).toBe('open');
    });

    it('applies replaceStepInput mutations', () => {
      const trajectory = buildTrajectory();
      const { envelope } = sealTrajectory({ trajectory });
      const plan = planReplay(envelope, {
        replaceStepInput: { 1: { value: 'replaced@example.com' } },
      });
      expect((plan.steps[1].input as Record<string, unknown>).value).toBe('replaced@example.com');
      // Untouched
      expect(plan.steps[0].action).toBe('open');
    });

    it('honours skipSteps', () => {
      const trajectory = buildTrajectory();
      const { envelope } = sealTrajectory({ trajectory });
      const plan = planReplay(envelope, { skipSteps: [2] });
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps.find(s => s.index === 2)).toBeUndefined();
    });
  });

  describe('replay delta', () => {
    it('reports allMatched=true when replay reproduces every step outcome', () => {
      const original = buildTrajectory();
      const { envelope } = sealTrajectory({ trajectory: original });
      const replay = buildTrajectory({ id: 'replay-1' });
      const delta = buildReplayDelta(envelope, replay);
      expect(delta.allMatched).toBe(true);
      expect(delta.parentTrajectoryId).toBe(original.id);
    });

    it('reports outcome drift when a step that succeeded in the parent fails on replay', () => {
      const original = buildTrajectory();
      const { envelope } = sealTrajectory({ trajectory: original });
      const replay = buildTrajectory({ id: 'replay-2' });
      // Force a fail on step 3
      (replay.steps[3] as Record<string, unknown>).result = { success: false };
      const delta = buildReplayDelta(envelope, replay);
      expect(delta.allMatched).toBe(false);
      expect(delta.stepResults[3].matched).toBe(false);
      expect(delta.stepResults[3].note).toMatch(/outcome drift/);
    });

    it('reports action drift when steps diverge', () => {
      const original = buildTrajectory();
      const { envelope } = sealTrajectory({ trajectory: original });
      const replay = buildTrajectory({ id: 'replay-3' });
      (replay.steps[1] as Record<string, unknown>).action = 'type';
      const delta = buildReplayDelta(envelope, replay);
      expect(delta.allMatched).toBe(false);
      expect(delta.stepResults[1].note).toMatch(/action drift/);
    });
  });

  describe('determinism', () => {
    it('produces the same signature for the same payload + same key', () => {
      const trajectory = buildTrajectory();
      const key = generateWitnessKey();
      const sealedAt = '2026-05-18T20:00:00.000Z';
      const a = sealTrajectory({ trajectory, witnessKey: key, sealedAt });
      const b = sealTrajectory({ trajectory, witnessKey: key, sealedAt });
      expect(a.envelope.signature).toBe(b.envelope.signature);
    });

    it('produces a different signature when content changes', () => {
      const key = generateWitnessKey();
      const sealedAt = '2026-05-18T20:00:00.000Z';
      const a = sealTrajectory({ trajectory: buildTrajectory({ goal: 'A' }), witnessKey: key, sealedAt });
      const b = sealTrajectory({ trajectory: buildTrajectory({ goal: 'B' }), witnessKey: key, sealedAt });
      expect(a.envelope.signature).not.toBe(b.envelope.signature);
    });
  });
});
