/**
 * Claims Application Layer
 *
 * Exports application services for the claims module:
 * - ClaimService: Core claiming, releasing, and handoff operations
 * - LoadBalancer: Work distribution and rebalancing across the swarm
 * - WorkStealingService: Idle agent work acquisition
 *
 * @module v3/claims/application
 */

// Core claim service
export { ClaimService, IClaimService } from './claim-service.js';

// Load Balancing Service
export {
  LoadBalancer,
  createLoadBalancer,
  type ILoadBalancer,
  type ILoadBalancerClaimRepository,
  type IAgentRegistry,
  type IHandoffService,
  type AgentMetadata,
  type SwarmLoadInfo,
  type RebalanceOptions,
  type RebalanceResult,
  type ImbalanceReport,
  type ClaimSummary,
  type LoadBalancerEventType,
  type SwarmRebalancedEvent,
  type AgentOverloadedEvent,
  type AgentUnderloadedEvent,
  type LoadBalancerClaimant,
  type LoadBalancerClaimStatus,
} from './load-balancer.js';

// Re-export AgentLoadInfo from load-balancer with a unique name to avoid conflict
export { type AgentLoadInfo as LoadBalancerAgentLoadInfo } from './load-balancer.js';

// Work Stealing Service
export {
  WorkStealingService,
  InMemoryWorkStealingEventBus,
  createWorkStealingService,
  type IWorkStealingService,
} from './work-stealing-service.js';
