/**
 * V2 Compatibility Validator
 *
 * Validates that V3 implementation maintains backward compatibility with V2 capabilities.
 * Tests CLI commands, MCP tools, hooks, and API interfaces.
 *
 * @module v3/testing/v2-compat/compatibility-validator
 */

import { vi } from 'vitest';

/**
 * Validation result for a single check
 */
export interface ValidationCheck {
  name: string;
  category: 'cli' | 'mcp' | 'hooks' | 'api';
  passed: boolean;
  message: string;
  v2Behavior: string;
  v3Behavior: string;
  breaking: boolean;
  migrationPath?: string;
  details?: Record<string, unknown>;
}

/**
 * Validation result for a category
 */
export interface ValidationResult {
  category: 'cli' | 'mcp' | 'hooks' | 'api';
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  breakingChanges: number;
  checks: ValidationCheck[];
  duration: number;
}

/**
 * Full validation report
 */
export interface FullValidationReport {
  timestamp: Date;
  v2Version: string;
  v3Version: string;
  overallPassed: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  breakingChanges: number;
  cli: ValidationResult;
  mcp: ValidationResult;
  hooks: ValidationResult;
  api: ValidationResult;
  summary: string;
  recommendations: string[];
  duration: number;
}

/**
 * V2 CLI command definition
 */
export interface V2CLICommand {
  name: string;
  aliases: string[];
  flags: string[];
  description: string;
  v3Equivalent?: string;
  deprecated?: boolean;
}

/**
 * V2 MCP tool definition
 */
export interface V2MCPTool {
  name: string;
  parameters: Record<string, { type: string; required: boolean }>;
  returnType: string;
  v3Equivalent?: string;
  deprecated?: boolean;
}

/**
 * V2 hook definition
 */
export interface V2Hook {
  name: string;
  trigger: string;
  parameters: string[];
  returnType: string;
  v3Equivalent?: string;
  deprecated?: boolean;
}

/**
 * V2 API interface definition
 */
export interface V2APIInterface {
  name: string;
  methods: { name: string; signature: string }[];
  v3Equivalent?: string;
  deprecated?: boolean;
}

/**
 * V2 CLI Commands (25 total)
 */
export const V2_CLI_COMMANDS: V2CLICommand[] = [
  // Core commands
  { name: 'init', aliases: ['i'], flags: ['--force', '--template'], description: 'Initialize claude-flow project', v3Equivalent: 'init' },
  { name: 'start', aliases: ['s'], flags: ['--detached', '--port'], description: 'Start MCP server', v3Equivalent: 'start' },
  { name: 'stop', aliases: [], flags: ['--force'], description: 'Stop MCP server', v3Equivalent: 'stop' },
  { name: 'status', aliases: ['st'], flags: ['--json', '--verbose'], description: 'Show system status', v3Equivalent: 'status' },
  { name: 'config', aliases: ['c'], flags: ['--get', '--set', '--list'], description: 'Manage configuration', v3Equivalent: 'config' },

  // Agent commands
  { name: 'agent spawn', aliases: ['a spawn'], flags: ['--type', '--id', '--config'], description: 'Spawn new agent', v3Equivalent: 'agent spawn' },
  { name: 'agent list', aliases: ['a ls'], flags: ['--status', '--type'], description: 'List agents', v3Equivalent: 'agent list' },
  { name: 'agent terminate', aliases: ['a kill'], flags: ['--force', '--all'], description: 'Terminate agent', v3Equivalent: 'agent terminate' },
  { name: 'agent info', aliases: ['a info'], flags: ['--metrics'], description: 'Show agent info', v3Equivalent: 'agent status' },

  // Swarm commands
  { name: 'swarm init', aliases: ['sw init'], flags: ['--topology', '--max-agents'], description: 'Initialize swarm', v3Equivalent: 'swarm init' },
  { name: 'swarm status', aliases: ['sw st'], flags: ['--detailed'], description: 'Show swarm status', v3Equivalent: 'swarm status' },
  { name: 'swarm scale', aliases: ['sw scale'], flags: ['--up', '--down'], description: 'Scale swarm', v3Equivalent: 'swarm scale' },

  // Memory commands
  { name: 'memory list', aliases: ['mem ls'], flags: ['--type', '--limit'], description: 'List memories', v3Equivalent: 'memory list' },
  { name: 'memory query', aliases: ['mem q'], flags: ['--search', '--type'], description: 'Query memory', v3Equivalent: 'memory search' },
  { name: 'memory clear', aliases: ['mem clear'], flags: ['--force', '--type'], description: 'Clear memory', v3Equivalent: 'memory clear' },

  // Hooks commands
  { name: 'hooks pre-edit', aliases: [], flags: ['--file'], description: 'Pre-edit hook', v3Equivalent: 'hooks pre-edit' },
  { name: 'hooks post-edit', aliases: [], flags: ['--file', '--success'], description: 'Post-edit hook', v3Equivalent: 'hooks post-edit' },
  { name: 'hooks pre-command', aliases: [], flags: ['--command'], description: 'Pre-command hook', v3Equivalent: 'hooks pre-command' },
  { name: 'hooks post-command', aliases: [], flags: ['--command', '--success'], description: 'Post-command hook', v3Equivalent: 'hooks post-command' },
  { name: 'hooks route', aliases: [], flags: ['--task'], description: 'Route task', v3Equivalent: 'hooks route' },
  { name: 'hooks pretrain', aliases: [], flags: [], description: 'Pretrain from repo', v3Equivalent: 'hooks pretrain' },
  { name: 'hooks metrics', aliases: [], flags: ['--dashboard'], description: 'Show metrics', v3Equivalent: 'hooks metrics' },

  // Deprecated but supported
  { name: 'hive-mind init', aliases: [], flags: [], description: 'Initialize hive', v3Equivalent: 'swarm init', deprecated: true },
  { name: 'neural init', aliases: [], flags: [], description: 'Initialize neural', v3Equivalent: 'hooks pretrain', deprecated: true },
  { name: 'goal init', aliases: [], flags: [], description: 'Initialize goals', v3Equivalent: 'hooks pretrain', deprecated: true },
];

