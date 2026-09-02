/**
 * @claude-flow/claims - Domain Layer Tests
 * Tests for ADR-016 types, events, and business rules
 */

import { describe, it, expect } from 'vitest';

import {
  // Types
  generateClaimId,
  isActiveClaimStatus,
  getValidStatusTransitions,
  ExtendedClaimStatus,
  ClaimantType,
  StealReason,
  HandoffReason,
  DEFAULT_WORK_STEALING_CONFIG,
  DEFAULT_LOAD_BALANCING_CONFIG,
} from '../src/domain/types.js';

import {
  // Events
  createClaimCreatedEvent,
  createClaimReleasedEvent,
  createClaimStatusChangedEvent,
  createHandoffRequestedEvent,
  createIssueMarkedStealableEvent,
  AllClaimEvents,
  AllExtendedClaimEvents,
} from '../src/domain/events.js';

// =============================================================================
// Domain Types Tests
// =============================================================================

describe('Domain Types (ADR-016)', () => {
  describe('ClaimId Generation', () => {
    it('should generate unique claim IDs', () => {
      const id1 = generateClaimId();
      const id2 = generateClaimId();

      expect(id1).toMatch(/^claim-/);
      expect(id2).toMatch(/^claim-/);
      expect(id1).not.toBe(id2);
    });

    it('should generate IDs with timestamp component', () => {
      const id = generateClaimId();
      const parts = id.split('-');

      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0]).toBe('claim');
    });
  });

  describe('ClaimStatus', () => {
    it('should include all ADR-016 statuses', () => {
      const validStatuses: ExtendedClaimStatus[] = [
        'active',
        'paused',
        'handoff-pending',
        'review-requested',
        'blocked',
        'stealable',
        'completed',
      ];

      validStatuses.forEach((status) => {
        expect(typeof status).toBe('string');
      });
    });

    it('should correctly identify active claim statuses', () => {
      expect(isActiveClaimStatus('active')).toBe(true);
      expect(isActiveClaimStatus('paused')).toBe(true);
      expect(isActiveClaimStatus('blocked')).toBe(true);
      expect(isActiveClaimStatus('handoff-pending')).toBe(true);
      expect(isActiveClaimStatus('review-requested')).toBe(true);
      expect(isActiveClaimStatus('stealable')).toBe(false);
      expect(isActiveClaimStatus('completed')).toBe(false);
    });
  });

  describe('Status Transitions', () => {
    it('should define valid transitions from active', () => {
      const transitions = getValidStatusTransitions('active');

      expect(transitions).toContain('paused');
      expect(transitions).toContain('blocked');
      expect(transitions).toContain('handoff-pending');
      expect(transitions).toContain('review-requested');
      expect(transitions).toContain('stealable');
      expect(transitions).toContain('completed');
    });

    it('should allow no transitions from completed (terminal state)', () => {
      const transitions = getValidStatusTransitions('completed');

      expect(transitions.length).toBe(0);
    });

    it('should allow stealable to transition to active or completed', () => {
      const transitions = getValidStatusTransitions('stealable');

      expect(transitions).toContain('active');
      expect(transitions).toContain('completed');
      expect(transitions.length).toBe(2);
    });
  });

  describe('StealReason', () => {
    it('should include all ADR-016 steal reasons', () => {
      const validReasons: StealReason[] = [
        'timeout',
        'overloaded',
        'blocked',
        'voluntary',
        'rebalancing',
        'abandoned',
        'priority-change',
      ];

      expect(validReasons.length).toBe(7);
    });
  });

  describe('HandoffReason', () => {
    it('should include all ADR-016 handoff reasons', () => {
      const validReasons: HandoffReason[] = [
        'capacity',
        'expertise',
        'shift-change',
        'escalation',
        'voluntary',
        'rebalancing',
      ];

      expect(validReasons.length).toBe(6);
    });
  });

  describe('Default Configurations', () => {
    it('should have valid work stealing config defaults', () => {
      expect(DEFAULT_WORK_STEALING_CONFIG.staleThresholdMinutes).toBe(30);
      expect(DEFAULT_WORK_STEALING_CONFIG.blockedThresholdMinutes).toBe(60);
      expect(DEFAULT_WORK_STEALING_CONFIG.gracePeriodMinutes).toBe(10);
      expect(DEFAULT_WORK_STEALING_CONFIG.contestWindowMinutes).toBe(5);
      expect(DEFAULT_WORK_STEALING_CONFIG.minProgressToProtect).toBe(75);
    });

    it('should have valid load balancing config defaults', () => {
      expect(DEFAULT_LOAD_BALANCING_CONFIG.enabled).toBe(true);
      expect(DEFAULT_LOAD_BALANCING_CONFIG.overloadThreshold).toBe(90);
      expect(DEFAULT_LOAD_BALANCING_CONFIG.underloadThreshold).toBe(30);
      expect(DEFAULT_LOAD_BALANCING_CONFIG.rebalanceThreshold).toBe(40);
      expect(DEFAULT_LOAD_BALANCING_CONFIG.selectionStrategy).toBe('capability-match');
    });
  });
});

