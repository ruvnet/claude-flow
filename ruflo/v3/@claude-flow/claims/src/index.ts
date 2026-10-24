/**
 * @claude-flow/claims (ADR-016)
 *
 * Issue claiming and handoff management for human and agent collaboration.
 *
 * Features:
 * - Issue claiming and releasing
 * - Human-to-agent and agent-to-agent handoffs
 * - Status tracking and updates (active, paused, handoff-pending, review-requested, blocked, stealable, completed)
 * - Auto-management (expiration, auto-assignment)
 * - Work stealing with contest windows
 * - Load balancing and swarm rebalancing
 * - Full event sourcing (ADR-007)
 *
 * MCP Tools (17 total):
 * - Core Claiming (7): claim, release, handoff, status_update, list_available, list_mine, board
 * - Work Stealing (4): mark_stealable, steal, get_stealable, contest_steal
 * - Load Balancing (3): agent_load_info, swarm_rebalance, swarm_load_overview
 * - Additional (3): claim_history, claim_metrics, claim_config
 *
 * ADR-016 Types:
 * - ClaimStatus: active | paused | handoff-pending | review-requested | blocked | stealable | completed
 * - ClaimantType: human | agent
 * - StealReason: timeout | overloaded | blocked | voluntary | rebalancing | abandoned | priority-change
 * - HandoffReason: capacity | expertise | shift-change | escalation | voluntary | rebalancing
 *
 * @module v3/claims
 */

// Domain layer - Types, Events, Rules, Repositories
export * from './domain/index.js';

// Application layer - Services
export * from './application/index.js';

// Infrastructure layer - Persistence
export * from './infrastructure/index.js';

// API layer - MCP Tools
export {
  // All tools collection
  claimsTools,

  // Tool categories
  coreClaimingTools,
  workStealingTools,
  loadBalancingTools,
  additionalClaimsTools,

  // Core Claiming Tools (7)
  issueClaimTool,
  issueReleaseTool,
  issueHandoffTool,
  issueStatusUpdateTool,
  issueListAvailableTool,
  issueListMineTool,
  issueBoardTool,

  // Work Stealing Tools (4)
  issueMarkStealableTool,
  issueStealTool,
  issueGetStealableTool,
  issueContestStealTool,

  // Load Balancing Tools (3)
  agentLoadInfoTool,
  swarmRebalanceTool,
  swarmLoadOverviewTool,

  // Additional Tools (3)
  claimHistoryTool,
  claimMetricsTool,
  claimConfigTool,

  // Utility functions
  registerClaimsTools,
  getClaimsToolsByCategory,
  getClaimsToolByName,
} from './api/mcp-tools.js';
