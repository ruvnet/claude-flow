/**
 * V3 Claude-Flow Claims Events Unit Tests
 *
 * London School TDD - Behavior Verification
 * Tests event emission, event data correctness, and event ordering
 *
 * @module v3/claims/tests/events
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMock, type MockedInterface, InteractionRecorder } from '../../testing/src/helpers/create-mock.js';

// =============================================================================
// Event Types
// =============================================================================

type ClaimEventType =
  | 'IssueClaimed'
  | 'IssueReleased'
  | 'HandoffRequested'
  | 'HandoffAccepted'
  | 'HandoffRejected'
  | 'ClaimStatusUpdated'
  | 'ClaimExpired'
  | 'WorkMarkedStealable'
  | 'WorkStolen'
  | 'StealContested'
  | 'StealContestResolved'
  | 'StaleWorkDetected'
  | 'LoadRebalanced'
  | 'ImbalanceDetected';

interface ClaimEvent<T = unknown> {
  id: string;
  type: ClaimEventType;
  timestamp: Date;
  source: string;
  correlationId?: string;
  causationId?: string;
  payload: T;
  metadata: EventMetadata;
}

interface EventMetadata {
  version: number;
  schemaVersion: string;
  environment: string;
  aggregateId: string;
  aggregateType: string;
  sequenceNumber: number;
}

// =============================================================================
// Event Payloads
// =============================================================================

interface IssueClaimedPayload {
  issueId: string;
  claimant: Claimant;
  claimedAt: Date;
  expiresAt: Date;
}

interface IssueReleasedPayload {
  issueId: string;
  releasedBy: Claimant;
  releasedAt: Date;
  reason?: string;
}

interface HandoffRequestedPayload {
  issueId: string;
  from: Claimant;
  to: Claimant;
  reason: string;
  requestedAt: Date;
}

interface HandoffAcceptedPayload {
  issueId: string;
  from: Claimant;
  to: Claimant;
  acceptedAt: Date;
}

interface HandoffRejectedPayload {
  issueId: string;
  rejectedBy: Claimant;
  reason: string;
  rejectedAt: Date;
}

interface ClaimStatusUpdatedPayload {
  issueId: string;
  previousStatus: string;
  newStatus: string;
  updatedAt: Date;
  updatedBy: Claimant;
}

interface ClaimExpiredPayload {
  issueId: string;
  expiredAt: Date;
  originalClaimant: Claimant;
}

interface WorkStolenPayload {
  issueId: string;
  from: Claimant;
  to: Claimant;
  stolenAt: Date;
}

interface LoadRebalancedPayload {
  actions: RebalanceAction[];
  movedClaims: number;
  overloadedCount: number;
  underloadedCount: number;
  rebalancedAt: Date;
}

interface ImbalanceDetectedPayload {
  severity: string;
  imbalanceScore: number;
  overloadedAgents: string[];
  underloadedAgents: string[];
  detectedAt: Date;
}

// =============================================================================
// Domain Types (reused from other tests)
// =============================================================================

interface Claimant {
  type: 'agent' | 'human';
  id: string;
  agentType?: string;
  humanId?: string;
}

interface Claim {
  issueId: string;
  claimant: Claimant;
  status: string;
  claimedAt: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
}

interface RebalanceAction {
  type: 'move' | 'reassign' | 'defer';
  claim: { issueId: string };
  fromAgent: string;
  toAgent: string;
  reason: string;
}

// =============================================================================
// Interfaces (Collaborators)
// =============================================================================

interface IEventStore {
  append(event: ClaimEvent): Promise<void>;
  appendBatch(events: ClaimEvent[]): Promise<void>;
  getEvents(aggregateId: string, options?: EventQueryOptions): Promise<ClaimEvent[]>;
  getEventsByType(type: ClaimEventType, options?: EventQueryOptions): Promise<ClaimEvent[]>;
  getLatestEvent(aggregateId: string): Promise<ClaimEvent | null>;
}

interface EventQueryOptions {
  fromSequence?: number;
  toSequence?: number;
  limit?: number;
  fromDate?: Date;
  toDate?: Date;
}

interface IEventPublisher {
  publish(event: ClaimEvent): Promise<void>;
  publishBatch(events: ClaimEvent[]): Promise<void>;
  subscribe(type: ClaimEventType, handler: EventHandler): void;
  unsubscribe(type: ClaimEventType, handler: EventHandler): void;
}

type EventHandler = (event: ClaimEvent) => void | Promise<void>;

interface IEventIdGenerator {
  generate(): string;
}

interface IClock {
  now(): Date;
}

interface ISequenceGenerator {
  next(aggregateId: string): number;
}

// =============================================================================
// Event Emitter Service
// =============================================================================

interface EventEmitterConfig {
  environment: string;
  schemaVersion: string;
  enableBatching: boolean;
  batchSize: number;
  batchTimeoutMs: number;
}

const DEFAULT_EVENT_CONFIG: EventEmitterConfig = {
  environment: 'test',
  schemaVersion: '1.0.0',
  enableBatching: false,
  batchSize: 10,
  batchTimeoutMs: 100,
};

class ClaimEventEmitter {
  private pendingEvents: ClaimEvent[] = [];
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly eventStore: IEventStore,
    private readonly eventPublisher: IEventPublisher,
    private readonly idGenerator: IEventIdGenerator,
    private readonly clock: IClock,
    private readonly sequenceGenerator: ISequenceGenerator,
    private readonly config: EventEmitterConfig = DEFAULT_EVENT_CONFIG
  ) {}

  async emitIssueClaimed(
    issueId: string,
    claimant: Claimant,
    expiresAt: Date,
    correlationId?: string
  ): Promise<ClaimEvent<IssueClaimedPayload>> {
    const event = this.createEvent<IssueClaimedPayload>(
      'IssueClaimed',
      issueId,
      'Claim',
      {
        issueId,
        claimant,
        claimedAt: this.clock.now(),
        expiresAt,
      },
      correlationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitIssueReleased(
    issueId: string,
    releasedBy: Claimant,
    reason?: string,
    correlationId?: string
  ): Promise<ClaimEvent<IssueReleasedPayload>> {
    const event = this.createEvent<IssueReleasedPayload>(
      'IssueReleased',
      issueId,
      'Claim',
      {
        issueId,
        releasedBy,
        releasedAt: this.clock.now(),
        reason,
      },
      correlationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitHandoffRequested(
    issueId: string,
    from: Claimant,
    to: Claimant,
    reason: string,
    correlationId?: string
  ): Promise<ClaimEvent<HandoffRequestedPayload>> {
    const event = this.createEvent<HandoffRequestedPayload>(
      'HandoffRequested',
      issueId,
      'Claim',
      {
        issueId,
        from,
        to,
        reason,
        requestedAt: this.clock.now(),
      },
      correlationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitHandoffAccepted(
    issueId: string,
    from: Claimant,
    to: Claimant,
    causationId?: string,
    correlationId?: string
  ): Promise<ClaimEvent<HandoffAcceptedPayload>> {
    const event = this.createEvent<HandoffAcceptedPayload>(
      'HandoffAccepted',
      issueId,
      'Claim',
      {
        issueId,
        from,
        to,
        acceptedAt: this.clock.now(),
      },
      correlationId,
      causationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitHandoffRejected(
    issueId: string,
    rejectedBy: Claimant,
    reason: string,
    causationId?: string,
    correlationId?: string
  ): Promise<ClaimEvent<HandoffRejectedPayload>> {
    const event = this.createEvent<HandoffRejectedPayload>(
      'HandoffRejected',
      issueId,
      'Claim',
      {
        issueId,
        rejectedBy,
        reason,
        rejectedAt: this.clock.now(),
      },
      correlationId,
      causationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitClaimStatusUpdated(
    issueId: string,
    previousStatus: string,
    newStatus: string,
    updatedBy: Claimant,
    correlationId?: string
  ): Promise<ClaimEvent<ClaimStatusUpdatedPayload>> {
    const event = this.createEvent<ClaimStatusUpdatedPayload>(
      'ClaimStatusUpdated',
      issueId,
      'Claim',
      {
        issueId,
        previousStatus,
        newStatus,
        updatedAt: this.clock.now(),
        updatedBy,
      },
      correlationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitClaimExpired(
    issueId: string,
    originalClaimant: Claimant,
    correlationId?: string
  ): Promise<ClaimEvent<ClaimExpiredPayload>> {
    const event = this.createEvent<ClaimExpiredPayload>(
      'ClaimExpired',
      issueId,
      'Claim',
      {
        issueId,
        expiredAt: this.clock.now(),
        originalClaimant,
      },
      correlationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitWorkStolen(
    issueId: string,
    from: Claimant,
    to: Claimant,
    correlationId?: string
  ): Promise<ClaimEvent<WorkStolenPayload>> {
    const event = this.createEvent<WorkStolenPayload>(
      'WorkStolen',
      issueId,
      'Claim',
      {
        issueId,
        from,
        to,
        stolenAt: this.clock.now(),
      },
      correlationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitLoadRebalanced(
    actions: RebalanceAction[],
    overloadedCount: number,
    underloadedCount: number,
    correlationId?: string
  ): Promise<ClaimEvent<LoadRebalancedPayload>> {
    const event = this.createEvent<LoadRebalancedPayload>(
      'LoadRebalanced',
      'load-balancer',
      'LoadBalancer',
      {
        actions,
        movedClaims: actions.filter((a) => a.type === 'move' || a.type === 'reassign').length,
        overloadedCount,
        underloadedCount,
        rebalancedAt: this.clock.now(),
      },
      correlationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  async emitImbalanceDetected(
    severity: string,
    imbalanceScore: number,
    overloadedAgents: string[],
    underloadedAgents: string[],
    correlationId?: string
  ): Promise<ClaimEvent<ImbalanceDetectedPayload>> {
    const event = this.createEvent<ImbalanceDetectedPayload>(
      'ImbalanceDetected',
      'load-balancer',
      'LoadBalancer',
      {
        severity,
        imbalanceScore,
        overloadedAgents,
        underloadedAgents,
        detectedAt: this.clock.now(),
      },
      correlationId
    );

    await this.persistAndPublish(event);
    return event;
  }

  // Batch emission for multiple events
  async emitBatch(events: ClaimEvent[]): Promise<void> {
    await this.eventStore.appendBatch(events);
    await this.eventPublisher.publishBatch(events);
  }

  private createEvent<T>(
    type: ClaimEventType,
    aggregateId: string,
    aggregateType: string,
    payload: T,
    correlationId?: string,
    causationId?: string
  ): ClaimEvent<T> {
    return {
      id: this.idGenerator.generate(),
      type,
      timestamp: this.clock.now(),
      source: 'claims-service',
      correlationId,
      causationId,
      payload,
      metadata: {
        version: 1,
        schemaVersion: this.config.schemaVersion,
        environment: this.config.environment,
        aggregateId,
        aggregateType,
        sequenceNumber: this.sequenceGenerator.next(aggregateId),
      },
    };
  }

  private async persistAndPublish(event: ClaimEvent): Promise<void> {
    if (this.config.enableBatching) {
      this.pendingEvents.push(event);
      if (this.pendingEvents.length >= this.config.batchSize) {
        await this.flushBatch();
      } else if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(
          () => this.flushBatch(),
          this.config.batchTimeoutMs
        );
      }
    } else {
      await this.eventStore.append(event);
      await this.eventPublisher.publish(event);
    }
  }

  async flushBatch(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    if (this.pendingEvents.length > 0) {
      const events = [...this.pendingEvents];
      this.pendingEvents = [];
      await this.emitBatch(events);
    }
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('ClaimEventEmitter', () => {
  let emitter: ClaimEventEmitter;
  let mockEventStore: MockedInterface<IEventStore>;
  let mockEventPublisher: MockedInterface<IEventPublisher>;
  let mockIdGenerator: MockedInterface<IEventIdGenerator>;
  let mockClock: MockedInterface<IClock>;
  let mockSequenceGenerator: MockedInterface<ISequenceGenerator>;

  const baseDate = new Date('2024-01-15T10:00:00Z');

  const agentClaimant: Claimant = {
    type: 'agent',
    id: 'coder-1',
    agentType: 'coder',
  };

  const humanClaimant: Claimant = {
    type: 'human',
    id: 'user-123',
    humanId: 'john.doe',
  };

  const reviewerClaimant: Claimant = {
    type: 'agent',
    id: 'reviewer-1',
    agentType: 'reviewer',
  };

  beforeEach(() => {
    mockEventStore = createMock<IEventStore>();
    mockEventPublisher = createMock<IEventPublisher>();
    mockIdGenerator = createMock<IEventIdGenerator>();
    mockClock = createMock<IClock>();
    mockSequenceGenerator = createMock<ISequenceGenerator>();

    // Default mock behaviors
    mockClock.now.mockReturnValue(baseDate);
    mockIdGenerator.generate.mockReturnValue('event-123');
    mockSequenceGenerator.next.mockReturnValue(1);
    mockEventStore.append.mockResolvedValue(undefined);
    mockEventStore.appendBatch.mockResolvedValue(undefined);
    mockEventPublisher.publish.mockResolvedValue(undefined);
    mockEventPublisher.publishBatch.mockResolvedValue(undefined);

    emitter = new ClaimEventEmitter(
      mockEventStore,
      mockEventPublisher,
      mockIdGenerator,
      mockClock,
      mockSequenceGenerator
    );
  });

  // ===========================================================================
  // IssueClaimed event tests
  // ===========================================================================

  describe('emitIssueClaimed', () => {
    it('should emit event with correct data', async () => {
      // Given
      const expiresAt = new Date('2024-01-16T10:00:00Z');

      // When
      const event = await emitter.emitIssueClaimed('issue-1', agentClaimant, expiresAt);

      // Then
      expect(event.type).toBe('IssueClaimed');
      expect(event.payload.issueId).toBe('issue-1');
      expect(event.payload.claimant).toEqual(agentClaimant);
      expect(event.payload.claimedAt).toEqual(baseDate);
      expect(event.payload.expiresAt).toEqual(expiresAt);
    });

    it('should persist event to store', async () => {
      // Given
      const expiresAt = new Date('2024-01-16T10:00:00Z');

      // When
      await emitter.emitIssueClaimed('issue-1', agentClaimant, expiresAt);

      // Then
      expect(mockEventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IssueClaimed',
          payload: expect.objectContaining({ issueId: 'issue-1' }),
        })
      );
    });

    it('should publish event to subscribers', async () => {
      // Given
      const expiresAt = new Date('2024-01-16T10:00:00Z');

      // When
      await emitter.emitIssueClaimed('issue-1', agentClaimant, expiresAt);

      // Then
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IssueClaimed',
        })
      );
    });

    it('should include correlation ID when provided', async () => {
      // Given
      const expiresAt = new Date('2024-01-16T10:00:00Z');
      const correlationId = 'corr-123';

      // When
      const event = await emitter.emitIssueClaimed('issue-1', agentClaimant, expiresAt, correlationId);

      // Then
      expect(event.correlationId).toBe(correlationId);
    });

    it('should include correct metadata', async () => {
      // Given
      const expiresAt = new Date('2024-01-16T10:00:00Z');

      // When
      const event = await emitter.emitIssueClaimed('issue-1', agentClaimant, expiresAt);

      // Then
      expect(event.metadata.aggregateId).toBe('issue-1');
      expect(event.metadata.aggregateType).toBe('Claim');
      expect(event.metadata.schemaVersion).toBe('1.0.0');
      expect(event.metadata.sequenceNumber).toBe(1);
    });
  });

  // ===========================================================================
  // IssueReleased event tests
  // ===========================================================================

  describe('emitIssueReleased', () => {
    it('should emit event with correct data', async () => {
      // When
      const event = await emitter.emitIssueReleased('issue-1', agentClaimant, 'Work completed');

      // Then
      expect(event.type).toBe('IssueReleased');
      expect(event.payload.issueId).toBe('issue-1');
      expect(event.payload.releasedBy).toEqual(agentClaimant);
      expect(event.payload.reason).toBe('Work completed');
      expect(event.payload.releasedAt).toEqual(baseDate);
    });

    it('should handle optional reason', async () => {
      // When
      const event = await emitter.emitIssueReleased('issue-1', agentClaimant);

      // Then
      expect(event.payload.reason).toBeUndefined();
    });
  });

  // ===========================================================================
  // HandoffRequested event tests
  // ===========================================================================

  describe('emitHandoffRequested', () => {
    it('should emit event with correct handoff details', async () => {
      // When
      const event = await emitter.emitHandoffRequested(
        'issue-1',
        agentClaimant,
        humanClaimant,
        'Need human review'
      );

      // Then
      expect(event.type).toBe('HandoffRequested');
      expect(event.payload.from).toEqual(agentClaimant);
      expect(event.payload.to).toEqual(humanClaimant);
      expect(event.payload.reason).toBe('Need human review');
      expect(event.payload.requestedAt).toEqual(baseDate);
    });
  });

  // ===========================================================================
  // HandoffAccepted event tests
  // ===========================================================================

  describe('emitHandoffAccepted', () => {
    it('should emit event with causation ID linking to request', async () => {
      // Given
      const causationId = 'handoff-request-event-id';
      const correlationId = 'corr-123';

      // When
      const event = await emitter.emitHandoffAccepted(
        'issue-1',
        agentClaimant,
        humanClaimant,
        causationId,
        correlationId
      );

      // Then
      expect(event.type).toBe('HandoffAccepted');
      expect(event.causationId).toBe(causationId);
      expect(event.correlationId).toBe(correlationId);
      expect(event.payload.from).toEqual(agentClaimant);
      expect(event.payload.to).toEqual(humanClaimant);
    });
  });

  // ===========================================================================
  // HandoffRejected event tests
  // ===========================================================================

  describe('emitHandoffRejected', () => {
    it('should emit event with rejection reason', async () => {
      // When
      const event = await emitter.emitHandoffRejected(
        'issue-1',
        humanClaimant,
        'Too busy to take over'
      );

      // Then
      expect(event.type).toBe('HandoffRejected');
      expect(event.payload.rejectedBy).toEqual(humanClaimant);
      expect(event.payload.reason).toBe('Too busy to take over');
    });
  });

  // ===========================================================================
  // ClaimStatusUpdated event tests
  // ===========================================================================

  describe('emitClaimStatusUpdated', () => {
    it('should emit event with status transition details', async () => {
      // When
      const event = await emitter.emitClaimStatusUpdated(
        'issue-1',
        'active',
        'pending_handoff',
        agentClaimant
      );

      // Then
      expect(event.type).toBe('ClaimStatusUpdated');
      expect(event.payload.previousStatus).toBe('active');
      expect(event.payload.newStatus).toBe('pending_handoff');
      expect(event.payload.updatedBy).toEqual(agentClaimant);
    });
  });

  // ===========================================================================
  // ClaimExpired event tests
  // ===========================================================================

  describe('emitClaimExpired', () => {
    it('should emit event with expiration details', async () => {
      // When
      const event = await emitter.emitClaimExpired('issue-1', agentClaimant);

      // Then
      expect(event.type).toBe('ClaimExpired');
      expect(event.payload.issueId).toBe('issue-1');
      expect(event.payload.originalClaimant).toEqual(agentClaimant);
      expect(event.payload.expiredAt).toEqual(baseDate);
    });
  });

  // ===========================================================================
  // WorkStolen event tests
  // ===========================================================================

  describe('emitWorkStolen', () => {
    it('should emit event with theft details', async () => {
      // When
      const event = await emitter.emitWorkStolen(
        'issue-1',
        agentClaimant,
        reviewerClaimant
      );

      // Then
      expect(event.type).toBe('WorkStolen');
      expect(event.payload.from).toEqual(agentClaimant);
      expect(event.payload.to).toEqual(reviewerClaimant);
      expect(event.payload.stolenAt).toEqual(baseDate);
    });
  });

  // ===========================================================================
  // LoadRebalanced event tests
  // ===========================================================================

  describe('emitLoadRebalanced', () => {
    it('should emit event with rebalance summary', async () => {
      // Given
      const actions: RebalanceAction[] = [
        { type: 'move', claim: { issueId: 'issue-1' }, fromAgent: 'coder-1', toAgent: 'coder-2', reason: 'Load' },
        { type: 'reassign', claim: { issueId: 'issue-2' }, fromAgent: 'coder-1', toAgent: 'coder-3', reason: 'Load' },
      ];

      // When
      const event = await emitter.emitLoadRebalanced(actions, 2, 3);

      // Then
      expect(event.type).toBe('LoadRebalanced');
      expect(event.payload.actions).toEqual(actions);
      expect(event.payload.movedClaims).toBe(2);
      expect(event.payload.overloadedCount).toBe(2);
      expect(event.payload.underloadedCount).toBe(3);
    });

    it('should correctly count moved claims excluding deferred', async () => {
      // Given
      const actions: RebalanceAction[] = [
        { type: 'move', claim: { issueId: 'issue-1' }, fromAgent: 'coder-1', toAgent: 'coder-2', reason: 'Load' },
        { type: 'defer', claim: { issueId: 'issue-2' }, fromAgent: 'coder-1', toAgent: 'coder-3', reason: 'Wait' },
        { type: 'reassign', claim: { issueId: 'issue-3' }, fromAgent: 'coder-1', toAgent: 'coder-4', reason: 'Load' },
      ];

      // When
      const event = await emitter.emitLoadRebalanced(actions, 1, 3);

      // Then
      expect(event.payload.movedClaims).toBe(2); // move + reassign, not defer
    });
  });

  // ===========================================================================
  // ImbalanceDetected event tests
  // ===========================================================================

  describe('emitImbalanceDetected', () => {
    it('should emit event with imbalance details', async () => {
      // When
      const event = await emitter.emitImbalanceDetected(
        'severe',
        75.5,
        ['coder-1', 'coder-2'],
        ['reviewer-1', 'tester-1']
      );

      // Then
      expect(event.type).toBe('ImbalanceDetected');
      expect(event.payload.severity).toBe('severe');
      expect(event.payload.imbalanceScore).toBe(75.5);
      expect(event.payload.overloadedAgents).toEqual(['coder-1', 'coder-2']);
      expect(event.payload.underloadedAgents).toEqual(['reviewer-1', 'tester-1']);
    });
  });

  // ===========================================================================
  // Event ordering tests
  // ===========================================================================

  describe('event ordering', () => {
    it('should persist before publishing', async () => {
      // Given
      const callOrder: string[] = [];
      mockEventStore.append.mockImplementation(async () => {
        callOrder.push('persist');
      });
      mockEventPublisher.publish.mockImplementation(async () => {
        callOrder.push('publish');
      });

      // When
      await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());

      // Then
      expect(callOrder).toEqual(['persist', 'publish']);
    });

    it('should generate unique IDs for each event', async () => {
      // Given
      let idCounter = 0;
      mockIdGenerator.generate.mockImplementation(() => `event-${++idCounter}`);

      // When
      const event1 = await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());
      const event2 = await emitter.emitIssueReleased('issue-1', agentClaimant);

      // Then
      expect(event1.id).toBe('event-1');
      expect(event2.id).toBe('event-2');
      expect(event1.id).not.toBe(event2.id);
    });

    it('should increment sequence numbers per aggregate', async () => {
      // Given
      let seq = 0;
      mockSequenceGenerator.next.mockImplementation(() => ++seq);

      // When
      await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());
      await emitter.emitClaimStatusUpdated('issue-1', 'active', 'pending_handoff', agentClaimant);
      await emitter.emitIssueReleased('issue-1', agentClaimant);

      // Then
      expect(mockSequenceGenerator.next).toHaveBeenCalledTimes(3);
    });

    it('should maintain causal chain via causation and correlation IDs', async () => {
      // Given
      let idCounter = 0;
      mockIdGenerator.generate.mockImplementation(() => `event-${++idCounter}`);
      const correlationId = 'workflow-123';

      // When - Simulate handoff workflow
      const requestEvent = await emitter.emitHandoffRequested(
        'issue-1',
        agentClaimant,
        humanClaimant,
        'Need review',
        correlationId
      );

      const acceptEvent = await emitter.emitHandoffAccepted(
        'issue-1',
        agentClaimant,
        humanClaimant,
        requestEvent.id, // causationId
        correlationId
      );

      // Then
      expect(requestEvent.correlationId).toBe(correlationId);
      expect(acceptEvent.correlationId).toBe(correlationId);
      expect(acceptEvent.causationId).toBe(requestEvent.id);
    });

    it('should use consistent timestamps within a workflow', async () => {
      // Given
      let timeOffset = 0;
      mockClock.now.mockImplementation(() => new Date(baseDate.getTime() + timeOffset));

      // When
      const event1 = await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());
      timeOffset += 1000;
      const event2 = await emitter.emitIssueReleased('issue-1', agentClaimant);

      // Then
      expect(event1.timestamp.getTime()).toBeLessThan(event2.timestamp.getTime());
    });
  });

  // ===========================================================================
  // Batch emission tests
  // ===========================================================================

  describe('batch emission', () => {
    it('should batch events when batching enabled', async () => {
      // Given
      const batchConfig: EventEmitterConfig = {
        ...DEFAULT_EVENT_CONFIG,
        enableBatching: true,
        batchSize: 3,
        batchTimeoutMs: 1000,
      };
      emitter = new ClaimEventEmitter(
        mockEventStore,
        mockEventPublisher,
        mockIdGenerator,
        mockClock,
        mockSequenceGenerator,
        batchConfig
      );

      // When - Emit 3 events (batch size)
      await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());
      await emitter.emitIssueClaimed('issue-2', agentClaimant, new Date());
      await emitter.emitIssueClaimed('issue-3', agentClaimant, new Date());

      // Then - Should trigger batch
      expect(mockEventStore.appendBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'IssueClaimed' }),
        ])
      );
    });

    it('should emit batch via emitBatch directly', async () => {
      // Given
      const events: ClaimEvent[] = [
        {
          id: 'event-1',
          type: 'IssueClaimed',
          timestamp: baseDate,
          source: 'test',
          payload: {},
          metadata: {
            version: 1,
            schemaVersion: '1.0.0',
            environment: 'test',
            aggregateId: 'issue-1',
            aggregateType: 'Claim',
            sequenceNumber: 1,
          },
        },
        {
          id: 'event-2',
          type: 'IssueReleased',
          timestamp: baseDate,
          source: 'test',
          payload: {},
          metadata: {
            version: 1,
            schemaVersion: '1.0.0',
            environment: 'test',
            aggregateId: 'issue-1',
            aggregateType: 'Claim',
            sequenceNumber: 2,
          },
        },
      ];

      // When
      await emitter.emitBatch(events);

      // Then
      expect(mockEventStore.appendBatch).toHaveBeenCalledWith(events);
      expect(mockEventPublisher.publishBatch).toHaveBeenCalledWith(events);
    });

    it('should flush pending batch on explicit flush', async () => {
      // Given
      const batchConfig: EventEmitterConfig = {
        ...DEFAULT_EVENT_CONFIG,
        enableBatching: true,
        batchSize: 10, // Large batch size
        batchTimeoutMs: 10000, // Long timeout
      };
      emitter = new ClaimEventEmitter(
        mockEventStore,
        mockEventPublisher,
        mockIdGenerator,
        mockClock,
        mockSequenceGenerator,
        batchConfig
      );

      // When - Emit fewer than batch size
      await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());
      await emitter.emitIssueClaimed('issue-2', agentClaimant, new Date());

      // Events not yet persisted
      expect(mockEventStore.appendBatch).not.toHaveBeenCalled();

      // Explicit flush
      await emitter.flushBatch();

      // Then
      expect(mockEventStore.appendBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'IssueClaimed' }),
        ])
      );
    });
  });

  // ===========================================================================
  // Event data correctness tests
  // ===========================================================================

  describe('event data correctness', () => {
    it('should include all required fields in every event', async () => {
      // When
      const event = await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());

      // Then
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('source');
      expect(event).toHaveProperty('payload');
      expect(event).toHaveProperty('metadata');
      expect(event.metadata).toHaveProperty('version');
      expect(event.metadata).toHaveProperty('schemaVersion');
      expect(event.metadata).toHaveProperty('environment');
      expect(event.metadata).toHaveProperty('aggregateId');
      expect(event.metadata).toHaveProperty('aggregateType');
      expect(event.metadata).toHaveProperty('sequenceNumber');
    });

    it('should set correct source for all events', async () => {
      // When
      const event = await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());

      // Then
      expect(event.source).toBe('claims-service');
    });

    it('should preserve claimant structure in payload', async () => {
      // When
      const event = await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date());

      // Then
      expect(event.payload.claimant).toEqual(agentClaimant);
      expect(event.payload.claimant.type).toBe('agent');
      expect(event.payload.claimant.agentType).toBe('coder');
    });

    it('should handle human claimant correctly', async () => {
      // When
      const event = await emitter.emitIssueClaimed('issue-1', humanClaimant, new Date());

      // Then
      expect(event.payload.claimant).toEqual(humanClaimant);
      expect(event.payload.claimant.type).toBe('human');
      expect(event.payload.claimant.humanId).toBe('john.doe');
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty correlation ID', async () => {
      // When
      const event = await emitter.emitIssueClaimed('issue-1', agentClaimant, new Date(), undefined);

      // Then
      expect(event.correlationId).toBeUndefined();
    });

    it('should handle special characters in reason strings', async () => {
      // Given
      const reason = 'Need review: "complex" logic & edge-cases <script>alert(1)</script>';

      // When
      const event = await emitter.emitHandoffRequested(
        'issue-1',
        agentClaimant,
        humanClaimant,
        reason
      );

      // Then
      expect(event.payload.reason).toBe(reason);
    });

    it('should handle very long issue IDs', async () => {
      // Given
      const longIssueId = 'issue-' + 'x'.repeat(500);

      // When
      const event = await emitter.emitIssueClaimed(longIssueId, agentClaimant, new Date());

      // Then
      expect(event.payload.issueId).toBe(longIssueId);
      expect(event.metadata.aggregateId).toBe(longIssueId);
    });

    it('should handle dates in different timezones', async () => {
      // Given
      const utcDate = new Date('2024-01-15T10:00:00.000Z');
      mockClock.now.mockReturnValue(utcDate);

      // When
      const event = await emitter.emitIssueClaimed('issue-1', agentClaimant, utcDate);

      // Then
      expect(event.timestamp.toISOString()).toBe('2024-01-15T10:00:00.000Z');
      expect(event.payload.claimedAt.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    });
  });
});

// =============================================================================
// Integration tests for event subscribers
// =============================================================================

describe('Event Subscription', () => {
  let mockEventPublisher: MockedInterface<IEventPublisher>;
  let subscribedHandlers: Map<ClaimEventType, EventHandler[]>;

  beforeEach(() => {
    subscribedHandlers = new Map();
    mockEventPublisher = createMock<IEventPublisher>();

    mockEventPublisher.subscribe.mockImplementation((type, handler) => {
      const handlers = subscribedHandlers.get(type) || [];
      handlers.push(handler);
      subscribedHandlers.set(type, handlers);
    });

    mockEventPublisher.unsubscribe.mockImplementation((type, handler) => {
      const handlers = subscribedHandlers.get(type) || [];
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
      subscribedHandlers.set(type, handlers);
    });
  });

  it('should allow subscribing to specific event types', () => {
    // Given
    const handler: EventHandler = vi.fn();

    // When
    mockEventPublisher.subscribe('IssueClaimed', handler);

    // Then
    expect(subscribedHandlers.get('IssueClaimed')).toContain(handler);
  });

  it('should allow unsubscribing from events', () => {
    // Given
    const handler: EventHandler = vi.fn();
    mockEventPublisher.subscribe('IssueClaimed', handler);

    // When
    mockEventPublisher.unsubscribe('IssueClaimed', handler);

    // Then
    expect(subscribedHandlers.get('IssueClaimed')).not.toContain(handler);
  });

  it('should support multiple handlers for same event type', () => {
    // Given
    const handler1: EventHandler = vi.fn();
    const handler2: EventHandler = vi.fn();

    // When
    mockEventPublisher.subscribe('IssueClaimed', handler1);
    mockEventPublisher.subscribe('IssueClaimed', handler2);

    // Then
    const handlers = subscribedHandlers.get('IssueClaimed');
    expect(handlers).toContain(handler1);
    expect(handlers).toContain(handler2);
    expect(handlers?.length).toBe(2);
  });

  it('should allow same handler for different event types', () => {
    // Given
    const sharedHandler: EventHandler = vi.fn();

    // When
    mockEventPublisher.subscribe('IssueClaimed', sharedHandler);
    mockEventPublisher.subscribe('IssueReleased', sharedHandler);

    // Then
    expect(subscribedHandlers.get('IssueClaimed')).toContain(sharedHandler);
    expect(subscribedHandlers.get('IssueReleased')).toContain(sharedHandler);
  });
});
