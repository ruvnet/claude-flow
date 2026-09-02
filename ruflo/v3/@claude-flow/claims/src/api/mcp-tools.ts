/**
 * V3 MCP Claims Tools
 *
 * MCP tools for issue claiming and work coordination:
 *
 * Core Claiming (7 tools):
 * - claims/issue_claim - Claim an issue to work on
 * - claims/issue_release - Release a claim
 * - claims/issue_handoff - Request handoff to another agent/human
 * - claims/issue_status_update - Update claim status
 * - claims/issue_list_available - List unclaimed issues
 * - claims/issue_list_mine - List my claims
 * - claims/issue_board - View claim board (who's working on what)
 *
 * Work Stealing (4 tools):
 * - claims/issue_mark_stealable - Mark my claim as stealable
 * - claims/issue_steal - Steal a stealable issue
 * - claims/issue_get_stealable - List stealable issues
 * - claims/issue_contest_steal - Contest a steal
 *
 * Load Balancing (3 tools):
 * - claims/agent_load_info - Get agent's current load
 * - claims/swarm_rebalance - Trigger swarm rebalancing
 * - claims/swarm_load_overview - Get swarm-wide load distribution
 *
 * Additionally provides:
 * - claims/claim_history - Get claim history for an issue
 * - claims/claim_metrics - Get claiming metrics
 * - claims/claim_config - Configure claiming behavior
 *
 * Implements ADR-005: MCP-First API Design
 */

import { z } from 'zod';
import { randomBytes } from 'crypto';

// ============================================================================
// Type Definitions (compatible with v3/mcp/types.ts)
// ============================================================================

/**
 * JSON Schema type for tool input
 */
interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: string[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | JSONSchema;
}

/**
 * Tool execution context
 */
interface ToolContext {
  sessionId: string;
  requestId?: string | number | null;
  orchestrator?: unknown;
  swarmCoordinator?: unknown;
  agentManager?: unknown;
  claimsService?: ClaimsService;
  metadata?: Record<string, unknown>;
}

/**
 * Tool handler function type
 */
type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context?: ToolContext
) => Promise<TOutput>;

/**
 * MCP Tool definition
 */
interface MCPTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: ToolHandler<TInput, TOutput>;
  category?: string;
  tags?: string[];
  version?: string;
  deprecated?: boolean;
  cacheable?: boolean;
  cacheTTL?: number;
  timeout?: number;
}

// ============================================================================
// Claims-Specific Types
// ============================================================================

type ClaimantType = 'human' | 'agent';
type ClaimStatus = 'active' | 'blocked' | 'in-review' | 'completed' | 'released' | 'stolen';
type IssuePriority = 'critical' | 'high' | 'medium' | 'low';
type HandoffReason = 'blocked' | 'expertise-needed' | 'capacity' | 'reassignment' | 'other';

interface Claim {
  id: string;
  issueId: string;
  claimantType: ClaimantType;
  claimantId: string;
  status: ClaimStatus;
  priority: IssuePriority;
  stealable: boolean;
  stealableReason?: string;
  claimedAt: string;
  lastActivityAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

interface Issue {
  id: string;
  title: string;
  description?: string;
  priority: IssuePriority;
  labels?: string[];
  repository?: string;
  createdAt: string;
  updatedAt?: string;
  claimedBy?: string;
  metadata?: Record<string, unknown>;
}

interface AgentLoad {
  agentId: string;
  agentType: string;
  currentClaims: number;
  maxClaims: number;
  utilizationPercent: number;
  activeTasks: number;
  queuedTasks: number;
  averageTaskDuration: number;
  lastActivityAt: string;
}

interface ClaimHistoryEntry {
  timestamp: string;
  action: string;
  actorId: string;
  actorType: ClaimantType;
  details?: Record<string, unknown>;
}

/**
 * Claims Service Interface
 * Defines the contract for claims management operations
 */
interface ClaimsService {
  claimIssue(params: {
    issueId: string;
    claimantType: ClaimantType;
    claimantId: string;
    priority?: IssuePriority;
    expiresInMs?: number;
  }): Promise<Claim>;

  releaseClaim(params: {
    issueId: string;
    claimantId: string;
    reason?: string;
  }): Promise<{ released: boolean; releasedAt: string }>;

  requestHandoff(params: {
    issueId: string;
    fromId: string;
    toId?: string;
    toType?: ClaimantType;
    reason: HandoffReason;
    notes?: string;
  }): Promise<{ handoffId: string; status: string }>;

  updateClaimStatus(params: {
    issueId: string;
    claimantId: string;
    status: ClaimStatus;
    progress?: number;
    notes?: string;
  }): Promise<Claim>;

