import { FederationNode, type FederationNodeStateRecord } from '../domain/entities/federation-node.js';
import { FederationSession } from '../domain/entities/federation-session.js';
import { type FederationMessageType } from '../domain/entities/federation-envelope.js';
import { TrustLevel } from '../domain/entities/trust-level.js';
import {
  FederationNodeState,
  type SuspensionReason,
} from '../domain/value-objects/federation-node-state.js';
import { DiscoveryService, type FederationManifest } from '../domain/services/discovery-service.js';
import { HandshakeService } from '../domain/services/handshake-service.js';
import { RoutingService, type RoutingResult } from '../domain/services/routing-service.js';
import { AuditService } from '../domain/services/audit-service.js';
import { PIIPipelineService } from '../domain/services/pii-pipeline-service.js';
import { TrustEvaluator, type ImmediateDowngradeReason, type BootstrapElevationAuditEntry } from './trust-evaluator.js';
import { PolicyEngine } from './policy-engine.js';
import {
  type Budget,
  type BudgetEnforcement,
  enforceBudget,
  validateBudget,
} from '../domain/value-objects/federation-budget.js';
import type { FederationBreakerService } from './federation-breaker-service.js';
import type {
  FederationSpendEvent,
  SpendReporter,
} from './spend-reporter.js';
import type { WgMeshService, WgCommand } from '../domain/services/wg-mesh-service.js';

/**
 * Optional per-call budget controls (ADR-097 Phase 1). All fields are
 * optional; omitted means "no limit on that axis" (the default unbounded
 * budget still has maxHops = 8 to defang recursive delegation loops).
 */
export interface SendOptions {
  readonly budget?: { maxTokens?: number; maxUsd?: number };
  readonly maxHops?: number;
  /**
   * How many hops this message has already traveled (0 on the originator).
   * Phase 1 enforces at the send side because there is no inbound dispatcher
   * yet; callers re-forwarding a received message should pass the original
   * envelope's hopCount here.
   */
  readonly hopCount?: number;
  /** Caller-reported usage from the previous leg, for cumulative checks. */
  readonly spent?: { tokens?: number; usd?: number };
}

export interface FederationCoordinatorConfig {
  readonly nodeId: string;
  readonly publicKey: string;
  readonly endpoint: string;
  readonly capabilities: readonly string[];
}

export interface FederationStatus {
  readonly nodeId: string;
  readonly activeSessions: number;
  readonly knownPeers: number;
  readonly trustLevels: Record<string, TrustLevel>;
  readonly healthy: boolean;
}

/**
 * Optional integrations (ADR-097 Phase 3 upstream + Phase 2.b breaker
 * wiring). Both are constructor-injected; both default to no-op.
 *
 * - `spendReporter` — invoked by reportSpend() when present; persists
 *   the FederationSpendEvent to whatever backend the integrator wired
 *   (cost-tracker bus, ruflo memory federation-spend namespace, etc.)
 * - `breakerService` — invoked by reportSpend() when present; calls
 *   recordOutcome() so the breaker's in-memory rolling buffer is fed
 *   without requiring the integrator to wire two parallel pipelines
 */
export interface FederationCoordinatorIntegrations {
  readonly spendReporter?: SpendReporter;
  readonly breakerService?: FederationBreakerService;
  /**
   * ADR-111 Phase 3 — optional WG mesh service. When present, peer state
   * transitions (evict/reactivate/breaker-suspend) emit `wg set` commands
   * to a sink supplied by `wgCommandSink`. No-op for peers without a `wg`
   * manifest block, so wiring the service is safe even in mixed deployments.
   */
  readonly wgMesh?: WgMeshService;
  /**
   * Where emitted WG commands go. Defaults to the audit log only. Integrators
   * can plug in a shell executor here (after operator approval — bringing up
   * a network interface is destructive). Commands include shell-ready
   * `wg set <iface> ...` strings; the sink should still validate before exec.
   */
  readonly wgCommandSink?: (cmd: WgCommand) => void | Promise<void>;
}

export class FederationCoordinator {
  private readonly config: FederationCoordinatorConfig;
  private readonly discovery: DiscoveryService;
  private readonly handshake: HandshakeService;
  private readonly routing: RoutingService;
  private readonly audit: AuditService;
  private readonly piiPipeline: PIIPipelineService;
  private readonly trustEvaluator: TrustEvaluator;
  private readonly policyEngine: PolicyEngine;
  private readonly sessions: Map<string, FederationSession>;
  private initialized: boolean;
  private readonly spendReporter?: SpendReporter;
  private readonly breakerService?: FederationBreakerService;
  private readonly wgMesh?: WgMeshService;
  private readonly wgCommandSink?: (cmd: WgCommand) => void | Promise<void>;

