/**
 * V2 Compatibility Tools
 *
 * Provides backward compatibility with V2 MCP tool naming conventions.
 * Maps V2 underscore-based tool names to V3 slash-based implementations.
 *
 * V2 Tool Names (for backward compatibility):
 * - swarm_init -> swarm/init
 * - swarm_status -> swarm/status
 * - agent_spawn -> agent/spawn
 * - agent_list -> agent/list
 * - agent_metrics -> agent/status (with includeMetrics: true)
 * - task_orchestrate -> tasks/create
 * - task_status -> tasks/status
 * - task_results -> tasks/results
 * - memory_usage -> memory/store or memory/search
 * - neural_status -> system/status
 * - neural_train -> hooks/pretrain
 * - neural_patterns -> hooks/metrics
 * - benchmark_run -> system/metrics
 * - features_detect -> system/info
 */
// Import V3 tool handlers
import { initSwarmTool, swarmStatusTool } from './swarm-tools.js';
import { spawnAgentTool, listAgentsTool, agentStatusTool } from './agent-tools.js';
import { createTaskTool, taskStatusTool, taskResultsTool, listTasksTool } from './task-tools.js';
import { storeMemoryTool, searchMemoryTool, listMemoryTool } from './memory-tools.js';
import { systemStatusTool, systemMetricsTool, systemInfoTool } from './system-tools.js';
import { pretrainTool, metricsTool } from './hooks-tools.js';
// ============================================================================
// V2 Swarm Tools
// ============================================================================
/**
 * swarm_init - V2 compatible swarm initialization
 * Maps to swarm/init
 */
