/**
 * State Selectors
 * Provides convenient functions for querying the unified state
 */

import type { 
  UnifiedSystemState,
  StateSelector,
  Agent,
  SwarmState,
  AgentState,
  TaskState,
  SessionState,
  MemoryState,
  OrchestrationState,
  SystemHealthState,
  SystemMetricsState,
  SystemConfigState
} from './types.js';

// ===== Base Selectors =====

/**
 * Get the entire state
 */
export const getState: StateSelector<UnifiedSystemState> = (state) => state;

/**
 * Get state metadata
 */
export const getStateMetadata: StateSelector<{
  version: string;
  lastUpdated: Date;
  sessionId: string;
}> = (state) => ({
  version: state.version,
  lastUpdated: state.lastUpdated,
  sessionId: state.sessionId
});

// ===== Swarm Selectors =====

/**
 * Get the swarm state
 */
export const getSwarmState: StateSelector<SwarmState> = (state) => state.swarm;

/**
 * Get a specific swarm agent
 */
export const getSwarmAgent = (agentId: string): StateSelector<any | undefined> => 
  (state) => state.swarm.swarmAgents.get(agentId);

/**
 * Get all swarm agents
 */
export const getAllSwarmAgents: StateSelector<any[]> = (state) => 
  Array.from(state.swarm.swarmAgents.values());

/**
 * Get swarm agents by status
 */
export const getSwarmAgentsByStatus = (status: string): StateSelector<any[]> => 
  (state) => Array.from(state.swarm.swarmAgents.values()).filter(agent => agent.status === status);

/**
 * Get active swarm agents
 */
export const getActiveSwarmAgents: StateSelector<any[]> = getSwarmAgentsByStatus('busy');

/**
 * Get idle swarm agents
 */
export const getIdleSwarmAgents: StateSelector<any[]> = getSwarmAgentsByStatus('idle');

/**
 * Get a specific swarm objective
 */
export const getSwarmObjective = (objectiveId: string): StateSelector<any | undefined> => 
  (state) => state.swarm.activeSwarms.get(objectiveId);

/**
 * Get all swarm objectives
 */
export const getAllSwarmObjectives: StateSelector<any[]> = (state) => 
  Array.from(state.swarm.activeSwarms.values());

/**
 * Get active swarm objectives
 */
export const getActiveSwarmObjectives: StateSelector<any[]> = (state) => 
  Array.from(state.swarm.activeSwarms.values()).filter(obj => obj.status === 'executing');

/**
 * Get a specific swarm task
 */
export const getSwarmTask = (taskId: string): StateSelector<any | undefined> => 
  (state) => state.swarm.swarmTasks.get(taskId);

/**
 * Get all swarm tasks
 */
export const getAllSwarmTasks: StateSelector<any[]> = (state) => 
  Array.from(state.swarm.swarmTasks.values());

/**
 * Get swarm tasks by status
 */
export const getSwarmTasksByStatus = (status: string): StateSelector<any[]> => 
  (state) => Array.from(state.swarm.swarmTasks.values()).filter(task => task.status === status);

/**
 * Get swarm coordinators
 */
export const getSwarmCoordinators: StateSelector<any[]> = (state) => 
  Array.from(state.swarm.coordinators.values());

// ===== Agent Selectors =====

/**
 * Get the agent state
 */
export const getAgentState: StateSelector<AgentState> = (state) => state.agents;

/**
 * Get a specific agent
 */
export const getAgent = (agentId: string): StateSelector<Agent | undefined> => 
  (state) => state.agents.agents.get(agentId);

/**
 * Get all agents
 */
export const getAllAgents: StateSelector<Agent[]> = (state) => 
  Array.from(state.agents.agents.values());

/**
 * Get agents by type
 */
export const getAgentsByType = (type: Agent['type']): StateSelector<Agent[]> => 
  (state) => Array.from(state.agents.agents.values()).filter(agent => agent.type === type);

/**
 * Get agents by status
 */
export const getAgentsByStatus = (status: Agent['status']): StateSelector<Agent[]> => 
  (state) => Array.from(state.agents.agents.values()).filter(agent => agent.status === status);

/**
 * Get available agents
 */
export const getAvailableAgents: StateSelector<Agent[]> = getAgentsByStatus('idle');

/**
 * Get busy agents
 */
export const getBusyAgents: StateSelector<Agent[]> = getAgentsByStatus('busy');

/**
 * Get failed agents
 */
export const getFailedAgents: StateSelector<Agent[]> = getAgentsByStatus('error');

/**
 * Get agent pools
 */
export const getAgentPools: StateSelector<any[]> = (state) => 
  Array.from(state.agents.pools.values());

/**
 * Get agent clusters
 */
export const getAgentClusters: StateSelector<any[]> = (state) => 
  Array.from(state.agents.clusters.values());

