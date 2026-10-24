/**
 * V3 Issues Command
 *
 * Implements ADR-016: Collaborative Issue Claims for Human-Agent Workflows
 *
 * Commands:
 * - issues list       List all claims
 * - issues claim      Claim an issue
 * - issues release    Release a claim
 * - issues handoff    Request handoff
 * - issues status     Update claim status
 * - issues stealable  List stealable issues
 * - issues steal      Steal an issue
 * - issues load       View agent load
 * - issues rebalance  Rebalance swarm
 * - issues board      Visual board view
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { createClaimService, type Claimant, type ClaimStatus } from '../services/claim-service.js';

// ============================================================================
// Subcommands
// ============================================================================

const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List all issue claims',
  options: [
    {
      name: 'status',
      short: 's',
      description: 'Filter by status',
      type: 'string',
      choices: ['active', 'paused', 'blocked', 'stealable', 'completed', 'handoff-pending', 'review-requested'],
    },
    {
      name: 'mine',
      short: 'm',
      description: 'Show only my claims',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const service = createClaimService(ctx.cwd);
    await service.initialize();

    const status = ctx.flags.status as ClaimStatus | undefined;
    const claims = status
      ? await service.getByStatus(status)
      : await service.getAllClaims();

    if (claims.length === 0) {
      output.printInfo('No claims found');
      return { success: true, data: { claims: [] } };
    }

    output.writeln();
    output.writeln(output.bold('Issue Claims (ADR-016)'));
    output.writeln();

    const rows = claims.map(c => ({
      issue: c.issueId,
      claimant: c.claimant.type === 'human'
        ? `👤 ${c.claimant.name}`
        : `🤖 ${c.claimant.agentType}`,
      status: formatStatus(c.status),
      progress: `${c.progress}%`,
      since: formatDuration(Date.now() - c.claimedAt.getTime()),
    }));

    output.printTable({
      columns: [
        { key: 'issue', header: 'Issue', width: 12 },
        { key: 'claimant', header: 'Claimant', width: 18 },
        { key: 'status', header: 'Status', width: 20 },
        { key: 'progress', header: 'Progress', width: 10 },
        { key: 'since', header: 'Since', width: 10 },
      ],
      data: rows,
    });

    if (ctx.flags.format === 'json') {
      output.printJson(claims);
    }

    return { success: true, data: { claims } };
  },
};

const claimCommand: Command = {
  name: 'claim',
  description: 'Claim an issue',
  options: [
    {
      name: 'issue',
      short: 'i',
      description: 'Issue ID to claim',
      type: 'string',
    },
    {
      name: 'agent',
      short: 'a',
      description: 'Claim as agent (format: type:id)',
      type: 'string',
    },
    {
      name: 'user',
      short: 'u',
      description: 'Claim as user (format: id:name)',
      type: 'string',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = (ctx.flags.issue || ctx.args[0]) as string;
    const agentStr = ctx.flags.agent as string | undefined;
    const userStr = ctx.flags.user as string | undefined;

    if (!issueId) {
      output.printError('Issue ID is required');
      return { success: false, exitCode: 1 };
    }

    if (!agentStr && !userStr) {
      output.printError('Must specify --agent or --user');
      return { success: false, exitCode: 1 };
    }

    const claimant: Claimant = agentStr
      ? {
          type: 'agent',
          agentType: agentStr.split(':')[0],
          agentId: agentStr.split(':')[1] || `${agentStr.split(':')[0]}-1`,
        }
      : {
          type: 'human',
          userId: userStr!.split(':')[0],
          name: userStr!.split(':')[1] || userStr!.split(':')[0],
        };

    const service = createClaimService(ctx.cwd);
    await service.initialize();

    const result = await service.claim(issueId, claimant);

    if (result.success) {
      output.printSuccess(`Claimed issue ${issueId}`);
      return { success: true, data: result.claim };
    } else {
      output.printError(result.error || 'Failed to claim issue');
      return { success: false, exitCode: 1 };
    }
  },
};

const releaseCommand: Command = {
  name: 'release',
  description: 'Release a claim',
  options: [
    {
      name: 'issue',
      short: 'i',
      description: 'Issue ID to release',
      type: 'string',
    },
    {
      name: 'agent',
      short: 'a',
      description: 'Release as agent',
      type: 'string',
    },
    {
      name: 'user',
      short: 'u',
      description: 'Release as user',
      type: 'string',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = (ctx.flags.issue || ctx.args[0]) as string;
    const agentStr = ctx.flags.agent as string | undefined;
    const userStr = ctx.flags.user as string | undefined;

    if (!issueId) {
      output.printError('Issue ID is required');
      return { success: false, exitCode: 1 };
    }

    if (!agentStr && !userStr) {
      output.printError('Must specify --agent or --user');
      return { success: false, exitCode: 1 };
    }

    const claimant: Claimant = agentStr
      ? {
          type: 'agent',
          agentType: agentStr.split(':')[0],
          agentId: agentStr.split(':')[1] || `${agentStr.split(':')[0]}-1`,
        }
      : {
          type: 'human',
          userId: userStr!.split(':')[0],
          name: userStr!.split(':')[1] || userStr!.split(':')[0],
        };

    const service = createClaimService(ctx.cwd);
    await service.initialize();

    try {
      await service.release(issueId, claimant);
      output.printSuccess(`Released claim on issue ${issueId}`);
      return { success: true };
    } catch (error) {
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

const handoffCommand: Command = {
  name: 'handoff',
  description: 'Request handoff to another agent/user',
  options: [
    { name: 'issue', short: 'i', type: 'string', description: 'Issue ID' },
    { name: 'to', description: 'Target (agent:type:id or user:id:name)', type: 'string' },
    { name: 'from', description: 'Current owner', type: 'string' },
    { name: 'reason', short: 'r', type: 'string', description: 'Handoff reason', default: 'Handoff requested' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = (ctx.flags.issue || ctx.args[0]) as string;
    const toStr = ctx.flags.to as string;
    const fromStr = ctx.flags.from as string;
    const reason = ctx.flags.reason as string;

    if (!issueId || !toStr) {
      output.printError('Issue ID and --to are required');
      return { success: false, exitCode: 1 };
    }

    const to = parseClaimant(toStr);
    if (!to) {
      output.printError('Invalid --to format. Use agent:type:id or user:id:name');
      return { success: false, exitCode: 1 };
    }

    const service = createClaimService(ctx.cwd);
    await service.initialize();

    // Get current claim to find "from"
    const claim = await service.getIssueStatus(issueId);
    if (!claim) {
      output.printError(`Issue ${issueId} is not claimed`);
      return { success: false, exitCode: 1 };
    }

    const from = fromStr ? parseClaimant(fromStr) : claim.claimant;
    if (!from) {
      output.printError('Could not determine current owner');
      return { success: false, exitCode: 1 };
    }

    try {
      await service.requestHandoff(issueId, from, to, reason);
      output.printSuccess(`Handoff requested for issue ${issueId}`);
      return { success: true };
    } catch (error) {
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

const statusCommand: Command = {
  name: 'status',
  description: 'Update claim status',
  options: [
    { name: 'issue', short: 'i', type: 'string', description: 'Issue ID' },
    { name: 'set', short: 's', type: 'string', description: 'New status', choices: ['active', 'paused', 'blocked', 'completed'] },
    { name: 'progress', short: 'p', type: 'number', description: 'Progress (0-100)' },
    { name: 'note', short: 'n', type: 'string', description: 'Status note' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = (ctx.flags.issue || ctx.args[0]) as string;

    if (!issueId) {
      output.printError('Issue ID is required');
      return { success: false, exitCode: 1 };
    }

    const service = createClaimService(ctx.cwd);
    await service.initialize();

    const newStatus = ctx.flags.set as ClaimStatus | undefined;
    const progress = ctx.flags.progress as number | undefined;
    const note = ctx.flags.note as string | undefined;

    try {
      if (newStatus) {
        await service.updateStatus(issueId, newStatus, note);
        output.printSuccess(`Updated status to ${newStatus}`);
      }

      if (progress !== undefined) {
        await service.updateProgress(issueId, progress);
        output.printSuccess(`Updated progress to ${progress}%`);
      }

      const claim = await service.getIssueStatus(issueId);
      if (claim) {
        output.writeln();
        output.printBox([
          `Issue: ${claim.issueId}`,
          `Status: ${formatStatus(claim.status)}`,
          `Progress: ${claim.progress}%`,
          `Claimant: ${formatClaimant(claim.claimant)}`,
        ].join('\n'), 'Claim Status');
      }

      return { success: true, data: claim };
    } catch (error) {
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

const stealableCommand: Command = {
  name: 'stealable',
  description: 'List stealable issues',
  options: [
    { name: 'type', short: 't', type: 'string', description: 'Filter by agent type' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentType = ctx.flags.type as string | undefined;

    const service = createClaimService(ctx.cwd);
    await service.initialize();

    const stealable = await service.getStealable(agentType);

    if (stealable.length === 0) {
      output.printInfo('No stealable issues found');
      return { success: true, data: { stealable: [] } };
    }

    output.writeln();
    output.writeln(output.bold('🎯 Stealable Issues'));
    output.writeln();

    for (const c of stealable) {
      output.writeln(`  ${output.highlight(c.issueId)}`);
      output.writeln(`    Owner: ${formatClaimant(c.claimant)}`);
      output.writeln(`    Progress: ${c.progress}%`);
      if (c.context) output.writeln(`    Context: ${c.context.slice(0, 60)}...`);
      output.writeln();
    }

    return { success: true, data: { stealable } };
  },
};

const stealCommand: Command = {
  name: 'steal',
  description: 'Steal a stealable issue',
  options: [
    { name: 'issue', short: 'i', type: 'string', description: 'Issue ID' },
    { name: 'agent', short: 'a', type: 'string', description: 'Steal as agent', required: true },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const issueId = (ctx.flags.issue || ctx.args[0]) as string;
    const agentStr = ctx.flags.agent as string;

    if (!issueId) {
      output.printError('Issue ID is required');
      return { success: false, exitCode: 1 };
    }

    const stealer: Claimant = {
      type: 'agent',
      agentType: agentStr.split(':')[0],
      agentId: agentStr.split(':')[1] || `${agentStr.split(':')[0]}-1`,
    };

    const service = createClaimService(ctx.cwd);
    await service.initialize();

    const result = await service.steal(issueId, stealer);

    if (result.success) {
      output.printSuccess(`🎯 Stole issue ${issueId}`);
      if (result.previousOwner) {
        output.printInfo(`Previous: ${formatClaimant(result.previousOwner)}`);
      }
      if (result.context) {
        output.printInfo(`Progress: ${result.context.progress}%`);
      }
      return { success: true, data: result };
    } else {
      output.printError(result.error || 'Failed to steal issue');
      return { success: false, exitCode: 1 };
    }
  },
};

const loadCommand: Command = {
  name: 'load',
  description: 'View agent load distribution',
  options: [
    { name: 'agent', short: 'a', type: 'string', description: 'Specific agent ID' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.flags.agent as string | undefined;

    const service = createClaimService(ctx.cwd);
    await service.initialize();

    if (agentId) {
      const load = await service.getAgentLoad(agentId);
      output.writeln();
      output.writeln(output.bold(`📊 Load: ${agentId}`));
      output.writeln();
      output.printList([
        `Claims: ${load.claimCount}/${load.maxClaims}`,
        `Utilization: ${(load.utilization * 100).toFixed(0)}%`,
        `Blocked: ${load.currentBlockedCount}`,
      ]);
      return { success: true, data: load };
    }

    const claims = await service.getAllClaims();
    const agentLoads = new Map<string, { count: number; type: string }>();

    for (const claim of claims) {
      if (claim.claimant.type === 'agent') {
        const id = claim.claimant.agentId;
        const existing = agentLoads.get(id);
        agentLoads.set(id, {
          count: (existing?.count || 0) + 1,
          type: claim.claimant.agentType,
        });
      }
    }

    output.writeln();
    output.writeln(output.bold('📊 Agent Load Distribution'));
    output.writeln();

    if (agentLoads.size === 0) {
      output.printInfo('No agent claims found');
    } else {
      for (const [id, data] of agentLoads) {
        const bar = '█'.repeat(data.count) + '░'.repeat(Math.max(0, 5 - data.count));
        output.writeln(`  ${id} (${data.type}): ${bar} ${data.count}`);
      }
    }

    return { success: true, data: Object.fromEntries(agentLoads) };
  },
};

const rebalanceCommand: Command = {
  name: 'rebalance',
  description: 'Rebalance work across swarm',
  options: [
    { name: 'dry-run', type: 'boolean', default: true, description: 'Preview only' },
    { name: 'apply', type: 'boolean', default: false, description: 'Apply changes' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const apply = ctx.flags.apply as boolean;

    const service = createClaimService(ctx.cwd);
    await service.initialize();

    const result = await service.rebalance('default');

    if (result.suggested.length === 0) {
      output.printSuccess('⚖️ Swarm is balanced');
      return { success: true, data: result };
    }

    output.writeln();
    output.writeln(output.bold(apply ? '⚖️ Rebalancing' : '⚖️ Rebalance Preview'));
    output.writeln();

    for (const s of result.suggested) {
      const from = s.currentOwner.type === 'agent' ? s.currentOwner.agentId : s.currentOwner.name;
      const to = s.suggestedOwner.type === 'agent' ? s.suggestedOwner.agentId : (s.suggestedOwner as { name?: string }).name;
      output.writeln(`  ${s.issueId}: ${from} → ${to}`);
    }

    if (!apply) {
      output.writeln();
      output.printInfo('Use --apply to execute');
    }

    return { success: true, data: result };
  },
};

const boardCommand: Command = {
  name: 'board',
  description: 'Visual board view of claims',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const service = createClaimService(ctx.cwd);
    await service.initialize();

    const claims = await service.getAllClaims();

    const byStatus: Record<string, typeof claims> = {
      active: [],
      blocked: [],
      'review-requested': [],
      stealable: [],
      completed: [],
    };

    for (const c of claims) {
      const key = c.status in byStatus ? c.status : 'active';
      byStatus[key].push(c);
    }

    output.writeln();
    output.writeln(output.bold('📋 Issue Board (ADR-016)'));
    output.writeln();

    const columns = ['active', 'blocked', 'review-requested', 'stealable', 'completed'];
    const headers = ['🔵 Active', '🔴 Blocked', '🟡 Review', '🟢 Stealable', '✅ Done'];

    // Print column headers
    output.writeln(headers.map(h => h.padEnd(18)).join(''));
    output.writeln('─'.repeat(90));

    // Find max rows
    const maxRows = Math.max(...Object.values(byStatus).map(arr => arr.length), 1);

    for (let i = 0; i < maxRows; i++) {
      const row = columns.map(col => {
        const item = byStatus[col][i];
        if (!item) return ''.padEnd(18);
        const owner = item.claimant.type === 'agent' ? item.claimant.agentType.slice(0, 6) : item.claimant.name.slice(0, 6);
        return `#${item.issueId} (${owner})`.padEnd(18);
      });
      output.writeln(row.join(''));
    }

    return { success: true };
  },
};

// ============================================================================
// Main Command
// ============================================================================

export const issuesCommand: Command = {
  name: 'issues',
  description: 'Collaborative issue claims for human-agent workflows (ADR-016)',
  subcommands: [
    listCommand,
    claimCommand,
    releaseCommand,
    handoffCommand,
    statusCommand,
    stealableCommand,
    stealCommand,
    loadCommand,
    rebalanceCommand,
    boardCommand,
  ],
  examples: [
    { command: 'claude-flow issues list', description: 'List all claims' },
    { command: 'claude-flow issues claim 123 --agent coder:coder-1', description: 'Claim as agent' },
    { command: 'claude-flow issues handoff 123 --to agent:tester:tester-1', description: 'Handoff to tester' },
    { command: 'claude-flow issues stealable', description: 'List stealable' },
    { command: 'claude-flow issues steal 123 --agent coder:coder-2', description: 'Steal issue' },
    { command: 'claude-flow issues board', description: 'Visual board' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('📋 Issue Claims (ADR-016)'));
    output.writeln(output.dim('Collaborative human-agent issue management'));
    output.writeln();
    output.writeln('Commands:');
    output.printList([
      'list       - List all claims',
      'claim      - Claim an issue',
      'release    - Release a claim',
      'handoff    - Request handoff',
      'status     - Update status/progress',
      'stealable  - List stealable issues',
      'steal      - Steal an issue',
      'load       - View agent load',
      'rebalance  - Rebalance swarm',
      'board      - Visual board view',
    ]);
    return { success: true };
  },
};

// ============================================================================
// Helpers
// ============================================================================

function parseClaimant(str: string): Claimant | null {
  const parts = str.split(':');
  if (parts[0] === 'agent' && parts.length >= 2) {
    return { type: 'agent', agentType: parts[1], agentId: parts[2] || `${parts[1]}-1` };
  }
  if (parts[0] === 'user' && parts.length >= 2) {
    return { type: 'human', userId: parts[1], name: parts[2] || parts[1] };
  }
  return null;
}

function formatClaimant(c: Claimant): string {
  return c.type === 'human' ? `👤 ${c.name}` : `🤖 ${c.agentType}:${c.agentId}`;
}

function formatStatus(status: ClaimStatus): string {
  const icons: Record<ClaimStatus, string> = {
    active: '🔵',
    paused: '⏸️',
    blocked: '🔴',
    stealable: '🟢',
    completed: '✅',
    'handoff-pending': '🔄',
    'review-requested': '🟡',
  };
  return `${icons[status] || '❓'} ${status}`;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default issuesCommand;
