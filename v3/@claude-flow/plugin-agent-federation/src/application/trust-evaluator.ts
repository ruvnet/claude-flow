import { TrustLevel, TRUST_TRANSITION_THRESHOLDS } from '../domain/entities/trust-level.js';
import { FederationNode } from '../domain/entities/federation-node.js';
import { type SessionMetrics } from '../domain/entities/federation-session.js';

export interface TrustScoreComponents {
  readonly successRate: number;
  readonly uptime: number;
  readonly threatPenalty: number;
  readonly dataIntegrityScore: number;
}

export interface TrustTransitionResult {
  readonly previousLevel: TrustLevel;
  readonly newLevel: TrustLevel;
  readonly score: number;
  readonly components: TrustScoreComponents;
  readonly reason: string;
  readonly requiresHumanApproval: boolean;
}

export type ImmediateDowngradeReason =
  | 'repeated-threat-detection'
  | 'hmac-verification-failure'
  | 'session-hijack-attempt';

export interface TrustEvaluatorDeps {
  onTrustChange?: (nodeId: string, result: TrustTransitionResult) => void;
}

/**
 * Audit record emitted by `bootstrapElevate`. Captures the bypass intent,
 * the operator-supplied reason, and the before/after trust levels so that
 * downstream audit consumers can flag bootstrap elevations distinctly from
 * organic trust transitions. See ADR-164 §3.5.4.
 */
export interface BootstrapElevationAuditEntry {
  readonly tag: 'bootstrap_elevation';
  readonly nodeId: string;
  readonly previousLevel: TrustLevel;
  readonly newLevel: TrustLevel;
  readonly reason: string;
  readonly timestamp: string;
  readonly operatorBypass: true;
}

export interface ThreatWindow {
  readonly detections: Date[];
  readonly windowMs: number;
  readonly threshold: number;
}

const THREAT_WINDOW_CONFIG: ThreatWindow = {
  detections: [],
  windowMs: 3_600_000,
  threshold: 2,
};

export class TrustEvaluator {
  private readonly deps: TrustEvaluatorDeps;
  private readonly threatWindows: Map<string, Date[]>;

  constructor(deps: TrustEvaluatorDeps = {}) {
    this.deps = deps;
    this.threatWindows = new Map();
  }

  computeScore(metrics: SessionMetrics, uptimeRatio: number): { score: number; components: TrustScoreComponents } {
    const totalAttempted = metrics.messagesSent + metrics.messagesReceived;
    const successRate = totalAttempted > 0
      ? (totalAttempted - metrics.hmacFailures) / totalAttempted
      : 0;

    const uptime = Math.max(0, Math.min(1, uptimeRatio));

    const threatPenalty = this.computeThreatPenalty(metrics.threatDetections, totalAttempted);

    const dataIntegrityScore = totalAttempted > 0
      ? 1 - (metrics.hmacFailures / totalAttempted)
      : 1;

    const score =
      0.4 * successRate +
      0.2 * uptime +
      0.2 * (1 - threatPenalty) +
      0.2 * dataIntegrityScore;

    const components: TrustScoreComponents = {
      successRate,
      uptime,
      threatPenalty,
      dataIntegrityScore,
    };

    return { score: Math.max(0, Math.min(1, score)), components };
  }

  evaluateTransition(
    node: FederationNode,
    metrics: SessionMetrics,
    uptimeRatio: number,
    hasInstitutionalAttestation: boolean = false,
  ): TrustTransitionResult | null {
    const { score, components } = this.computeScore(metrics, uptimeRatio);
    const currentLevel = node.trustLevel;

    node.updateTrustScore(score);

    const upgrade = this.checkUpgrade(currentLevel, score, metrics.totalInteractions, hasInstitutionalAttestation);
    if (upgrade !== null) {
      const result: TrustTransitionResult = {
        previousLevel: currentLevel,
        newLevel: upgrade,
        score,
        components,
        reason: `Score ${score.toFixed(3)} meets upgrade threshold for level ${upgrade}`,
        requiresHumanApproval: upgrade === TrustLevel.PRIVILEGED,
      };

      if (!result.requiresHumanApproval) {
        node.updateTrustLevel(upgrade);
      }

      this.deps.onTrustChange?.(node.nodeId, result);
      return result;
    }

    const downgrade = this.checkDowngrade(currentLevel, score);
    if (downgrade !== null) {
      const result: TrustTransitionResult = {
        previousLevel: currentLevel,
        newLevel: downgrade,
        score,
        components,
        reason: `Score ${score.toFixed(3)} dropped below downgrade threshold for level ${currentLevel}`,
        requiresHumanApproval: false,
      };

      node.updateTrustLevel(downgrade);
      this.deps.onTrustChange?.(node.nodeId, result);
      return result;
    }

    return null;
  }