  constructor(
    config: FederationCoordinatorConfig,
    discovery: DiscoveryService,
    handshake: HandshakeService,
    routing: RoutingService,
    audit: AuditService,
    piiPipeline: PIIPipelineService,
    trustEvaluator: TrustEvaluator,
    policyEngine: PolicyEngine,
    integrations: FederationCoordinatorIntegrations = {},
  ) {
    this.config = config;
    this.discovery = discovery;
    this.handshake = handshake;
    this.routing = routing;
    this.audit = audit;
    this.piiPipeline = piiPipeline;
    this.trustEvaluator = trustEvaluator;
    this.policyEngine = policyEngine;
    this.sessions = new Map();
    this.initialized = false;
    this.spendReporter = integrations.spendReporter;
    this.breakerService = integrations.breakerService;
    this.wgMesh = integrations.wgMesh;
    this.wgCommandSink = integrations.wgCommandSink;
  }

  /**
   * ADR-111 Phase 3 — emit a WG command for an audited peer transition.
   * No-op if no wgMesh is configured or the peer lacks a `wg` manifest
   * block. Commands flow to `wgCommandSink` (if any) and always to the
   * audit log so reactivation is fully traceable.
   */
  private async emitWgCommand(
    peer: FederationNode,
    builder: (pubkey: string, meshIP: string) => WgCommand | null,
  ): Promise<void> {
    if (!this.wgMesh) return;
    const wgPubkey = peer.metadata.wgPublicKey as string | undefined;
    const wgMeshIP = peer.metadata.wgMeshIP as string | undefined;
    if (!wgPubkey || !wgMeshIP) return;
    const cmd = builder(wgPubkey, wgMeshIP);
    if (!cmd) return;
    await this.audit.log('peer_manifest_published', {
      targetNodeId: peer.nodeId,
      metadata: {
        wgCommand: cmd.cmd,
        wgVerb: cmd.verb,
        wgRationale: cmd.rationale,
      },
    });
    if (this.wgCommandSink) {
      await this.wgCommandSink(cmd);
    }
  }

  async initialize(manifest: Omit<FederationManifest, 'signature'>): Promise<void> {
    await this.discovery.publishManifest(manifest);
    this.discovery.startPeriodicDiscovery();
    this.initialized = true;

    await this.audit.log('peer_manifest_published', {
      metadata: { endpoint: this.config.endpoint },
    });
  }

  async shutdown(): Promise<void> {
    this.discovery.stopPeriodicDiscovery();

    for (const [sessionId, session] of this.sessions) {
      session.terminate();
      await this.audit.log('session_terminated', {
        sessionId,
        targetNodeId: session.remoteNodeId,
      });
    }

    this.sessions.clear();
    await this.audit.flush();
    this.initialized = false;
  }

  async joinPeer(endpoint: string): Promise<FederationSession> {
    this.ensureInitialized();

    const node = await this.discovery.addStaticPeer(endpoint);

    await this.audit.log('peer_discovered', {
      targetNodeId: node.nodeId,
      metadata: { endpoint },
    });

    return this.establishSession(node);
  }

  async leavePeer(nodeId: string): Promise<void> {
    this.ensureInitialized();

    const session = this.findSessionByNodeId(nodeId);
    if (session) {
      session.terminate();
      this.sessions.delete(session.sessionId);

      await this.audit.log('session_terminated', {
        sessionId: session.sessionId,
        targetNodeId: nodeId,
      });
    }

    this.discovery.removePeer(nodeId);
  }