  listAvailableIssues(params: {
    priority?: IssuePriority;
    labels?: string[];
    repository?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ issues: Issue[]; total: number }>;

  listMyClaims(params: {
    claimantId: string;
    status?: ClaimStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ claims: Claim[]; total: number }>;

  getClaimBoard(params: {
    includeAgents?: boolean;
    includeHumans?: boolean;
    groupBy?: 'claimant' | 'priority' | 'status';
  }): Promise<{
    claims: Claim[];
    byClaimant?: Record<string, Claim[]>;
    byPriority?: Record<IssuePriority, Claim[]>;
    byStatus?: Record<ClaimStatus, Claim[]>;
  }>;

  markStealable(params: {
    issueId: string;
    claimantId: string;
    reason?: string;
  }): Promise<{ marked: boolean; markedAt: string }>;

  stealClaim(params: {
    issueId: string;
    stealerId: string;
    stealerType: ClaimantType;
    reason?: string;
  }): Promise<{
    stolen: boolean;
    claim: Claim;
    previousClaimant: string;
    contestWindow: number;
  }>;

  getStealableIssues(params: {
    priority?: IssuePriority;
    limit?: number;
  }): Promise<{ issues: Array<Issue & { stealableReason?: string }>; total: number }>;

  contestSteal(params: {
    issueId: string;
    contesterId: string;
    reason: string;
  }): Promise<{
    contested: boolean;
    resolution: 'pending' | 'upheld' | 'reversed';
    resolvedAt?: string;
  }>;

  getAgentLoad(params: {
    agentId: string;
  }): Promise<AgentLoad>;

  rebalanceSwarm(params: {
    strategy?: 'round-robin' | 'least-loaded' | 'priority-based' | 'capability-based';
    dryRun?: boolean;
  }): Promise<{
    rebalanced: boolean;
    changes: Array<{ issueId: string; from: string; to: string }>;
    dryRun: boolean;
  }>;

  getLoadOverview(): Promise<{
    totalAgents: number;
    totalClaims: number;
    averageLoad: number;
    agents: AgentLoad[];
    bottlenecks: string[];
    recommendations: string[];
  }>;

  getClaimHistory(params: {
    issueId: string;
    limit?: number;
  }): Promise<{ history: ClaimHistoryEntry[]; total: number }>;

  getMetrics(): Promise<{
    totalClaims: number;
    activeClaims: number;
    completedClaims: number;
    stolenClaims: number;
    averageClaimDuration: number;
    claimsByPriority: Record<IssuePriority, number>;
    claimsByStatus: Record<ClaimStatus, number>;
  }>;
}

// ============================================================================
// Secure ID Generation
// ============================================================================

function generateSecureId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(12).toString('hex');
  return `${prefix}-${timestamp}-${random}`;
}

// ============================================================================
// In-Memory Store (for simple implementation without service)
// ============================================================================

const claimStore = new Map<string, Claim>();
const issueStore = new Map<string, Issue>();

// Initialize with some mock data
function initializeMockData(): void {
  if (issueStore.size === 0) {
    const mockIssues: Issue[] = [
      {
        id: 'issue-1',
        title: 'Implement user authentication',
        priority: 'high',
        labels: ['feature', 'security'],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'issue-2',
        title: 'Fix memory leak in agent coordinator',
        priority: 'critical',
        labels: ['bug', 'performance'],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'issue-3',
        title: 'Add unit tests for claims module',
        priority: 'medium',
        labels: ['testing'],
        createdAt: new Date().toISOString(),
      },
    ];
    mockIssues.forEach(issue => issueStore.set(issue.id, issue));
  }
}

// ============================================================================
// Input Schemas
// ============================================================================

// Core Claiming Schemas
const issueClaimSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID to claim'),
  claimantType: z.enum(['human', 'agent']).describe('Type of claimant'),
  claimantId: z.string().min(1).describe('ID of the claimant'),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional()
    .describe('Override priority for the claim'),
  expiresInMs: z.number().int().positive().optional()
    .describe('Claim expiration time in milliseconds'),
});

const issueReleaseSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID to release'),
  claimantId: z.string().min(1).describe('ID of the current claimant'),
  reason: z.string().optional().describe('Reason for releasing the claim'),
});

const issueHandoffSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID for handoff'),
  fromId: z.string().min(1).describe('Current claimant ID'),
  toId: z.string().optional().describe('Target claimant ID (optional for open handoff)'),
  toType: z.enum(['human', 'agent']).optional().describe('Target claimant type'),
  reason: z.enum(['blocked', 'expertise-needed', 'capacity', 'reassignment', 'other'])
    .describe('Reason for handoff'),
  notes: z.string().optional().describe('Additional notes for handoff'),
});

const issueStatusUpdateSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID to update'),
  claimantId: z.string().min(1).describe('Current claimant ID'),
  status: z.enum(['active', 'blocked', 'in-review', 'completed']).describe('New status'),
  progress: z.number().min(0).max(100).optional().describe('Progress percentage (0-100)'),
  notes: z.string().optional().describe('Status update notes'),
});

const issueListAvailableSchema = z.object({
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional()
    .describe('Filter by priority'),
  labels: z.array(z.string()).optional().describe('Filter by labels'),
  repository: z.string().optional().describe('Filter by repository'),
  limit: z.number().int().positive().max(100).default(50).describe('Maximum results'),
  offset: z.number().int().nonnegative().default(0).describe('Pagination offset'),
});

const issueListMineSchema = z.object({
  claimantId: z.string().min(1).describe('Claimant ID'),
  status: z.enum(['active', 'blocked', 'in-review', 'completed', 'released', 'stolen']).optional()
    .describe('Filter by status'),
  limit: z.number().int().positive().max(100).default(50).describe('Maximum results'),
  offset: z.number().int().nonnegative().default(0).describe('Pagination offset'),
});

const issueBoardSchema = z.object({
  includeAgents: z.boolean().default(true).describe('Include agent claims'),
  includeHumans: z.boolean().default(true).describe('Include human claims'),
  groupBy: z.enum(['claimant', 'priority', 'status']).optional()
    .describe('Group claims by field'),
});

// Work Stealing Schemas
const issueMarkStealableSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID to mark as stealable'),
  claimantId: z.string().min(1).describe('Current claimant ID'),
  reason: z.string().optional().describe('Reason for making stealable'),
});

const issueStealSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID to steal'),
  stealerId: z.string().min(1).describe('ID of the stealer'),
  stealerType: z.enum(['human', 'agent']).describe('Type of stealer'),
  reason: z.string().optional().describe('Reason for stealing'),
});

const issueGetStealableSchema = z.object({
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional()
    .describe('Filter by priority'),
  limit: z.number().int().positive().max(100).default(50).describe('Maximum results'),
});

const issueContestStealSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID being contested'),
  contesterId: z.string().min(1).describe('ID of the contester'),
  reason: z.string().min(1).describe('Reason for contesting'),
});

// Load Balancing Schemas
const agentLoadInfoSchema = z.object({
  agentId: z.string().min(1).describe('Agent ID to get load info for'),
});

const swarmRebalanceSchema = z.object({
  strategy: z.enum(['round-robin', 'least-loaded', 'priority-based', 'capability-based'])
    .default('least-loaded').describe('Rebalancing strategy'),
  dryRun: z.boolean().default(false).describe('Simulate without making changes'),
});

const swarmLoadOverviewSchema = z.object({
  includeRecommendations: z.boolean().default(true)
    .describe('Include optimization recommendations'),
});

// Additional Tools Schemas
const claimHistorySchema = z.object({
  issueId: z.string().min(1).describe('Issue ID to get history for'),
  limit: z.number().int().positive().max(100).default(50).describe('Maximum entries'),
});

const claimMetricsSchema = z.object({
  timeRange: z.enum(['1h', '24h', '7d', '30d', 'all']).default('24h')
    .describe('Time range for metrics'),
});