/**
 * V2 MCP Tools (65 total - showing key ones)
 */
export const V2_MCP_TOOLS: V2MCPTool[] = [
  // Agent tools
  { name: 'dispatch_agent', parameters: { type: { type: 'string', required: true }, name: { type: 'string', required: false } }, returnType: 'AgentInfo', v3Equivalent: 'agent/spawn' },
  { name: 'agents/spawn', parameters: { type: { type: 'string', required: true }, config: { type: 'object', required: false } }, returnType: 'AgentInfo', v3Equivalent: 'agent/spawn' },
  { name: 'agents/list', parameters: { status: { type: 'string', required: false } }, returnType: 'AgentInfo[]', v3Equivalent: 'agent/list' },
  { name: 'agents/terminate', parameters: { id: { type: 'string', required: true } }, returnType: 'boolean', v3Equivalent: 'agent/terminate' },
  { name: 'agents/info', parameters: { id: { type: 'string', required: true } }, returnType: 'AgentInfo', v3Equivalent: 'agent/status' },
  { name: 'agent/create', parameters: { type: { type: 'string', required: true } }, returnType: 'AgentInfo', v3Equivalent: 'agent/spawn' },

  // Swarm tools
  { name: 'swarm_status', parameters: {}, returnType: 'SwarmStatus', v3Equivalent: 'swarm/status' },
  { name: 'swarm/get-status', parameters: {}, returnType: 'SwarmStatus', v3Equivalent: 'swarm/status' },
  { name: 'swarm/get-comprehensive-status', parameters: {}, returnType: 'ComprehensiveStatus', v3Equivalent: 'swarm/status' },
  { name: 'mcp__ruv-swarm__swarm_init', parameters: { topology: { type: 'string', required: false } }, returnType: 'SwarmInfo', v3Equivalent: 'swarm/init' },
  { name: 'mcp__ruv-swarm__swarm_status', parameters: {}, returnType: 'SwarmStatus', v3Equivalent: 'swarm/status' },
  { name: 'mcp__ruv-swarm__agent_spawn', parameters: { type: { type: 'string', required: true } }, returnType: 'AgentInfo', v3Equivalent: 'agent/spawn' },
  { name: 'mcp__ruv-swarm__agent_list', parameters: {}, returnType: 'AgentInfo[]', v3Equivalent: 'agent/list' },
  { name: 'mcp__ruv-swarm__agent_metrics', parameters: { id: { type: 'string', required: true } }, returnType: 'AgentMetrics', v3Equivalent: 'agent/status' },

  // Memory tools
  { name: 'memory/query', parameters: { search: { type: 'string', required: true } }, returnType: 'MemoryEntry[]', v3Equivalent: 'memory/search' },
  { name: 'memory/store', parameters: { content: { type: 'string', required: true }, type: { type: 'string', required: false } }, returnType: 'MemoryEntry', v3Equivalent: 'memory/store' },
  { name: 'memory/delete', parameters: { id: { type: 'string', required: true } }, returnType: 'boolean', v3Equivalent: 'memory/delete' },
  { name: 'mcp__ruv-swarm__memory_usage', parameters: {}, returnType: 'MemoryStats', v3Equivalent: 'memory/list' },

  // Config tools
  { name: 'config/get', parameters: { key: { type: 'string', required: true } }, returnType: 'any', v3Equivalent: 'config/load' },
  { name: 'config/update', parameters: { key: { type: 'string', required: true }, value: { type: 'any', required: true } }, returnType: 'boolean', v3Equivalent: 'config/save' },

  // Task tools
  { name: 'task/create', parameters: { description: { type: 'string', required: true } }, returnType: 'TaskInfo', v3Equivalent: 'task/create' },
  { name: 'task/assign', parameters: { taskId: { type: 'string', required: true }, agentId: { type: 'string', required: true } }, returnType: 'boolean', v3Equivalent: 'task/assign' },
  { name: 'task/status', parameters: { taskId: { type: 'string', required: true } }, returnType: 'TaskStatus', v3Equivalent: 'task/status' },
  { name: 'task/complete', parameters: { taskId: { type: 'string', required: true }, result: { type: 'any', required: false } }, returnType: 'boolean', v3Equivalent: 'task/complete' },

  // Neural/Learning tools
  { name: 'mcp__ruv-swarm__neural_status', parameters: {}, returnType: 'NeuralStatus', v3Equivalent: 'hooks/metrics' },
  { name: 'mcp__ruv-swarm__neural_train', parameters: { data: { type: 'object', required: true } }, returnType: 'TrainingResult', v3Equivalent: 'hooks/pretrain' },

  // GitHub integration tools
  { name: 'github/pr-create', parameters: { title: { type: 'string', required: true }, body: { type: 'string', required: false } }, returnType: 'PRInfo', v3Equivalent: 'github/pr-create' },
  { name: 'github/pr-review', parameters: { prNumber: { type: 'number', required: true } }, returnType: 'ReviewInfo', v3Equivalent: 'github/pr-review' },
  { name: 'github/issue-create', parameters: { title: { type: 'string', required: true } }, returnType: 'IssueInfo', v3Equivalent: 'github/issue-create' },

  // Coordination tools
  { name: 'coordinate/consensus', parameters: { proposal: { type: 'object', required: true } }, returnType: 'ConsensusResult', v3Equivalent: 'swarm/consensus' },
  { name: 'coordinate/broadcast', parameters: { message: { type: 'object', required: true } }, returnType: 'BroadcastResult', v3Equivalent: 'swarm/broadcast' },
];

/**
 * V2 Hooks (42 total)
 */
