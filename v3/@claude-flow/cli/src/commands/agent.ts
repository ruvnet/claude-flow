/**
 * V3 CLI Agent Command
 * Agent management commands for spawning, listing, and controlling agents
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm, input } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { wasmSubcommands } from './agent-wasm.js';
import { agentPublishCommand } from './agntcy/publish.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Update swarm-activity.json metrics after agent count changes.
 * The statusline reads this file to display the swarm agent count.
 */
function updateSwarmActivityMetrics(agentCountDelta: number): void {
  try {
    const metricsDir = path.join(process.cwd(), '.claude-flow', 'metrics');
    const activityPath = path.join(metricsDir, 'swarm-activity.json');

    let data: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      swarm: { active: false, agent_count: 0, coordination_active: false },
    };

    if (fs.existsSync(activityPath)) {
      data = JSON.parse(fs.readFileSync(activityPath, 'utf-8'));
    } else {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const swarm = (data.swarm as Record<string, unknown>) ?? {};
    const currentCount = Math.max(0, (swarm.agent_count as number) || 0);
    const newCount = Math.max(0, currentCount + agentCountDelta);

    swarm.agent_count = newCount;
    swarm.active = newCount > 0;
    swarm.coordination_active = newCount > 0;
    data.swarm = swarm;
    data.timestamp = new Date().toISOString();

    fs.writeFileSync(activityPath, JSON.stringify(data, null, 2));
  } catch {
    // Non-critical — don't fail the command if metrics update fails
  }
}

// Available agent types with descriptions
const AGENT_TYPES = [
  { value: 'coder', label: 'Coder', hint: 'Code development with neural patterns' },
  { value: 'researcher', label: 'Researcher', hint: 'Research with web access and data analysis' },
  { value: 'tester', label: 'Tester', hint: 'Comprehensive testing with automation' },
  { value: 'reviewer', label: 'Reviewer', hint: 'Code review with security and quality checks' },
  { value: 'architect', label: 'Architect', hint: 'System design with enterprise patterns' },
  { value: 'coordinator', label: 'Coordinator', hint: 'Multi-agent orchestration and workflow' },
  { value: 'analyst', label: 'Analyst', hint: 'Performance analysis and optimization' },
  { value: 'optimizer', label: 'Optimizer', hint: 'Performance optimization and bottleneck analysis' },
  { value: 'security-architect', label: 'Security Architect', hint: 'Security architecture and threat modeling' },
  { value: 'security-auditor', label: 'Security Auditor', hint: 'CVE remediation and security testing' },
  { value: 'memory-specialist', label: 'Memory Specialist', hint: 'AgentDB unification (150x-12,500x faster)' },
  { value: 'swarm-specialist', label: 'Swarm Specialist', hint: 'Unified coordination engine' },
  { value: 'performance-engineer', label: 'Performance Engineer', hint: '2.49x-7.47x optimization targets' },
  { value: 'core-architect', label: 'Core Architect', hint: 'Domain-driven design restructure' },
  { value: 'test-architect', label: 'Test Architect', hint: 'TDD London School methodology' }
];