const claimConfigSchema = z.object({
  action: z.enum(['get', 'set']).describe('Get or set configuration'),
  config: z.object({
    defaultExpirationMs: z.number().int().positive().optional(),
    maxClaimsPerAgent: z.number().int().positive().optional(),
    contestWindowMs: z.number().int().positive().optional(),
    autoReleaseOnInactivityMs: z.number().int().positive().optional(),
  }).optional().describe('Configuration values (for set action)'),
});

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Claim an issue to work on
 */
async function handleIssueClaim(
  input: z.infer<typeof issueClaimSchema>,
  context?: ToolContext
): Promise<{
  claimId: string;
  issueId: string;
  claimantId: string;
  claimantType: ClaimantType;
  status: ClaimStatus;
  claimedAt: string;
  expiresAt?: string;
}> {
  initializeMockData();

  // Try to use claims service if available
  if (context?.claimsService) {
    const claim = await context.claimsService.claimIssue(input);
    return {
      claimId: claim.id,
      issueId: claim.issueId,
      claimantId: claim.claimantId,
      claimantType: claim.claimantType,
      status: claim.status,
      claimedAt: claim.claimedAt,
      expiresAt: claim.expiresAt,
    };
  }

  // Simple implementation
  const issue = issueStore.get(input.issueId);
  if (!issue) {
    throw new Error(`Issue not found: ${input.issueId}`);
  }

  if (issue.claimedBy) {
    throw new Error(`Issue ${input.issueId} is already claimed by ${issue.claimedBy}`);
  }

  const claimId = generateSecureId('claim');
  const claimedAt = new Date().toISOString();
  const expiresAt = input.expiresInMs
    ? new Date(Date.now() + input.expiresInMs).toISOString()
    : undefined;

  const claim: Claim = {
    id: claimId,
    issueId: input.issueId,
    claimantType: input.claimantType,
    claimantId: input.claimantId,
    status: 'active',
    priority: input.priority || issue.priority,
    stealable: false,
    claimedAt,
    lastActivityAt: claimedAt,
    expiresAt,
  };

  claimStore.set(claimId, claim);
  issue.claimedBy = input.claimantId;

  return {
    claimId,
    issueId: input.issueId,
    claimantId: input.claimantId,
    claimantType: input.claimantType,
    status: 'active',
    claimedAt,
    expiresAt,
  };
}

/**
 * Release a claim
 */
async function handleIssueRelease(
  input: z.infer<typeof issueReleaseSchema>,
  context?: ToolContext
): Promise<{
  released: boolean;
  issueId: string;
  releasedAt: string;
  reason?: string;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.releaseClaim(input);
    return {
      released: result.released,
      issueId: input.issueId,
      releasedAt: result.releasedAt,
      reason: input.reason,
    };
  }

  // Simple implementation
  const issue = issueStore.get(input.issueId);
  if (!issue) {
    throw new Error(`Issue not found: ${input.issueId}`);
  }

  if (issue.claimedBy !== input.claimantId) {
    throw new Error(`Issue ${input.issueId} is not claimed by ${input.claimantId}`);
  }

  // Find and update the claim
  for (const claim of claimStore.values()) {
    if (claim.issueId === input.issueId && claim.claimantId === input.claimantId) {
      claim.status = 'released';
      claim.lastActivityAt = new Date().toISOString();
    }
  }

  issue.claimedBy = undefined;

  return {
    released: true,
    issueId: input.issueId,
    releasedAt: new Date().toISOString(),
    reason: input.reason,
  };
}

/**
 * Request handoff to another agent/human
 */