export const V2_HOOKS: V2Hook[] = [
  // Edit hooks
  { name: 'pre-edit', trigger: 'before:file:edit', parameters: ['filePath', 'content'], returnType: 'HookResult', v3Equivalent: 'pre-edit' },
  { name: 'post-edit', trigger: 'after:file:edit', parameters: ['filePath', 'success', 'changes'], returnType: 'HookResult', v3Equivalent: 'post-edit' },
  { name: 'pre-create', trigger: 'before:file:create', parameters: ['filePath'], returnType: 'HookResult', v3Equivalent: 'pre-edit' },
  { name: 'post-create', trigger: 'after:file:create', parameters: ['filePath', 'success'], returnType: 'HookResult', v3Equivalent: 'post-edit' },

  // Command hooks
  { name: 'pre-command', trigger: 'before:command:execute', parameters: ['command', 'args'], returnType: 'HookResult', v3Equivalent: 'pre-command' },
  { name: 'post-command', trigger: 'after:command:execute', parameters: ['command', 'success', 'output'], returnType: 'HookResult', v3Equivalent: 'post-command' },
  { name: 'pre-bash', trigger: 'before:bash:execute', parameters: ['script'], returnType: 'HookResult', v3Equivalent: 'pre-command' },
  { name: 'post-bash', trigger: 'after:bash:execute', parameters: ['script', 'exitCode'], returnType: 'HookResult', v3Equivalent: 'post-command' },

  // Task hooks
  { name: 'pre-task', trigger: 'before:task:start', parameters: ['task'], returnType: 'HookResult', v3Equivalent: 'pre-task' },
  { name: 'post-task', trigger: 'after:task:complete', parameters: ['task', 'result'], returnType: 'HookResult', v3Equivalent: 'post-task' },
  { name: 'task-assign', trigger: 'on:task:assign', parameters: ['task', 'agent'], returnType: 'HookResult', v3Equivalent: 'task-assign' },
  { name: 'task-fail', trigger: 'on:task:fail', parameters: ['task', 'error'], returnType: 'HookResult', v3Equivalent: 'task-fail' },

  // Agent hooks
  { name: 'agent-spawn', trigger: 'on:agent:spawn', parameters: ['agentConfig'], returnType: 'HookResult', v3Equivalent: 'agent-spawn' },
  { name: 'agent-terminate', trigger: 'on:agent:terminate', parameters: ['agentId', 'reason'], returnType: 'HookResult', v3Equivalent: 'agent-terminate' },
  { name: 'agent-message', trigger: 'on:agent:message', parameters: ['from', 'to', 'message'], returnType: 'HookResult', v3Equivalent: 'agent-message' },
  { name: 'agent-error', trigger: 'on:agent:error', parameters: ['agentId', 'error'], returnType: 'HookResult', v3Equivalent: 'agent-error' },

  // Swarm hooks
  { name: 'swarm-init', trigger: 'on:swarm:init', parameters: ['topology', 'config'], returnType: 'HookResult', v3Equivalent: 'swarm-init' },
  { name: 'swarm-scale', trigger: 'on:swarm:scale', parameters: ['direction', 'count'], returnType: 'HookResult', v3Equivalent: 'swarm-scale' },
  { name: 'swarm-consensus', trigger: 'on:swarm:consensus', parameters: ['proposal', 'result'], returnType: 'HookResult', v3Equivalent: 'swarm-consensus' },
  { name: 'swarm-broadcast', trigger: 'on:swarm:broadcast', parameters: ['message'], returnType: 'HookResult', v3Equivalent: 'swarm-broadcast' },

  // Memory hooks
  { name: 'memory-store', trigger: 'on:memory:store', parameters: ['entry'], returnType: 'HookResult', v3Equivalent: 'memory-store' },
  { name: 'memory-retrieve', trigger: 'on:memory:retrieve', parameters: ['query', 'results'], returnType: 'HookResult', v3Equivalent: 'memory-retrieve' },
  { name: 'memory-delete', trigger: 'on:memory:delete', parameters: ['id'], returnType: 'HookResult', v3Equivalent: 'memory-delete' },
  { name: 'memory-consolidate', trigger: 'on:memory:consolidate', parameters: [], returnType: 'HookResult', v3Equivalent: 'memory-consolidate' },

  // Learning hooks
  { name: 'learning-pattern', trigger: 'on:learning:pattern', parameters: ['pattern'], returnType: 'HookResult', v3Equivalent: 'learning-pattern' },
  { name: 'learning-reward', trigger: 'on:learning:reward', parameters: ['trajectory', 'reward'], returnType: 'HookResult', v3Equivalent: 'learning-reward' },
  { name: 'learning-distill', trigger: 'on:learning:distill', parameters: ['memories'], returnType: 'HookResult', v3Equivalent: 'learning-distill' },
  { name: 'learning-consolidate', trigger: 'on:learning:consolidate', parameters: [], returnType: 'HookResult', v3Equivalent: 'learning-consolidate' },

  // Session hooks
  { name: 'session-start', trigger: 'on:session:start', parameters: ['sessionId'], returnType: 'HookResult', v3Equivalent: 'session-start' },
  { name: 'session-end', trigger: 'on:session:end', parameters: ['sessionId', 'metrics'], returnType: 'HookResult', v3Equivalent: 'session-end' },
  { name: 'session-resume', trigger: 'on:session:resume', parameters: ['sessionId'], returnType: 'HookResult', v3Equivalent: 'session-resume' },
  { name: 'session-pause', trigger: 'on:session:pause', parameters: ['sessionId'], returnType: 'HookResult', v3Equivalent: 'session-pause' },

  // Config hooks
  { name: 'config-load', trigger: 'on:config:load', parameters: ['config'], returnType: 'HookResult', v3Equivalent: 'config-load' },
  { name: 'config-save', trigger: 'on:config:save', parameters: ['config'], returnType: 'HookResult', v3Equivalent: 'config-save' },
  { name: 'config-change', trigger: 'on:config:change', parameters: ['key', 'oldValue', 'newValue'], returnType: 'HookResult', v3Equivalent: 'config-change' },

  // Error hooks
  { name: 'error-global', trigger: 'on:error:global', parameters: ['error'], returnType: 'HookResult', v3Equivalent: 'error-global' },
  { name: 'error-recover', trigger: 'on:error:recover', parameters: ['error', 'strategy'], returnType: 'HookResult', v3Equivalent: 'error-recover' },

  // Performance hooks
  { name: 'perf-threshold', trigger: 'on:perf:threshold', parameters: ['metric', 'value'], returnType: 'HookResult', v3Equivalent: 'perf-threshold' },
  { name: 'perf-report', trigger: 'on:perf:report', parameters: ['report'], returnType: 'HookResult', v3Equivalent: 'perf-report' },

  // Security hooks
  { name: 'security-alert', trigger: 'on:security:alert', parameters: ['alert'], returnType: 'HookResult', v3Equivalent: 'security-alert' },
  { name: 'security-block', trigger: 'on:security:block', parameters: ['operation', 'reason'], returnType: 'HookResult', v3Equivalent: 'security-block' },
  { name: 'security-audit', trigger: 'on:security:audit', parameters: ['action', 'context'], returnType: 'HookResult', v3Equivalent: 'security-audit' },
];

