/**
 * TrustEvaluator Tests
 *
 * Validates trust score computation using the formula:
 *   score = 0.4*successRate + 0.2*uptime + 0.2*(1-threatPenalty) + 0.2*dataIntegrityScore
 *
 * Where:
 *   successRate = (sent + received - hmacFailures) / (sent + received)
 *   threatPenalty = min(1, (threatDetections / totalMessages) * 10)
 *   dataIntegrityScore = 1 - (hmacFailures / totalMessages)
 *
 * Also tests trust level transitions with hysteresis, minimum interaction
 * requirements, and automatic downgrades on security events.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TrustEvaluator } from '../../src/application/trust-evaluator.js';
import { FederationNode } from '../../src/domain/entities/federation-node.js';
import { TrustLevel } from '../../src/domain/entities/trust-level.js';
import { type SessionMetrics } from '../../src/domain/entities/federation-session.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    messagesSent: 0,
    messagesReceived: 0,
    piiRedactions: 0,
    threatDetections: 0,
    hmacFailures: 0,
    totalInteractions: 0,
    ...overrides,
  };
}

function makeNode(trustLevel: TrustLevel = TrustLevel.VERIFIED, nodeId = 'node-1'): FederationNode {
  return FederationNode.create({
    nodeId,
    publicKey: 'test-key',
    endpoint: 'ws://test',
    capabilities: {
      agentTypes: [],
      maxConcurrentSessions: 1,
      supportedProtocols: [],
      complianceModes: [],
    },
    metadata: {},
    trustLevel,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrustEvaluator', () => {
  let evaluator: TrustEvaluator;

  beforeEach(() => {
    evaluator = new TrustEvaluator();
  });

  describe('computeScore', () => {
    it('should return 1.0 for perfect metrics', () => {
      const metrics = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        threatDetections: 0,
        hmacFailures: 0,
        totalInteractions: 100,
      });
      const { score } = evaluator.computeScore(metrics, 1.0);
      expect(score).toBeCloseTo(1.0, 5);
    });

    it('should return 0.0 for worst-case metrics', () => {
      // All messages are HMAC failures, threat penalty maxed out, uptime 0
      const metrics = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        threatDetections: 100,
        hmacFailures: 100,
        totalInteractions: 100,
      });
      const { score } = evaluator.computeScore(metrics, 0);
      expect(score).toBeCloseTo(0.0, 5);
    });

    it('should compute expected score for mixed metrics', () => {
      // sent=60, received=40 => total=100
      // successRate = (100 - 5) / 100 = 0.95
      // uptime = 0.8
      // threatPenalty = min(1, (2/100)*10) = 0.2
      // dataIntegrity = 1 - (5/100) = 0.95
      // score = 0.4*0.95 + 0.2*0.8 + 0.2*(1-0.2) + 0.2*0.95
      //       = 0.38 + 0.16 + 0.16 + 0.19 = 0.89
      const metrics = makeMetrics({
        messagesSent: 60,
        messagesReceived: 40,
        threatDetections: 2,
        hmacFailures: 5,
        totalInteractions: 100,
      });
      const { score } = evaluator.computeScore(metrics, 0.8);
      expect(score).toBeCloseTo(0.89, 2);
    });

    it('should weight successRate most heavily at 40%', () => {
      // Two scenarios identical except successRate differs by adding hmacFailures
      const metricsGood = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        hmacFailures: 0,
        totalInteractions: 100,
      });
      const metricsBad = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        hmacFailures: 50, // 50% failure -> successRate drops by 0.5
        totalInteractions: 100,
      });
      const { score: good } = evaluator.computeScore(metricsGood, 0.5);
      const { score: bad } = evaluator.computeScore(metricsBad, 0.5);
      // successRate change: 1.0 -> 0.5, contributes 0.4 * 0.5 = 0.2 difference
      // but dataIntegrity also drops from 1.0 -> 0.5, contributing 0.2 * 0.5 = 0.1
      // total diff ~0.3
      expect(good).toBeGreaterThan(bad);
    });

    it('should inversely weight threatPenalty', () => {
      const noThreat = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        threatDetections: 0,
        totalInteractions: 100,
      });
      const fullThreat = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        threatDetections: 10, // penalty = min(1, (10/100)*10) = 1.0
        totalInteractions: 100,
      });
      const { score: clean } = evaluator.computeScore(noThreat, 0.5);
      const { score: dirty } = evaluator.computeScore(fullThreat, 0.5);
      expect(clean).toBeGreaterThan(dirty);
      // Threat penalty difference: 0.2 * (1-0) - 0.2 * (1-1) = 0.2
      expect(clean - dirty).toBeCloseTo(0.2, 2);
    });

    it('should handle zero-message metrics gracefully', () => {
      const metrics = makeMetrics(); // all zeros
      const { score } = evaluator.computeScore(metrics, 0);
      // successRate=0, uptime=0, threatPenalty=0, dataIntegrity=1
      // 0 + 0 + 0.2*(1-0) + 0.2*1 = 0.4
      expect(score).toBeCloseTo(0.4, 5);
    });

    it('should clamp uptime to [0, 1]', () => {
      const metrics = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        totalInteractions: 100,
      });
      const { score: over } = evaluator.computeScore(metrics, 1.5);
      const { score: normal } = evaluator.computeScore(metrics, 1.0);
      expect(over).toBeCloseTo(normal, 5);
    });

    it('should produce values in [0, 1] range for valid inputs', () => {
      for (let i = 0; i <= 10; i++) {
        const total = 100;
        const failures = Math.floor((i / 10) * total);
        const threats = Math.floor((i / 10) * total);
        const metrics = makeMetrics({
          messagesSent: total / 2,
          messagesReceived: total / 2,
          hmacFailures: failures,
          threatDetections: threats,
          totalInteractions: total,
        });
        const { score } = evaluator.computeScore(metrics, i / 10);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it('should return score components alongside the score', () => {
      const metrics = makeMetrics({
        messagesSent: 80,
        messagesReceived: 20,
        hmacFailures: 10,
        threatDetections: 5,
        totalInteractions: 100,
      });
      const { components } = evaluator.computeScore(metrics, 0.9);
      expect(components.successRate).toBeCloseTo(0.9, 2);
      expect(components.uptime).toBeCloseTo(0.9, 2);
      expect(components.threatPenalty).toBeCloseTo(0.5, 2);
      expect(components.dataIntegrityScore).toBeCloseTo(0.9, 2);
    });
  });

  describe('evaluateTransition', () => {
    it('should upgrade from VERIFIED to ATTESTED when score >= 0.7 and interactions >= 50', () => {
      const node = makeNode(TrustLevel.VERIFIED);
      const metrics = makeMetrics({
        messagesSent: 40,
        messagesReceived: 40,
        totalInteractions: 80,
      });
      // Perfect metrics, high uptime -> score ~1.0, well above 0.7
      const result = evaluator.evaluateTransition(node, metrics, 1.0);
      expect(result).not.toBeNull();
      expect(result!.newLevel).toBe(TrustLevel.ATTESTED);
      expect(node.trustLevel).toBe(TrustLevel.ATTESTED);
    });

    it('should not upgrade when interaction count is below minimum', () => {
      const node = makeNode(TrustLevel.VERIFIED);
      const metrics = makeMetrics({
        messagesSent: 20,
        messagesReceived: 20,
        totalInteractions: 40, // below the 50 threshold for 1->2
      });
      const result = evaluator.evaluateTransition(node, metrics, 1.0);
      expect(result).toBeNull();
      expect(node.trustLevel).toBe(TrustLevel.VERIFIED);
    });

    it('should not upgrade when score is below upgrade threshold', () => {
      const node = makeNode(TrustLevel.VERIFIED);
      // Produce a score below 0.7
      const metrics = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        hmacFailures: 50,
        threatDetections: 20,
        totalInteractions: 100,
      });
      const result = evaluator.evaluateTransition(node, metrics, 0.2);
      // Score will be low due to failures
      expect(node.trustLevel).toBe(TrustLevel.VERIFIED);
    });

    it('should downgrade from ATTESTED to VERIFIED when score < 0.5', () => {
      const node = makeNode(TrustLevel.ATTESTED);
      // Produce a very low score: many failures
      const metrics = makeMetrics({
        messagesSent: 50,
        messagesReceived: 50,
        hmacFailures: 80,
        threatDetections: 30,
        totalInteractions: 100,
      });
      const result = evaluator.evaluateTransition(node, metrics, 0.0);
      expect(result).not.toBeNull();
      expect(result!.newLevel).toBe(TrustLevel.VERIFIED);
      expect(node.trustLevel).toBe(TrustLevel.VERIFIED);
    });

    it('should keep level when score is between downgrade and upgrade thresholds (hysteresis)', () => {
      const node = makeNode(TrustLevel.ATTESTED);
      // Need score >= 0.5 (above downgrade for 1->2) but < 0.85 (below upgrade for 2->3)
      // Also need < 500 interactions to ensure no upgrade to TRUSTED even if score were high
      const metrics = makeMetrics({
        messagesSent: 40,
        messagesReceived: 40,
        hmacFailures: 5,
        threatDetections: 1,
        totalInteractions: 80,
      });
      const result = evaluator.evaluateTransition(node, metrics, 0.7);
      expect(result).toBeNull();
      expect(node.trustLevel).toBe(TrustLevel.ATTESTED);
    });

    it('should upgrade from ATTESTED to TRUSTED when score >= 0.85 and interactions >= 500', () => {
      const node = makeNode(TrustLevel.ATTESTED);
      const metrics = makeMetrics({
        messagesSent: 300,
        messagesReceived: 300,
        totalInteractions: 600,
      });
      const result = evaluator.evaluateTransition(node, metrics, 1.0);
      expect(result).not.toBeNull();
      expect(result!.newLevel).toBe(TrustLevel.TRUSTED);
      expect(node.trustLevel).toBe(TrustLevel.TRUSTED);
    });

    it('should require institutional attestation for upgrade to PRIVILEGED', () => {
      const node = makeNode(TrustLevel.TRUSTED);
      const metrics = makeMetrics({
        messagesSent: 3000,
        messagesReceived: 3000,
        totalInteractions: 6000,
      });
      // Without institutional attestation, upgrade to PRIVILEGED is blocked
      const resultWithout = evaluator.evaluateTransition(node, metrics, 1.0, false);
      expect(resultWithout).toBeNull();
      expect(node.trustLevel).toBe(TrustLevel.TRUSTED);

      // With institutional attestation, upgrade to PRIVILEGED succeeds
      // But requiresHumanApproval should be true, so node is NOT auto-updated
      const resultWith = evaluator.evaluateTransition(node, metrics, 1.0, true);
      expect(resultWith).not.toBeNull();
      expect(resultWith!.newLevel).toBe(TrustLevel.PRIVILEGED);
      expect(resultWith!.requiresHumanApproval).toBe(true);
      // Node trust level should NOT change because human approval is required
      expect(node.trustLevel).toBe(TrustLevel.TRUSTED);
    });

    it('should not upgrade past PRIVILEGED', () => {
      const node = makeNode(TrustLevel.PRIVILEGED);
      const metrics = makeMetrics({
        messagesSent: 50000,
        messagesReceived: 50000,
        totalInteractions: 100000,
      });
      const result = evaluator.evaluateTransition(node, metrics, 1.0, true);
      expect(result).toBeNull();
      expect(node.trustLevel).toBe(TrustLevel.PRIVILEGED);
    });

    it('should invoke onTrustChange callback on transition', () => {
      let callbackNodeId: string | undefined;
      let callbackResult: unknown;
      const evaluatorWithCb = new TrustEvaluator({
        onTrustChange: (nodeId, result) => {
          callbackNodeId = nodeId;
          callbackResult = result;
        },
      });
      const node = makeNode(TrustLevel.VERIFIED, 'cb-node');
      const metrics = makeMetrics({
        messagesSent: 40,
        messagesReceived: 40,
        totalInteractions: 80,
      });
      evaluatorWithCb.evaluateTransition(node, metrics, 1.0);
      expect(callbackNodeId).toBe('cb-node');
      expect(callbackResult).toBeDefined();
    });
  });

  describe('recordThreatDetection', () => {
    it('should return false after a single threat detection', () => {
      const result = evaluator.recordThreatDetection('node-1');
      expect(result).toBe(false);
    });

    it('should return true when 2+ threats are detected within the 1-hour window', () => {
      evaluator.recordThreatDetection('node-1');
      const result = evaluator.recordThreatDetection('node-1');
      expect(result).toBe(true);
    });

    it('should track threat windows per node independently', () => {
      evaluator.recordThreatDetection('node-a');
      evaluator.recordThreatDetection('node-b');
      // Each node only has 1 detection, so neither should trigger
      const a = evaluator.recordThreatDetection('node-a');
      expect(a).toBe(true); // node-a now has 2
      const b = evaluator.recordThreatDetection('node-b');
      expect(b).toBe(true); // node-b now has 2
    });
  });

  describe('downgrade (immediate)', () => {
    it('should downgrade to UNTRUSTED on HMAC verification failure', () => {
      const node = makeNode(TrustLevel.PRIVILEGED);
      const result = evaluator.downgrade(node, 'hmac-verification-failure');
      expect(result.newLevel).toBe(TrustLevel.UNTRUSTED);
      expect(result.previousLevel).toBe(TrustLevel.PRIVILEGED);
      expect(node.trustLevel).toBe(TrustLevel.UNTRUSTED);
      expect(node.trustScore).toBe(0);
    });

    it('should downgrade to UNTRUSTED on repeated threat detection', () => {
      const node = makeNode(TrustLevel.TRUSTED);
      const result = evaluator.downgrade(node, 'repeated-threat-detection');
      expect(result.newLevel).toBe(TrustLevel.UNTRUSTED);
      expect(result.previousLevel).toBe(TrustLevel.TRUSTED);
      expect(node.trustLevel).toBe(TrustLevel.UNTRUSTED);
    });

    it('should downgrade to UNTRUSTED on session hijack attempt', () => {
      const node = makeNode(TrustLevel.ATTESTED);
      const result = evaluator.downgrade(node, 'session-hijack-attempt');
      expect(result.newLevel).toBe(TrustLevel.UNTRUSTED);
      expect(result.previousLevel).toBe(TrustLevel.ATTESTED);
      expect(node.trustLevel).toBe(TrustLevel.UNTRUSTED);
    });

    it('should set score to 0 and threat penalty to 1 in components', () => {
      const node = makeNode(TrustLevel.TRUSTED);
      const result = evaluator.downgrade(node, 'hmac-verification-failure');
      expect(result.score).toBe(0);
      expect(result.components.threatPenalty).toBe(1);
      expect(result.components.successRate).toBe(0);
      expect(result.components.dataIntegrityScore).toBe(0);
    });

    it('should invoke onTrustChange callback on downgrade', () => {
      let called = false;
      const evaluatorWithCb = new TrustEvaluator({
        onTrustChange: () => { called = true; },
      });
      const node = makeNode(TrustLevel.TRUSTED, 'dg-node');
      evaluatorWithCb.downgrade(node, 'hmac-verification-failure');
      expect(called).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // bootstrapElevate — ADR-164 §3.5.4 founder-bootstrap escape hatch
  // -------------------------------------------------------------------------
  describe('bootstrapElevate', () => {
    it('throws on empty reason', () => {
      const node = makeNode(TrustLevel.VERIFIED);
      expect(() => evaluator.bootstrapElevate(node, TrustLevel.TRUSTED, '')).toThrow(/non-empty reason/);
      expect(() => evaluator.bootstrapElevate(node, TrustLevel.TRUSTED, '   ')).toThrow(/non-empty reason/);
    });

    it('bypasses minInteractions to jump VERIFIED → TRUSTED in a single call', () => {
      const node = makeNode(TrustLevel.VERIFIED, 'fresh-peer');
      // Organic upgrade VERIFIED→ATTESTED requires score≥0.7 AND minInteractions=50.
      // ATTESTED→TRUSTED requires score≥0.85 AND minInteractions=500. The
      // bootstrap path must skip both thresholds.
      const entry = evaluator.bootstrapElevate(node, TrustLevel.TRUSTED, 'Day-1 #exec autopilot bring-up');
      expect(entry.tag).toBe('bootstrap_elevation');
      expect(entry.nodeId).toBe('fresh-peer');
      expect(entry.previousLevel).toBe(TrustLevel.VERIFIED);
      expect(entry.newLevel).toBe(TrustLevel.TRUSTED);
      expect(entry.reason).toBe('Day-1 #exec autopilot bring-up');
      expect(entry.operatorBypass).toBe(true);
      expect(node.trustLevel).toBe(TrustLevel.TRUSTED);
    });

    it('emits onTrustChange callback so downstream code can react', () => {
      let observed: { nodeId: string; previous: TrustLevel; next: TrustLevel } | null = null;
      const evaluatorWithCb = new TrustEvaluator({
        onTrustChange: (nodeId, result) => {
          observed = {
            nodeId,
            previous: result.previousLevel,
            next: result.newLevel,
          };
        },
      });
      const node = makeNode(TrustLevel.UNTRUSTED, 'cb-node');
      const entry = evaluatorWithCb.bootstrapElevate(node, TrustLevel.TRUSTED, 'manual elevate for smoke test');
      expect(entry).toBeDefined();
      expect(observed).not.toBeNull();
      expect(observed!.nodeId).toBe('cb-node');
      expect(observed!.previous).toBe(TrustLevel.UNTRUSTED);
      expect(observed!.next).toBe(TrustLevel.TRUSTED);
    });

    it('rejects out-of-range trust levels', () => {
      const node = makeNode(TrustLevel.VERIFIED);
      expect(() => evaluator.bootstrapElevate(node, TrustLevel.UNTRUSTED, 'x')).toThrow(/VERIFIED..PRIVILEGED/);
      expect(() => evaluator.bootstrapElevate(node, 99 as TrustLevel, 'x')).toThrow(/VERIFIED..PRIVILEGED/);
    });

    it('audit entry timestamp is an ISO-8601 string', () => {
      const node = makeNode(TrustLevel.VERIFIED);
      const entry = evaluator.bootstrapElevate(node, TrustLevel.ATTESTED, 'iso check');
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
