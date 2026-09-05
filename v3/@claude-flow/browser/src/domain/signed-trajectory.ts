/**
 * @claude-flow/browser - Signed Trajectory Container (ADR-122 Phase 1)
 *
 * Combines RVF trajectory envelope + Ed25519 witness signature to produce a
 * portable, verifiable browser-session artifact. No SOTA web agent ships
 * cryptographic provenance for AI browsing — this is the beyond-SOTA wedge.
 */

import { z } from 'zod';
import type { BrowserTrajectory } from './types.js';

/** Container envelope version. Bump when shape changes incompatibly. */
export const SIGNED_TRAJECTORY_ENVELOPE_VERSION = '1.0.0';

/** Magic identifier so verifiers can refuse non-trajectory containers. */
export const SIGNED_TRAJECTORY_KIND = 'browser-trajectory';

export const SignedTrajectoryPayloadSchema = z.object({
  envelopeVersion: z.literal(SIGNED_TRAJECTORY_ENVELOPE_VERSION),
  kind: z.literal(SIGNED_TRAJECTORY_KIND),
  /** Stable trajectory ID (matches BrowserTrajectory.id). */
  trajectoryId: z.string().min(1),
  /** Project/installation identifier for federation trust boundary. */
  projectId: z.string().min(1),
  /** Ed25519 public key (hex) of the signer for verifier convenience. */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/, 'public key must be 64 hex chars'),
  /** Trajectory itself — steps + verdict + timing. */
  trajectory: z.object({
    id: z.string(),
    sessionId: z.string(),
    goal: z.string(),
    steps: z.array(z.unknown()),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    success: z.boolean().optional(),
    verdict: z.string().optional(),
  }),
  /** Content hashes of screenshots referenced by steps (path → sha256 hex). */
  screenshotHashes: z.record(z.string().regex(/^[0-9a-f]{64}$/)),
  /** Final snapshot at endTrajectory — deterministic enough to drive replay. */
  finalSnapshot: z.unknown().optional(),
  /** When this envelope was sealed. */
  sealedAt: z.string(),
  /** Causal parent — if this is a replay-delta, points to the source trajectory ID. */
  parentTrajectoryId: z.string().optional(),
});

export type SignedTrajectoryPayload = z.infer<typeof SignedTrajectoryPayloadSchema>;

export const SignedTrajectoryEnvelopeSchema = z.object({
  payload: SignedTrajectoryPayloadSchema,
  /** Ed25519 signature (hex) over the canonical-JSON-stringified payload. */
  signature: z.string().regex(/^[0-9a-f]{128}$/, 'signature must be 128 hex chars'),
  /** Algorithm tag for future-proofing. Today only ed25519. */
  algorithm: z.literal('ed25519'),
});

export type SignedTrajectoryEnvelope = z.infer<typeof SignedTrajectoryEnvelopeSchema>;

/** Result of verifying an envelope. */
export interface VerificationResult {
  valid: boolean;
  /** True iff signature checks out AND payload schema passes. */
  signatureValid: boolean;
  schemaValid: boolean;
  /** Public key the envelope was signed with (for trust-list checks). */
  publicKey?: string;
  /** Why verification failed. Populated only when valid === false. */
  reason?: string;
}

/** Options for replay-with-mutation. */
export interface ReplayMutation {
  /** Replace step inputs by index — e.g. swap a URL or a fill value. */
  replaceStepInput?: Record<number, Record<string, unknown>>;
  /** Skip step indexes entirely (e.g. for shorter replay scenarios). */
  skipSteps?: number[];
  /** Override the trajectory goal (informational only). */
  goal?: string;
}

/** Result returned by replay() — points back to the original signed envelope. */
export interface ReplayDelta {
  /** Trajectory that was replayed. */
  parentTrajectoryId: string;
  /** New trajectory produced by replay; can itself be signed. */
  newTrajectory: BrowserTrajectory;
  /** Per-step verdict — did the replay step succeed against the same target? */
  stepResults: Array<{
    index: number;
    parentAction: string;
    replayAction: string;
    matched: boolean;
    note?: string;
  }>;
  /** True iff every replayed step matched the original outcome. */
  allMatched: boolean;
}