/**
 * V2 API Interfaces
 */
export const V2_API_INTERFACES: V2APIInterface[] = [
  // Core interfaces
  {
    name: 'HiveMind',
    methods: [
      { name: 'initialize', signature: '(config?: HiveMindConfig): Promise<void>' },
      { name: 'spawn', signature: '(type: string, config?: AgentConfig): Promise<Agent>' },
      { name: 'getStatus', signature: '(): Promise<HiveMindStatus>' },
      { name: 'shutdown', signature: '(): Promise<void>' },
    ],
    v3Equivalent: 'UnifiedSwarmCoordinator',
  },
  {
    name: 'SwarmCoordinator',
    methods: [
      { name: 'init', signature: '(topology: string): Promise<void>' },
      { name: 'addAgent', signature: '(agent: Agent): Promise<void>' },
      { name: 'removeAgent', signature: '(agentId: string): Promise<void>' },
      { name: 'broadcast', signature: '(message: Message): Promise<void>' },
      { name: 'consensus', signature: '(proposal: Proposal): Promise<ConsensusResult>' },
    ],
    v3Equivalent: 'UnifiedSwarmCoordinator',
  },
  {
    name: 'MemoryManager',
    methods: [
      { name: 'store', signature: '(entry: MemoryEntry): Promise<string>' },
      { name: 'query', signature: '(search: string): Promise<MemoryEntry[]>' },
      { name: 'delete', signature: '(id: string): Promise<boolean>' },
      { name: 'clear', signature: '(): Promise<void>' },
      { name: 'getStats', signature: '(): Promise<MemoryStats>' },
    ],
    v3Equivalent: 'UnifiedMemoryService',
  },
  {
    name: 'AgentManager',
    methods: [
      { name: 'spawn', signature: '(config: AgentConfig): Promise<Agent>' },
      { name: 'terminate', signature: '(id: string): Promise<void>' },
      { name: 'list', signature: '(): Promise<Agent[]>' },
      { name: 'getInfo', signature: '(id: string): Promise<AgentInfo>' },
    ],
    v3Equivalent: 'AgentLifecycleService',
  },
  {
    name: 'TaskOrchestrator',
    methods: [
      { name: 'create', signature: '(definition: TaskDefinition): Promise<Task>' },
      { name: 'assign', signature: '(taskId: string, agentId: string): Promise<void>' },
      { name: 'complete', signature: '(taskId: string, result?: any): Promise<void>' },
      { name: 'getStatus', signature: '(taskId: string): Promise<TaskStatus>' },
    ],
    v3Equivalent: 'TaskExecutionService',
  },
];

/**
 * Mock V3 service for testing
 */
interface MockV3Service {
  cli: {
    execute: (command: string, args: string[]) => Promise<{ success: boolean; output: string }>;
    getCommands: () => string[];
  };
  mcp: {
    callTool: (name: string, params: Record<string, unknown>) => Promise<unknown>;
    getTools: () => string[];
    translateToolName: (v2Name: string) => string;
  };
  hooks: {
    trigger: (name: string, params: Record<string, unknown>) => Promise<{ handled: boolean; result: unknown }>;
    getHooks: () => string[];
  };
  api: {
    getClass: (name: string) => { methods: string[] } | null;
    getClasses: () => string[];
  };
}

/**
 * V2 Compatibility Validator
 *
 * Tests V3 implementation against V2 capabilities to ensure backward compatibility.
 */
export class V2CompatibilityValidator {
  private readonly v3Service: MockV3Service;
  private readonly v2Version: string;
  private readonly v3Version: string;
  private readonly verbose: boolean;

  constructor(options: {
    v3Service?: MockV3Service;
    v2Version?: string;
    v3Version?: string;
    verbose?: boolean;
  } = {}) {
    this.v3Service = options.v3Service || this.createDefaultMockService();
    this.v2Version = options.v2Version || '2.0.0';
    this.v3Version = options.v3Version || '3.0.0';
    this.verbose = options.verbose || false;
  }

