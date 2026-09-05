/**
 * Signed PageRank Artifact (Phase 7 — beyond-SOTA, ADR-123)
 *
 * RuFlo gains a primitive no competing memory framework can ship: a portable,
 * Ed25519-signed PageRank result that carries enough metadata for a remote
 * peer to verify provenance + budget compliance + input stability without
 * trusting the producer. Federation peers exchange these instead of
 * re-walking graphs.
 *
 * Schema mirrors the ADR-123 Architecture diagram with the upstream 1.7.0
 * additions: `complexity_class` (budget compliance) + `coherence_score`
 * (DD-margin at compute time).
 */

import { z } from 'zod';
import {
  ComplexityClassSchema,
  PageRankResultSchema,
  type PageRankResult,
} from './types.js';

export const ARTIFACT_ENVELOPE_VERSION = '1.0.0';
export const ARTIFACT_ENVELOPE_KIND = 'pagerank';

export const SignedPageRankPayloadSchema = z.object({
  envelopeVersion: z.literal(ARTIFACT_ENVELOPE_VERSION),
  kind: z.literal(ARTIFACT_ENVELOPE_KIND),
  installationId: z.string().min(1),
  /** Witness key ID (key version, not key identity per ADR-103). */
  witnessKeyId: z.string().min(1),
  /** Ed25519 public key (hex, 32 bytes). */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  /** Adapter graph id (e.g. `ruflo-federation:trust-mesh`). */
  graphId: z.string().min(1),
  /** SHA-256 of the input matrix's `contentHash`. */
  graphHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Wall-clock at compute time. */
  graphTimestamp: z.string(),
  algorithm: z.enum(['forward-push', 'backward-push', 'bidirectional', 'cg', 'neumann']),
  alpha: z.number().positive().lt(1),
  epsilon: z.number().positive(),
  /** Query node — None for full-vector artifacts. */
  queryNode: z.string().optional(),
  /** Seed nodes (PPR). Empty for plain PR. */
  seedNodes: z.array(z.string()),
  /** Result (single-entry or full-vector). */
  result: PageRankResultSchema,
  /** Class the solver actually achieved (echoes result.complexityClass). */
  complexityClass: ComplexityClassSchema,
  /** Coherence margin at compute time (echoes result.coherence.score). */
  coherenceScore: z.number(),
  /** Hash of `result` (echoes result.resultHash). */
  resultHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** When the envelope was sealed. */
  sealedAt: z.string(),
  /** Solver version used. */
  solverVersion: z.string().default('sublinear-time-solver@1.7.0'),
});
export type SignedPageRankPayload = z.infer<typeof SignedPageRankPayloadSchema>;

export const SignedPageRankEnvelopeSchema = z.object({
  payload: SignedPageRankPayloadSchema,
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  algorithm: z.literal('ed25519'),
});
export type SignedPageRankEnvelope = z.infer<typeof SignedPageRankEnvelopeSchema>;

export interface ArtifactVerificationResult {
  valid: boolean;
  signatureValid: boolean;
  schemaValid: boolean;
  /** True iff graphHash + resultHash + signature all check out. */
  integrityValid: boolean;
  publicKey?: string;
  /** Complexity class echo — callers can budget against this. */
  complexityClass?: PageRankResult['complexityClass'];
  /** Coherence margin echo — callers can sanity-check input stability. */
  coherenceScore?: number;
  reason?: string;
}