async function handleIssueHandoff(
  input: z.infer<typeof issueHandoffSchema>,
  context?: ToolContext
): Promise<{
  handoffId: string;
  issueId: string;
  fromId: string;
  toId?: string;
  toType?: ClaimantType;
  status: 'pending' | 'accepted' | 'rejected';
  reason: HandoffReason;
  createdAt: string;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.requestHandoff(input);
    return {
      handoffId: result.handoffId,
      issueId: input.issueId,
      fromId: input.fromId,
      toId: input.toId,
      toType: input.toType,
      status: result.status as 'pending' | 'accepted' | 'rejected',
      reason: input.reason,
      createdAt: new Date().toISOString(),
    };
  }

  // Simple implementation
  const handoffId = generateSecureId('handoff');

  return {
    handoffId,
    issueId: input.issueId,
    fromId: input.fromId,
    toId: input.toId,
    toType: input.toType,
    status: 'pending',
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Update claim status
 */
async function handleIssueStatusUpdate(
  input: z.infer<typeof issueStatusUpdateSchema>,
  context?: ToolContext
): Promise<{
  issueId: string;
  status: ClaimStatus;
  progress?: number;
  updatedAt: string;
  notes?: string;
}> {
  if (context?.claimsService) {
    const claim = await context.claimsService.updateClaimStatus(input);
    return {
      issueId: claim.issueId,
      status: claim.status,
      progress: input.progress,
      updatedAt: claim.lastActivityAt,
      notes: input.notes,
    };
  }

  // Simple implementation
  for (const claim of claimStore.values()) {
    if (claim.issueId === input.issueId && claim.claimantId === input.claimantId) {
      claim.status = input.status;
      claim.lastActivityAt = new Date().toISOString();
      if (input.progress !== undefined) {
        claim.metadata = { ...claim.metadata, progress: input.progress };
      }
      return {
        issueId: input.issueId,
        status: input.status,
        progress: input.progress,
        updatedAt: claim.lastActivityAt,
        notes: input.notes,
      };
    }
  }

  throw new Error(`No active claim found for issue ${input.issueId} by ${input.claimantId}`);
}

/**
 * List unclaimed issues
 */
async function handleIssueListAvailable(
  input: z.infer<typeof issueListAvailableSchema>,
  context?: ToolContext
): Promise<{
  issues: Issue[];
  total: number;
  limit: number;
  offset: number;
}> {
  initializeMockData();

  if (context?.claimsService) {
    const result = await context.claimsService.listAvailableIssues(input);
    return {
      ...result,
      limit: input.limit,
      offset: input.offset,
    };
  }

  // Simple implementation
  let issues = Array.from(issueStore.values()).filter(issue => !issue.claimedBy);

  if (input.priority) {
    issues = issues.filter(issue => issue.priority === input.priority);
  }
  if (input.labels && input.labels.length > 0) {
    issues = issues.filter(issue =>
      input.labels!.some(label => issue.labels?.includes(label))
    );
  }
  if (input.repository) {
    issues = issues.filter(issue => issue.repository === input.repository);
  }

  const total = issues.length;
  const paginated = issues.slice(input.offset, input.offset + input.limit);

  return {
    issues: paginated,
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

/**
 * List my claims
 */
async function handleIssueListMine(
  input: z.infer<typeof issueListMineSchema>,
  context?: ToolContext
): Promise<{
  claims: Claim[];
  total: number;
  limit: number;
  offset: number;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.listMyClaims(input);
    return {
      ...result,
      limit: input.limit,
      offset: input.offset,
    };
  }

  // Simple implementation
  let claims = Array.from(claimStore.values())
    .filter(claim => claim.claimantId === input.claimantId);

  if (input.status) {
    claims = claims.filter(claim => claim.status === input.status);
  }

  const total = claims.length;
  const paginated = claims.slice(input.offset, input.offset + input.limit);

  return {
    claims: paginated,
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

/**
 * View claim board
 */
async function handleIssueBoard(
  input: z.infer<typeof issueBoardSchema>,
  context?: ToolContext
): Promise<{
  claims: Claim[];
  totalClaims: number;
  byClaimant?: Record<string, number>;
  byPriority?: Record<IssuePriority, number>;
  byStatus?: Record<ClaimStatus, number>;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.getClaimBoard(input);
    return {
      claims: result.claims,
      totalClaims: result.claims.length,
      byClaimant: result.byClaimant
        ? Object.fromEntries(Object.entries(result.byClaimant).map(([k, v]) => [k, v.length]))
        : undefined,
      byPriority: result.byPriority
        ? Object.fromEntries(Object.entries(result.byPriority).map(([k, v]) => [k, v.length])) as Record<IssuePriority, number>
        : undefined,
      byStatus: result.byStatus
        ? Object.fromEntries(Object.entries(result.byStatus).map(([k, v]) => [k, v.length])) as Record<ClaimStatus, number>
        : undefined,
    };
  }

  // Simple implementation
  let claims = Array.from(claimStore.values());

  if (!input.includeAgents) {
    claims = claims.filter(c => c.claimantType !== 'agent');
  }
  if (!input.includeHumans) {
    claims = claims.filter(c => c.claimantType !== 'human');
  }

  const result: {
    claims: Claim[];
    totalClaims: number;
    byClaimant?: Record<string, number>;
    byPriority?: Record<IssuePriority, number>;
    byStatus?: Record<ClaimStatus, number>;
  } = {
    claims,
    totalClaims: claims.length,
  };

  if (input.groupBy === 'claimant') {
    result.byClaimant = {};
    claims.forEach(c => {
      result.byClaimant![c.claimantId] = (result.byClaimant![c.claimantId] || 0) + 1;
    });
  } else if (input.groupBy === 'priority') {
    result.byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
    claims.forEach(c => {
      result.byPriority![c.priority]++;
    });
  } else if (input.groupBy === 'status') {
    result.byStatus = { active: 0, blocked: 0, 'in-review': 0, completed: 0, released: 0, stolen: 0 };
    claims.forEach(c => {
      result.byStatus![c.status]++;
    });
  }

  return result;
}

/**
 * Mark claim as stealable
 */
async function handleIssueMarkStealable(
  input: z.infer<typeof issueMarkStealableSchema>,
  context?: ToolContext
): Promise<{
  marked: boolean;
  issueId: string;
  markedAt: string;
  reason?: string;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.markStealable(input);
    return {
      marked: result.marked,
      issueId: input.issueId,
      markedAt: result.markedAt,
      reason: input.reason,
    };
  }

  // Simple implementation
  for (const claim of claimStore.values()) {
    if (claim.issueId === input.issueId && claim.claimantId === input.claimantId) {
      claim.stealable = true;
      claim.stealableReason = input.reason;
      claim.lastActivityAt = new Date().toISOString();
      return {
        marked: true,
        issueId: input.issueId,
        markedAt: claim.lastActivityAt,
        reason: input.reason,
      };
    }
  }

  throw new Error(`No active claim found for issue ${input.issueId} by ${input.claimantId}`);
}

/**
 * Steal a stealable issue
 */
async function handleIssueSteal(
  input: z.infer<typeof issueStealSchema>,
  context?: ToolContext
): Promise<{
  stolen: boolean;
  issueId: string;
  newClaimId: string;
  previousClaimant: string;
  contestWindowMs: number;
  stolenAt: string;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.stealClaim(input);
    return {
      stolen: result.stolen,
      issueId: input.issueId,
      newClaimId: result.claim.id,
      previousClaimant: result.previousClaimant,
      contestWindowMs: result.contestWindow,
      stolenAt: result.claim.claimedAt,
    };
  }

  // Simple implementation
  for (const claim of claimStore.values()) {
    if (claim.issueId === input.issueId && claim.stealable) {
      const previousClaimant = claim.claimantId;

      // Update old claim
      claim.status = 'stolen';
      claim.lastActivityAt = new Date().toISOString();

      // Create new claim
      const newClaimId = generateSecureId('claim');
      const stolenAt = new Date().toISOString();
      const newClaim: Claim = {
        id: newClaimId,
        issueId: input.issueId,
        claimantType: input.stealerType,
        claimantId: input.stealerId,
        status: 'active',
        priority: claim.priority,
        stealable: false,
        claimedAt: stolenAt,
        lastActivityAt: stolenAt,
      };
      claimStore.set(newClaimId, newClaim);

      // Update issue
      const issue = issueStore.get(input.issueId);
      if (issue) {
        issue.claimedBy = input.stealerId;
      }

      return {
        stolen: true,
        issueId: input.issueId,
        newClaimId,
        previousClaimant,
        contestWindowMs: 300000, // 5 minutes
        stolenAt,
      };
    }
  }

  throw new Error(`Issue ${input.issueId} is not stealable or not claimed`);
}

/**
 * Get stealable issues
 */
async function handleIssueGetStealable(
  input: z.infer<typeof issueGetStealableSchema>,
  context?: ToolContext
): Promise<{
  issues: Array<{
    issueId: string;
    title: string;
    priority: IssuePriority;
    currentClaimant: string;
    stealableReason?: string;
  }>;
  total: number;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.getStealableIssues(input);
    return {
      issues: result.issues.map(issue => ({
        issueId: issue.id,
        title: issue.title,
        priority: issue.priority,
        currentClaimant: issue.claimedBy || 'unknown',
        stealableReason: issue.stealableReason,
      })),
      total: result.total,
    };
  }

  // Simple implementation
  let stealableClaims = Array.from(claimStore.values()).filter(c => c.stealable);

  if (input.priority) {
    stealableClaims = stealableClaims.filter(c => c.priority === input.priority);
  }

  const issues = stealableClaims.slice(0, input.limit).map(claim => {
    const issue = issueStore.get(claim.issueId);
    return {
      issueId: claim.issueId,
      title: issue?.title || 'Unknown',
      priority: claim.priority,
      currentClaimant: claim.claimantId,
      stealableReason: claim.stealableReason,
    };
  });

  return {
    issues,
    total: stealableClaims.length,
  };
}

