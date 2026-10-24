/**
 * Claim Repository Interfaces
 *
 * Repository interfaces for the claims domain following DDD patterns.
 *
 * @module v3/claims/domain/repositories
 */

import {
  ClaimId,
  IssueId,
  Claimant,
  ClaimStatus,
  Issue,
  IssueClaim,
  IssueFilters,
  HandoffRecord,
} from './types.js';

// =============================================================================
// Claim Repository Interface
// =============================================================================

/**
 * Repository for managing issue claims
 */
export interface IClaimRepository {
  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Save a new claim or update an existing one
   */
  save(claim: IssueClaim): Promise<void>;

  /**
   * Find a claim by its ID
   */
  findById(claimId: ClaimId): Promise<IssueClaim | null>;

  /**
   * Find the active claim for an issue
   */
  findByIssueId(issueId: IssueId): Promise<IssueClaim | null>;

  /**
   * Find all claims for a specific claimant
   */
  findByClaimant(claimant: Claimant): Promise<IssueClaim[]>;

  /**
   * Find claims by status
   */
  findByStatus(status: ClaimStatus): Promise<IssueClaim[]>;

  /**
   * Delete a claim
   */
  delete(claimId: ClaimId): Promise<void>;

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Find all active claims
   */
  findActiveClaims(): Promise<IssueClaim[]>;

  /**
   * Find stale claims (claims with no activity past a threshold)
   */
  findStaleClaims(staleSince: Date): Promise<IssueClaim[]>;

  /**
   * Find claims with pending handoffs
   */
  findClaimsWithPendingHandoffs(): Promise<IssueClaim[]>;

  /**
   * Count claims by claimant
   */
  countByClaimant(claimantId: string): Promise<number>;

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the repository
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Issue Repository Interface
// =============================================================================

/**
 * Repository for accessing issues
 */
export interface IIssueRepository {
  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Find an issue by its ID
   */
  findById(issueId: IssueId): Promise<Issue | null>;

  /**
   * Find issues matching filters
   */
  findByFilters(filters: IssueFilters): Promise<Issue[]>;

  /**
   * Find all unclaimed issues matching filters
   */
  findAvailable(filters?: IssueFilters): Promise<Issue[]>;

  /**
   * Check if an issue exists
   */
  exists(issueId: IssueId): Promise<boolean>;

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the repository
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Claimant Repository Interface
// =============================================================================

/**
 * Repository for managing claimants
 */
export interface IClaimantRepository {
  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Find a claimant by ID
   */
  findById(claimantId: string): Promise<Claimant | null>;

  /**
   * Find claimants by type
   */
  findByType(type: 'human' | 'agent'): Promise<Claimant[]>;

  /**
   * Find claimants with specific capabilities
   */
  findByCapabilities(capabilities: string[]): Promise<Claimant[]>;

  /**
   * Get all available claimants (not at max workload)
   */
  findAvailable(): Promise<Claimant[]>;

  /**
   * Check if a claimant exists
   */
  exists(claimantId: string): Promise<boolean>;

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the repository
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Event Store Interface (for domain events)
// =============================================================================

import { AllClaimEvents, ClaimDomainEvent } from './events.js';

/**
 * Event store interface for claim domain events
 */
export interface IClaimEventStore {
  /**
   * Append a new event to the store
   */
  append(event: ClaimDomainEvent): Promise<void>;

  /**
   * Get events for a specific claim
   */
  getEvents(claimId: ClaimId, fromVersion?: number): Promise<ClaimDomainEvent[]>;

  /**
   * Get events by type
   */
  getEventsByType(type: string): Promise<ClaimDomainEvent[]>;

  /**
   * Get events for an issue across all claims
   */
  getEventsByIssueId(issueId: IssueId): Promise<ClaimDomainEvent[]>;

  /**
   * Initialize the event store
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the event store
   */
  shutdown(): Promise<void>;
}
