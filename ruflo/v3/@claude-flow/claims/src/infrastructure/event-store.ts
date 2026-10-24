/**
 * @claude-flow/claims - Event Store Implementation
 * Event sourcing storage for claims (ADR-007, ADR-016)
 *
 * @module v3/claims/infrastructure/event-store
 */

import {
  ClaimId,
  IssueId,
} from '../domain/types.js';
import {
  ClaimDomainEvent,
  AllClaimEvents,
  AllExtendedClaimEvents,
  ClaimEventType,
  ExtendedClaimEventType,
} from '../domain/events.js';
import { IClaimEventStore } from '../domain/repositories.js';

// =============================================================================
// Event Store Types
// =============================================================================

export interface EventFilter {
  aggregateId?: string;
  eventTypes?: (ClaimEventType | ExtendedClaimEventType)[];
  fromTimestamp?: number;
  toTimestamp?: number;
  fromVersion?: number;
  toVersion?: number;
  limit?: number;
  offset?: number;
}

export interface EventSubscription {
  id: string;
  eventTypes: (ClaimEventType | ExtendedClaimEventType)[];
  handler: (event: AllExtendedClaimEvents) => void | Promise<void>;
}

// =============================================================================
// In-Memory Event Store Implementation
// =============================================================================

/**
 * In-memory implementation of the event store
 * Suitable for development and testing
 */
export class InMemoryClaimEventStore implements IClaimEventStore {
  private events: AllExtendedClaimEvents[] = [];
  private aggregateVersions: Map<string, number> = new Map();
  private subscriptions: EventSubscription[] = [];
  private nextSubscriptionId = 0;

  async initialize(): Promise<void> {
    // No initialization needed for in-memory store
  }

  async shutdown(): Promise<void> {
    this.events = [];
    this.aggregateVersions.clear();
    this.subscriptions = [];
  }

  // ==========================================================================
  // Write Operations
  // ==========================================================================

  async append(event: ClaimDomainEvent): Promise<void> {
    // Assign version
    const currentVersion = this.aggregateVersions.get(event.aggregateId) ?? 0;
    const newVersion = currentVersion + 1;
    (event as any).version = newVersion;

    // Store event
    this.events.push(event as AllExtendedClaimEvents);
    this.aggregateVersions.set(event.aggregateId, newVersion);

    // Notify subscribers
    await this.notifySubscribers(event as AllExtendedClaimEvents);
  }

  async appendBatch(events: ClaimDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.append(event);
    }
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  async getEvents(
    claimId: ClaimId,
    fromVersion?: number
  ): Promise<ClaimDomainEvent[]> {
    return this.events.filter(
      (e) =>
        e.aggregateId === claimId &&
        (fromVersion === undefined || e.version >= fromVersion)
    ) as ClaimDomainEvent[];
  }

  async getEventsByType(type: string): Promise<ClaimDomainEvent[]> {
    return this.events.filter((e) => e.type === type) as ClaimDomainEvent[];
  }

  async getEventsByIssueId(issueId: IssueId): Promise<ClaimDomainEvent[]> {
    return this.events.filter(
      (e) => (e.payload as any)?.issueId === issueId
    ) as ClaimDomainEvent[];
  }

  async query(filter: EventFilter): Promise<AllExtendedClaimEvents[]> {
    let results = [...this.events];

    if (filter.aggregateId) {
      results = results.filter((e) => e.aggregateId === filter.aggregateId);
    }

    if (filter.eventTypes && filter.eventTypes.length > 0) {
      results = results.filter((e) => filter.eventTypes!.includes(e.type as any));
    }

    if (filter.fromTimestamp !== undefined) {
      results = results.filter((e) => e.timestamp >= filter.fromTimestamp!);
    }

    if (filter.toTimestamp !== undefined) {
      results = results.filter((e) => e.timestamp <= filter.toTimestamp!);
    }

    if (filter.fromVersion !== undefined) {
      results = results.filter((e) => e.version >= filter.fromVersion!);
    }

    if (filter.toVersion !== undefined) {
      results = results.filter((e) => e.version <= filter.toVersion!);
    }

    // Apply pagination
    if (filter.offset) {
      results = results.slice(filter.offset);
    }

    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  // ==========================================================================
  // Subscription Operations
  // ==========================================================================

  subscribe(
    eventTypes: (ClaimEventType | ExtendedClaimEventType)[],
    handler: (event: AllExtendedClaimEvents) => void | Promise<void>
  ): () => void {
    const subscription: EventSubscription = {
      id: `sub-${++this.nextSubscriptionId}`,
      eventTypes,
      handler,
    };

    this.subscriptions.push(subscription);

    // Return unsubscribe function
    return () => {
      const index = this.subscriptions.findIndex((s) => s.id === subscription.id);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
      }
    };
  }

  subscribeAll(
    handler: (event: AllExtendedClaimEvents) => void | Promise<void>
  ): () => void {
    return this.subscribe([], handler);
  }

  private async notifySubscribers(event: AllExtendedClaimEvents): Promise<void> {
    for (const subscription of this.subscriptions) {
      // If no event types specified, handler receives all events
      if (
        subscription.eventTypes.length === 0 ||
        subscription.eventTypes.includes(event.type as any)
      ) {
        try {
          await subscription.handler(event);
        } catch (error) {
          console.error(
            `Event handler error for subscription ${subscription.id}:`,
            error
          );
        }
      }
    }
  }

  // ==========================================================================
  // Aggregate Operations
  // ==========================================================================

  async getAggregateVersion(aggregateId: string): Promise<number> {
    return this.aggregateVersions.get(aggregateId) ?? 0;
  }

  async getAggregateState<T>(
    aggregateId: string,
    reducer: (state: T, event: AllExtendedClaimEvents) => T,
    initialState: T
  ): Promise<T> {
    const events = await this.getEvents(aggregateId as ClaimId);
    return events.reduce(
      (state, event) => reducer(state, event as AllExtendedClaimEvents),
      initialState
    );
  }

  // ==========================================================================
  // Snapshot Operations
  // ==========================================================================

  private snapshots: Map<string, { state: unknown; version: number }> = new Map();

  async saveSnapshot<T>(aggregateId: string, state: T, version: number): Promise<void> {
    this.snapshots.set(aggregateId, { state, version });
  }

  async getSnapshot<T>(aggregateId: string): Promise<{ state: T; version: number } | null> {
    const snapshot = this.snapshots.get(aggregateId);
    if (!snapshot) return null;
    return snapshot as { state: T; version: number };
  }

  async getStateFromSnapshot<T>(
    aggregateId: string,
    reducer: (state: T, event: AllExtendedClaimEvents) => T,
    initialState: T
  ): Promise<T> {
    // Try to get snapshot
    const snapshot = await this.getSnapshot<T>(aggregateId);

    let state: T;
    let fromVersion: number;

    if (snapshot) {
      state = snapshot.state;
      fromVersion = snapshot.version + 1;
    } else {
      state = initialState;
      fromVersion = 1;
    }

    // Apply events after snapshot
    const events = await this.getEvents(aggregateId as ClaimId, fromVersion);
    return events.reduce(
      (s, event) => reducer(s, event as AllExtendedClaimEvents),
      state
    );
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  async getEventCount(): Promise<number> {
    return this.events.length;
  }

  async getEventCountByType(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const event of this.events) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
    }
    return counts;
  }

  async getAggregateCount(): Promise<number> {
    return this.aggregateVersions.size;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new event store
 */
export function createClaimEventStore(): InMemoryClaimEventStore {
  return new InMemoryClaimEventStore();
}