/**
 * Get agent templates
 */
export const getAgentTemplates: StateSelector<any[]> = (state) => 
  Array.from(state.agents.templates.values());

// ===== Task Selectors =====

/**
 * Get the task state
 */
export const getTaskState: StateSelector<TaskState> = (state) => state.tasks;

/**
 * Get a specific task
 */
export const getTask = (taskId: string): StateSelector<any | undefined> => 
  (state) => state.tasks.tasks.get(taskId);

/**
 * Get all tasks
 */
export const getAllTasks: StateSelector<any[]> = (state) => 
  Array.from(state.tasks.tasks.values());

/**
 * Get tasks by status
 */
export const getTasksByStatus = (status: string): StateSelector<any[]> => 
  (state) => Array.from(state.tasks.tasks.values()).filter(task => task.status === status);

/**
 * Get pending tasks
 */
export const getPendingTasks: StateSelector<any[]> = getTasksByStatus('pending');

/**
 * Get active tasks
 */
export const getActiveTasks: StateSelector<any[]> = getTasksByStatus('running');

/**
 * Get completed tasks
 */
export const getCompletedTasks: StateSelector<any[]> = getTasksByStatus('completed');

/**
 * Get failed tasks
 */
export const getFailedTasks: StateSelector<any[]> = getTasksByStatus('failed');

/**
 * Get task queue
 */
export const getTaskQueue: StateSelector<TaskState['queue']> = (state) => state.tasks.queue;

/**
 * Get task queue counts
 */
export const getTaskQueueCounts: StateSelector<{
  pending: number;
  active: number;
  completed: number;
  failed: number;
}> = (state) => ({
  pending: state.tasks.queue.pending.length,
  active: state.tasks.queue.active.length,
  completed: state.tasks.queue.completed.length,
  failed: state.tasks.queue.failed.length
});

/**
 * Get workflows
 */
export const getWorkflows: StateSelector<any[]> = (state) => 
  Array.from(state.tasks.workflows.values());

/**
 * Get task executions
 */
export const getTaskExecutions: StateSelector<any[]> = (state) => 
  Array.from(state.tasks.executions.values());

/**
 * Get task dependencies
 */
export const getTaskDependencies: StateSelector<Map<string, any[]>> = (state) => 
  state.tasks.dependencies;

// ===== Session Selectors =====

/**
 * Get the session state
 */
export const getSessionState: StateSelector<SessionState> = (state) => state.sessions;

/**
 * Get all sessions
 */
export const getAllSessions: StateSelector<any[]> = (state) => 
  Array.from(state.sessions.sessions.values());

/**
 * Get a specific session
 */
export const getSession = (sessionId: string): StateSelector<any | undefined> => 
  (state) => state.sessions.sessions.get(sessionId);

/**
 * Get session profiles
 */
export const getSessionProfiles: StateSelector<any[]> = (state) => 
  Array.from(state.sessions.profiles.values());

/**
 * Get session counts
 */
export const getSessionCounts: StateSelector<{
  active: number;
  total: number;
}> = (state) => ({
  active: state.sessions.activeCount,
  total: state.sessions.totalCreated
});

// ===== Memory Selectors =====

/**
 * Get the memory state
 */
export const getMemoryState: StateSelector<MemoryState> = (state) => state.memory;

/**
 * Get all memory entries
 */
export const getAllMemoryEntries: StateSelector<any[]> = (state) => 
  Array.from(state.memory.entries.values());

/**
 * Get a specific memory entry
 */
export const getMemoryEntry = (entryId: string): StateSelector<any | undefined> => 
  (state) => state.memory.entries.get(entryId);

/**
 * Get memory banks
 */
export const getMemoryBanks: StateSelector<any[]> = (state) => 
  Array.from(state.memory.banks.values());

/**
 * Get memory indexes
 */
export const getMemoryIndexes: StateSelector<any[]> = (state) => 
  Array.from(state.memory.indexes.values());

/**
 * Get memory cache state
 */
export const getMemoryCacheState: StateSelector<any> = (state) => state.memory.cache;

/**
 * Get memory statistics
 */
export const getMemoryStats: StateSelector<{
  totalEntries: number;
  totalSize: number;
  bankCount: number;
  indexCount: number;
}> = (state) => ({
  totalEntries: state.memory.totalEntries,
  totalSize: state.memory.totalSize,
  bankCount: state.memory.banks.size,
  indexCount: state.memory.indexes.size
});

// ===== Orchestration Selectors =====

/**
 * Get the orchestration state
 */
export const getOrchestrationState: StateSelector<OrchestrationState> = (state) => state.orchestration;

/**
 * Get orchestration status
 */
export const getOrchestrationStatus: StateSelector<string> = (state) => state.orchestration.status;

/**
 * Get active orchestrators
 */