  async sendMessage<T>(
    targetNodeId: string,
    messageType: FederationMessageType,
    payload: T,
    options: SendOptions = {},
  ): Promise<RoutingResult> {
    this.ensureInitialized();

    // ADR-097 Phase 2.b: outbound short-circuit on tripped breaker. If the
    // peer is SUSPENDED or EVICTED we refuse the send before doing any work,
    // and emit a constant-string error (no remaining-budget echo per the
    // anti-oracle posture inherited from Phase 1). The check fires *before*
    // session lookup so an evicted peer cannot consume cycles even on a
    // dangling session reference.
    const peer = this.discovery.getPeer(targetNodeId);
    if (peer && !peer.isActive) {
      const reason = peer.isEvicted ? 'PEER_EVICTED' : 'PEER_SUSPENDED';
      await this.audit.log('message_rejected', {
        targetNodeId,
        metadata: { reason },
      });
      return {
        success: false,
        mode: 'direct',
        envelopeId: '',
        targetNodeIds: [targetNodeId],
        error: reason,
      };
    }

    const session = this.findSessionByNodeId(targetNodeId);
    if (!session) {
      return {
        success: false,
        mode: 'direct',
        envelopeId: '',
        targetNodeIds: [targetNodeId],
        error: `No active session with node ${targetNodeId}`,
      };
    }

    const policyResult = this.policyEngine.evaluateMessage(
      messageType,
      session.trustLevel,
      JSON.stringify(payload).length,
      this.config.nodeId,
    );

    if (!policyResult.allowed) {
      await this.audit.log('message_rejected', {
        targetNodeId,
        sessionId: session.sessionId,
        metadata: { reason: policyResult.reason },
      });
      return {
        success: false,
        mode: 'direct',
        envelopeId: '',
        targetNodeIds: [targetNodeId],
        error: policyResult.reason,
      };
    }

    // ADR-097 Phase 1: validate caller-supplied budget + enforce hop limit
    // and cumulative spend BEFORE outbound dispatch. Synchronous & atomic —
    // no awaits between validate and enforce, so concurrent sends cannot
    // both pass a single-hop budget. Errors are constant strings so a
    // malicious caller cannot use the response as a budget oracle.
    const budgetResult = validateBudget(options.budget, options.maxHops);
    if (!budgetResult.ok) {
      await this.audit.log('message_rejected', {
        targetNodeId,
        sessionId: session.sessionId,
        metadata: { reason: 'INVALID_BUDGET', detail: budgetResult.error },
      });
      return {
        success: false,
        mode: 'direct',
        envelopeId: '',
        targetNodeIds: [targetNodeId],
        error: 'INVALID_BUDGET',
      };
    }
    const enforcement: BudgetEnforcement = enforceBudget(
      budgetResult.budget,
      options.hopCount ?? 0,
      {
        tokens: options.spent?.tokens ?? 0,
        usd: options.spent?.usd ?? 0,
      },
    );
    if (!enforcement.ok) {
      await this.audit.log('message_rejected', {
        targetNodeId,
        sessionId: session.sessionId,
        metadata: { reason: enforcement.reason },
      });
      return {
        success: false,
        mode: 'direct',
        envelopeId: '',
        targetNodeIds: [targetNodeId],
        error: enforcement.reason, // constant string — no oracle leak
      };
    }

    const result = await this.routing.send(session, messageType, payload);

    await this.audit.log(result.success ? 'message_sent' : 'message_rejected', {
      targetNodeId,
      sessionId: session.sessionId,
      latencyMs: result.latencyMs,
      metadata: {
        messageType,
        mode: result.mode,
        hopCount: enforcement.nextHopCount,
      },
    });

    return result;
  }

  /**
   * Re-export the budget primitives so external callers (e.g. follow-up
   * iterations adding receive-side decrement) can reuse them without
   * dipping into domain/value-objects directly.
   */
  static readonly budget = { validate: validateBudget, enforce: enforceBudget };

  async broadcastMessage<T>(
    messageType: FederationMessageType,
    payload: T,
  ): Promise<RoutingResult[]> {
    this.ensureInitialized();
    return this.routing.broadcast(messageType, payload);
  }

  handleThreatDetection(nodeId: string): void {
    const exceedsThreshold = this.trustEvaluator.recordThreatDetection(nodeId);
    const node = this.discovery.getPeer(nodeId);

    if (node && exceedsThreshold) {
      this.trustEvaluator.downgrade(node, 'repeated-threat-detection');
      const session = this.findSessionByNodeId(nodeId);
      if (session) {
        session.terminate();
        this.sessions.delete(session.sessionId);
      }

      this.audit.log('threat_blocked', {
        sourceNodeId: nodeId,
        trustLevel: TrustLevel.UNTRUSTED,
        threatDetected: true,
        metadata: { reason: 'repeated-threat-detection' },
      });
    }
  }

  handleHmacFailure(nodeId: string): void {
    const node = this.discovery.getPeer(nodeId);
    if (node) {
      this.trustEvaluator.downgrade(node, 'hmac-verification-failure');
      const session = this.findSessionByNodeId(nodeId);
      if (session) {
        session.terminate();
        this.sessions.delete(session.sessionId);
      }

      this.audit.log('threat_blocked', {
        sourceNodeId: nodeId,
        trustLevel: TrustLevel.UNTRUSTED,
        metadata: { reason: 'hmac-verification-failure' },
      });
    }
  }

