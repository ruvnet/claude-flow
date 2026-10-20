import {
  FederationEnvelope,
  type FederationEnvelopeProps,
  type FederationMessageType,
  CONSENSUS_REQUIRED_TYPES,
} from '../entities/federation-envelope.js';
import { FederationSession } from '../entities/federation-session.js';
import { TrustLevel } from '../entities/trust-level.js';

export type RoutingMode = 'direct' | 'broadcast' | 'consensus';

export interface RoutingResult {
  readonly success: boolean;
  readonly mode: RoutingMode;
  readonly envelopeId: string;
  readonly targetNodeIds: readonly string[];
  readonly error?: string;
  readonly latencyMs?: number;
}

export interface ConsensusProposal {
  readonly proposalId: string;
  readonly proposerNodeId: string;
  readonly messageType: FederationMessageType;
  readonly payload: unknown;
  readonly quorumRequired: number;
  readonly votes: Map<string, boolean>;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface RoutingServiceDeps {
  generateEnvelopeId: () => string;
  generateNonce: () => string;
  signEnvelope: (payload: string, sessionToken: string) => string;
  verifyEnvelope: (payload: string, signature: string, sessionToken: string) => boolean;
  scanPii: (text: string, trustLevel: number) => { transformedText: string; scanResult: FederationEnvelopeProps['piiScanResult'] };
  sendToNode: (nodeId: string, envelope: FederationEnvelope) => Promise<void>;
  getActiveSessions: () => FederationSession[];
  getLocalNodeId: () => string;
  /** Current peer authority; absent peers/resolvers receive the untrusted PII policy. */
  getPeerTrustLevel?: (nodeId: string) => TrustLevel | undefined;
}

export class RoutingService {
  private readonly deps: RoutingServiceDeps;
  private readonly pendingProposals: Map<string, ConsensusProposal>;

  constructor(deps: RoutingServiceDeps) {
    this.deps = deps;
    this.pendingProposals = new Map();
  }

  selectMode(messageType: FederationMessageType): RoutingMode {
    if (CONSENSUS_REQUIRED_TYPES.has(messageType)) {
      return 'consensus';
    }
    if (messageType === 'status-broadcast') {
      return 'broadcast';
    }
    return 'direct';
  }

  async send<T>(
    session: FederationSession,
    messageType: FederationMessageType,
    payload: T,
  ): Promise<RoutingResult> {
    const startTime = Date.now();

    if (!session.active) {
      return { success: false, mode: 'direct', envelopeId: '', targetNodeIds: [], error: 'Session is not active' };
    }

    if (session.isExpired()) {
      return { success: false, mode: 'direct', envelopeId: '', targetNodeIds: [], error: 'Session has expired' };
    }

    const payloadStr = JSON.stringify(payload);
    // Session trust records handshake admission; peer trust can change after it opens.
    const trustLevel = this.deps.getPeerTrustLevel?.(session.remoteNodeId) ?? TrustLevel.UNTRUSTED;
    const { transformedText, scanResult } = this.deps.scanPii(payloadStr, trustLevel);
    if (scanResult.piiFound && scanResult.actionsApplied.includes('block')) {
      return { success: false, mode: 'direct', envelopeId: '', targetNodeIds: [session.remoteNodeId], error: 'Message blocked by PII policy' };
    }

    const envelopeId = this.deps.generateEnvelopeId();
    const nonce = this.deps.generateNonce();
    const timestamp = new Date();

    const unsignedPayload = JSON.stringify({
      envelopeId,
      sourceNodeId: session.localNodeId,
      targetNodeId: session.remoteNodeId,
      sessionId: session.sessionId,
      messageType,
      payload: JSON.parse(transformedText),
      timestamp: timestamp.toISOString(),
      nonce,
    });

    const hmacSignature = this.deps.signEnvelope(unsignedPayload, session.sessionToken);

    const envelope = new FederationEnvelope<T>({
      envelopeId,
      sourceNodeId: session.localNodeId,
      targetNodeId: session.remoteNodeId,
      sessionId: session.sessionId,
      messageType,
      payload: JSON.parse(transformedText) as T,
      timestamp,
      nonce,
      hmacSignature,
      piiScanResult: scanResult,
    });

    try {
      await this.deps.sendToNode(session.remoteNodeId, envelope);
      session.recordMessageSent();
      if (scanResult.piiFound) {
        session.recordPiiRedaction();
      }

      return {
        success: true,
        mode: 'direct',
        envelopeId,
        targetNodeIds: [session.remoteNodeId],
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, mode: 'direct', envelopeId, targetNodeIds: [session.remoteNodeId], error: errorMsg };
    }
  }

  async broadcast<T>(
    messageType: FederationMessageType,
    payload: T,
  ): Promise<RoutingResult[]> {
    const sessions = this.deps.getActiveSessions().filter(s => s.active && !s.isExpired());
    const results: RoutingResult[] = [];

    for (const session of sessions) {
      const result = await this.send(session, messageType, payload);
      results.push(result);
    }

    return results;
  }

  async propose<T>(
    messageType: FederationMessageType,
    payload: T,
    quorumFraction: number = 2 / 3,
  ): Promise<ConsensusProposal> {
    const sessions = this.deps.getActiveSessions().filter(s => s.active && !s.isExpired());
    const quorumRequired = Math.ceil(sessions.length * quorumFraction);

    const proposal: ConsensusProposal = {
      proposalId: this.deps.generateEnvelopeId(),
      proposerNodeId: this.deps.getLocalNodeId(),
      messageType,
      payload,
      quorumRequired,
      votes: new Map(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30_000),
    };

    this.pendingProposals.set(proposal.proposalId, proposal);

    await this.broadcast(messageType, {
      type: 'consensus-proposal',
      proposalId: proposal.proposalId,
      messageType,
      payload,
      quorumRequired,
    });

    return proposal;
  }

  recordVote(proposalId: string, nodeId: string, vote: boolean): boolean {
    const proposal = this.pendingProposals.get(proposalId);
    if (!proposal) return false;

    if (new Date() > proposal.expiresAt) {
      this.pendingProposals.delete(proposalId);
      return false;
    }

    proposal.votes.set(nodeId, vote);
    return true;
  }

  isConsensusReached(proposalId: string): { reached: boolean; approved: boolean } {
    const proposal = this.pendingProposals.get(proposalId);
    if (!proposal) return { reached: false, approved: false };

    const approvals = Array.from(proposal.votes.values()).filter(v => v).length;
    if (approvals >= proposal.quorumRequired) {
      return { reached: true, approved: true };
    }

    const rejections = Array.from(proposal.votes.values()).filter(v => !v).length;
    const totalVoters = this.deps.getActiveSessions().length;
    if (rejections > totalVoters - proposal.quorumRequired) {
      return { reached: true, approved: false };
    }

    return { reached: false, approved: false };
  }

  verifyInboundEnvelope(envelope: FederationEnvelope, sessionToken: string): boolean {
    const signablePayload = envelope.toSignablePayload();
    return this.deps.verifyEnvelope(signablePayload, envelope.hmacSignature, sessionToken);
  }

  cleanExpiredProposals(): void {
    const now = new Date();
    for (const [id, proposal] of this.pendingProposals) {
      if (now > proposal.expiresAt) {
        this.pendingProposals.delete(id);
      }
    }
  }
}