/**
 * Contest a steal
 */
async function handleIssueContestSteal(
  input: z.infer<typeof issueContestStealSchema>,
  context?: ToolContext
): Promise<{
  contested: boolean;
  contestId: string;
  issueId: string;
  contesterId: string;
  status: 'pending' | 'upheld' | 'reversed';
  contestedAt: string;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.contestSteal(input);
    return {
      contested: result.contested,
      contestId: generateSecureId('contest'),
      issueId: input.issueId,
      contesterId: input.contesterId,
      status: result.resolution,
      contestedAt: result.resolvedAt || new Date().toISOString(),
    };
  }

  // Simple implementation
  return {
    contested: true,
    contestId: generateSecureId('contest'),
    issueId: input.issueId,
    contesterId: input.contesterId,
    status: 'pending',
    contestedAt: new Date().toISOString(),
  };
}

/**
 * Get agent load info
 */
async function handleAgentLoadInfo(
  input: z.infer<typeof agentLoadInfoSchema>,
  context?: ToolContext
): Promise<AgentLoad> {
  if (context?.claimsService) {
    return context.claimsService.getAgentLoad(input);
  }

  // Simple implementation
  const claims = Array.from(claimStore.values())
    .filter(c => c.claimantId === input.agentId && c.status === 'active');

  return {
    agentId: input.agentId,
    agentType: 'worker',
    currentClaims: claims.length,
    maxClaims: 5,
    utilizationPercent: Math.min(100, (claims.length / 5) * 100),
    activeTasks: claims.length,
    queuedTasks: 0,
    averageTaskDuration: 3600000, // 1 hour
    lastActivityAt: new Date().toISOString(),
  };
}

/**
 * Trigger swarm rebalancing
 */
async function handleSwarmRebalance(
  input: z.infer<typeof swarmRebalanceSchema>,
  context?: ToolContext
): Promise<{
  rebalanced: boolean;
  strategy: string;
  changes: Array<{ issueId: string; from: string; to: string }>;
  dryRun: boolean;
  rebalancedAt: string;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.rebalanceSwarm(input);
    return {
      rebalanced: result.rebalanced,
      strategy: input.strategy,
      changes: result.changes,
      dryRun: result.dryRun,
      rebalancedAt: new Date().toISOString(),
    };
  }

  // Simple implementation - no actual rebalancing
  return {
    rebalanced: !input.dryRun,
    strategy: input.strategy,
    changes: [],
    dryRun: input.dryRun,
    rebalancedAt: new Date().toISOString(),
  };
}

/**
 * Get swarm-wide load overview
 */
async function handleSwarmLoadOverview(
  input: z.infer<typeof swarmLoadOverviewSchema>,
  context?: ToolContext
): Promise<{
  totalAgents: number;
  totalClaims: number;
  averageLoad: number;
  agents: Array<{ agentId: string; currentClaims: number; utilizationPercent: number }>;
  bottlenecks: string[];
  recommendations: string[];
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.getLoadOverview();
    return {
      ...result,
      agents: result.agents.map(a => ({
        agentId: a.agentId,
        currentClaims: a.currentClaims,
        utilizationPercent: a.utilizationPercent,
      })),
    };
  }

  // Simple implementation
  const claimsByAgent = new Map<string, number>();
  for (const claim of claimStore.values()) {
    if (claim.status === 'active') {
      claimsByAgent.set(claim.claimantId, (claimsByAgent.get(claim.claimantId) || 0) + 1);
    }
  }

  const agents = Array.from(claimsByAgent.entries()).map(([agentId, claims]) => ({
    agentId,
    currentClaims: claims,
    utilizationPercent: Math.min(100, (claims / 5) * 100),
  }));

  const totalClaims = Array.from(claimsByAgent.values()).reduce((a, b) => a + b, 0);
  const avgLoad = agents.length > 0
    ? agents.reduce((a, b) => a + b.utilizationPercent, 0) / agents.length
    : 0;

  const result: {
    totalAgents: number;
    totalClaims: number;
    averageLoad: number;
    agents: Array<{ agentId: string; currentClaims: number; utilizationPercent: number }>;
    bottlenecks: string[];
    recommendations: string[];
  } = {
    totalAgents: agents.length,
    totalClaims,
    averageLoad: Math.round(avgLoad * 100) / 100,
    agents,
    bottlenecks: [],
    recommendations: [],
  };

  if (input.includeRecommendations) {
    const overloaded = agents.filter(a => a.utilizationPercent > 80);
    if (overloaded.length > 0) {
      result.bottlenecks = overloaded.map(a => a.agentId);
      result.recommendations.push('Consider rebalancing claims to reduce load on overloaded agents');
    }
    if (avgLoad > 70) {
      result.recommendations.push('Swarm is under high load. Consider scaling up agent count.');
    }
    if (avgLoad < 30 && agents.length > 1) {
      result.recommendations.push('Swarm has low utilization. Consider consolidating agents.');
    }
  }

  return result;
}

/**
 * Get claim history
 */