  getStatus(): FederationStatus {
    const peers = this.discovery.listPeers();
    const trustLevels: Record<string, TrustLevel> = {};
    for (const peer of peers) {
      trustLevels[peer.nodeId] = peer.trustLevel;
    }

    return {
      nodeId: this.config.nodeId,
      activeSessions: Array.from(this.sessions.values()).filter(s => s.active).length,
      knownPeers: peers.length,
      trustLevels,
      healthy: this.initialized,
    };
  }

  /**
   * ADR-097 Phase 4: per-peer breaker state snapshot for the doctor
   * surface and `federation_breaker_status` MCP tool.
   *
   * Returns one entry per known peer with the entity's stateRecord —
   * what state, when it changed, why, and which caller's correlation
   * key triggered it. Pure read; does not mutate.
   */
  getPeerStates(): readonly (FederationNodeStateRecord & { readonly nodeId: string })[] {
    return this.discovery.listPeers().map((peer) => ({
      nodeId: peer.nodeId,
      ...peer.stateRecord,
    }));
  }

  /**
   * ADR-111 Phase 6: public read of the discovery peer list. Used by
   * federation_wg_status MCP tool + WG firewall projection. Returns the
   * full known-peer set (active + suspended + evicted) — filter via
   * .isActive / state if you only want the live mesh members.
   */
  listPeers(): readonly FederationNode[] {
    return this.discovery.listPeers();
  }

  /**
   * Aggregated counts for the doctor surface — `{ active: N, suspended: M,
   * evicted: K }`. Cheap O(peers) sweep; safe to call from a status line.
   */
  getPeerStateCounts(): { readonly active: number; readonly suspended: number; readonly evicted: number } {
    let active = 0;
    let suspended = 0;
    let evicted = 0;
    for (const peer of this.discovery.listPeers()) {
      switch (peer.state) {
        case FederationNodeState.ACTIVE: active++; break;
        case FederationNodeState.SUSPENDED: suspended++; break;
        case FederationNodeState.EVICTED: evicted++; break;
      }
    }
    return { active, suspended, evicted };
  }

  /**
   * Operator-initiated evict. Returns true on transition, false if the
   * peer was already EVICTED or unknown. Logs to audit either way.
   *
   * Does NOT remove the peer from the discovery registry — `leavePeer`
   * is the registry-removal API. Eviction is the breaker layer; the peer
   * remains queryable so the operator can later reactivate.
   */
  async evictPeer(
    nodeId: string,
    reason: SuspensionReason = 'MANUAL_EVICT',
    correlationId?: string,
  ): Promise<boolean> {
    this.ensureInitialized();
    const peer = this.discovery.getPeer(nodeId);
    if (!peer) return false;

    const ok = peer.evict({ reason, correlationId });
    await this.audit.log('threat_blocked', {
      targetNodeId: nodeId,
      metadata: {
        reason,
        correlationId: correlationId ?? null,
        state: peer.state,
        applied: ok,
      },
    });
    if (ok) {
      const session = this.findSessionByNodeId(nodeId);
      if (session) {
        session.terminate();
        this.sessions.delete(session.sessionId);
      }
      // ADR-111 Phase 3 — propagate eviction to the WG mesh. No-op if the
      // peer never published a wg block; otherwise drops the peer from the
      // mesh runtime (config rebuild will also exclude it).
      await this.emitWgCommand(peer, (pubkey) =>
        this.wgMesh!.removePeer(peer, pubkey, reason),
      );
    }
    return ok;
  }

  /**
   * ADR-097 Phase 3 upstream: report the actual cost of a federated
   * call. Federation doesn't own model pricing, so the integrator calls
   * this after the downstream agent completes.
   *
   * Fans out to:
   *   - spendReporter (if injected) — persists to integrator's backend
   *   - breakerService.recordOutcome (if injected) — feeds the breaker's
   *     in-memory rolling buffer for cost/failure-ratio thresholds
   *
   * Both are no-ops if the corresponding integration isn't wired, so
   * callers don't need to branch on configuration. Negative tokens/usd
   * are clamped to 0 at the breaker layer (anti-credit-inflation); the
   * spend reporter receives the raw values so backends can audit them.
   *
   * Auto-fills `ts` if the caller omits it.
   */
  async reportSpend(input: {
    readonly peerId: string;
    readonly taskId?: string;
    readonly tokensUsed: number;
    readonly usdSpent: number;
    readonly success: boolean;
    readonly ts?: string;
  }): Promise<void> {
    const event: FederationSpendEvent = {
      peerId: input.peerId,
      taskId: input.taskId,
      tokensUsed: input.tokensUsed,
      usdSpent: input.usdSpent,
      success: input.success,
      ts: input.ts ?? new Date().toISOString(),
    };

    // Fan out in parallel — neither side blocks the other. Reporter
    // failures bubble up (integrator's responsibility); breaker is
    // sync-internally so its branch is fire-and-forget safe.
    const tasks: Promise<void>[] = [];
    if (this.spendReporter) {
      tasks.push(this.spendReporter.reportSpend(event));
    }
    if (this.breakerService) {
      this.breakerService.recordOutcome({
        nodeId: event.peerId,
        success: event.success,
        tokensUsed: event.tokensUsed,
        usdSpent: event.usdSpent,
        at: new Date(event.ts),
      });
    }
    if (tasks.length > 0) await Promise.all(tasks);
  }

