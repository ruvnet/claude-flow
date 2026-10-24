// @ts-nocheck - CLI integration requires the full @claude-flow/cli package
/**
 * V3 CLI Claims Command
 * Issue claiming and work distribution management
 *
 * Implements:
 * - Core claiming commands (list, claim, release, handoff, status)
 * - Work stealing commands (stealable, steal, mark-stealable, contest)
 * - Load balancing commands (load, rebalance)
 */

import type { Command, CommandContext, CommandResult } from './cli-types.js';
import { output, select, confirm, input, callMCPTool, MCPClientError } from './cli-types.js';

// ============================================
// Types
// ============================================

export interface ClaimServices {
  claimIssue: (issueId: string, claimantId: string, claimantType: ClaimantType) => Promise<Claim>;
  releaseClaim: (issueId: string, claimantId: string) => Promise<void>;
  requestHandoff: (issueId: string, targetId: string, targetType: ClaimantType) => Promise<HandoffRequest>;
  updateStatus: (issueId: string, status: ClaimStatus, reason?: string) => Promise<Claim>;
  listClaims: (filter?: ClaimFilter) => Promise<Claim[]>;
  listStealable: () => Promise<Claim[]>;
  stealIssue: (issueId: string, stealerId: string) => Promise<Claim>;
  markStealable: (issueId: string, reason?: string) => Promise<Claim>;
  contestSteal: (issueId: string, contesterId: string, reason: string) => Promise<ContestResult>;
  getAgentLoad: (agentId?: string) => Promise<AgentLoad[]>;
  rebalance: (dryRun?: boolean) => Promise<RebalanceResult>;
}

export type ClaimantType = 'agent' | 'human';
export type ClaimStatus = 'active' | 'blocked' | 'review-requested' | 'stealable' | 'completed';

export interface Claim {
  issueId: string;
  claimantId: string;
  claimantType: ClaimantType;
  status: ClaimStatus;
  progress: number;
  claimedAt: string;
  expiresAt?: string;
  blockedReason?: string;
  stealableReason?: string;
}

export interface ClaimFilter {
  claimantId?: string;
  status?: ClaimStatus;
  available?: boolean;
}

