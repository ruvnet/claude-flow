/**
 * Federation Protocol for PR Artifacts (Phase 8 — beyond-SOTA, ADR-123)
 *
 * Wire message types over the ADR-104 federation transport. Peers can ask
 * for a precomputed signed PageRank vector instead of re-walking the graph,
 * verify via the Phase 7 signer, and fall back to local recompute when the
 * artifact is stale (graphHash mismatch) or the holder isn't trusted.
 */

import { z } from 'zod';
import { SignedPageRankEnvelopeSchema } from './signed-artifact.js';

// ============================================================================
// Request types
// ============================================================================

export const PrArtifactRequestSchema = z.object({
  type: z.literal('pr_artifact_request'),
  /** Requesting installation id. */
  fromInstallation: z.string().min(1),
  /** Adapter graph id to query. */
  graphId: z.string().min(1),
  /** Query node for single-entry PR. Omit for full-vector requests. */
  queryNode: z.string().optional(),
  alpha: z.number().positive().lt(1).default(0.85),
  epsilon: z.number().positive().default(1e-3),
  seedNodes: z.array(z.string()).default([]),
  /** Hash of the graph the requester has locally. Holder uses this to decide
   *  whether to ship a fresh artifact or a delta. */
  lastKnownGraphHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Hash of any previous PR result the requester has cached. */
  lastKnownResultHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type PrArtifactRequest = z.infer<typeof PrArtifactRequestSchema>;

// ============================================================================
// Response types — either a full artifact, a delta, or a stale-rejection
// ============================================================================

export const PrArtifactResponseSchema = z.object({
  type: z.literal('pr_artifact_response'),
  /** Responding installation id. */
  fromInstallation: z.string().min(1),
  /** The Phase 7 signed envelope. */
  envelope: SignedPageRankEnvelopeSchema,
});
export type PrArtifactResponse = z.infer<typeof PrArtifactResponseSchema>;

/** Lightweight delta — only the score difference + new resultHash. */
export const PrArtifactDeltaSchema = z.object({
  type: z.literal('pr_artifact_delta'),
  fromInstallation: z.string().min(1),
  graphId: z.string().min(1),
  /** Hash the delta is based on. */
  baseResultHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** New resultHash after delta applied. */
  newResultHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Score delta (single-entry) or sparse delta indices+values (vector). */
  scoreDelta: z.number().optional(),
  sparseDelta: z.object({
    indices: z.array(z.number().int().nonnegative()),
    values: z.array(z.number()),
  }).optional(),
});
export type PrArtifactDelta = z.infer<typeof PrArtifactDeltaSchema>;

export const PrArtifactStaleSchema = z.object({
  type: z.literal('pr_artifact_stale'),
  fromInstallation: z.string().min(1),
  graphId: z.string().min(1),
  /** The holder's current graph hash so the requester can decide what to do. */
  currentGraphHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Why the request was stale-rejected. */
  reason: z.string(),
});
export type PrArtifactStale = z.infer<typeof PrArtifactStaleSchema>;

export const FederationMessageSchema = z.discriminatedUnion('type', [
  PrArtifactRequestSchema,
  PrArtifactResponseSchema,
  PrArtifactDeltaSchema,
  PrArtifactStaleSchema,
]);
export type FederationMessage = z.infer<typeof FederationMessageSchema>;

// ============================================================================
// Transport contract — ADR-104 plugs in here
// ============================================================================

export interface FederationTransport {
  /** Send a message to a specific peer. Returns the response message. */
  send(toInstallation: string, message: FederationMessage): Promise<FederationMessage | null>;
  /** Subscribe to inbound messages. */
  onMessage(handler: (msg: FederationMessage) => Promise<FederationMessage | null>): () => void;
}