  /**
   * Founder-bootstrap trust elevation (ADR-164 §3.5.4 — operator escape hatch
   * used in the autopilot Day-1 scenario where a freshly-joined BBS peer
   * needs TRUSTED before organic minInteractions thresholds can accrue).
   *
   * Refuses if the target node is not a registered federation peer (returns
   * null). On success, writes a `trust_level_changed` audit entry tagged
   * `bootstrap_elevation` with the operator-supplied reason, and returns
   * the audit entry so the CLI / caller can print it to stdout.
   */
  async bootstrapElevatePeer(
    nodeId: string,
    newLevel: TrustLevel,
    reason: string,
  ): Promise<BootstrapElevationAuditEntry | null> {
    this.ensureInitialized();
    const peer = this.discovery.getPeer(nodeId);
    if (!peer) return null;

    const entry = this.trustEvaluator.bootstrapElevate(peer, newLevel, reason);

    await this.audit.log('trust_level_changed', {
      targetNodeId: nodeId,
      trustLevel: newLevel,
      metadata: {
        tag: 'bootstrap_elevation',
        previousLevel: entry.previousLevel,
        newLevel: entry.newLevel,
        reason: entry.reason,
        operatorBypass: true,
        timestamp: entry.timestamp,
      },
    });

    return entry;
  }

  /**
   * Operator-initiated reactivate. Used after an integrator-supplied
   * health probe confirms a SUSPENDED peer is healthy, OR as an
   * operator-override escape from EVICTED. Returns true on transition.
   */
  async reactivatePeer(nodeId: string, correlationId?: string): Promise<boolean> {
    this.ensureInitialized();
    const peer = this.discovery.getPeer(nodeId);
    if (!peer) return false;

    const ok = peer.reactivate(correlationId);
    await this.audit.log('trust_level_changed', {
      targetNodeId: nodeId,
      metadata: {
        action: 'reactivate',
        correlationId: correlationId ?? null,
        state: peer.state,
        applied: ok,
      },
    });
    if (ok) {
      // ADR-111 Phase 3 — restore the WG AllowedIPs slice the peer had
      // before suspension. removePeer-then-reactivate stays evicted at the
      // mesh layer because removePeer marks the peer terminally evicted;
      // the operator must reconfigure manually for an evicted peer to rejoin.
      await this.emitWgCommand(peer, (pubkey, meshIP) =>
        this.wgMesh!.restoreAllowedIPs(peer, meshIP, pubkey),
      );
    }
    return ok;
  }

  getSession(sessionId: string): FederationSession | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSessions(): FederationSession[] {
    return Array.from(this.sessions.values()).filter(s => s.active && !s.isExpired());
  }

  private async establishSession(node: FederationNode): Promise<FederationSession> {
    await this.audit.log('handshake_initiated', { targetNodeId: node.nodeId });

    const challenge = await this.handshake.initiateHandshake(node);
    const response = await this.handshake.respondToHandshake(challenge);
    const result = await this.handshake.verifyChallenge(response, node);

    if (!result.success || !result.session) {
      await this.audit.log('handshake_failed', {
        targetNodeId: node.nodeId,
        metadata: { error: result.error },
      });
      throw new Error(`Handshake failed: ${result.error}`);
    }

    this.sessions.set(result.session.sessionId, result.session);

    await this.audit.log('handshake_completed', {
      targetNodeId: node.nodeId,
      sessionId: result.session.sessionId,
      trustLevel: result.session.trustLevel,
    });

    await this.audit.log('session_created', {
      sessionId: result.session.sessionId,
      targetNodeId: node.nodeId,
      trustLevel: result.session.trustLevel,
    });

    return result.session;
  }

  private findSessionByNodeId(nodeId: string): FederationSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.remoteNodeId === nodeId && session.active) {
        return session;
      }
    }
    return undefined;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('FederationCoordinator is not initialized. Call initialize() first.');
    }
  }
}