async function handleClaimHistory(
  input: z.infer<typeof claimHistorySchema>,
  context?: ToolContext
): Promise<{
  issueId: string;
  history: ClaimHistoryEntry[];
  total: number;
}> {
  if (context?.claimsService) {
    const result = await context.claimsService.getClaimHistory(input);
    return {
      issueId: input.issueId,
      history: result.history,
      total: result.total,
    };
  }

  // Simple implementation - mock history
  const claims = Array.from(claimStore.values())
    .filter(c => c.issueId === input.issueId)
    .sort((a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime());

  const history: ClaimHistoryEntry[] = claims.flatMap(claim => [
    {
      timestamp: claim.claimedAt,
      action: 'claimed',
      actorId: claim.claimantId,
      actorType: claim.claimantType,
    },
    ...(claim.status !== 'active' ? [{
      timestamp: claim.lastActivityAt,
      action: claim.status,
      actorId: claim.claimantId,
      actorType: claim.claimantType,
    }] : []),
  ]).slice(0, input.limit);

  return {
    issueId: input.issueId,
    history,
    total: history.length,
  };
}

/**
 * Get claim metrics
 */
async function handleClaimMetrics(
  input: z.infer<typeof claimMetricsSchema>,
  context?: ToolContext
): Promise<{
  timeRange: string;
  totalClaims: number;
  activeClaims: number;
  completedClaims: number;
  stolenClaims: number;
  averageClaimDurationMs: number;
  claimsByPriority: Record<IssuePriority, number>;
  claimsByStatus: Record<ClaimStatus, number>;
}> {
  if (context?.claimsService) {
    const metrics = await context.claimsService.getMetrics();
    return {
      timeRange: input.timeRange,
      totalClaims: metrics.totalClaims,
      activeClaims: metrics.activeClaims,
      completedClaims: metrics.completedClaims,
      stolenClaims: metrics.stolenClaims,
      averageClaimDurationMs: metrics.averageClaimDuration,
      claimsByPriority: metrics.claimsByPriority,
      claimsByStatus: metrics.claimsByStatus,
    };
  }

  // Simple implementation
  const claims = Array.from(claimStore.values());
  const byPriority: Record<IssuePriority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byStatus: Record<ClaimStatus, number> = {
    active: 0, blocked: 0, 'in-review': 0, completed: 0, released: 0, stolen: 0,
  };

  claims.forEach(c => {
    byPriority[c.priority]++;
    byStatus[c.status]++;
  });

  return {
    timeRange: input.timeRange,
    totalClaims: claims.length,
    activeClaims: byStatus.active,
    completedClaims: byStatus.completed,
    stolenClaims: byStatus.stolen,
    averageClaimDurationMs: 3600000, // 1 hour mock
    claimsByPriority: byPriority,
    claimsByStatus: byStatus,
  };
}

/**
 * Get/set claim configuration
 */
async function handleClaimConfig(
  input: z.infer<typeof claimConfigSchema>,
  _context?: ToolContext
): Promise<{
  action: 'get' | 'set';
  config: {
    defaultExpirationMs: number;
    maxClaimsPerAgent: number;
    contestWindowMs: number;
    autoReleaseOnInactivityMs: number;
  };
  updatedAt?: string;
}> {
  // Default configuration
  const defaultConfig = {
    defaultExpirationMs: 86400000, // 24 hours
    maxClaimsPerAgent: 5,
    contestWindowMs: 300000, // 5 minutes
    autoReleaseOnInactivityMs: 7200000, // 2 hours
  };

  if (input.action === 'get') {
    return {
      action: 'get',
      config: defaultConfig,
    };
  }

  // Set action
  const newConfig = {
    ...defaultConfig,
    ...input.config,
  };

  return {
    action: 'set',
    config: newConfig,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

// Core Claiming Tools

export const issueClaimTool: MCPTool = {
  name: 'claims/issue_claim',
  description: 'Claim an issue to work on. Prevents duplicate work by ensuring only one agent/human works on an issue at a time.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue ID to claim' },
      claimantType: { type: 'string', enum: ['human', 'agent'], description: 'Type of claimant' },
      claimantId: { type: 'string', description: 'ID of the claimant' },
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Override priority for the claim',
      },
      expiresInMs: {
        type: 'number',
        description: 'Claim expiration time in milliseconds',
        minimum: 1,
      },
    },
    required: ['issueId', 'claimantType', 'claimantId'],
  },
  handler: async (input, context) => {
    const validated = issueClaimSchema.parse(input);
    return handleIssueClaim(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'issue', 'coordination'],
  version: '1.0.0',
};

export const issueReleaseTool: MCPTool = {
  name: 'claims/issue_release',
  description: 'Release a claim on an issue, making it available for others to work on.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue ID to release' },
      claimantId: { type: 'string', description: 'ID of the current claimant' },
      reason: { type: 'string', description: 'Reason for releasing the claim' },
    },
    required: ['issueId', 'claimantId'],
  },
  handler: async (input, context) => {
    const validated = issueReleaseSchema.parse(input);
    return handleIssueRelease(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'issue', 'release'],
  version: '1.0.0',
};

export const issueHandoffTool: MCPTool = {
  name: 'claims/issue_handoff',
  description: 'Request handoff of an issue to another agent or human. Useful when blocked or needing specific expertise.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue ID for handoff' },
      fromId: { type: 'string', description: 'Current claimant ID' },
      toId: { type: 'string', description: 'Target claimant ID (optional for open handoff)' },
      toType: { type: 'string', enum: ['human', 'agent'], description: 'Target claimant type' },
      reason: {
        type: 'string',
        enum: ['blocked', 'expertise-needed', 'capacity', 'reassignment', 'other'],
        description: 'Reason for handoff',
      },
      notes: { type: 'string', description: 'Additional notes for handoff' },
    },
    required: ['issueId', 'fromId', 'reason'],
  },
  handler: async (input, context) => {
    const validated = issueHandoffSchema.parse(input);
    return handleIssueHandoff(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'issue', 'handoff', 'coordination'],
  version: '1.0.0',
};