// Agent spawn subcommand
const spawnCommand: Command = {
  name: 'spawn',
  description: 'Spawn a new agent',
  options: [
    {
      name: 'type',
      short: 't',
      description: 'Agent type to spawn',
      type: 'string',
      choices: AGENT_TYPES.map(a => a.value)
    },
    {
      name: 'name',
      short: 'n',
      description: 'Agent name/identifier',
      type: 'string'
    },
    {
      name: 'provider',
      short: 'p',
      description: 'Provider to use (anthropic, openrouter, ollama)',
      type: 'string',
      default: 'anthropic'
    },
    {
      name: 'model',
      short: 'm',
      description: 'Model to use',
      type: 'string'
    },
    {
      name: 'task',
      description: 'Initial task for the agent',
      type: 'string'
    },
    {
      name: 'timeout',
      description: 'Agent timeout in seconds',
      type: 'number',
      default: 300
    },
    {
      name: 'auto-tools',
      description: 'Enable automatic tool usage',
      type: 'boolean',
      default: true
    }
  ],
  examples: [
    { command: 'claude-flow agent spawn --type coder --name bot-1', description: 'Spawn a coder agent' },
    { command: 'claude-flow agent spawn -t researcher --task "Research React 19"', description: 'Spawn researcher with task' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let agentType = ctx.flags.type as string;
    let agentName = ctx.flags.name as string;

    // Interactive mode if type not specified
    if (!agentType && ctx.interactive) {
      agentType = await select({
        message: 'Select agent type:',
        options: AGENT_TYPES
      });
    }

    if (!agentType) {
      output.printError('Agent type is required. Use --type or -t flag.');
      return { success: false, exitCode: 1 };
    }

    // Generate name if not provided
    if (!agentName) {
      agentName = `${agentType}-${Date.now().toString(36)}`;
    }

    output.printInfo(`Spawning ${agentType} agent: ${output.highlight(agentName)}`);

    try {
      // Call MCP tool to spawn agent
      const result = await callMCPTool<{
        agentId: string;
        agentType: string;
        status: string;
        createdAt: string;
      }>('agent_spawn', {
        agentType,
        id: agentName,
        config: {
          provider: ctx.flags.provider || 'anthropic',
          model: ctx.flags.model,
          task: ctx.flags.task,
          timeout: ctx.flags.timeout,
          autoTools: ctx.flags.autoTools,
        },
        priority: 'normal',
        metadata: {
          name: agentName,
          capabilities: getAgentCapabilities(agentType),
        },
      });

      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 40 }
        ],
        data: [
          { property: 'ID', value: result.agentId },
          { property: 'Type', value: result.agentType },
          { property: 'Name', value: agentName },
          { property: 'Status', value: result.status },
          { property: 'Created', value: result.createdAt },
          { property: 'Capabilities', value: getAgentCapabilities(agentType).join(', ') }
        ]
      });

      output.writeln();
      output.printSuccess(`Agent ${agentName} spawned successfully`);

      // Update swarm-activity.json so statusline reflects the new agent count
      updateSwarmActivityMetrics(1);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to spawn agent: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Agent list subcommand
const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List all active agents',
  options: [
    {
      name: 'all',
      short: 'a',
      description: 'Include inactive agents',
      type: 'boolean',
      default: false
    },
    {
      name: 'type',
      short: 't',
      description: 'Filter by agent type',
      type: 'string'
    },
    {
      name: 'status',
      short: 's',
      description: 'Filter by status',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      // Call MCP tool to list agents
      const result = await callMCPTool<{
        agents: Array<{
          agentId: string;
          agentType: string;
          status: 'active' | 'busy' | 'idle' | 'terminated';
          createdAt: string;
          lastActivityAt?: string;
        }>;
        total: number;
      }>('agent_list', {
        status: ctx.flags.all ? 'all' : ctx.flags.status || undefined,
        agentType: ctx.flags.type || undefined,
        limit: 100,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Active Agents'));
      output.writeln();

      if (result.agents.length === 0) {
        output.printInfo('No agents found matching criteria');
        return { success: true, data: result };
      }

      // Format for display
      const displayAgents = result.agents.map(agent => ({
        id: agent.agentId,
        type: agent.agentType,
        status: agent.status,
        created: new Date(agent.createdAt).toLocaleTimeString(),
        lastActivity: agent.lastActivityAt
          ? new Date(agent.lastActivityAt).toLocaleTimeString()
          : 'N/A',
      }));

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 20 },
          { key: 'type', header: 'Type', width: 15 },
          { key: 'status', header: 'Status', width: 12, format: formatStatus },
          { key: 'created', header: 'Created', width: 12 },
          { key: 'lastActivity', header: 'Last Activity', width: 12 }
        ],
        data: displayAgents
      });

      output.writeln();
      output.printInfo(`Total: ${result.total} agents`);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to list agents: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Agent status subcommand