  downgrade(node: FederationNode, reason: ImmediateDowngradeReason): TrustTransitionResult {
    const previousLevel = node.trustLevel;

    node.updateTrustLevel(TrustLevel.UNTRUSTED);
    node.updateTrustScore(0);

    const result: TrustTransitionResult = {
      previousLevel,
      newLevel: TrustLevel.UNTRUSTED,
      score: 0,
      components: { successRate: 0, uptime: 0, threatPenalty: 1, dataIntegrityScore: 0 },
      reason: `Immediate downgrade: ${reason}`,
      requiresHumanApproval: false,
    };

    this.deps.onTrustChange?.(node.nodeId, result);
    return result;
  }

  /**
   * Founder-bootstrap trust elevation (ADR-164 §3.5.4).
   *
   * Bypasses the organic trust-accrual thresholds (minInteractions: 500 for
   * 2→3, etc.) so a freshly-joined BBS peer can be hand-promoted to
   * TRUSTED on Day 1, before its interaction count has accrued. This is an
   * operator escape hatch — every invocation MUST be recorded as a special
   * `bootstrap_elevation` audit entry so it is distinguishable from organic
   * upgrades. `reason` MUST be a non-empty operator-supplied string.
   *
   * The caller is responsible for refusing to invoke this method when the
   * target node is not a registered federation peer; this function trusts
   * its inputs and only performs the elevation + audit construction.
   *
   * @returns audit entry tagged `bootstrap_elevation` ready to be persisted.
   */
  bootstrapElevate(
    node: FederationNode,
    newLevel: TrustLevel,
    reason: string,
  ): BootstrapElevationAuditEntry {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error('bootstrapElevate requires a non-empty reason');
    }
    if (
      newLevel !== TrustLevel.VERIFIED &&
      newLevel !== TrustLevel.ATTESTED &&
      newLevel !== TrustLevel.TRUSTED &&
      newLevel !== TrustLevel.PRIVILEGED
    ) {
      throw new Error(`bootstrapElevate target level must be VERIFIED..PRIVILEGED, got ${newLevel}`);
    }
    const previousLevel = node.trustLevel;
    node.updateTrustLevel(newLevel);

    const result: TrustTransitionResult = {
      previousLevel,
      newLevel,
      score: 0,
      components: { successRate: 0, uptime: 0, threatPenalty: 0, dataIntegrityScore: 0 },
      reason: `Bootstrap elevation: ${reason}`,
      requiresHumanApproval: false,
    };
    this.deps.onTrustChange?.(node.nodeId, result);

    return {
      tag: 'bootstrap_elevation',
      nodeId: node.nodeId,
      previousLevel,
      newLevel,
      reason: reason.trim(),
      timestamp: new Date().toISOString(),
      operatorBypass: true,
    };
  }

  recordThreatDetection(nodeId: string): boolean {
    const now = new Date();
    const detections = this.threatWindows.get(nodeId) ?? [];
    detections.push(now);

    const windowStart = now.getTime() - THREAT_WINDOW_CONFIG.windowMs;
    const recentDetections = detections.filter(d => d.getTime() > windowStart);
    this.threatWindows.set(nodeId, recentDetections);

    return recentDetections.length >= THREAT_WINDOW_CONFIG.threshold;
  }

  private checkUpgrade(
    currentLevel: TrustLevel,
    score: number,
    totalInteractions: number,
    hasInstitutionalAttestation: boolean,
  ): TrustLevel | null {
    if (currentLevel >= TrustLevel.PRIVILEGED) return null;

    const nextLevel = currentLevel + 1;
    const transitionKey = `${currentLevel}->${nextLevel}`;
    const threshold = TRUST_TRANSITION_THRESHOLDS[transitionKey];

    if (!threshold) return null;

    if (score < threshold.upgradeScore) return null;
    if (totalInteractions < threshold.minInteractions) return null;

    if (nextLevel === TrustLevel.PRIVILEGED && !hasInstitutionalAttestation) {
      return null;
    }

    return nextLevel as TrustLevel;
  }

  private checkDowngrade(currentLevel: TrustLevel, score: number): TrustLevel | null {
    if (currentLevel <= TrustLevel.UNTRUSTED) return null;

    const transitionKey = `${currentLevel - 1}->${currentLevel}`;
    const threshold = TRUST_TRANSITION_THRESHOLDS[transitionKey];

    if (!threshold) return null;

    if (score < threshold.downgradeScore) {
      return (currentLevel - 1) as TrustLevel;
    }

    return null;
  }

  private computeThreatPenalty(threatCount: number, totalMessages: number): number {
    if (totalMessages === 0) return 0;
    const ratio = threatCount / totalMessages;
    return Math.min(1, ratio * 10);
  }
}