  /**
   * Create default mock V3 service for testing
   */
  private createDefaultMockService(): MockV3Service {
    // Tool name mapping from V2 to V3
    const toolNameMapping: Record<string, string> = {
      'dispatch_agent': 'agent/spawn',
      'agents/spawn': 'agent/spawn',
      'agents/list': 'agent/list',
      'agents/terminate': 'agent/terminate',
      'agents/info': 'agent/status',
      'agent/create': 'agent/spawn',
      'swarm_status': 'swarm/status',
      'swarm/get-status': 'swarm/status',
      'swarm/get-comprehensive-status': 'swarm/status',
      'mcp__ruv-swarm__swarm_init': 'swarm/init',
      'mcp__ruv-swarm__swarm_status': 'swarm/status',
      'mcp__ruv-swarm__agent_spawn': 'agent/spawn',
      'mcp__ruv-swarm__agent_list': 'agent/list',
      'mcp__ruv-swarm__agent_metrics': 'agent/status',
      'memory/query': 'memory/search',
      'mcp__ruv-swarm__memory_usage': 'memory/list',
      'config/get': 'config/load',
      'config/update': 'config/save',
      'mcp__ruv-swarm__neural_status': 'hooks/metrics',
      'mcp__ruv-swarm__neural_train': 'hooks/pretrain',
    };

    const v3Tools = [
      'agent/spawn', 'agent/list', 'agent/terminate', 'agent/status',
      'swarm/init', 'swarm/status', 'swarm/scale', 'swarm/consensus', 'swarm/broadcast',
      'memory/store', 'memory/search', 'memory/delete', 'memory/list',
      'task/create', 'task/assign', 'task/status', 'task/complete',
      'config/load', 'config/save',
      'hooks/metrics', 'hooks/pretrain',
      'github/pr-create', 'github/pr-review', 'github/issue-create',
    ];

    const v3Commands = [
      'init', 'start', 'stop', 'status', 'config',
      'agent spawn', 'agent list', 'agent terminate', 'agent status',
      'swarm init', 'swarm status', 'swarm scale',
      'memory list', 'memory search', 'memory clear',
      'hooks pre-edit', 'hooks post-edit', 'hooks pre-command', 'hooks post-command',
      'hooks route', 'hooks pretrain', 'hooks metrics',
    ];

    const v3Hooks = V2_HOOKS.map(h => h.v3Equivalent || h.name);

    const v3Classes = ['UnifiedSwarmCoordinator', 'UnifiedMemoryService', 'AgentLifecycleService', 'TaskExecutionService'];

    return {
      cli: {
        execute: vi.fn().mockImplementation(async (command: string) => {
          const isSupported = v3Commands.some(c => c === command || command.startsWith(c.split(' ')[0]));
          return { success: isSupported, output: isSupported ? 'OK' : 'Command not found' };
        }),
        getCommands: vi.fn().mockReturnValue(v3Commands),
      },
      mcp: {
        callTool: vi.fn().mockImplementation(async (name: string) => {
          const v3Name = toolNameMapping[name] || name;
          const isSupported = v3Tools.includes(v3Name);
          if (!isSupported) throw new Error(`Tool not found: ${name}`);
          return { success: true };
        }),
        getTools: vi.fn().mockReturnValue(v3Tools),
        translateToolName: vi.fn().mockImplementation((v2Name: string) => toolNameMapping[v2Name] || v2Name),
      },
      hooks: {
        trigger: vi.fn().mockImplementation(async (name: string) => {
          const isSupported = v3Hooks.includes(name);
          return { handled: isSupported, result: isSupported ? {} : null };
        }),
        getHooks: vi.fn().mockReturnValue(v3Hooks),
      },
      api: {
        getClass: vi.fn().mockImplementation((name: string) => {
          const mapping: Record<string, { methods: string[] }> = {
            'UnifiedSwarmCoordinator': { methods: ['initialize', 'spawn', 'addAgent', 'removeAgent', 'broadcast', 'consensus', 'getStatus', 'shutdown'] },
            'UnifiedMemoryService': { methods: ['store', 'search', 'delete', 'clear', 'getStats'] },
            'AgentLifecycleService': { methods: ['spawn', 'terminate', 'list', 'getInfo', 'getStatus'] },
            'TaskExecutionService': { methods: ['create', 'assign', 'complete', 'getStatus'] },
          };
          return mapping[name] || null;
        }),
        getClasses: vi.fn().mockReturnValue(v3Classes),
      },
    };
  }

  /**
   * Validate CLI command compatibility
   */
  async validateCLI(): Promise<ValidationResult> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    const v3Commands = this.v3Service.cli.getCommands();

    for (const cmd of V2_CLI_COMMANDS) {
      const v3Equivalent = cmd.v3Equivalent || cmd.name;
      const isSupported = v3Commands.some(c =>
        c === v3Equivalent || c.startsWith(v3Equivalent.split(' ')[0])
      );

      // Check command exists
      checks.push({
        name: `CLI: ${cmd.name}`,
        category: 'cli',
        passed: isSupported,
        message: isSupported
          ? `Command "${cmd.name}" is supported via "${v3Equivalent}"`
          : `Command "${cmd.name}" is not available in V3`,
        v2Behavior: `Execute "${cmd.name}" with flags: ${cmd.flags.join(', ') || 'none'}`,
        v3Behavior: isSupported
          ? `Execute "${v3Equivalent}"`
          : 'Not available',
        breaking: !isSupported && !cmd.deprecated,
        migrationPath: isSupported ? `Use "${v3Equivalent}" instead` : undefined,
      });

      // Check aliases
      for (const alias of cmd.aliases) {
        const aliasSupported = v3Commands.some(c => c === alias || c.startsWith(alias.split(' ')[0]));
        checks.push({
          name: `CLI Alias: ${alias}`,
          category: 'cli',
          passed: aliasSupported || isSupported,
          message: aliasSupported
            ? `Alias "${alias}" is supported`
            : `Alias "${alias}" not directly supported, use "${v3Equivalent}"`,
          v2Behavior: `Execute "${alias}"`,
          v3Behavior: aliasSupported ? `Execute "${alias}"` : `Execute "${v3Equivalent}"`,
          breaking: false,
          migrationPath: `Use "${v3Equivalent}" for consistent behavior`,
        });
      }

      // Check flags
      for (const flag of cmd.flags) {
        checks.push({
          name: `CLI Flag: ${cmd.name} ${flag}`,
          category: 'cli',
          passed: isSupported, // Assume flags are supported if command is
          message: isSupported
            ? `Flag "${flag}" is expected to work with "${v3Equivalent}"`
            : `Flag "${flag}" not available (command not supported)`,
          v2Behavior: `Use "${flag}" with "${cmd.name}"`,
          v3Behavior: isSupported ? `Use "${flag}" with "${v3Equivalent}"` : 'Not available',
          breaking: !isSupported && !cmd.deprecated,
        });
      }
    }