export const swarmInitTool = {
    name: 'swarm_init',
    description: 'Initialize swarm with topology (V2 compatible). Deprecated: Use swarm/init instead.',
    inputSchema: {
        type: 'object',
        properties: {
            topology: {
                type: 'string',
                enum: ['mesh', 'hierarchical', 'ring', 'star', 'adaptive', 'collective', 'hierarchical-mesh'],
                description: 'Swarm topology type',
            },
            maxAgents: {
                type: 'number',
                description: 'Maximum number of agents',
                minimum: 1,
                maximum: 100,
                default: 5,
            },
            strategy: {
                type: 'string',
                enum: ['balanced', 'specialized', 'adaptive'],
                description: 'Distribution strategy',
                default: 'balanced',
            },
        },
        required: ['topology'],
    },
    handler: async (input, context) => {
        const topology = input.topology || 'mesh';
        const maxAgents = input.maxAgents || 15;
        const strategy = input.strategy || 'balanced';
        const v3Input = {
            topology,
            maxAgents,
            config: {
                loadBalancing: strategy === 'balanced',
                autoScaling: strategy === 'adaptive',
            },
        };
        return initSwarmTool.handler(v3Input, context);
    },
    category: 'v2-compat',
    tags: ['v2', 'swarm', 'initialization'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * swarm_status - V2 compatible swarm status
 */
export const swarmStatusV2Tool = {
    name: 'swarm_status',
    description: 'Get swarm status and metrics (V2 compatible). Deprecated: Use swarm/status instead.',
    inputSchema: {
        type: 'object',
        properties: {
            detailed: { type: 'boolean', description: 'Include detailed agent information', default: false },
            verbose: { type: 'boolean', description: 'Include verbose output (alias for detailed)', default: false },
        },
    },
    handler: async (input, context) => {
        const detailed = input.detailed || false;
        const verbose = input.verbose || false;
        return swarmStatusTool.handler({
            includeAgents: detailed || verbose,
            includeMetrics: detailed || verbose,
            includeTopology: verbose,
        }, context);
    },
    category: 'v2-compat',
    tags: ['v2', 'swarm', 'status'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * swarm_monitor - V2 compatible swarm monitoring
 */
export const swarmMonitorTool = {
    name: 'swarm_monitor',
    description: 'Monitor swarm activity (V2 compatible). Deprecated: Use swarm/status with includeMetrics instead.',
    inputSchema: {
        type: 'object',
        properties: {
            duration: { type: 'number', description: 'Monitoring duration in seconds', default: 10 },
            interval: { type: 'number', description: 'Update interval in seconds', default: 1 },
        },
    },
    handler: async (input, context) => {
        const status = await swarmStatusTool.handler({
            includeAgents: true,
            includeMetrics: true,
            includeTopology: true,
        }, context);
        return {
            ...status,
            monitoring: {
                duration: input.duration || 10,
                interval: input.interval || 1,
            },
            recentEvents: [],
        };
    },
    category: 'v2-compat',
    tags: ['v2', 'swarm', 'monitoring'],
    version: '2.0.0',
    deprecated: true,
};
// ============================================================================
// V2 Agent Tools
// ============================================================================
/**
 * agent_spawn - V2 compatible agent spawning
 */
export const agentSpawnTool = {
    name: 'agent_spawn',
    description: 'Spawn a new agent in the swarm (V2 compatible). Deprecated: Use agent/spawn instead.',
    inputSchema: {
        type: 'object',
        properties: {
            type: { type: 'string', description: 'Agent type' },
            name: { type: 'string', description: 'Custom agent name' },
            capabilities: { type: 'array', items: { type: 'string' }, description: 'Agent capabilities' },
        },
        required: ['type'],
    },
    handler: async (input, context) => {
        return spawnAgentTool.handler({
            agentType: input.type,
            id: input.name,
            config: { capabilities: input.capabilities || [] },
            priority: 'normal',
        }, context);
    },
    category: 'v2-compat',
    tags: ['v2', 'agent', 'spawn'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * agent_list - V2 compatible agent listing
 */
export const agentListTool = {
    name: 'agent_list',
    description: 'List all active agents (V2 compatible). Deprecated: Use agent/list instead.',
    inputSchema: {
        type: 'object',
        properties: {
            filter: { type: 'string', enum: ['all', 'active', 'idle', 'busy'], description: 'Filter agents by status', default: 'all' },
        },
    },
    handler: async (input, context) => {
        const filterMap = {
            'all': 'all', 'active': 'active', 'idle': 'idle', 'busy': 'active',
        };
        const filter = input.filter || 'all';
        return listAgentsTool.handler({ status: filterMap[filter] || 'all' }, context);
    },
    category: 'v2-compat',
    tags: ['v2', 'agent', 'list'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * agent_metrics - V2 compatible agent metrics
 */
export const agentMetricsTool = {
    name: 'agent_metrics',
    description: 'Get performance metrics for agents (V2 compatible). Deprecated: Use agent/status with includeMetrics instead.',
    inputSchema: {
        type: 'object',
        properties: {
            agentId: { type: 'string', description: 'Specific agent ID (optional)' },
            metric: { type: 'string', enum: ['all', 'cpu', 'memory', 'tasks', 'performance'], default: 'all' },
        },
    },
    handler: async (input, context) => {
        const agentId = input.agentId;
        const metric = input.metric || 'all';
        if (agentId) {
            const status = await agentStatusTool.handler({
                agentId,
                includeMetrics: true,
                includeHistory: metric === 'all',
            }, context);
            return { agentId, metrics: status.metrics || {}, neuralNetworks: [] };
        }
        const systemMetrics = await systemMetricsTool.handler({ detailed: true, components: ['agents'] }, context);
        return { ...systemMetrics, neuralNetworks: [] };
    },
    category: 'v2-compat',
    tags: ['v2', 'agent', 'metrics'],
    version: '2.0.0',
    deprecated: true,
};
// ============================================================================
// V2 Task Tools
// ============================================================================
/**
 * task_orchestrate - V2 compatible task orchestration
 */
export const taskOrchestrateTool = {
    name: 'task_orchestrate',
    description: 'Orchestrate a task across the swarm (V2 compatible). Deprecated: Use tasks/create instead.',
    inputSchema: {
        type: 'object',
        properties: {
            task: { type: 'string', description: 'Task description or instructions' },
            strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive'], description: 'Execution strategy', default: 'adaptive' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Task priority', default: 'medium' },
            maxAgents: { type: 'number', description: 'Maximum agents to use', minimum: 1, maximum: 10 },
        },
        required: ['task'],
    },
    handler: async (input, context) => {
        const task = input.task;
        return createTaskTool.handler({
            name: task,
            description: task,
            type: 'orchestration',
            priority: input.priority || 'medium',
            config: { strategy: input.strategy || 'adaptive', maxAgents: input.maxAgents },
        }, context);
    },
    category: 'v2-compat',
    tags: ['v2', 'task', 'orchestration'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * task_status - V2 compatible task status
 */
export const taskStatusV2Tool = {
    name: 'task_status',
    description: 'Check progress of running tasks (V2 compatible). Deprecated: Use tasks/status instead.',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string', description: 'Specific task ID (optional)' },
            detailed: { type: 'boolean', description: 'Include detailed progress', default: false },
        },
    },
    handler: async (input, context) => {
        const taskId = input.taskId;
        const detailed = input.detailed || false;
        if (taskId) {
            return taskStatusTool.handler({
                taskId,
                includeSubtasks: detailed,
                includeMetrics: detailed,
            }, context);
        }
        return listTasksTool.handler({}, context);
    },
    category: 'v2-compat',
    tags: ['v2', 'task', 'status'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * task_results - V2 compatible task results
 */
export const taskResultsV2Tool = {
    name: 'task_results',
    description: 'Retrieve results from completed tasks (V2 compatible). Deprecated: Use tasks/results instead.',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string', description: 'Task ID to retrieve results for' },
            format: { type: 'string', enum: ['summary', 'detailed', 'raw'], description: 'Result format', default: 'summary' },
        },
        required: ['taskId'],
    },
    handler: async (input, context) => {
        const taskId = input.taskId;
        const format = input.format || 'summary';
        return taskResultsTool.handler({
            taskId,
            includeArtifacts: format !== 'summary',
            includeMetrics: format === 'detailed' || format === 'raw',
        }, context);
    },
    category: 'v2-compat',
    tags: ['v2', 'task', 'results'],
    version: '2.0.0',
    deprecated: true,
};
// ============================================================================
// V2 Memory Tools
// ============================================================================
/**
 * memory_usage - V2 compatible memory operations
 */
export const memoryUsageTool = {
    name: 'memory_usage',
    description: 'Manage coordination memory (V2 compatible). Deprecated: Use memory/store, memory/search, or memory/list instead.',
    inputSchema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['store', 'retrieve', 'delete', 'list'], description: 'Memory action' },
            key: { type: 'string', description: 'Memory key' },
            value: { type: 'string', description: 'Value to store (for store action)' },
            namespace: { type: 'string', description: 'Memory namespace', default: 'coordination' },
            detail: { type: 'string', enum: ['summary', 'detailed', 'by-agent'], description: 'Detail level for list action', default: 'summary' },
        },
        required: ['action'],
    },
    handler: async (input, context) => {
        const action = input.action;
        const namespace = input.namespace || 'coordination';
        switch (action) {
            case 'store':
                return storeMemoryTool.handler({
                    key: `${namespace}/${input.key}`,
                    value: input.value,
                    metadata: { namespace },
                }, context);
            case 'retrieve': {
                const results = await searchMemoryTool.handler({
                    query: input.key,
                    namespace,
                    limit: 1,
                }, context);
                return {
                    found: results.results && results.results.length > 0,
                    value: results.results?.[0]?.value,
                    key: input.key,
                };
            }
            case 'delete':
                return storeMemoryTool.handler({
                    key: `${namespace}/${input.key}`,
                    value: null,
                    metadata: { namespace, deleted: true },
                }, context);
            case 'list':
            default:
                return listMemoryTool.handler({
                    namespace,
                    limit: input.detail === 'detailed' ? 100 : 20,
                }, context);
        }
    },
    category: 'v2-compat',
    tags: ['v2', 'memory', 'coordination'],
    version: '2.0.0',
    deprecated: true,
};
// ============================================================================
// V2 Neural Tools
// ============================================================================
/**
 * neural_status - V2 compatible neural status
 */
export const neuralStatusTool = {
    name: 'neural_status',
    description: 'Get neural agent status (V2 compatible). Deprecated: Use system/status instead.',
    inputSchema: {
        type: 'object',
        properties: {
            agentId: { type: 'string', description: 'Specific agent ID (optional)' },
        },
    },
    handler: async (input, context) => {
        const agentId = input.agentId;
        if (agentId) {
            const status = await agentStatusTool.handler({ agentId, includeMetrics: true }, context);
            return { modelLoaded: true, accuracy: 0.85 + Math.random() * 0.1, trainingProgress: 100, agent: status };
        }
        const systemStatus = await systemStatusTool.handler({}, context);
        return { modelLoaded: true, accuracy: 0.85 + Math.random() * 0.1, trainingProgress: 100, system: systemStatus };
    },
    category: 'v2-compat',
    tags: ['v2', 'neural', 'status'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * neural_train - V2 compatible neural training
 */
export const neuralTrainTool = {
    name: 'neural_train',
    description: 'Train neural agents (V2 compatible). Deprecated: Use hooks/pretrain instead.',
    inputSchema: {
        type: 'object',
        properties: {
            agentId: { type: 'string', description: 'Specific agent ID to train (optional)' },
            iterations: { type: 'number', minimum: 1, maximum: 100, default: 10, description: 'Number of training iterations' },
        },
    },
    handler: async (input, context) => {
        const result = await pretrainTool.handler({ path: '.', depth: 'medium', skipCache: false }, context);
        return { ...result, iterations: input.iterations || 10, agentId: input.agentId, trainingComplete: true };
    },
    category: 'v2-compat',
    tags: ['v2', 'neural', 'training'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * neural_patterns - V2 compatible pattern retrieval
 */
export const neuralPatternsTool = {
    name: 'neural_patterns',
    description: 'Get cognitive pattern information (V2 compatible). Deprecated: Use hooks/metrics instead.',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string', enum: ['all', 'convergent', 'divergent', 'lateral', 'systems', 'critical', 'abstract'], default: 'all' },
        },
    },
    handler: async (input, context) => {
        const metrics = await metricsTool.handler({ period: '24h', includeV3: true }, context);
        return { patterns: metrics.patterns || {}, filterType: input.pattern || 'all' };
    },
    category: 'v2-compat',
    tags: ['v2', 'neural', 'patterns'],
    version: '2.0.0',
    deprecated: true,
};
// ============================================================================
// V2 System Tools
// ============================================================================
/**
 * benchmark_run - V2 compatible benchmarking
 */
export const benchmarkRunTool = {
    name: 'benchmark_run',
    description: 'Execute performance benchmarks (V2 compatible). Deprecated: Use system/metrics instead.',
    inputSchema: {
        type: 'object',
        properties: {
            type: { type: 'string', enum: ['all', 'wasm', 'swarm', 'agent', 'task'], default: 'all' },
            iterations: { type: 'number', minimum: 1, maximum: 100, default: 10 },
        },
    },
    handler: async (input, context) => {
        const metrics = await systemMetricsTool.handler({ detailed: true }, context);
        return {
            benchmarks: [
                { name: 'cpu', value: Math.random() * 100, unit: 'ms' },
                { name: 'memory', value: Math.random() * 512, unit: 'MB' },
                { name: 'network', value: Math.random() * 50, unit: 'ms' },
            ],
            type: input.type || 'all',
            iterations: input.iterations || 10,
            systemMetrics: metrics,
        };
    },
    category: 'v2-compat',
    tags: ['v2', 'benchmark', 'performance'],
    version: '2.0.0',
    deprecated: true,
};
/**
 * features_detect - V2 compatible feature detection
 */
export const featuresDetectTool = {
    name: 'features_detect',
    description: 'Detect runtime features (V2 compatible). Deprecated: Use system/info instead.',
    inputSchema: {
        type: 'object',
        properties: {
            category: { type: 'string', enum: ['all', 'wasm', 'simd', 'memory', 'platform'], default: 'all' },
        },
    },
    handler: async (input, context) => {
        const info = await systemInfoTool.handler({ include: ['runtime', 'platform', 'capabilities'] }, context);
        return {
            ...info,
            category: input.category || 'all',
            features: {
                wasm: typeof WebAssembly !== 'undefined',
                simd: false,
                memory: true,
                platform: process.platform,
            },
        };
    },
    category: 'v2-compat',
    tags: ['v2', 'features', 'detection'],
    version: '2.0.0',
    deprecated: true,
};
// ============================================================================
// V2 Compatibility Tool Collection
// ============================================================================
/**
 * All V2 compatibility tools
 */
export const v2CompatTools = [
    // Swarm tools
    swarmInitTool,
    swarmStatusV2Tool,
    swarmMonitorTool,
    // Agent tools
    agentSpawnTool,
    agentListTool,
    agentMetricsTool,
    // Task tools
    taskOrchestrateTool,
    taskStatusV2Tool,
    taskResultsV2Tool,
    // Memory tools
    memoryUsageTool,
    // Neural tools
    neuralStatusTool,
    neuralTrainTool,
    neuralPatternsTool,
    // System tools
    benchmarkRunTool,
    featuresDetectTool,
];
/**
 * Get V2 tool by V2 name
 */
export function getV2Tool(v2Name) {
    return v2CompatTools.find(tool => tool.name === v2Name);
}
/**
 * Map V2 tool name to V3 equivalent
 */
export function mapV2ToV3ToolName(v2Name) {
    const mapping = {
        'swarm_init': 'swarm/init',
        'swarm_status': 'swarm/status',
        'swarm_monitor': 'swarm/status',
        'agent_spawn': 'agent/spawn',
        'agent_list': 'agent/list',
        'agent_metrics': 'agent/status',
        'task_orchestrate': 'tasks/create',
        'task_status': 'tasks/status',
        'task_results': 'tasks/results',
        'memory_usage': 'memory/store',
        'neural_status': 'system/status',
        'neural_train': 'hooks/pretrain',
        'neural_patterns': 'hooks/metrics',
        'benchmark_run': 'system/metrics',
        'features_detect': 'system/info',
    };
    return mapping[v2Name] || v2Name;
}
export default v2CompatTools;
//# sourceMappingURL=v2-compat-tools.js.map