const statusCommand: Command = {
  name: 'status',
  description: 'Show detailed status of an agent',
  options: [
    {
      name: 'id',
      description: 'Agent ID',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let agentId = ctx.args[0] || ctx.flags.id as string;

    if (!agentId && ctx.interactive) {
      agentId = await input({
        message: 'Enter agent ID:',
        validate: (v) => v.length > 0 || 'Agent ID is required'
      });
    }

    if (!agentId) {
      output.printError('Agent ID is required');
      return { success: false, exitCode: 1 };
    }

    try {
      // Call MCP tool to get agent status
      const status = await callMCPTool<{
        id: string;
        agentType: string;
        status: 'active' | 'idle' | 'terminated';
        createdAt: string;
        lastActivityAt?: string;
        config?: Record<string, unknown>;
        metrics?: {
          tasksCompleted: number;
          tasksInProgress: number;
          tasksFailed: number;
          averageExecutionTime: number;
          uptime: number;
        };
      }>('agent_status', {
        agentId,
        includeMetrics: true,
        includeHistory: false,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(status);
        return { success: true, data: status };
      }

      output.writeln();
      output.printBox(
        [
          `Type: ${status.agentType}`,
          `Status: ${formatStatus(status.status)}`,
          `Created: ${new Date(status.createdAt).toLocaleString()}`,
          `Last Activity: ${status.lastActivityAt ? new Date(status.lastActivityAt).toLocaleString() : 'N/A'}`
        ].join('\n'),
        `Agent: ${status.id}`
      );

      if (status.metrics) {
        output.writeln();
        output.writeln(output.bold('Metrics'));
        const avgExecTime = status.metrics.averageExecutionTime ?? 0;
        const uptime = status.metrics.uptime ?? 0;
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 15, align: 'right' }
          ],
          data: [
            { metric: 'Tasks Completed', value: status.metrics.tasksCompleted ?? 0 },
            { metric: 'Tasks In Progress', value: status.metrics.tasksInProgress ?? 0 },
            { metric: 'Tasks Failed', value: status.metrics.tasksFailed ?? 0 },
            { metric: 'Avg Execution Time', value: `${avgExecTime.toFixed(2)}ms` },
            { metric: 'Uptime', value: `${(uptime / 1000 / 60).toFixed(1)}m` }
          ]
        });
      }

      return { success: true, data: status };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to get agent status: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Agent stop subcommand
const stopCommand: Command = {
  name: 'stop',
  aliases: ['kill'],
  description: 'Stop a running agent',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force stop without graceful shutdown',
      type: 'boolean',
      default: false
    },
    {
      name: 'timeout',
      description: 'Graceful shutdown timeout in seconds',
      type: 'number',
      default: 30
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.args[0];

    if (!agentId) {
      output.printError('Agent ID is required');
      return { success: false, exitCode: 1 };
    }

    const force = ctx.flags.force as boolean;

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Are you sure you want to stop agent ${agentId}?`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    output.printInfo(`Stopping agent ${agentId}...`);

    try {
      // Call MCP tool to terminate agent
      const result = await callMCPTool<{
        agentId: string;
        terminated: boolean;
        terminatedAt: string;
      }>('agent_terminate', {
        agentId,
        graceful: !force,
        reason: 'Stopped by user via CLI',
      });

      if (!force) {
        output.writeln(output.dim('  Completing current task...'));
        output.writeln(output.dim('  Saving state...'));
        output.writeln(output.dim('  Releasing resources...'));
      }

      output.printSuccess(`Agent ${agentId} stopped successfully`);

      // Update swarm-activity.json so statusline reflects the reduced agent count
      updateSwarmActivityMetrics(-1);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to stop agent: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Agent metrics subcommand
const metricsCommand: Command = {
  name: 'metrics',
  description: 'Show agent performance metrics',
  options: [
    {
      name: 'period',
      short: 'p',
      description: 'Time period (1h, 24h, 7d, 30d)',
      type: 'string',
      default: '24h'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.args[0];
    const period = ctx.flags.period as string;

    // Collect real metrics from .swarm/ state
    const { existsSync, readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    let totalAgents = 0;
    let activeAgents = 0;
    let tasksCompleted = 0;
    const typeCounts: Record<string, { count: number; tasks: number; success: number }> = {};

    // Read swarm agent state
    const swarmDir = join(process.cwd(), '.swarm');
    const agentsDir = join(swarmDir, 'agents');
    if (existsSync(agentsDir)) {
      try {
        const files = readdirSync(agentsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const data = JSON.parse(readFileSync(join(agentsDir, file), 'utf-8'));
            totalAgents++;
            const agType = data.type || 'unknown';
            if (!typeCounts[agType]) typeCounts[agType] = { count: 0, tasks: 0, success: 0 };
            typeCounts[agType].count++;
            if (data.status === 'active' || data.status === 'running') activeAgents++;
            if (data.tasksCompleted) {
              typeCounts[agType].tasks += data.tasksCompleted;
              tasksCompleted += data.tasksCompleted;
            }
            if (data.successCount) typeCounts[agType].success += data.successCount;
          } catch { /* skip malformed */ }
        }
      } catch { /* no agents dir */ }
    }

    // Read swarm activity for additional state
    const activityFile = join(swarmDir, 'swarm-activity.json');
    if (existsSync(activityFile)) {
      try {
        const activity = JSON.parse(readFileSync(activityFile, 'utf-8'));
        if (activity.totalAgents && totalAgents === 0) totalAgents = activity.totalAgents;
        if (activity.activeAgents && activeAgents === 0) activeAgents = activity.activeAgents;
      } catch { /* ignore */ }
    }

    // Read memory.db stats
    let vectorCount = 0;
    const dbPath = join(swarmDir, 'memory.db');
    if (existsSync(dbPath)) {
      try {
        const dbSize = statSync(dbPath).size;
        vectorCount = Math.floor(dbSize / 2048);
      } catch { /* ignore */ }
    }

    const byType = Object.entries(typeCounts).map(([type, data]) => ({
      type,
      count: data.count,
      tasks: data.tasks,
      successRate: data.tasks > 0 ? `${Math.round((data.success / data.tasks) * 100)}%` : 'N/A'
    }));

    const avgSuccessRate = tasksCompleted > 0
      ? `${Math.round(Object.values(typeCounts).reduce((a, d) => a + d.success, 0) / tasksCompleted * 100)}%`
      : 'N/A';

    // ADR-330: expose the learned scheduling signal where operators already
    // inspect agent metrics. Old/non-APSC installs simply omit this section.
    let pheromone: {
      active: boolean;
      dryRun: boolean;
      threshold: number;
      agents: Array<{
        agentId: string;
        role: string;
        pheromoneScore: number;
        rawScore: number;
        samples: number;
        eligibility: string;
      }>;
    } | undefined;
    const swarmStatePath = join(process.cwd(), '.claude-flow', 'swarm', 'swarm-state.json');
    if (existsSync(swarmStatePath)) {
      try {
        const store = JSON.parse(readFileSync(swarmStatePath, 'utf-8')) as {
          swarms?: Record<string, {
            topology?: string;
            status?: string;
            updatedAt?: string;
            config?: {
              apscState?: {
                threshold?: number;
                config?: { dryRun?: boolean };
                agents?: Record<string, {
                  agentId: string;
                  role: string;
                  emaScore: number;
                  rawScore: number;
                  samples: number;
                  status: string;
                }>;
              };
            };
          }>;
        };
        const current = Object.values(store.swarms ?? {})
          .filter((swarm) => swarm.status === 'running' && swarm.topology === 'pheromone-adaptive')
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
        const apsc = current?.config?.apscState;
        if (apsc) {
          const agents = Object.values(apsc.agents ?? {})
            .filter((agent) => !agentId || agent.agentId === agentId)
            .sort((a, b) => a.agentId.localeCompare(b.agentId))
            .map((agent) => ({
              agentId: agent.agentId,
              role: agent.role,
              pheromoneScore: agent.emaScore,
              rawScore: agent.rawScore,
              samples: agent.samples,
              eligibility: agent.status === 'suspended' ? 'suspended' : 'eligible',
            }));
          pheromone = {
            active: true,
            dryRun: apsc.config?.dryRun !== false,
            threshold: apsc.threshold ?? 0.5,
            agents,
          };
        }
      } catch { /* malformed/legacy swarm state — preserve existing metrics */ }
    }

    const metrics = {
      period,
      summary: {
        totalAgents,
        activeAgents,
        tasksCompleted,
        avgSuccessRate,
        vectorCount,
        note: totalAgents === 0 ? 'No agents spawned yet. Use: agent spawn -t coder' : undefined
      },
      byType,
      performance: {
        memoryVectors: `${vectorCount} vectors`,
        searchBackend: vectorCount > 0 ? 'HNSW-indexed' : 'none'
      },
      pheromone,
    };

    if (ctx.flags.format === 'json') {
      output.printJson(metrics);
      return { success: true, data: metrics };
    }

    output.writeln();
    output.writeln(output.bold(`Agent Metrics (${period})`));
    output.writeln();

    output.printTable({
      columns: [
        { key: 'metric', header: 'Metric', width: 20 },
        { key: 'value', header: 'Value', width: 15, align: 'right' }
      ],
      data: [
        { metric: 'Total Agents', value: metrics.summary.totalAgents },
        { metric: 'Active Agents', value: metrics.summary.activeAgents },
        { metric: 'Tasks Completed', value: metrics.summary.tasksCompleted },
        { metric: 'Success Rate', value: metrics.summary.avgSuccessRate },
        { metric: 'Memory Vectors', value: metrics.summary.vectorCount }
      ]
    });

    output.writeln();
    output.writeln(output.bold('By Agent Type'));
    output.printTable({
      columns: [
        { key: 'type', header: 'Type', width: 12 },
        { key: 'count', header: 'Count', width: 8, align: 'right' },
        { key: 'tasks', header: 'Tasks', width: 8, align: 'right' },
        { key: 'successRate', header: 'Success', width: 10, align: 'right' }
      ],
      data: metrics.byType
    });

    if (metrics.summary.note) {
      output.writeln();
      output.writeln(output.dim(metrics.summary.note));
    }

    output.writeln();
    output.writeln(output.bold('Memory'));
    output.printList([
      `Vectors: ${output.success(metrics.performance.memoryVectors)}`,
      `Backend: ${output.success(metrics.performance.searchBackend)}`
    ]);

    if (metrics.pheromone) {
      output.writeln();
      output.writeln(output.bold(`Pheromone Scheduling (${metrics.pheromone.dryRun ? 'dry run' : 'live'})`));
      output.printTable({
        columns: [
          { key: 'agentId', header: 'Agent', width: 20 },
          { key: 'role', header: 'Role', width: 18 },
          { key: 'pheromoneScore', header: 'EMA Score', width: 12, align: 'right' },
          { key: 'samples', header: 'Samples', width: 9, align: 'right' },
          { key: 'eligibility', header: 'Eligibility', width: 12 },
        ],
        data: metrics.pheromone.agents,
      });
    }

    return { success: true, data: metrics };
  }
};

// Agent pool subcommand
const poolCommand: Command = {
  name: 'pool',
  description: 'Manage agent pool for scaling',
  options: [
    {
      name: 'size',
      short: 's',
      description: 'Pool size',
      type: 'number'
    },
    {
      name: 'min',
      description: 'Minimum pool size',
      type: 'number',
      default: 1
    },
    {
      name: 'max',
      description: 'Maximum pool size',
      type: 'number',
      default: 10
    },
    {
      name: 'auto-scale',
      short: 'a',
      description: 'Enable auto-scaling',
      type: 'boolean',
      default: true
    }
  ],
  examples: [
    { command: 'claude-flow agent pool --size 5', description: 'Set pool size' },
    { command: 'claude-flow agent pool --min 2 --max 15', description: 'Configure auto-scaling' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const result = await callMCPTool<{
        poolId: string;
        currentSize: number;
        minSize: number;
        maxSize: number;
        autoScale: boolean;
        utilization: number;
        agents: Array<{ id: string; type: string; status: string }>;
      }>('agent_pool', {
        size: ctx.flags.size,
        min: ctx.flags.min,
        max: ctx.flags.max,
        autoScale: ctx.flags.autoScale ?? true,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      const utilization = result.utilization ?? 0;
      output.printBox(
        [
          `Pool ID: ${result.poolId ?? 'default'}`,
          `Current Size: ${result.currentSize ?? 0}`,
          `Min/Max: ${result.minSize ?? 0}/${result.maxSize ?? 100}`,
          `Auto-Scale: ${result.autoScale ? 'Yes' : 'No'}`,
          `Utilization: ${(utilization * 100).toFixed(1)}%`
        ].join('\n'),
        'Agent Pool'
      );

      const agents = result.agents ?? [];
      if (agents.length > 0) {
        output.writeln();
        output.writeln(output.bold('Pool Agents'));
        output.printTable({
          columns: [
            { key: 'id', header: 'ID', width: 20 },
            { key: 'type', header: 'Type', width: 15 },
            { key: 'status', header: 'Status', width: 12, format: formatStatus }
          ],
          data: agents
        });
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Pool error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Agent health subcommand
const healthCommand: Command = {
  name: 'health',
  description: 'Show agent health and metrics',
  options: [
    {
      name: 'id',
      short: 'i',
      description: 'Agent ID (all if not specified)',
      type: 'string'
    },
    {
      name: 'detailed',
      short: 'd',
      description: 'Show detailed health metrics',
      type: 'boolean',
      default: false
    },
    {
      name: 'watch',
      short: 'w',
      description: 'Watch mode (refresh every 5s)',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow agent health', description: 'Show all agents health' },
    { command: 'claude-flow agent health -i agent-001 -d', description: 'Detailed health for specific agent' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.args[0] || ctx.flags.id as string;
    const detailed = ctx.flags.detailed as boolean;

    try {
      const result = await callMCPTool<{
        agents: Array<{
          id: string;
          type: string;
          health: 'healthy' | 'degraded' | 'unhealthy';
          uptime: number;
          memory: { used: number; limit: number };
          cpu: number;
          tasks: { active: number; queued: number; completed: number; failed: number };
          latency: { avg: number; p99: number };
          errors: { count: number; lastError?: string };
        }>;
        overall: {
          healthy: number;
          degraded: number;
          unhealthy: number;
          avgCpu: number;
          avgMemory: number;
        };
      }>('agent_health', {
        agentId,
        detailed,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Agent Health'));
      output.writeln();

      // Overall summary with null checks
      const overall = result.overall ?? { healthy: 0, degraded: 0, unhealthy: 0, avgCpu: 0, avgMemory: 0 };
      const avgCpu = overall.avgCpu ?? 0;
      const avgMemory = overall.avgMemory ?? 0;
      output.printBox(
        [
          `Healthy: ${output.success(String(overall.healthy ?? 0))}`,
          `Degraded: ${output.warning(String(overall.degraded ?? 0))}`,
          `Unhealthy: ${output.error(String(overall.unhealthy ?? 0))}`,
          `Avg CPU: ${avgCpu.toFixed(1)}%`,
          `Avg Memory: ${(avgMemory * 100).toFixed(1)}%`
        ].join('  |  '),
        'Overall Status'
      );

      const healthAgents = result.agents ?? [];
      output.writeln();
      output.printTable({
        columns: [
          { key: 'id', header: 'Agent ID', width: 18 },
          { key: 'type', header: 'Type', width: 12 },
          { key: 'health', header: 'Health', width: 10, format: formatHealthStatus },
          { key: 'cpu', header: 'CPU %', width: 8, align: 'right', format: (v) => `${Number(v ?? 0).toFixed(1)}%` },
          { key: 'memory', header: 'Memory', width: 10, align: 'right', format: (v: unknown) => {
            const mem = v as { used: number; limit: number } | undefined;
            if (!mem) return '0%';
            return `${(mem.used / mem.limit * 100).toFixed(0)}%`;
          }},
          { key: 'tasks', header: 'Tasks', width: 12, align: 'right', format: (v: unknown) => {
            const t = v as { active: number; completed: number } | undefined;
            if (!t) return '0/0';
            return `${t.active ?? 0}/${t.completed ?? 0}`;
          }}
        ],
        data: healthAgents
      });

      if (detailed && healthAgents.length > 0) {
        output.writeln();
        output.writeln(output.bold('Detailed Metrics'));
        for (const agent of healthAgents) {
          output.writeln();
          output.writeln(output.highlight(agent.id));
          const uptime = agent.uptime ?? 0;
          const latency = agent.latency ?? { avg: 0, p99: 0 };
          const tasks = agent.tasks ?? { completed: 0, failed: 0, queued: 0 };
          const errors = agent.errors ?? { count: 0 };
          output.printList([
            `Uptime: ${(uptime / 1000 / 60).toFixed(1)} min`,
            `Latency: avg ${(latency.avg ?? 0).toFixed(1)}ms, p99 ${(latency.p99 ?? 0).toFixed(1)}ms`,
            `Tasks: ${tasks.completed ?? 0} completed, ${tasks.failed ?? 0} failed, ${tasks.queued ?? 0} queued`,
            `Errors: ${errors.count ?? 0}${errors.lastError ? ` (${errors.lastError})` : ''}`
          ]);
        }
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Health check error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Agent logs subcommand
const logsCommand: Command = {
  name: 'logs',
  description: 'Show agent activity logs',
  options: [
    {
      name: 'id',
      short: 'i',
      description: 'Agent ID',
      type: 'string'
    },
    {
      name: 'tail',
      short: 'n',
      description: 'Number of recent entries',
      type: 'number',
      default: 50
    },
    {
      name: 'level',
      short: 'l',
      description: 'Minimum log level',
      type: 'string',
      choices: ['debug', 'info', 'warn', 'error'],
      default: 'info'
    },
    {
      name: 'follow',
      short: 'f',
      description: 'Follow log output',
      type: 'boolean',
      default: false
    },
    {
      name: 'since',
      description: 'Show logs since (e.g., "1h", "30m")',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow agent logs -i agent-001', description: 'Show agent logs' },
    { command: 'claude-flow agent logs -i agent-001 -f', description: 'Follow agent logs' },
    { command: 'claude-flow agent logs -l error --since 1h', description: 'Show errors from last hour' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.args[0] || ctx.flags.id as string;
    const tail = ctx.flags.tail as number;
    const level = ctx.flags.level as string;

    if (!agentId) {
      output.printError('Agent ID is required. Use --id or -i');
      return { success: false, exitCode: 1 };
    }

    try {
      const result = await callMCPTool<{
        agentId: string;
        entries: Array<{
          timestamp: string;
          level: 'debug' | 'info' | 'warn' | 'error';
          message: string;
          context?: Record<string, unknown>;
        }>;
        total: number;
      }>('agent_logs', {
        agentId,
        tail,
        level,
        since: ctx.flags.since,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold(`Logs for ${agentId}`));
      output.writeln(output.dim(`Showing ${result.entries.length} of ${result.total} entries`));
      output.writeln();

      for (const entry of result.entries) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const levelStr = formatLogLevel(entry.level);
        output.writeln(`${output.dim(time)} ${levelStr} ${entry.message}`);
        if (entry.context && Object.keys(entry.context).length > 0) {
          output.writeln(output.dim(`  ${JSON.stringify(entry.context)}`));
        }
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Logs error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

function formatHealthStatus(health: unknown): string {
  const h = String(health);
  switch (h) {
    case 'healthy':
      return output.success(h);
    case 'degraded':
      return output.warning(h);
    case 'unhealthy':
      return output.error(h);
    default:
      return h;
  }
}

function formatLogLevel(level: string): string {
  switch (level) {
    case 'debug':
      return output.dim('[DEBUG]');
    case 'info':
      return '[INFO] ';
    case 'warn':
      return output.warning('[WARN] ');
    case 'error':
      return output.error('[ERROR]');
    default:
      return `[${level.toUpperCase()}]`;
  }
}

// Main agent command
export const agentCommand: Command = {
  name: 'agent',
  description: 'Agent management commands',
  subcommands: [spawnCommand, listCommand, statusCommand, stopCommand, metricsCommand, poolCommand, healthCommand, logsCommand, ...wasmSubcommands, agentPublishCommand],
  options: [],
  examples: [
    { command: 'claude-flow agent spawn -t coder', description: 'Spawn a coder agent' },
    { command: 'claude-flow agent list', description: 'List all agents' },
    { command: 'claude-flow agent status agent-001', description: 'Show agent status' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Show help if no subcommand
    output.writeln();
    output.writeln(output.bold('Agent Management Commands'));
    output.writeln();
    output.writeln('Usage: claude-flow agent <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('spawn')}         - Spawn a new agent`,
      `${output.highlight('list')}          - List all active agents`,
      `${output.highlight('status')}        - Show detailed agent status`,
      `${output.highlight('stop')}          - Stop a running agent`,
      `${output.highlight('metrics')}       - Show agent metrics`,
      `${output.highlight('pool')}          - Manage agent pool`,
      `${output.highlight('health')}        - Show agent health`,
      `${output.highlight('logs')}          - Show agent logs`,
      `${output.highlight('wasm-status')}   - Check WASM runtime availability`,
      `${output.highlight('wasm-create')}   - Create a WASM-sandboxed agent`,
      `${output.highlight('wasm-prompt')}   - Send a prompt to a WASM agent`,
      `${output.highlight('wasm-gallery')}  - List WASM agent gallery templates`,
    ]);
    output.writeln();
    output.writeln('Run "claude-flow agent <subcommand> --help" for subcommand help');

    return { success: true };
  }
};