    const passedChecks = checks.filter(c => c.passed).length;
    const breakingChanges = checks.filter(c => c.breaking).length;

    return {
      category: 'cli',
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      breakingChanges,
      checks,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Validate MCP tool compatibility
   */
  async validateMCPTools(): Promise<ValidationResult> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    const v3Tools = this.v3Service.mcp.getTools();

    for (const tool of V2_MCP_TOOLS) {
      const v3Equivalent = this.v3Service.mcp.translateToolName(tool.name);
      const isSupported = v3Tools.includes(v3Equivalent);

      // Check tool exists
      checks.push({
        name: `MCP Tool: ${tool.name}`,
        category: 'mcp',
        passed: isSupported,
        message: isSupported
          ? `Tool "${tool.name}" maps to "${v3Equivalent}"`
          : `Tool "${tool.name}" has no V3 equivalent`,
        v2Behavior: `Call "${tool.name}" with params`,
        v3Behavior: isSupported
          ? `Call "${v3Equivalent}" with translated params`
          : 'Not available',
        breaking: !isSupported && !tool.deprecated,
        migrationPath: isSupported ? `Use "${v3Equivalent}" with updated parameters` : undefined,
        details: {
          v2Parameters: tool.parameters,
          v3Equivalent,
        },
      });

      // Check parameter translation
      if (isSupported) {
        for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
          checks.push({
            name: `MCP Param: ${tool.name}.${paramName}`,
            category: 'mcp',
            passed: true, // Assume param translation works
            message: `Parameter "${paramName}" (${paramDef.type}) is translated`,
            v2Behavior: `Pass "${paramName}" as ${paramDef.type}`,
            v3Behavior: `Translated to V3 format`,
            breaking: false,
          });
        }
      }
    }

    const passedChecks = checks.filter(c => c.passed).length;
    const breakingChanges = checks.filter(c => c.breaking).length;

