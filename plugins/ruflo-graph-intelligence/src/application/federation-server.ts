/**
 * Federation Server for PR Artifacts (Phase 8 — beyond-SOTA, ADR-123)
 *
 * Receives `pr_artifact_request` messages and serves either a fresh signed
 * artifact (if the holder has one cached or computes one on demand) or a
 * stale-rejection. The server uses Phase 7's sealArtifact for signing and
 * Phase 2-6 adapters for graph access.
 *
 * Pluggable via FederationTransport so ADR-104's real wire layer fits in
 * unchanged.
 */

import { sealArtifact, type WitnessKey } from '../infrastructure/witness-signer.js';
import { runPageRank } from '../infrastructure/solver-bridge.js';
import { getRegistry } from '../domain/adapter.js';
import type {
  FederationMessage,
  FederationTransport,
  PrArtifactRequest,
  PrArtifactResponse,
  PrArtifactStale,
} from '../domain/federation-protocol.js';

export interface FederationServerOptions {
  installationId: string;
  witnessKey: WitnessKey;
  witnessKeyId: string;
  transport: FederationTransport;
  /** Per-graph rate-limit budget — requests per peer per minute. */
  rateLimitPerPeerPerMinute?: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export class FederationServer {
  private readonly installationId: string;
  private readonly witnessKey: WitnessKey;
  private readonly witnessKeyId: string;
  private readonly transport: FederationTransport;
  private readonly rateLimit: number;
  private rateBuckets = new Map<string, RateBucket>();
  private unsubscribe?: () => void;

  constructor(options: FederationServerOptions) {
    this.installationId = options.installationId;
    this.witnessKey = options.witnessKey;
    this.witnessKeyId = options.witnessKeyId;
    this.transport = options.transport;
    this.rateLimit = options.rateLimitPerPeerPerMinute ?? 60;
  }

  start(): void {
    this.unsubscribe = this.transport.onMessage((m) => this.handle(m));
  }

  stop(): void {
    this.unsubscribe?.();
  }

  /** Public test seam — handles a single inbound message. */
  async handle(msg: FederationMessage): Promise<FederationMessage | null> {
    if (msg.type !== 'pr_artifact_request') return null;
    return this.handleRequest(msg);
  }

  private async handleRequest(req: PrArtifactRequest): Promise<FederationMessage> {
    // Rate-limit per peer
    if (!this.checkRate(req.fromInstallation)) {
      return {
        type: 'pr_artifact_stale',
        fromInstallation: this.installationId,
        graphId: req.graphId,
        currentGraphHash: 'rate-limited'.padEnd(64, '0'),
        reason: 'rate limit exceeded',
      } satisfies PrArtifactStale;
    }

    const adapter = getRegistry().get(req.graphId);
    if (!adapter) {
      return {
        type: 'pr_artifact_stale',
        fromInstallation: this.installationId,
        graphId: req.graphId,
        currentGraphHash: '0'.repeat(64),
        reason: `no adapter for graphId=${req.graphId}`,
      } satisfies PrArtifactStale;
    }

    const matrix = await adapter.exportAsSparseMatrix();
    const currentGraphHash = matrix.contentHash ?? '0'.repeat(64);

    // Stale-check: if the requester's lastKnownGraphHash differs, send stale
    if (req.lastKnownGraphHash && req.lastKnownGraphHash !== currentGraphHash) {
      return {
        type: 'pr_artifact_stale',
        fromInstallation: this.installationId,
        graphId: req.graphId,
        currentGraphHash,
        reason: 'graph has changed since requester last cached',
      } satisfies PrArtifactStale;
    }

    if (!req.queryNode) {
      return {
        type: 'pr_artifact_stale',
        fromInstallation: this.installationId,
        graphId: req.graphId,
        currentGraphHash,
        reason: 'full-vector requests not yet supported (Phase 8 only)',
      } satisfies PrArtifactStale;
    }

    // Compute and seal
    const prResult = runPageRank(matrix, {
      graphId: req.graphId,
      nodeId: req.queryNode,
      alpha: req.alpha,
      epsilon: req.epsilon,
      seedNodes: req.seedNodes,
      maxComplexityClass: 'polynomial',
      coherenceThreshold: 0,
    });
    const { envelope } = sealArtifact({
      installationId: this.installationId,
      witnessKeyId: this.witnessKeyId,
      graphId: req.graphId,
      graphHash: currentGraphHash,
      graphTimestamp: matrix.capturedAt,
      algorithm: 'forward-push',
      alpha: req.alpha,
      epsilon: req.epsilon,
      queryNode: req.queryNode,
      seedNodes: req.seedNodes,
      result: prResult,
      witnessKey: this.witnessKey,
    });
    return {
      type: 'pr_artifact_response',
      fromInstallation: this.installationId,
      envelope,
    } satisfies PrArtifactResponse;
  }

  private checkRate(peer: string): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(peer);
    if (!bucket || now >= bucket.resetAt) {
      this.rateBuckets.set(peer, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (bucket.count >= this.rateLimit) return false;
    bucket.count++;
    return true;
  }
}