export const getActiveOrchestrators: StateSelector<any[]> = (state) => 
  Array.from(state.orchestration.activeOrchestrators.values());

/**
 * Get MCP servers
 */
export const getMCPServers: StateSelector<any[]> = (state) => 
  Array.from(state.orchestration.mcpServers.values());

/**
 * Get terminals
 */
export const getTerminals: StateSelector<any[]> = (state) => 
  Array.from(state.orchestration.terminals.values());

// ===== Health Selectors =====

/**
 * Get the health state
 */
export const getHealthState: StateSelector<SystemHealthState> = (state) => state.health;

/**
 * Get overall health status
 */
export const getOverallHealth: StateSelector<string> = (state) => state.health.overall;

/**
 * Get component health
 */
export const getComponentHealth: StateSelector<any[]> = (state) => 
  Array.from(state.health.components.values());

/**
 * Get health issues
 */
export const getHealthIssues: StateSelector<any[]> = (state) => state.health.issues;

/**
 * Get critical health issues
 */
export const getCriticalHealthIssues: StateSelector<any[]> = (state) => 
  state.health.issues.filter(issue => issue.severity === 'critical');

// ===== Metrics Selectors =====

/**
 * Get the metrics state
 */
export const getMetricsState: StateSelector<SystemMetricsState> = (state) => state.metrics;

/**
 * Get performance metrics
 */
export const getPerformanceMetrics: StateSelector<any> = (state) => state.metrics.performance;

/**
 * Get resource metrics
 */
export const getResourceMetrics: StateSelector<any> = (state) => state.metrics.resource;

/**
 * Get business metrics
 */
export const getBusinessMetrics: StateSelector<any> = (state) => state.metrics.business;

// ===== Config Selectors =====

/**
 * Get the config state
 */
export const getConfigState: StateSelector<SystemConfigState> = (state) => state.config;

/**
 * Get system environment
 */
export const getSystemEnvironment: StateSelector<string> = (state) => state.config.environment;

/**
 * Get system features
 */
export const getSystemFeatures: StateSelector<Map<string, boolean>> = (state) => state.config.features;

/**
 * Get system limits
 */
export const getSystemLimits: StateSelector<any> = (state) => state.config.limits;

/**
 * Get system settings
 */
export const getSystemSettings: StateSelector<any> = (state) => state.config.settings;

// ===== Computed Selectors =====

/**
 * Get system overview
 */
export const getSystemOverview: StateSelector<{
  health: string;
  orchestrationStatus: string;
  agentCounts: { total: number; active: number; idle: number };
  taskCounts: { total: number; pending: number; active: number; completed: number };
  memoryStats: { totalEntries: number; totalSize: number };
}> = (state) => ({
  health: state.health.overall,
  orchestrationStatus: state.orchestration.status,
  agentCounts: {
    total: state.agents.agents.size,
    active: getAllAgents(state).filter(a => a.status === 'busy').length,
    idle: getAllAgents(state).filter(a => a.status === 'idle').length
  },
  taskCounts: {
    total: state.tasks.tasks.size,
    pending: state.tasks.queue.pending.length,
    active: state.tasks.queue.active.length,
    completed: state.tasks.queue.completed.length
  },
  memoryStats: {
    totalEntries: state.memory.totalEntries,
    totalSize: state.memory.totalSize
  }
});

/**
 * Get resource utilization
 */
export const getResourceUtilization: StateSelector<{
  agentUtilization: number;
  taskQueueUtilization: number;
  memoryUtilization: number;
}> = (state) => {
  const agentStats = getAllAgents(state);
  const busyAgents = agentStats.filter(a => a.status === 'busy').length;
  const agentUtilization = agentStats.length > 0 ? (busyAgents / agentStats.length) * 100 : 0;

  const taskQueue = state.tasks.queue;
  const totalTasks = taskQueue.pending.length + taskQueue.active.length;
  const taskQueueUtilization = totalTasks > 0 ? (taskQueue.active.length / totalTasks) * 100 : 0;

  const memoryUtilization = state.memory.cache.maxSize > 0 
    ? (state.memory.cache.size / state.memory.cache.maxSize) * 100 
    : 0;

  return {
    agentUtilization,
    taskQueueUtilization,
    memoryUtilization
  };
};

/**
 * Get performance summary
 */
export const getPerformanceSummary: StateSelector<{
  avgResponseTime: number;
  throughput: number;
  errorRate: number;
  successRate: number;
  systemLoad: number;
}> = (state) => {
  const performance = state.metrics.performance;
  const resource = state.metrics.resource;
  
  const systemLoad = (resource.cpuUsage + resource.memoryUsage) / 2;

  return {
    avgResponseTime: performance.avgResponseTime,
    throughput: performance.throughput,
    errorRate: performance.errorRate,
    successRate: performance.successRate,
    systemLoad
  };
};