export interface HandoffRequest {
  issueId: string;
  fromId: string;
  toId: string;
  toType: ClaimantType;
  requestedAt: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface ContestResult {
  issueId: string;
  contesterId: string;
  originalClaimantId: string;
  resolution: 'steal-reverted' | 'steal-upheld' | 'pending-review';
  reason?: string;
}

export interface AgentLoad {
  agentId: string;
  agentType: string;
  activeIssues: number;
  totalCapacity: number;
  utilizationPercent: number;
  avgCompletionTime: string;
  status: 'healthy' | 'overloaded' | 'idle';
}

export interface RebalanceResult {
  moved: number;
  reassignments: Array<{
    issueId: string;
    fromAgent: string;
    toAgent: string;
    reason: string;
  }>;
  skipped: number;
  dryRun: boolean;
}

// ============================================
// Formatting Helpers
// ============================================

function formatClaimStatus(status: ClaimStatus): string {
  switch (status) {
    case 'active':
      return output.success(status);
    case 'blocked':
      return output.error(status);
    case 'review-requested':
      return output.warning(status);
    case 'stealable':
      return output.warning(status);
    case 'completed':
      return output.dim(status);
    default:
      return status;
  }
}

function formatClaimantType(type: ClaimantType): string {
  switch (type) {
    case 'agent':
      return output.info(type);
    case 'human':
      return output.highlight(type);
    default:
      return type;
  }
}

function formatAgentStatus(status: 'healthy' | 'overloaded' | 'idle'): string {
  switch (status) {
    case 'healthy':
      return output.success(status);
    case 'overloaded':
      return output.error(status);
    case 'idle':
      return output.dim(status);
    default:
      return status;
  }
}

function formatProgress(progress: number): string {
  if (progress >= 75) {
    return output.success(`${progress}%`);
  } else if (progress >= 25) {
    return output.warning(`${progress}%`);
  }
  return output.dim(`${progress}%`);
}

function formatTimeRemaining(expiresAt?: string): string {
  if (!expiresAt) return output.dim('N/A');

  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();

  if (diffMs <= 0) {
    return output.error('EXPIRED');
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours < 1) {
    return output.warning(`${minutes}m`);
  } else if (hours < 4) {
    return output.warning(`${hours}h ${minutes}m`);
  }

  return output.dim(`${hours}h ${minutes}m`);
}

function parseTarget(target: string): { id: string; type: ClaimantType } {
  // Format: agent:coder-1 or human:alice
  const [type, id] = target.split(':');
  if (!type || !id || (type !== 'agent' && type !== 'human')) {
    throw new Error(`Invalid target format: ${target}. Use agent:<id> or human:<id>`);
  }
  return { id, type: type as ClaimantType };
}

// ============================================
// List Subcommand
// ============================================

const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List issues',
  options: [
    {
      name: 'available',
      short: 'a',
      description: 'Show only unclaimed issues',
      type: 'boolean',
      default: false
    },
    {
      name: 'mine',
      short: 'm',
      description: 'Show only my claims',
      type: 'boolean',
      default: false
    },
    {
      name: 'status',
      short: 's',
      description: 'Filter by status',
      type: 'string',
      choices: ['active', 'blocked', 'review-requested', 'stealable', 'completed']
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum number of issues to show',
      type: 'number',
      default: 20
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const available = ctx.flags.available as boolean;
    const mine = ctx.flags.mine as boolean;
    const status = ctx.flags.status as ClaimStatus | undefined;
    const limit = ctx.flags.limit as number;

    try {
      const result = await callMCPTool<{
        claims: Claim[];
        total: number;
        available: number;
      }>('claims/list', {
        available,
        mine,
        status,
        limit
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();

      if (available) {
        output.writeln(output.bold('Available Issues (Unclaimed)'));
      } else if (mine) {
        output.writeln(output.bold('My Claims'));
      } else {
        output.writeln(output.bold('All Claims'));
      }

      output.writeln();

      if (result.claims.length === 0) {
        if (available) {
          output.printInfo('No unclaimed issues available');
        } else if (mine) {
          output.printInfo('You have no active claims');
        } else {
          output.printInfo('No claims found matching criteria');
        }
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'issueId', header: 'Issue', width: 12 },
          { key: 'claimant', header: 'Claimant', width: 15 },
          { key: 'type', header: 'Type', width: 8 },
          { key: 'status', header: 'Status', width: 16 },
          { key: 'progress', header: 'Progress', width: 10 },
          { key: 'time', header: 'Time Left', width: 12 }
        ],
        data: result.claims.map(c => ({
          issueId: c.issueId,
          claimant: c.claimantId || output.dim('unclaimed'),
          type: c.claimantType ? formatClaimantType(c.claimantType) : '-',
          status: formatClaimStatus(c.status),
          progress: formatProgress(c.progress),
          time: formatTimeRemaining(c.expiresAt)
        }))
      });

      output.writeln();
      output.printInfo(`Showing ${result.claims.length} of ${result.total} issues (${result.available} available)`);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to list issues: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// ============================================
// Claim Subcommand
// ============================================

const claimCommand: Command = {
  name: 'claim',
  description: 'Claim an issue to work on',
  options: [
    {
      name: 'as',
      description: 'Claim as specific identity (agent:id or human:id)',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = ctx.args[0];
    const asIdentity = ctx.flags.as as string | undefined;

    if (!issueId) {
      output.printError('Issue ID is required');
      output.printInfo('Usage: claude-flow issues claim <issueId>');
      return { success: false, exitCode: 1 };
    }

    let claimantId = 'current-agent';
    let claimantType: ClaimantType = 'agent';

    if (asIdentity) {
      const parsed = parseTarget(asIdentity);
      claimantId = parsed.id;
      claimantType = parsed.type;
    }

    output.writeln();
    output.printInfo(`Claiming issue ${output.highlight(issueId)}...`);

    try {
      const result = await callMCPTool<Claim>('claims/claim', {
        issueId,
        claimantId,
        claimantType
      });

      output.writeln();
      output.printSuccess(`Issue ${issueId} claimed successfully`);
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Issue ID', value: result.issueId },
          { property: 'Claimant', value: result.claimantId },
          { property: 'Type', value: formatClaimantType(result.claimantType) },
          { property: 'Status', value: formatClaimStatus(result.status) },
          { property: 'Claimed At', value: new Date(result.claimedAt).toLocaleString() },
          { property: 'Expires At', value: result.expiresAt ? new Date(result.expiresAt).toLocaleString() : 'N/A' }
        ]
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to claim issue: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// ============================================
// Release Subcommand
// ============================================

const releaseCommand: Command = {
  name: 'release',
  aliases: ['unclaim'],
  description: 'Release a claim on an issue',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force release without confirmation',
      type: 'boolean',
      default: false
    },
    {
      name: 'reason',
      short: 'r',
      description: 'Reason for releasing the claim',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = ctx.args[0];
    const force = ctx.flags.force as boolean;
    const reason = ctx.flags.reason as string | undefined;

    if (!issueId) {
      output.printError('Issue ID is required');
      output.printInfo('Usage: claude-flow issues release <issueId>');
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Release your claim on issue ${issueId}?`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    output.writeln();
    output.printInfo(`Releasing claim on issue ${output.highlight(issueId)}...`);

    try {
      await callMCPTool<void>('claims/release', {
        issueId,
        reason: reason || 'Released by user via CLI'
      });

      output.writeln();
      output.printSuccess(`Claim on issue ${issueId} released`);

      if (reason) {
        output.printInfo(`Reason: ${reason}`);
      }

      return { success: true };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to release claim: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// ============================================
// Handoff Subcommand
// ============================================

const handoffCommand: Command = {
  name: 'handoff',
  description: 'Request handoff of an issue to another agent or human',
  options: [
    {
      name: 'to',
      short: 't',
      description: 'Target for handoff (agent:id or human:id)',
      type: 'string',
      required: true
    },
    {
      name: 'reason',
      short: 'r',
      description: 'Reason for handoff',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = ctx.args[0];
    let target = ctx.flags.to as string;
    const reason = ctx.flags.reason as string | undefined;

    if (!issueId) {
      output.printError('Issue ID is required');
      output.printInfo('Usage: claude-flow issues handoff <issueId> --to <target>');
      return { success: false, exitCode: 1 };
    }

    if (!target && ctx.interactive) {
      target = await input({
        message: 'Handoff to (agent:id or human:id):',
        validate: (v) => {
          try {
            parseTarget(v);
            return true;
          } catch {
            return 'Invalid format. Use agent:<id> or human:<id>';
          }
        }
      });
    }

    if (!target) {
      output.printError('Target is required. Use --to flag (e.g., --to agent:coder-1)');
      return { success: false, exitCode: 1 };
    }

    const parsedTarget = parseTarget(target);

    output.writeln();
    output.printInfo(`Requesting handoff of ${output.highlight(issueId)} to ${output.highlight(target)}...`);

    try {
      const result = await callMCPTool<HandoffRequest>('claims/handoff', {
        issueId,
        targetId: parsedTarget.id,
        targetType: parsedTarget.type,
        reason
      });

      output.writeln();
      output.printSuccess(`Handoff requested for issue ${issueId}`);
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Issue ID', value: result.issueId },
          { property: 'From', value: result.fromId },
          { property: 'To', value: `${result.toType}:${result.toId}` },
          { property: 'Status', value: output.warning(result.status) },
          { property: 'Requested At', value: new Date(result.requestedAt).toLocaleString() }
        ]
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to request handoff: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// ============================================
// Status Subcommand
// ============================================

const statusCommand: Command = {
  name: 'status',
  description: 'Update or view issue claim status',
  options: [
    {
      name: 'blocked',
      short: 'b',
      description: 'Mark issue as blocked with reason',
      type: 'string'
    },
    {
      name: 'review-requested',
      short: 'r',
      description: 'Request review for the issue',
      type: 'boolean',
      default: false
    },
    {
      name: 'active',
      short: 'a',
      description: 'Mark issue as active (unblock)',
      type: 'boolean',
      default: false
    },
    {
      name: 'progress',
      short: 'p',
      description: 'Update progress percentage (0-100)',
      type: 'number'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = ctx.args[0];

    if (!issueId) {
      output.printError('Issue ID is required');
      output.printInfo('Usage: claude-flow issues status <issueId> [options]');
      return { success: false, exitCode: 1 };
    }

    const blocked = ctx.flags.blocked as string | undefined;
    const reviewRequested = ctx.flags['review-requested'] as boolean;
    const active = ctx.flags.active as boolean;
    const progress = ctx.flags.progress as number | undefined;

    // If no update flags, show current status
    if (!blocked && !reviewRequested && !active && progress === undefined) {
      try {
        const result = await callMCPTool<Claim>('claims/status', { issueId });

        if (ctx.flags.format === 'json') {
          output.printJson(result);
          return { success: true, data: result };
        }

        output.writeln();
        output.printBox(
          [
            `Claimant:    ${result.claimantId || 'unclaimed'}`,
            `Type:        ${formatClaimantType(result.claimantType)}`,
            `Status:      ${formatClaimStatus(result.status)}`,
            `Progress:    ${formatProgress(result.progress)}`,
            '',
            `Claimed At:  ${result.claimedAt ? new Date(result.claimedAt).toLocaleString() : 'N/A'}`,
            `Expires At:  ${result.expiresAt ? new Date(result.expiresAt).toLocaleString() : 'N/A'}`,
            '',
            result.blockedReason ? `Blocked:     ${result.blockedReason}` : '',
            result.stealableReason ? `Stealable:   ${result.stealableReason}` : ''
          ].filter(Boolean).join('\n'),
          `Issue: ${issueId}`
        );

        return { success: true, data: result };
      } catch (error) {
        if (error instanceof MCPClientError) {
          output.printError(`Failed to get status: ${error.message}`);
        } else {
          output.printError(`Unexpected error: ${String(error)}`);
        }
        return { success: false, exitCode: 1 };
      }
    }

    // Update status
    let newStatus: ClaimStatus | undefined;
    let reason: string | undefined;

    if (blocked) {
      newStatus = 'blocked';
      reason = blocked;
    } else if (reviewRequested) {
      newStatus = 'review-requested';
    } else if (active) {
      newStatus = 'active';
    }

    output.writeln();
    output.printInfo(`Updating issue ${output.highlight(issueId)}...`);

    try {
      const result = await callMCPTool<Claim>('claims/update', {
        issueId,
        status: newStatus,
        reason,
        progress
      });

      output.writeln();
      output.printSuccess(`Issue ${issueId} updated`);
      output.writeln();

      const updates: Array<{ property: string; value: string }> = [];

      if (newStatus) {
        updates.push({ property: 'Status', value: formatClaimStatus(result.status) });
      }

      if (reason) {
        updates.push({ property: 'Reason', value: reason });
      }

      if (progress !== undefined) {
        updates.push({ property: 'Progress', value: formatProgress(result.progress) });
      }

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: updates
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to update status: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// ============================================
// Board Subcommand
// ============================================

const boardCommand: Command = {
  name: 'board',
  description: 'View who is working on what',
  options: [
    {
      name: 'all',
      short: 'a',
      description: 'Show all issues including completed',
      type: 'boolean',
      default: false
    },
    {
      name: 'group',
      short: 'g',
      description: 'Group by claimant type',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const showAll = ctx.flags.all as boolean;
    const groupBy = ctx.flags.group as boolean;

    try {
      const result = await callMCPTool<{
        claims: Claim[];
        stats: {
          totalClaimed: number;
          totalAvailable: number;
          agentClaims: number;
          humanClaims: number;
        };
      }>('claims/board', {
        includeCompleted: showAll
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Issue Claims Board'));
      output.writeln();

      // Stats summary
      output.printList([
        `Total Claimed: ${output.highlight(String(result.stats.totalClaimed))}`,
        `Available: ${output.success(String(result.stats.totalAvailable))}`,
        `By Agents: ${output.info(String(result.stats.agentClaims))}`,
        `By Humans: ${output.highlight(String(result.stats.humanClaims))}`
      ]);

      output.writeln();

      if (result.claims.length === 0) {
        output.printInfo('No active claims');
        return { success: true, data: result };
      }

      if (groupBy) {
        // Group by claimant type
        const agents = result.claims.filter(c => c.claimantType === 'agent');
        const humans = result.claims.filter(c => c.claimantType === 'human');

        if (agents.length > 0) {
          output.writeln(output.bold('Agent Claims'));
          printBoardTable(agents);
          output.writeln();
        }

        if (humans.length > 0) {
          output.writeln(output.bold('Human Claims'));
          printBoardTable(humans);
          output.writeln();
        }
      } else {
        printBoardTable(result.claims);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to load board: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

function printBoardTable(claims: Claim[]): void {
  output.printTable({
    columns: [
      { key: 'issue', header: 'Issue', width: 12 },
      { key: 'claimant', header: 'Claimant', width: 15 },
      { key: 'type', header: 'Type', width: 8 },
      { key: 'status', header: 'Status', width: 16 },
      { key: 'progress', header: 'Progress', width: 10 },
      { key: 'time', header: 'Time', width: 12 }
    ],
    data: claims.map(c => ({
      issue: c.issueId,
      claimant: c.claimantId,
      type: formatClaimantType(c.claimantType),
      status: formatClaimStatus(c.status),
      progress: formatProgress(c.progress),
      time: formatTimeRemaining(c.expiresAt)
    }))
  });
}

// ============================================
// Work Stealing Commands
// ============================================

const stealableCommand: Command = {
  name: 'stealable',
  description: 'List stealable issues',
  options: [
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum number of issues to show',
      type: 'number',
      default: 20
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const limit = ctx.flags.limit as number;

    try {
      const result = await callMCPTool<{
        claims: Claim[];
        total: number;
      }>('claims/stealable', { limit });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Stealable Issues'));
      output.writeln();

      if (result.claims.length === 0) {
        output.printInfo('No stealable issues available');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'issue', header: 'Issue', width: 12 },
          { key: 'claimant', header: 'Current Owner', width: 15 },
          { key: 'progress', header: 'Progress', width: 10 },
          { key: 'reason', header: 'Stealable Reason', width: 30 }
        ],
        data: result.claims.map(c => ({
          issue: c.issueId,
          claimant: c.claimantId,
          progress: formatProgress(c.progress),
          reason: c.stealableReason || output.dim('No reason provided')
        }))
      });

      output.writeln();
      output.printInfo(`Showing ${result.claims.length} of ${result.total} stealable issues`);
      output.writeln();
      output.printInfo('Use "claude-flow issues steal <issueId>" to take over an issue');

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to list stealable issues: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

const stealCommand: Command = {
  name: 'steal',
  description: 'Steal an issue from another agent',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force steal without confirmation',
      type: 'boolean',
      default: false
    },
    {
      name: 'reason',
      short: 'r',
      description: 'Reason for stealing',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = ctx.args[0];
    const force = ctx.flags.force as boolean;
    const reason = ctx.flags.reason as string | undefined;

    if (!issueId) {
      output.printError('Issue ID is required');
      output.printInfo('Usage: claude-flow issues steal <issueId>');
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      output.writeln();
      output.printWarning('Work stealing should be used responsibly.');
      output.printInfo('This action will reassign the issue to you.');
      output.writeln();

      const confirmed = await confirm({
        message: `Steal issue ${issueId}?`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    output.writeln();
    output.printInfo(`Stealing issue ${output.highlight(issueId)}...`);

    try {
      const result = await callMCPTool<Claim>('claims/steal', {
        issueId,
        reason
      });

      output.writeln();
      output.printSuccess(`Issue ${issueId} stolen successfully`);
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Issue ID', value: result.issueId },
          { property: 'New Claimant', value: result.claimantId },
          { property: 'Status', value: formatClaimStatus(result.status) },
          { property: 'Progress', value: formatProgress(result.progress) }
        ]
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to steal issue: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

const markStealableCommand: Command = {
  name: 'mark-stealable',
  description: 'Mark my claim as stealable',
  options: [
    {
      name: 'reason',
      short: 'r',
      description: 'Reason for marking as stealable',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = ctx.args[0];
    let reason = ctx.flags.reason as string | undefined;

    if (!issueId) {
      output.printError('Issue ID is required');
      output.printInfo('Usage: claude-flow issues mark-stealable <issueId>');
      return { success: false, exitCode: 1 };
    }

    if (!reason && ctx.interactive) {
      reason = await input({
        message: 'Reason for marking as stealable (optional):',
        default: ''
      });
    }

    output.writeln();
    output.printInfo(`Marking issue ${output.highlight(issueId)} as stealable...`);

    try {
      const result = await callMCPTool<Claim>('claims/mark-stealable', {
        issueId,
        reason: reason || undefined
      });

      output.writeln();
      output.printSuccess(`Issue ${issueId} marked as stealable`);

      if (reason) {
        output.printInfo(`Reason: ${reason}`);
      }

      output.writeln();
      output.printWarning('Other agents can now claim this issue');

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to mark as stealable: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

const contestCommand: Command = {
  name: 'contest',
  description: 'Contest a steal action',
  options: [
    {
      name: 'reason',
      short: 'r',
      description: 'Reason for contesting (required)',
      type: 'string',
      required: true
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = ctx.args[0];
    let reason = ctx.flags.reason as string;

    if (!issueId) {
      output.printError('Issue ID is required');
      output.printInfo('Usage: claude-flow issues contest <issueId> --reason "..."');
      return { success: false, exitCode: 1 };
    }

    if (!reason && ctx.interactive) {
      reason = await input({
        message: 'Reason for contesting (required):',
        validate: (v) => v.length > 0 || 'Reason is required'
      });
    }

    if (!reason) {
      output.printError('Reason is required for contesting');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    output.printInfo(`Contesting steal on issue ${output.highlight(issueId)}...`);

    try {
      const result = await callMCPTool<ContestResult>('claims/contest', {
        issueId,
        reason
      });

      output.writeln();

      switch (result.resolution) {
        case 'steal-reverted':
          output.printSuccess('Contest successful - steal reverted');
          output.printInfo(`Issue ${issueId} returned to original claimant: ${result.originalClaimantId}`);
          break;
        case 'steal-upheld':
          output.printWarning('Contest denied - steal upheld');
          output.printInfo(`Issue ${issueId} remains with: ${result.contesterId}`);
          break;
        case 'pending-review':
          output.printWarning('Contest submitted for review');
          output.printInfo('A coordinator will review this contest');
          break;
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to contest steal: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// ============================================
// Load Balancing Commands
// ============================================

const loadCommand: Command = {
  name: 'load',
  description: 'View agent load distribution',
  options: [
    {
      name: 'agent',
      short: 'a',
      description: 'View specific agent load',
      type: 'string'
    },
    {
      name: 'sort',
      short: 's',
      description: 'Sort by field',
      type: 'string',
      choices: ['utilization', 'issues', 'agent'],
      default: 'utilization'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.flags.agent as string | undefined;
    const sortBy = ctx.flags.sort as string;

    try {
      const result = await callMCPTool<{
        agents: AgentLoad[];
        summary: {
          totalAgents: number;
          totalIssues: number;
          avgUtilization: number;
          overloadedCount: number;
          idleCount: number;
        };
      }>('claims/load', {
        agentId,
        sortBy
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Agent Load Distribution'));
      output.writeln();

      // Summary
      output.printList([
        `Total Agents: ${result.summary.totalAgents}`,
        `Active Issues: ${result.summary.totalIssues}`,
        `Avg Utilization: ${result.summary.avgUtilization.toFixed(1)}%`,
        `Overloaded: ${output.error(String(result.summary.overloadedCount))}`,
        `Idle: ${output.dim(String(result.summary.idleCount))}`
      ]);

      output.writeln();

      if (agentId) {
        // Single agent detail
        const agent = result.agents[0];
        if (!agent) {
          output.printError(`Agent ${agentId} not found`);
          return { success: false, exitCode: 1 };
        }

        output.printBox(
          [
            `Type:           ${agent.agentType}`,
            `Status:         ${formatAgentStatus(agent.status)}`,
            `Active Issues:  ${agent.activeIssues}`,
            `Capacity:       ${agent.totalCapacity}`,
            `Utilization:    ${output.progressBar(agent.utilizationPercent, 100, 30)}`,
            `Avg Completion: ${agent.avgCompletionTime}`
          ].join('\n'),
          `Agent: ${agent.agentId}`
        );
      } else {
        // All agents table
        output.printTable({
          columns: [
            { key: 'agent', header: 'Agent', width: 15 },
            { key: 'type', header: 'Type', width: 12 },
            { key: 'issues', header: 'Issues', width: 8, align: 'right' },
            { key: 'capacity', header: 'Cap', width: 6, align: 'right' },
            { key: 'utilization', header: 'Utilization', width: 15 },
            { key: 'status', header: 'Status', width: 12 }
          ],
          data: result.agents.map(a => ({
            agent: a.agentId,
            type: a.agentType,
            issues: a.activeIssues,
            capacity: a.totalCapacity,
            utilization: `${a.utilizationPercent.toFixed(0)}%`,
            status: formatAgentStatus(a.status)
          }))
        });
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to get load info: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

const rebalanceCommand: Command = {
  name: 'rebalance',
  description: 'Trigger swarm rebalancing',
  options: [
    {
      name: 'dry-run',
      short: 'd',
      description: 'Preview rebalancing without making changes',
      type: 'boolean',
      default: false
    },
    {
      name: 'force',
      short: 'f',
      description: 'Force rebalancing without confirmation',
      type: 'boolean',
      default: false
    },
    {
      name: 'threshold',
      short: 't',
      description: 'Utilization threshold for rebalancing (0-100)',
      type: 'number',
      default: 80
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dryRun = ctx.flags['dry-run'] as boolean;
    const force = ctx.flags.force as boolean;
    const threshold = ctx.flags.threshold as number;

    if (!dryRun && !force && ctx.interactive) {
      output.writeln();
      output.printWarning('This will reassign issues between agents to balance load.');

      const confirmed = await confirm({
        message: 'Proceed with rebalancing?',
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    output.writeln();

    if (dryRun) {
      output.printInfo('Analyzing rebalancing options (dry run)...');
    } else {
      output.printInfo('Rebalancing swarm workload...');
    }

    const spinner = output.createSpinner({ text: 'Calculating optimal distribution...', spinner: 'dots' });
    spinner.start();

    try {
      const result = await callMCPTool<RebalanceResult>('claims/rebalance', {
        dryRun,
        threshold
      });

      spinner.stop();

      output.writeln();

      if (dryRun) {
        output.printSuccess('Rebalancing Analysis Complete (Dry Run)');
      } else {
        output.printSuccess('Rebalancing Complete');
      }

      output.writeln();

      // Summary stats
      output.printList([
        `Issues to move: ${output.highlight(String(result.moved))}`,
        `Issues skipped: ${output.dim(String(result.skipped))}`,
        `Mode: ${dryRun ? output.warning('DRY RUN') : output.success('APPLIED')}`
      ]);

      if (result.reassignments.length > 0) {
        output.writeln();
        output.writeln(output.bold('Reassignments'));

        output.printTable({
          columns: [
            { key: 'issue', header: 'Issue', width: 12 },
            { key: 'from', header: 'From', width: 15 },
            { key: 'to', header: 'To', width: 15 },
            { key: 'reason', header: 'Reason', width: 30 }
          ],
          data: result.reassignments.map(r => ({
            issue: r.issueId,
            from: r.fromAgent,
            to: r.toAgent,
            reason: r.reason
          }))
        });

        if (dryRun) {
          output.writeln();
          output.printInfo('Run without --dry-run to apply these changes');
        }
      } else {
        output.writeln();
        output.printInfo('No reassignments needed - workload is balanced');
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Rebalancing failed');

      if (error instanceof MCPClientError) {
        output.printError(`Failed to rebalance: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// ============================================
// Main Issues Command
// ============================================

export const issuesCommand: Command = {
  name: 'issues',
  description: 'Manage issue claims and work distribution',
  subcommands: [
    // Core claiming
    listCommand,
    claimCommand,
    releaseCommand,
    handoffCommand,
    statusCommand,
    boardCommand,
    // Work stealing
    stealableCommand,
    stealCommand,
    markStealableCommand,
    contestCommand,
    // Load balancing
    loadCommand,
    rebalanceCommand
  ],
  options: [],
  examples: [
    { command: 'claude-flow issues list --available', description: 'List unclaimed issues' },
    { command: 'claude-flow issues list --mine', description: 'List my claims' },
    { command: 'claude-flow issues claim GH-123', description: 'Claim an issue' },
    { command: 'claude-flow issues release GH-123', description: 'Release a claim' },
    { command: 'claude-flow issues handoff GH-123 --to agent:coder-1', description: 'Request handoff to agent' },
    { command: 'claude-flow issues handoff GH-123 --to human:alice', description: 'Request handoff to human' },
    { command: 'claude-flow issues status GH-123 --blocked "Waiting for API"', description: 'Mark as blocked' },
    { command: 'claude-flow issues status GH-123 --review-requested', description: 'Request review' },
    { command: 'claude-flow issues board', description: 'View who is working on what' },
    { command: 'claude-flow issues stealable', description: 'List stealable issues' },
    { command: 'claude-flow issues steal GH-123', description: 'Steal an issue' },
    { command: 'claude-flow issues mark-stealable GH-123', description: 'Mark my claim as stealable' },
    { command: 'claude-flow issues contest GH-123 -r "I was actively working on it"', description: 'Contest a steal' },
    { command: 'claude-flow issues load', description: 'View agent load distribution' },
    { command: 'claude-flow issues load --agent coder-1', description: 'View specific agent load' },
    { command: 'claude-flow issues rebalance --dry-run', description: 'Preview rebalancing' },
    { command: 'claude-flow issues rebalance', description: 'Trigger swarm rebalancing' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Show help if no subcommand
    output.writeln();
    output.writeln(output.bold('Issue Claims Management'));
    output.writeln();
    output.writeln('Usage: claude-flow issues <subcommand> [options]');
    output.writeln();

    output.writeln(output.bold('Core Commands'));
    output.printList([
      `${output.highlight('list')}           - List issues (--available, --mine)`,
      `${output.highlight('claim')}          - Claim an issue to work on`,
      `${output.highlight('release')}        - Release a claim on an issue`,
      `${output.highlight('handoff')}        - Request handoff to another agent/human`,
      `${output.highlight('status')}         - Update or view issue claim status`,
      `${output.highlight('board')}          - View who is working on what`
    ]);

    output.writeln();
    output.writeln(output.bold('Work Stealing Commands'));
    output.printList([
      `${output.highlight('stealable')}      - List stealable issues`,
      `${output.highlight('steal')}          - Steal an issue from another agent`,
      `${output.highlight('mark-stealable')} - Mark my claim as stealable`,
      `${output.highlight('contest')}        - Contest a steal action`
    ]);

    output.writeln();
    output.writeln(output.bold('Load Balancing Commands'));
    output.printList([
      `${output.highlight('load')}           - View agent load distribution`,
      `${output.highlight('rebalance')}      - Trigger swarm rebalancing`
    ]);

    output.writeln();
    output.writeln('Run "claude-flow issues <subcommand> --help" for subcommand help');

    return { success: true };
  }
};

// ============================================
// Factory Function (for dependency injection)
// ============================================

/**
 * Create issues command with injected services
 * This allows for testing with mock services
 */
export function createIssuesCommand(services: ClaimServices): Command {
  // The command structure remains the same, but actions would use
  // the injected services instead of callMCPTool
  // For now, we return the default command which uses MCP tools
  return issuesCommand;
}

export default issuesCommand;