// =============================================================================
// Domain Events Tests
// =============================================================================

describe('Domain Events (ADR-016)', () => {
  const mockClaimant = {
    id: 'agent-001',
    type: 'agent' as ClaimantType,
    name: 'Test Agent',
  };

  describe('Claim Lifecycle Events', () => {
    it('should create a valid ClaimCreatedEvent', () => {
      const event = createClaimCreatedEvent(
        'claim-123',
        'issue-456',
        mockClaimant,
        Date.now() + 3600000
      );

      expect(event.type).toBe('claim:created');
      expect(event.aggregateType).toBe('claim');
      expect(event.payload.claimId).toBe('claim-123');
      expect(event.payload.issueId).toBe('issue-456');
      expect(event.payload.claimant).toEqual(mockClaimant);
      expect(event.id).toMatch(/^claim-evt-/);
    });

    it('should create a valid ClaimReleasedEvent', () => {
      const event = createClaimReleasedEvent(
        'claim-123',
        'issue-456',
        mockClaimant,
        'Completed work'
      );

      expect(event.type).toBe('claim:released');
      expect(event.payload.claimId).toBe('claim-123');
      expect(event.payload.reason).toBe('Completed work');
    });

    it('should create a valid ClaimStatusChangedEvent', () => {
      const event = createClaimStatusChangedEvent(
        'claim-123',
        'issue-456',
        'active' as any,
        'paused' as any,
        'Taking a break'
      );

      expect(event.type).toBe('claim:status-changed');
      expect(event.payload.previousStatus).toBe('active');
      expect(event.payload.newStatus).toBe('paused');
      expect(event.payload.note).toBe('Taking a break');
    });
  });

  describe('Handoff Events', () => {
    it('should create a valid HandoffRequestedEvent', () => {
      const targetClaimant = {
        id: 'agent-002',
        type: 'agent' as ClaimantType,
        name: 'Target Agent',
      };

      const event = createHandoffRequestedEvent(
        'claim-123',
        'issue-456',
        'handoff-001',
        mockClaimant,
        targetClaimant,
        'Need expert help'
      );

      expect(event.type).toBe('handoff:requested');
      expect(event.payload.from).toEqual(mockClaimant);
      expect(event.payload.to).toEqual(targetClaimant);
      expect(event.payload.reason).toBe('Need expert help');
    });
  });

  describe('Work Stealing Events (ADR-016)', () => {
    it('should create a valid IssueMarkedStealableEvent', () => {
      const event = createIssueMarkedStealableEvent(
        'claim-123',
        'issue-456',
        mockClaimant,
        'timeout',
        300000, // 5 minutes grace period
        'medium',
        true
      );

      expect(event.type).toBe('steal:issue-marked-stealable');
      expect(event.payload.reason).toBe('timeout');
      expect(event.payload.gracePeriodMs).toBe(300000);
      expect(event.payload.requiresContest).toBe(true);
    });
  });

  describe('Event Metadata', () => {
    it('should include timestamp on all events', () => {
      const beforeTimestamp = Date.now();
      const event = createClaimCreatedEvent(
        'claim-123',
        'issue-456',
        mockClaimant
      );
      const afterTimestamp = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(event.timestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    it('should include version number on all events', () => {
      const event = createClaimCreatedEvent(
        'claim-123',
        'issue-456',
        mockClaimant
      );

      expect(event.version).toBeDefined();
      expect(typeof event.version).toBe('number');
    });

    it('should include source on all events', () => {
      const event = createClaimCreatedEvent(
        'claim-123',
        'issue-456',
        mockClaimant
      );

      expect(event.source).toBeDefined();
      expect(typeof event.source).toBe('string');
    });
  });
});
