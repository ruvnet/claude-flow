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
import { MCPTool } from '../types.js';
/**
 * swarm_init - V2 compatible swarm initialization
 * Maps to swarm/init
 */
export declare const swarmInitTool: MCPTool;
/**
 * swarm_status - V2 compatible swarm status
 */
export declare const swarmStatusV2Tool: MCPTool;
/**
 * swarm_monitor - V2 compatible swarm monitoring
 */
export declare const swarmMonitorTool: MCPTool;
/**
 * agent_spawn - V2 compatible agent spawning
 */
export declare const agentSpawnTool: MCPTool;
/**
 * agent_list - V2 compatible agent listing
 */
export declare const agentListTool: MCPTool;
/**
 * agent_metrics - V2 compatible agent metrics
 */
export declare const agentMetricsTool: MCPTool;
/**
 * task_orchestrate - V2 compatible task orchestration
 */
export declare const taskOrchestrateTool: MCPTool;
/**
 * task_status - V2 compatible task status
 */
export declare const taskStatusV2Tool: MCPTool;
/**
 * task_results - V2 compatible task results
 */
export declare const taskResultsV2Tool: MCPTool;
/**
 * memory_usage - V2 compatible memory operations
 */
export declare const memoryUsageTool: MCPTool;
/**
 * neural_status - V2 compatible neural status
 */
export declare const neuralStatusTool: MCPTool;
/**
 * neural_train - V2 compatible neural training
 */
export declare const neuralTrainTool: MCPTool;
/**
 * neural_patterns - V2 compatible pattern retrieval
 */
export declare const neuralPatternsTool: MCPTool;
/**
 * benchmark_run - V2 compatible benchmarking
 */
export declare const benchmarkRunTool: MCPTool;
/**
 * features_detect - V2 compatible feature detection
 */
export declare const featuresDetectTool: MCPTool;
/**
 * All V2 compatibility tools
 */
export declare const v2CompatTools: MCPTool[];
/**
 * Get V2 tool by V2 name
 */
export declare function getV2Tool(v2Name: string): MCPTool | undefined;
/**
 * Map V2 tool name to V3 equivalent
 */
export declare function mapV2ToV3ToolName(v2Name: string): string;
export default v2CompatTools;
//# sourceMappingURL=v2-compat-tools.d.ts.map