// Helper functions
function getAgentCapabilities(type: string): string[] {
  const capabilities: Record<string, string[]> = {
    coder: ['code-generation', 'refactoring', 'debugging', 'testing'],
    researcher: ['web-search', 'data-analysis', 'summarization', 'citation'],
    tester: ['unit-testing', 'integration-testing', 'coverage-analysis', 'automation'],
    reviewer: ['code-review', 'security-audit', 'quality-check', 'documentation'],
    architect: ['system-design', 'pattern-analysis', 'scalability', 'documentation'],
    coordinator: ['task-orchestration', 'agent-management', 'workflow-control'],
    'security-architect': ['threat-modeling', 'security-patterns', 'compliance', 'audit'],
    'memory-specialist': ['vector-search', 'agentdb', 'caching', 'optimization'],
    'performance-engineer': ['benchmarking', 'profiling', 'optimization', 'monitoring']
  };

  return capabilities[type] || ['general'];
}

function formatStatus(status: unknown): string {
  const statusStr = String(status);
  switch (statusStr) {
    case 'active':
      return output.success(statusStr);
    case 'idle':
      return output.warning(statusStr);
    case 'inactive':
    case 'stopped':
      return output.dim(statusStr);
    case 'error':
      return output.error(statusStr);
    default:
      return statusStr;
  }
}

export default agentCommand;
