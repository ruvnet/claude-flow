import { FederationNode } from '../entities/federation-node.js';
import { FederationSession, type SessionMetrics } from '../entities/federation-session.js';
import { TrustLevel } from '../entities/trust-level.js';

export interface HandshakeChallenge {
  readonly challengeId: string;
  readonly nonce: string;
  readonly timestamp: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}

export interface HandshakeChallengeResponse {
  readonly challengeId: string;
  readonly signedNonce: string;
  readonly publicKey: string;
  readonly capabilities: readonly string[];
}

export interface HandshakeResult {
  readonly success: boolean;
  readonly session?: FederationSession;
  readonly error?: string;
}

export interface HandshakeServiceDeps {
  generateSessionId: () => string;
  generateSessionToken: () => string;
  generateNonce: () => string;
  signChallenge: (nonce: string) => Promise<string>;
  verifySignature: (nonce: string, signature: string, publicKey: string) => Promise<boolean>;
  getLocalNodeId: () => string;
  getLocalPublicKey: () => string;
  getLocalCapabilities: () => readonly string[];
}

export interface HandshakeConfig {
  readonly sessionTtlMs: number;
  readonly maxSessionTtlMs: number;
  readonly heartbeatIntervalMs: number;
  readonly challengeTimeoutMs: number;
}

const DEFAULT_HANDSHAKE_CONFIG: HandshakeConfig = {
  sessionTtlMs: 3_600_000,
  maxSessionTtlMs: 86_400_000,
  heartbeatIntervalMs: 30_000,
  challengeTimeoutMs: 10_000,
};

export class HandshakeService {
  private readonly deps: HandshakeServiceDeps;
  private readonly config: HandshakeConfig;
  private readonly pendingChallenges: Map<string, { challenge: HandshakeChallenge; expiresAt: number }>;

  constructor(deps: HandshakeServiceDeps, config?: Partial<HandshakeConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_HANDSHAKE_CONFIG, ...config };
    this.pendingChallenges = new Map();
  }

  async initiateHandshake(remoteNode: FederationNode): Promise<HandshakeChallenge> {
    const nonce = this.deps.generateNonce();
    const challenge: HandshakeChallenge = {
      challengeId: this.deps.generateSessionId(),
      nonce,
      timestamp: new Date().toISOString(),
      sourceNodeId: this.deps.getLocalNodeId(),
      targetNodeId: remoteNode.nodeId,
    };

    this.pendingChallenges.set(challenge.challengeId, {
      challenge,
      expiresAt: Date.now() + this.config.challengeTimeoutMs,
    });

    this.cleanExpiredChallenges();
    return challenge;
  }

  async respondToHandshake(challenge: HandshakeChallenge): Promise<HandshakeChallengeResponse> {
    const signedNonce = await this.deps.signChallenge(challenge.nonce);

    return {
      challengeId: challenge.challengeId,
      signedNonce,
      publicKey: this.deps.getLocalPublicKey(),
      capabilities: this.deps.getLocalCapabilities(),
    };
  }

  async verifyChallenge(
    response: HandshakeChallengeResponse,
    remoteNode: FederationNode,
  ): Promise<HandshakeResult> {
    const pending = this.pendingChallenges.get(response.challengeId);

    if (!pending) {
      return { success: false, error: 'Unknown or expired challenge' };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingChallenges.delete(response.challengeId);
      return { success: false, error: 'Challenge expired' };
    }

    const isValid = await this.deps.verifySignature(
      pending.challenge.nonce,
      response.signedNonce,
      response.publicKey,
    );

    this.pendingChallenges.delete(response.challengeId);

    if (!isValid) {
      return { success: false, error: 'Invalid challenge signature' };
    }

    const localCapabilities = this.deps.getLocalCapabilities();
    const negotiatedCapabilities = localCapabilities.filter(
      cap => response.capabilities.includes(cap),
    );

    const now = new Date();
    const session = new FederationSession({
      sessionId: this.deps.generateSessionId(),
      localNodeId: this.deps.getLocalNodeId(),
      remoteNodeId: remoteNode.nodeId,
      trustLevel: TrustLevel.ATTESTED,
      negotiatedCapabilities,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.sessionTtlMs),
      heartbeatInterval: this.config.heartbeatIntervalMs,
      sessionToken: this.deps.generateSessionToken(),
      metrics: FederationSession.createMetrics(),
    });

    remoteNode.updateTrustLevel(TrustLevel.ATTESTED);
    remoteNode.markSeen();

    return { success: true, session };
  }

  /**
   * Establish a capability-limited session from discovery evidence.
   *
   * A signed manifest proves that the advertised key bound the protocol list;
   * it does not prove live challenge response, so this path never elevates
   * beyond VERIFIED. Endpoint-only peers remain UNTRUSTED with no negotiated
   * optional capabilities. A future wire handshake may elevate either session
   * after authenticating a response received from the remote process.
   */
  establishDiscoverySession(
    remoteNode: FederationNode,
    verifiedManifest: boolean,
  ): FederationSession {
    const remoteCapabilities = verifiedManifest
      ? remoteNode.capabilities.supportedProtocols
      : [];
    const negotiatedCapabilities = this.deps.getLocalCapabilities().filter(
      (capability) => remoteCapabilities.includes(capability),
    );
    const now = new Date();
    return new FederationSession({
      sessionId: this.deps.generateSessionId(),
      localNodeId: this.deps.getLocalNodeId(),
      remoteNodeId: remoteNode.nodeId,
      trustLevel: verifiedManifest ? TrustLevel.VERIFIED : TrustLevel.UNTRUSTED,
      negotiatedCapabilities,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.sessionTtlMs),
      heartbeatInterval: this.config.heartbeatIntervalMs,
      sessionToken: this.deps.generateSessionToken(),
      metrics: FederationSession.createMetrics(),
    });
  }

  renewSession(session: FederationSession): FederationSession {
    const remainingTtl = this.config.maxSessionTtlMs - (Date.now() - session.createdAt.getTime());
    const renewalTtl = Math.min(this.config.sessionTtlMs, remainingTtl);

    if (renewalTtl <= 0) {
      throw new Error('Session has exceeded maximum TTL and cannot be renewed');
    }

    session.renew(new Date(Date.now() + renewalTtl));
    return session;
  }

  private cleanExpiredChallenges(): void {
    const now = Date.now();
    for (const [id, pending] of this.pendingChallenges) {
      if (now > pending.expiresAt) {
        this.pendingChallenges.delete(id);
      }
    }
  }
}