export const issueStatusUpdateTool: MCPTool = {
  name: 'claims/issue_status_update',
  description: 'Update the status of a claimed issue. Track progress and communicate blockers.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue ID to update' },
      claimantId: { type: 'string', description: 'Current claimant ID' },
      status: {
        type: 'string',
        enum: ['active', 'blocked', 'in-review', 'completed'],
        description: 'New status',
      },
      progress: {
        type: 'number',
        description: 'Progress percentage (0-100)',
        minimum: 0,
        maximum: 100,
      },
      notes: { type: 'string', description: 'Status update notes' },
    },
    required: ['issueId', 'claimantId', 'status'],
  },
  handler: async (input, context) => {
    const validated = issueStatusUpdateSchema.parse(input);
    return handleIssueStatusUpdate(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'issue', 'status', 'progress'],
  version: '1.0.0',
};

export const issueListAvailableTool: MCPTool = {
  name: 'claims/issue_list_available',
  description: 'List all unclaimed issues available for work. Filter by priority, labels, or repository.',
  inputSchema: {
    type: 'object',
    properties: {
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Filter by priority',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by labels',
      },
      repository: { type: 'string', description: 'Filter by repository' },
      limit: {
        type: 'number',
        description: 'Maximum results',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
      offset: {
        type: 'number',
        description: 'Pagination offset',
        minimum: 0,
        default: 0,
      },
    },
  },
  handler: async (input, context) => {
    const validated = issueListAvailableSchema.parse(input);
    return handleIssueListAvailable(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'issue', 'list', 'available'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

export const issueListMineTool: MCPTool = {
  name: 'claims/issue_list_mine',
  description: 'List all issues claimed by a specific claimant. Filter by status.',
  inputSchema: {
    type: 'object',
    properties: {
      claimantId: { type: 'string', description: 'Claimant ID' },
      status: {
        type: 'string',
        enum: ['active', 'blocked', 'in-review', 'completed', 'released', 'stolen'],
        description: 'Filter by status',
      },
      limit: {
        type: 'number',
        description: 'Maximum results',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
      offset: {
        type: 'number',
        description: 'Pagination offset',
        minimum: 0,
        default: 0,
      },
    },
    required: ['claimantId'],
  },
  handler: async (input, context) => {
    const validated = issueListMineSchema.parse(input);
    return handleIssueListMine(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'issue', 'list', 'my-claims'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 2000,
};

export const issueBoardTool: MCPTool = {
  name: 'claims/issue_board',
  description: 'View the claim board showing who is working on what. Group by claimant, priority, or status.',
  inputSchema: {
    type: 'object',
    properties: {
      includeAgents: {
        type: 'boolean',
        description: 'Include agent claims',
        default: true,
      },
      includeHumans: {
        type: 'boolean',
        description: 'Include human claims',
        default: true,
      },
      groupBy: {
        type: 'string',
        enum: ['claimant', 'priority', 'status'],
        description: 'Group claims by field',
      },
    },
  },
  handler: async (input, context) => {
    const validated = issueBoardSchema.parse(input);
    return handleIssueBoard(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'board', 'overview', 'coordination'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

// Work Stealing Tools

export const issueMarkStealableTool: MCPTool = {
  name: 'claims/issue_mark_stealable',
  description: 'Mark a claimed issue as stealable, allowing other agents/humans to take over the work.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue ID to mark as stealable' },
      claimantId: { type: 'string', description: 'Current claimant ID' },
      reason: { type: 'string', description: 'Reason for making stealable' },
    },
    required: ['issueId', 'claimantId'],
  },
  handler: async (input, context) => {
    const validated = issueMarkStealableSchema.parse(input);
    return handleIssueMarkStealable(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'stealing', 'mark'],
  version: '1.0.0',
};

export const issueStealTool: MCPTool = {
  name: 'claims/issue_steal',
  description: 'Steal a stealable issue from another claimant. The previous claimant has a contest window to object.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue ID to steal' },
      stealerId: { type: 'string', description: 'ID of the stealer' },
      stealerType: { type: 'string', enum: ['human', 'agent'], description: 'Type of stealer' },
      reason: { type: 'string', description: 'Reason for stealing' },
    },
    required: ['issueId', 'stealerId', 'stealerType'],
  },
  handler: async (input, context) => {
    const validated = issueStealSchema.parse(input);
    return handleIssueSteal(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'stealing', 'takeover'],
  version: '1.0.0',
};

export const issueGetStealableTool: MCPTool = {
  name: 'claims/issue_get_stealable',
  description: 'List all issues marked as stealable. Filter by priority.',
  inputSchema: {
    type: 'object',
    properties: {
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Filter by priority',
      },
      limit: {
        type: 'number',
        description: 'Maximum results',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
    },
  },
  handler: async (input, context) => {
    const validated = issueGetStealableSchema.parse(input);
    return handleIssueGetStealable(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'stealing', 'list'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

export const issueContestStealTool: MCPTool = {
  name: 'claims/issue_contest_steal',
  description: 'Contest a steal within the contest window. Provide a reason for the contest.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue ID being contested' },
      contesterId: { type: 'string', description: 'ID of the contester' },
      reason: { type: 'string', description: 'Reason for contesting' },
    },
    required: ['issueId', 'contesterId', 'reason'],
  },
  handler: async (input, context) => {
    const validated = issueContestStealSchema.parse(input);
    return handleIssueContestSteal(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'stealing', 'contest'],
  version: '1.0.0',
};

// Load Balancing Tools

export const agentLoadInfoTool: MCPTool = {
  name: 'claims/agent_load_info',
  description: 'Get current load information for a specific agent including claims, tasks, and utilization.',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'Agent ID to get load info for' },
    },
    required: ['agentId'],
  },
  handler: async (input, context) => {
    const validated = agentLoadInfoSchema.parse(input);
    return handleAgentLoadInfo(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'load', 'agent', 'metrics'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 2000,
};

export const swarmRebalanceTool: MCPTool = {
  name: 'claims/swarm_rebalance',
  description: 'Trigger rebalancing of claims across the swarm to optimize load distribution.',
  inputSchema: {
    type: 'object',
    properties: {
      strategy: {
        type: 'string',
        enum: ['round-robin', 'least-loaded', 'priority-based', 'capability-based'],
        description: 'Rebalancing strategy',
        default: 'least-loaded',
      },
      dryRun: {
        type: 'boolean',
        description: 'Simulate without making changes',
        default: false,
      },
    },
  },
  handler: async (input, context) => {
    const validated = swarmRebalanceSchema.parse(input);
    return handleSwarmRebalance(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'load', 'swarm', 'rebalance'],
  version: '1.0.0',
};

export const swarmLoadOverviewTool: MCPTool = {
  name: 'claims/swarm_load_overview',
  description: 'Get swarm-wide load distribution including all agents, bottlenecks, and optimization recommendations.',
  inputSchema: {
    type: 'object',
    properties: {
      includeRecommendations: {
        type: 'boolean',
        description: 'Include optimization recommendations',
        default: true,
      },
    },
  },
  handler: async (input, context) => {
    const validated = swarmLoadOverviewSchema.parse(input);
    return handleSwarmLoadOverview(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'load', 'swarm', 'overview', 'metrics'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

// Additional Tools

export const claimHistoryTool: MCPTool = {
  name: 'claims/claim_history',
  description: 'Get the claim history for a specific issue showing all past claims and actions.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue ID to get history for' },
      limit: {
        type: 'number',
        description: 'Maximum entries',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
    },
    required: ['issueId'],
  },
  handler: async (input, context) => {
    const validated = claimHistorySchema.parse(input);
    return handleClaimHistory(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'history', 'audit'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 10000,
};

export const claimMetricsTool: MCPTool = {
  name: 'claims/claim_metrics',
  description: 'Get claiming metrics including totals, averages, and distributions by priority and status.',
  inputSchema: {
    type: 'object',
    properties: {
      timeRange: {
        type: 'string',
        enum: ['1h', '24h', '7d', '30d', 'all'],
        description: 'Time range for metrics',
        default: '24h',
      },
    },
  },
  handler: async (input, context) => {
    const validated = claimMetricsSchema.parse(input);
    return handleClaimMetrics(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'metrics', 'analytics'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 30000,
};

export const claimConfigTool: MCPTool = {
  name: 'claims/claim_config',
  description: 'Get or set claiming configuration including expiration times, limits, and contest windows.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'set'], description: 'Get or set configuration' },
      config: {
        type: 'object',
        description: 'Configuration values (for set action)',
        properties: {
          defaultExpirationMs: { type: 'number', minimum: 1 },
          maxClaimsPerAgent: { type: 'number', minimum: 1 },
          contestWindowMs: { type: 'number', minimum: 1 },
          autoReleaseOnInactivityMs: { type: 'number', minimum: 1 },
        },
      },
    },
    required: ['action'],
  },
  handler: async (input, context) => {
    const validated = claimConfigSchema.parse(input);
    return handleClaimConfig(validated, context);
  },
  category: 'claims',
  tags: ['claims', 'config', 'settings'],
  version: '1.0.0',
};

// ============================================================================
// Tool Collections
// ============================================================================

/**
 * Core claiming tools (7 tools)
 */
export const coreClaimingTools: MCPTool[] = [
  issueClaimTool,
  issueReleaseTool,
  issueHandoffTool,
  issueStatusUpdateTool,
  issueListAvailableTool,
  issueListMineTool,
  issueBoardTool,
];

/**
 * Work stealing tools (4 tools)
 */
export const workStealingTools: MCPTool[] = [
  issueMarkStealableTool,
  issueStealTool,
  issueGetStealableTool,
  issueContestStealTool,
];

/**
 * Load balancing tools (3 tools)
 */
export const loadBalancingTools: MCPTool[] = [
  agentLoadInfoTool,
  swarmRebalanceTool,
  swarmLoadOverviewTool,
];

/**
 * Additional tools (3 tools)
 */
export const additionalClaimsTools: MCPTool[] = [
  claimHistoryTool,
  claimMetricsTool,
  claimConfigTool,
];

/**
 * All claims tools (17 tools total)
 */
export const claimsTools: MCPTool[] = [
  ...coreClaimingTools,
  ...workStealingTools,
  ...loadBalancingTools,
  ...additionalClaimsTools,
];

// ============================================================================
// Registration Function
// ============================================================================

/**
 * Register all claims tools with an MCP server or tool registry
 *
 * @param registry - Tool registry or server to register with
 * @returns Number of tools registered
 *
 * @example
 * ```typescript
 * import { registerClaimsTools, claimsTools } from '@claude-flow/claims';
 *
 * // Register all tools
 * const count = registerClaimsTools(server);
 * console.log(`Registered ${count} claims tools`);
 *
 * // Or use tools directly
 * server.registerTools(claimsTools);
 * ```
 */
export function registerClaimsTools(
  registry: { registerTool?: (tool: MCPTool) => void; register?: (tool: MCPTool) => void }
): number {
  const registerFn = registry.registerTool || registry.register;

  if (!registerFn) {
    throw new Error('Registry must have a registerTool or register method');
  }

  claimsTools.forEach(tool => registerFn.call(registry, tool));

  return claimsTools.length;
}

/**
 * Get claims tools by category
 *
 * @param category - Category name: 'core', 'stealing', 'load', or 'additional'
 * @returns Array of tools in that category
 */
export function getClaimsToolsByCategory(
  category: 'core' | 'stealing' | 'load' | 'additional'
): MCPTool[] {
  switch (category) {
    case 'core':
      return coreClaimingTools;
    case 'stealing':
      return workStealingTools;
    case 'load':
      return loadBalancingTools;
    case 'additional':
      return additionalClaimsTools;
    default:
      return [];
  }
}

/**
 * Get a specific claims tool by name
 *
 * @param name - Tool name (e.g., 'claims/issue_claim')
 * @returns The tool if found, undefined otherwise
 */
export function getClaimsToolByName(name: string): MCPTool | undefined {
  return claimsTools.find(tool => tool.name === name);
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  // All tools
  claimsTools,

  // Tool categories
  coreClaimingTools,
  workStealingTools,
  loadBalancingTools,
  additionalClaimsTools,

  // Individual tools
  issueClaimTool,
  issueReleaseTool,
  issueHandoffTool,
  issueStatusUpdateTool,
  issueListAvailableTool,
  issueListMineTool,
  issueBoardTool,
  issueMarkStealableTool,
  issueStealTool,
  issueGetStealableTool,
  issueContestStealTool,
  agentLoadInfoTool,
  swarmRebalanceTool,
  swarmLoadOverviewTool,
  claimHistoryTool,
  claimMetricsTool,
  claimConfigTool,

  // Utility functions
  registerClaimsTools,
  getClaimsToolsByCategory,
  getClaimsToolByName,
};