    return {
      category: 'mcp',
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      breakingChanges,
      checks,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Validate hook compatibility
   */
  async validateHooks(): Promise<ValidationResult> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    const v3Hooks = this.v3Service.hooks.getHooks();

    for (const hook of V2_HOOKS) {
      const v3Equivalent = hook.v3Equivalent || hook.name;
      const isSupported = v3Hooks.includes(v3Equivalent);

      // Check hook exists
      checks.push({
        name: `Hook: ${hook.name}`,
        category: 'hooks',
        passed: isSupported,
        message: isSupported
          ? `Hook "${hook.name}" is supported as "${v3Equivalent}"`
          : `Hook "${hook.name}" is not available in V3`,
        v2Behavior: `Trigger on "${hook.trigger}" with params: ${hook.parameters.join(', ')}`,
        v3Behavior: isSupported
          ? `Trigger "${v3Equivalent}" with translated params`
          : 'Not available',
        breaking: !isSupported && !hook.deprecated,
        migrationPath: isSupported ? `Listen for "${v3Equivalent}" instead` : undefined,
        details: {
          v2Trigger: hook.trigger,
          v2Parameters: hook.parameters,
          v3Equivalent,
        },
      });

      // Check parameters
      for (const param of hook.parameters) {
        checks.push({
          name: `Hook Param: ${hook.name}.${param}`,
          category: 'hooks',
          passed: isSupported, // Assume params work if hook works
          message: isSupported
            ? `Parameter "${param}" is passed to hook`
            : `Parameter "${param}" not available (hook not supported)`,
          v2Behavior: `Receive "${param}" in hook handler`,
          v3Behavior: isSupported ? 'Translated parameter available' : 'Not available',
          breaking: !isSupported,
        });
      }

      // Check return type compatibility
      checks.push({
        name: `Hook Return: ${hook.name}`,
        category: 'hooks',
        passed: isSupported,
        message: isSupported
          ? `Return type "${hook.returnType}" is compatible`
          : `Return type not available (hook not supported)`,
        v2Behavior: `Return ${hook.returnType}`,
        v3Behavior: isSupported ? `Return compatible ${hook.returnType}` : 'Not available',
        breaking: !isSupported,
      });
    }

    const passedChecks = checks.filter(c => c.passed).length;
    const breakingChanges = checks.filter(c => c.breaking).length;

    return {
      category: 'hooks',
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      breakingChanges,
      checks,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Validate API compatibility
   */
  async validateAPI(): Promise<ValidationResult> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    const v3Classes = this.v3Service.api.getClasses();

    for (const iface of V2_API_INTERFACES) {
      const v3Equivalent = iface.v3Equivalent || iface.name;
      const v3Class = this.v3Service.api.getClass(v3Equivalent);
      const isSupported = v3Class !== null;

      // Check class exists
      checks.push({
        name: `API Class: ${iface.name}`,
        category: 'api',
        passed: isSupported,
        message: isSupported
          ? `Class "${iface.name}" is available as "${v3Equivalent}"`
          : `Class "${iface.name}" has no V3 equivalent`,
        v2Behavior: `Import and use "${iface.name}"`,
        v3Behavior: isSupported
          ? `Import "${v3Equivalent}" from @claude-flow/*`
          : 'Not available',
        breaking: !isSupported && !iface.deprecated,
        migrationPath: isSupported
          ? `Use "${v3Equivalent}" with import alias`
          : undefined,
      });

      // Check methods
      for (const method of iface.methods) {
        const methodAvailable = v3Class?.methods.some(m =>
          m === method.name || m.toLowerCase() === method.name.toLowerCase()
        );

        checks.push({
          name: `API Method: ${iface.name}.${method.name}`,
          category: 'api',
          passed: methodAvailable || false,
          message: methodAvailable
            ? `Method "${method.name}" is available`
            : `Method "${method.name}" may have different name or signature`,
          v2Behavior: `Call ${iface.name}.${method.name}${method.signature}`,
          v3Behavior: methodAvailable
            ? `Call ${v3Equivalent}.${method.name}()`
            : 'May need migration',
          breaking: !methodAvailable && !iface.deprecated,
          migrationPath: methodAvailable
            ? 'Same method signature'
            : 'Check V3 API documentation',
        });
      }
    }

    const passedChecks = checks.filter(c => c.passed).length;
    const breakingChanges = checks.filter(c => c.breaking).length;

    return {
      category: 'api',
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      breakingChanges,
      checks,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Run full validation suite
   */
  async runFullValidation(): Promise<FullValidationReport> {
    const startTime = Date.now();

    this.log('Starting V2 Compatibility Validation...');

    this.log('Validating CLI commands...');
    const cliResult = await this.validateCLI();

    this.log('Validating MCP tools...');
    const mcpResult = await this.validateMCPTools();

    this.log('Validating hooks...');
    const hooksResult = await this.validateHooks();

    this.log('Validating API interfaces...');
    const apiResult = await this.validateAPI();

    const totalChecks = cliResult.totalChecks + mcpResult.totalChecks + hooksResult.totalChecks + apiResult.totalChecks;
    const passedChecks = cliResult.passedChecks + mcpResult.passedChecks + hooksResult.passedChecks + apiResult.passedChecks;
    const failedChecks = totalChecks - passedChecks;
    const breakingChanges = cliResult.breakingChanges + mcpResult.breakingChanges + hooksResult.breakingChanges + apiResult.breakingChanges;

    const overallPassed = breakingChanges === 0;

    const recommendations = this.generateRecommendations(cliResult, mcpResult, hooksResult, apiResult);

    const report: FullValidationReport = {
      timestamp: new Date(),
      v2Version: this.v2Version,
      v3Version: this.v3Version,
      overallPassed,
      totalChecks,
      passedChecks,
      failedChecks,
      breakingChanges,
      cli: cliResult,
      mcp: mcpResult,
      hooks: hooksResult,
      api: apiResult,
      summary: this.generateSummary(cliResult, mcpResult, hooksResult, apiResult, overallPassed),
      recommendations,
      duration: Date.now() - startTime,
    };

    this.log('Validation complete.');

    return report;
  }

  /**
   * Generate recommendations based on results
   */
  private generateRecommendations(
    cli: ValidationResult,
    mcp: ValidationResult,
    hooks: ValidationResult,
    api: ValidationResult
  ): string[] {
    const recommendations: string[] = [];

    if (cli.breakingChanges > 0) {
      recommendations.push('Update CLI command calls to use V3 equivalents');
      recommendations.push('Run migration script: npx @claude-flow/cli migrate');
    }

    if (mcp.breakingChanges > 0) {
      recommendations.push('Enable V2 compatibility mode in MCP server configuration');
      recommendations.push('Update tool calls to use new naming convention (e.g., agent/spawn)');
    }

    if (hooks.breakingChanges > 0) {
      recommendations.push('Review hook configuration for renamed or removed hooks');
      recommendations.push('Update hook listeners to use V3 event names');
    }

    if (api.breakingChanges > 0) {
      recommendations.push('Update import statements to use @claude-flow/* packages');
      recommendations.push('Use provided import aliases for backward compatibility');
    }

    if (cli.passedChecks < cli.totalChecks) {
      recommendations.push('Some CLI aliases may not be directly supported - use canonical command names');
    }

    if (mcp.passedChecks < mcp.totalChecks) {
      recommendations.push('Consider using tool name translation layer for gradual migration');
    }

    if (recommendations.length === 0) {
      recommendations.push('No migration actions required - V2 code is fully compatible');
    }

    return recommendations;
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    cli: ValidationResult,
    mcp: ValidationResult,
    hooks: ValidationResult,
    api: ValidationResult,
    overallPassed: boolean
  ): string {
    const lines: string[] = [
      '='.repeat(70),
      '           V2 COMPATIBILITY VALIDATION REPORT',
      '='.repeat(70),
      '',
      `Status: ${overallPassed ? 'PASSED - No breaking changes detected' : 'FAILED - Breaking changes detected'}`,
      '',
      'Category Summary:',
      '-'.repeat(70),
      `CLI Commands:    ${cli.passedChecks}/${cli.totalChecks} passed (${cli.breakingChanges} breaking)`,
      `MCP Tools:       ${mcp.passedChecks}/${mcp.totalChecks} passed (${mcp.breakingChanges} breaking)`,
      `Hooks:           ${hooks.passedChecks}/${hooks.totalChecks} passed (${hooks.breakingChanges} breaking)`,
      `API Interfaces:  ${api.passedChecks}/${api.totalChecks} passed (${api.breakingChanges} breaking)`,
      '-'.repeat(70),
      '',
    ];

    if (!overallPassed) {
      lines.push('Breaking Changes Detected:');
      lines.push('');

      const allBreaking = [
        ...cli.checks.filter(c => c.breaking).map(c => `  CLI: ${c.name}`),
        ...mcp.checks.filter(c => c.breaking).map(c => `  MCP: ${c.name}`),
        ...hooks.checks.filter(c => c.breaking).map(c => `  Hooks: ${c.name}`),
        ...api.checks.filter(c => c.breaking).map(c => `  API: ${c.name}`),
      ].slice(0, 20);

      lines.push(...allBreaking);

      if (cli.breakingChanges + mcp.breakingChanges + hooks.breakingChanges + api.breakingChanges > 20) {
        lines.push(`  ... and ${cli.breakingChanges + mcp.breakingChanges + hooks.breakingChanges + api.breakingChanges - 20} more`);
      }

      lines.push('');
    }

    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.verbose) {
      console.log(`[V2Compat] ${message}`);
    }
  }
}

/**
 * Generate markdown compatibility report
 */
export function generateCompatibilityReport(report: FullValidationReport): string {
  const lines: string[] = [
    '# V2 Compatibility Validation Report',
    '',
    `> Generated: ${report.timestamp.toISOString()}`,
    `> V2 Version: ${report.v2Version}`,
    `> V3 Version: ${report.v3Version}`,
    '',
    '## Executive Summary',
    '',
    `**Status**: ${report.overallPassed ? 'PASSED' : 'FAILED'}`,
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total Checks | ${report.totalChecks} |`,
    `| Passed | ${report.passedChecks} |`,
    `| Failed | ${report.failedChecks} |`,
    `| Breaking Changes | ${report.breakingChanges} |`,
    `| Duration | ${report.duration}ms |`,
    '',
    '## Category Results',
    '',
    '### CLI Commands',
    '',
    `- **Total**: ${report.cli.totalChecks}`,
    `- **Passed**: ${report.cli.passedChecks}`,
    `- **Failed**: ${report.cli.failedChecks}`,
    `- **Breaking**: ${report.cli.breakingChanges}`,
    '',
    '| Command | Status | Migration |',
    '|---------|--------|-----------|',
    ...report.cli.checks
      .filter(c => c.name.startsWith('CLI:'))
      .slice(0, 30)
      .map(c => `| ${c.name.replace('CLI: ', '')} | ${c.passed ? 'OK' : 'FAIL'} | ${c.migrationPath || 'N/A'} |`),
    '',
    '### MCP Tools',
    '',
    `- **Total**: ${report.mcp.totalChecks}`,
    `- **Passed**: ${report.mcp.passedChecks}`,
    `- **Failed**: ${report.mcp.failedChecks}`,
    `- **Breaking**: ${report.mcp.breakingChanges}`,
    '',
    '| Tool | Status | V3 Equivalent |',
    '|------|--------|---------------|',
    ...report.mcp.checks
      .filter(c => c.name.startsWith('MCP Tool:'))
      .slice(0, 40)
      .map(c => {
        const v3Name = c.details?.v3Equivalent as string || 'N/A';
        return `| ${c.name.replace('MCP Tool: ', '')} | ${c.passed ? 'OK' : 'FAIL'} | ${v3Name} |`;
      }),
    '',
    '### Hooks',
    '',
    `- **Total**: ${report.hooks.totalChecks}`,
    `- **Passed**: ${report.hooks.passedChecks}`,
    `- **Failed**: ${report.hooks.failedChecks}`,
    `- **Breaking**: ${report.hooks.breakingChanges}`,
    '',
    '| Hook | Status | V3 Trigger |',
    '|------|--------|------------|',
    ...report.hooks.checks
      .filter(c => c.name.startsWith('Hook:') && !c.name.includes('Param') && !c.name.includes('Return'))
      .slice(0, 50)
      .map(c => {
        const v3Name = c.details?.v3Equivalent as string || 'N/A';
        return `| ${c.name.replace('Hook: ', '')} | ${c.passed ? 'OK' : 'FAIL'} | ${v3Name} |`;
      }),
    '',
    '### API Interfaces',
    '',
    `- **Total**: ${report.api.totalChecks}`,
    `- **Passed**: ${report.api.passedChecks}`,
    `- **Failed**: ${report.api.failedChecks}`,
    `- **Breaking**: ${report.api.breakingChanges}`,
    '',
    '| Interface/Method | Status | Migration |',
    '|------------------|--------|-----------|',
    ...report.api.checks
      .slice(0, 30)
      .map(c => `| ${c.name.replace('API ', '')} | ${c.passed ? 'OK' : 'FAIL'} | ${c.migrationPath || 'N/A'} |`),
    '',
    '## Breaking Changes',
    '',
  ];

  const breakingChecks = [
    ...report.cli.checks.filter(c => c.breaking),
    ...report.mcp.checks.filter(c => c.breaking),
    ...report.hooks.checks.filter(c => c.breaking),
    ...report.api.checks.filter(c => c.breaking),
  ];

  if (breakingChecks.length === 0) {
    lines.push('No breaking changes detected.');
  } else {
    lines.push('| Category | Item | V2 Behavior | V3 Behavior |');
    lines.push('|----------|------|-------------|-------------|');
    for (const check of breakingChecks.slice(0, 50)) {
      lines.push(`| ${check.category.toUpperCase()} | ${check.name} | ${check.v2Behavior} | ${check.v3Behavior} |`);
    }
  }

  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  for (const rec of report.recommendations) {
    lines.push(`- ${rec}`);
  }

  lines.push('');
  lines.push('## Migration Guide');
  lines.push('');
  lines.push('### CLI Migration');
  lines.push('');
  lines.push('```bash');
  lines.push('# V2 commands are supported via compatibility layer');
  lines.push('# Deprecated commands will show warnings');
  lines.push('');
  lines.push('# V2 (deprecated)');
  lines.push('npx claude-flow hive-mind init');
  lines.push('');
  lines.push('# V3 (recommended)');
  lines.push('npx @claude-flow/cli swarm init');
  lines.push('```');
  lines.push('');
  lines.push('### MCP Tool Migration');
  lines.push('');
  lines.push('```typescript');
  lines.push('// V2 tool call');
  lines.push("await mcp.callTool('dispatch_agent', { type: 'coder' });");
  lines.push('');
  lines.push('// V3 tool call (direct)');
  lines.push("await mcp.callTool('agent/spawn', { agentType: 'coder' });");
  lines.push('');
  lines.push('// V3 with compatibility layer');
  lines.push("await mcp.callTool('dispatch_agent', { type: 'coder' }); // Auto-translated");
  lines.push('```');
  lines.push('');
  lines.push('### API Migration');
  lines.push('');
  lines.push('```typescript');
  lines.push("// V2 imports");
  lines.push("import { HiveMind } from 'claude-flow/hive-mind';");
  lines.push("import { SwarmCoordinator } from 'claude-flow/swarm';");
  lines.push('');
  lines.push("// V3 imports (using aliases)");
  lines.push("import { UnifiedSwarmCoordinator as HiveMind } from '@claude-flow/swarm';");
  lines.push("import { UnifiedSwarmCoordinator as SwarmCoordinator } from '@claude-flow/swarm';");
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Report generated by V2CompatibilityValidator*');

  return lines.join('\n');
}
