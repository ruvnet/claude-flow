/**
 * @claude-flow/browser - Signed Trajectory Service (ADR-122 Phase 1)
 *
 * High-level API for sealing a recorded BrowserTrajectory into a portable,
 * Ed25519-signed envelope and for verifying / replaying received envelopes.
 *
 * Phase 1 ships a JSON-on-disk container; Phase 1.5 will swap the on-disk
 * format for the binary RVF format from `@ruvector/rvf@0.2.1` once we have
 * a working dependency story for it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  signTrajectory,
  verifyTrajectory,
  resolveWitnessKey,
  sha256Hex,
  type WitnessKey,
} from '../infrastructure/witness-signer.js';
import type { BrowserTrajectory, Snapshot } from '../domain/types.js';
import type {
  SignedTrajectoryEnvelope,
  VerificationResult,
  ReplayDelta,
  ReplayMutation,
} from '../domain/signed-trajectory.js';

export interface SealTrajectoryInput {
  trajectory: BrowserTrajectory;
  /** Project / installation ID. Falls back to env or 'unknown'. */
  projectId?: string;
  /** Optional final accessibility snapshot. */
  finalSnapshot?: Snapshot;
  /** Per-screenshot content. Keys are paths or step IDs; values are buffers. Hashes are computed. */
  screenshots?: Record<string, Buffer>;
  /** Override witness key (tests / advanced callers). */
  witnessKey?: WitnessKey;
  /** When sealed (test determinism). Defaults to now. */
  sealedAt?: string;
  /** Parent trajectory ID for replay deltas. */
  parentTrajectoryId?: string;
}

export interface SealedTrajectory {
  envelope: SignedTrajectoryEnvelope;
  publicKeyHex: string;
}

/** Seal a trajectory into a signed envelope. */
export function sealTrajectory(input: SealTrajectoryInput): SealedTrajectory {
  const key = input.witnessKey ?? resolveWitnessKey();
  const screenshotHashes: Record<string, string> = {};
  for (const [path, buf] of Object.entries(input.screenshots ?? {})) {
    screenshotHashes[path] = sha256Hex(buf);
  }

  const envelope = signTrajectory(
    {
      trajectoryId: input.trajectory.id,
      projectId: input.projectId ?? process.env.RUFLO_PROJECT_ID ?? 'unknown',
      trajectory: {
        id: input.trajectory.id,
        sessionId: input.trajectory.sessionId,
        goal: input.trajectory.goal,
        steps: input.trajectory.steps,
        startedAt: input.trajectory.startedAt,
        completedAt: input.trajectory.completedAt,
        success: input.trajectory.success,
        verdict: input.trajectory.verdict,
      },
      screenshotHashes,
      finalSnapshot: input.finalSnapshot,
      parentTrajectoryId: input.parentTrajectoryId,
    },
    key,
    { sealedAt: input.sealedAt },
  );

  return { envelope, publicKeyHex: key.publicKeyHex };
}

/** Write a signed envelope to disk. */
export async function writeSealedTrajectory(
  envelope: SignedTrajectoryEnvelope,
  path: string,
): Promise<void> {
  await writeFile(resolvePath(path), JSON.stringify(envelope, null, 2), 'utf8');
}

/** Read a signed envelope from disk. */
export async function readSealedTrajectory(path: string): Promise<SignedTrajectoryEnvelope> {
  if (!existsSync(path)) throw new Error('trajectory envelope not found: ' + path);
  const raw = await readFile(resolvePath(path), 'utf8');
  return JSON.parse(raw) as SignedTrajectoryEnvelope;
}

/** Verify a sealed envelope. Thin wrapper that allows trust-list filtering. */
export function verifySealedTrajectory(
  envelope: unknown,
  options: { trustedPublicKeys?: string[] } = {},
): VerificationResult {
  return verifyTrajectory(envelope, options);
}

/**
 * Compute the replay plan from a sealed envelope + mutations.
 *
 * Phase 1 deliberately returns a plan rather than executing — the executor
 * needs a live BrowserService and is wired in BrowserService.replayFromEnvelope.
 * This keeps the signing/replay logic browser-engine-independent so it can be
 * unit-tested without spawning Playwright.
 */
export function planReplay(
  envelope: SignedTrajectoryEnvelope,
  mutations: ReplayMutation = {},
): {
  steps: Array<{
    index: number;
    action: string;
    input: Record<string, unknown>;
    /** True iff the original recorded this step as successful. */
    parentSucceeded: boolean;
  }>;
  goal: string;
  parentTrajectoryId: string;
} {
  const parent = envelope.payload.trajectory;
  const skipSet = new Set(mutations.skipSteps ?? []);
  const overrides = mutations.replaceStepInput ?? {};

  // Phase 1: trajectory steps are typed as unknown[] (preserves cross-version compat);
  // pick out the bits we actually need for planning.
  const steps = (parent.steps as Array<Record<string, unknown>>)
    .map((step, index) => {
      if (skipSet.has(index)) return null;
      const baseInput = (step.input ?? {}) as Record<string, unknown>;
      const override = overrides[index] ?? {};
      return {
        index,
        action: String(step.action ?? 'unknown'),
        input: { ...baseInput, ...override },
        parentSucceeded: Boolean((step.result as Record<string, unknown> | undefined)?.success ?? true),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    steps,
    goal: mutations.goal ?? parent.goal,
    parentTrajectoryId: parent.id,
  };
}

/**
 * Compute a delta between an original sealed trajectory and a fresh replay.
 *
 * Both must reference the same goal+parent. The delta tells you which steps
 * still produce the same outcome under replay and which have diverged —
 * the foundation of visual-regression / "did this site change?" CI gates.
 */
export function buildReplayDelta(
  envelope: SignedTrajectoryEnvelope,
  newTrajectory: BrowserTrajectory,
): ReplayDelta {
  const parentSteps = envelope.payload.trajectory.steps as Array<Record<string, unknown>>;
  const newSteps = newTrajectory.steps as unknown as Array<Record<string, unknown>>;

  const stepResults: ReplayDelta['stepResults'] = [];
  const len = Math.max(parentSteps.length, newSteps.length);
  for (let i = 0; i < len; i++) {
    const parent = parentSteps[i];
    const next = newSteps[i];
    const parentAction = String(parent?.action ?? 'missing');
    const replayAction = String(next?.action ?? 'missing');
    const parentSuccess = Boolean((parent?.result as Record<string, unknown> | undefined)?.success ?? true);
    const replaySuccess = Boolean((next?.result as Record<string, unknown> | undefined)?.success ?? true);
    const matched = parentAction === replayAction && parentSuccess === replaySuccess;
    stepResults.push({
      index: i,
      parentAction,
      replayAction,
      matched,
      note: matched ? undefined : describeDivergence(parent, next),
    });
  }

  return {
    parentTrajectoryId: envelope.payload.trajectory.id,
    newTrajectory,
    stepResults,
    allMatched: stepResults.every(s => s.matched),
  };
}

function describeDivergence(
  parent: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): string {
  if (!parent) return 'extra step in replay';
  if (!next) return 'missing step in replay';
  const parentAction = String(parent.action ?? 'unknown');
  const nextAction = String(next.action ?? 'unknown');
  if (parentAction !== nextAction) return `action drift: ${parentAction} → ${nextAction}`;
  const parentOk = Boolean((parent.result as Record<string, unknown> | undefined)?.success ?? true);
  const nextOk = Boolean((next.result as Record<string, unknown> | undefined)?.success ?? true);
  if (parentOk !== nextOk) return `outcome drift: parent=${parentOk}, replay=${nextOk}`;
  return 'unspecified divergence';
}
