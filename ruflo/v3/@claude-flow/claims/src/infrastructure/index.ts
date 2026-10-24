/**
 * @claude-flow/claims - Infrastructure Layer
 *
 * Exports persistence implementations for the claims module.
 *
 * @module v3/claims/infrastructure
 */

// Claim Repository
export {
  InMemoryClaimRepository,
  createClaimRepository,
} from './claim-repository.js';

// Event Store
export {
  InMemoryClaimEventStore,
  createClaimEventStore,
  type EventFilter,
  type EventSubscription,
} from './event-store.js';
