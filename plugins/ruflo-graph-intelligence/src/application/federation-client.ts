/**
 * Federation Client for PR Artifacts (Phase 8 — beyond-SOTA, ADR-123)
 *
 * Sends `pr_artifact_request` to peers, verifies inbound `pr_artifact_response`
 * envelopes via Phase 7 verifier with the consumer's trust list, falls back
 * to local recompute on stale/untrusted responses.
 */

import { verifyArtifact } from '../infrastructure/witness-signer.js';
import { runPageRank } from '../infrastructure/solver-bridge.js';
import { getRegistry } from '../domain/adapter.js';
import type {
  FederationMessage,
  FederationTransport,
  PrArtifactRequest,
  PrArtifactResponse,
  PrArtifactStale,
} from '../domain/federation-protocol.js';
import type { ArtifactVerificationResult } from '../domain/signed-artifact.js';
import type { PageRankResult } from '../domain/types.js';

export interface FederationClientOptions {
  installationId: string;
  transport: FederationTransport;
  /** Public keys we trust. Empty = trust any valid signature. */
  trustedPublicKeys?: string[];
}

export interface FetchPrResult {
  /** How the result was obtained. */
  origin: 'peer' | 'local-fallback' | 'stale-fallback' | 'untrusted-fallback';
  result: PageRankResult;
  /** If origin === 'peer', the verification report. */
  verification?: ArtifactVerificationResult;
  /** Optional reason when we fell back. */
  fallbackReason?: string;
}

export class FederationClient {
  private readonly installationId: string;
  private readonly transport: FederationTransport;
  private readonly trustedPublicKeys: string[];

  constructor(options: FederationClientOptions) {
    this.installationId = options.installationId;
    this.transport = options.transport;
    this.trustedPublicKeys = options.trustedPublicKeys ?? [];
  }

  /**
   * Fetch a single-entry PR score for `nodeId` over `graphId`. Tries the
   * peer first; on stale/untrusted/missing, falls back to local recompute.
   */
  async fetchPageRank(input: {
    peer: string;
    graphId: string;
    nodeId: string;
    alpha?: number;
    epsilon?: number;
    seedNodes?: string[];
    lastKnownGraphHash?: string;
    lastKnownResultHash?: string;
  }): Promise<FetchPrResult> {
    const request: PrArtifactRequest = {
      type: 'pr_artifact_request',
      fromInstallation: this.installationId,
      graphId: input.graphId,
      queryNode: input.nodeId,
      alpha: input.alpha ?? 0.85,
      epsilon: input.epsilon ?? 1e-3,
      seedNodes: input.seedNodes ?? [],
      lastKnownGraphHash: input.lastKnownGraphHash,
      lastKnownResultHash: input.lastKnownResultHash,
    };
    const response = await this.transport.send(input.peer, request);
    if (response && response.type === 'pr_artifact_response') {
      const verification = verifyArtifact(response.envelope, {
        trustedPublicKeys: this.trustedPublicKeys.length > 0 ? this.trustedPublicKeys : undefined,
      });
      if (verification.valid) {
        return {
          origin: 'peer',
          result: response.envelope.payload.result,
          verification,
        };
      }
      return {
        origin: 'untrusted-fallback',
        result: await this.localCompute(input),
        verification,
        fallbackReason: verification.reason ?? 'verification failed',
      };
    }
    if (response && response.type === 'pr_artifact_stale') {
      return {
        origin: 'stale-fallback',
        result: await this.localCompute(input),
        fallbackReason: response.reason,
      };
    }
    // No usable response
    return {
      origin: 'local-fallback',
      result: await this.localCompute(input),
      fallbackReason: 'no usable response from peer',
    };
  }

  private async localCompute(input: {
    graphId: string;
    nodeId: string;
    alpha?: number;
    epsilon?: number;
    seedNodes?: string[];
  }): Promise<PageRankResult> {
    const adapter = getRegistry().get(input.graphId);
    if (!adapter) {
      throw new Error(`localCompute: no adapter for graphId=${input.graphId}`);
    }
    const matrix = await adapter.exportAsSparseMatrix();
    return runPageRank(matrix, {
      graphId: input.graphId,
      nodeId: input.nodeId,
      alpha: input.alpha ?? 0.85,
      epsilon: input.epsilon ?? 1e-3,
      seedNodes: input.seedNodes ?? [],
      maxComplexityClass: 'polynomial',
      coherenceThreshold: 0,
    });
  }
}

/**
 * Helper: an in-process transport stitching a client to a server. Useful for
 * testing the Phase 8 round-trip without spinning up real ADR-104 wiring.
 */
export function inProcessTransport(server: { handle: (msg: FederationMessage) => Promise<FederationMessage | null> }): FederationTransport {
  return {
    async send(_to, msg) {
      return server.handle(msg);
    },
    onMessage() {
      // not used in the in-process variant
      return () => {};
    },
  };
}
