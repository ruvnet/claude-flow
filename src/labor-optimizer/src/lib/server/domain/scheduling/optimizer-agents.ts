/**
 * RuFlo Swarm Agent Configurations for Schedule Optimization
 *
 * Defines how RuFlo agents coordinate for multi-location scheduling:
 * - Hierarchical coordinator manages the swarm
 * - Per-location optimizer agents run constraint solver in parallel
 * - Compliance auditor validates all generated schedules
 * - Cost analyzer ensures budget adherence
 * - Hive-mind consensus resolves cross-location float employee conflicts
 */

export interface SwarmOptimizationConfig {
  locations: string[];
  weekStartDate: string;
  maxAgents: number;
  topology: 'hierarchical';
  strategy: 'specialized';
  consensus: 'raft';
}

/** Agent role definitions for the optimization swarm */
export const OPTIMIZATION_AGENTS = {
  coordinator: {
    type: 'hierarchical-coordinator',
    role: 'Orchestrate multi-location schedule optimization',
    instructions: `
      1. Initialize optimization session in shared memory
      2. Dispatch forecast-agent per location to refresh demand forecasts
      3. Wait for all forecasts, then dispatch optimizer-agent per location
      4. Collect all draft schedules
      5. Run cross-location conflict resolution via hive-mind consensus
      6. Dispatch compliance-auditor to validate all schedules
      7. Dispatch cost-analyzer for final budget check
      8. Return consolidated results
    `,
  },

  forecastAgent: {
    type: 'researcher',
    role: 'Generate demand forecast for a single location',
    instructions: `
      1. Pull historical Toast POS data for the target week
      2. Pull Resy reservations
      3. Use HNSW to find 10 most similar historical days
      4. Generate weighted ensemble forecast
      5. Store forecast in AgentDB memory namespace 'optimization'
    `,
  },

  optimizerAgent: {
    type: 'coder',
    role: 'Run constraint solver for a single location',
    instructions: `
      1. Read forecast from memory namespace 'optimization'
      2. Load employee roster and availability
      3. Load staffing config (floors + ratios)
      4. Run constraint solver with fairness and cost weights
      5. Store draft schedule in memory namespace 'optimization'
    `,
  },

  complianceAuditor: {
    type: 'reviewer',
    role: 'Validate all generated schedules against labor law rules',
    instructions: `
      1. Read all draft schedules from memory namespace 'optimization'
      2. Check each shift against configured compliance rules
      3. Flag violations: break requirements, overtime, predictive scheduling
      4. Store compliance report in memory
    `,
  },

  costAnalyzer: {
    type: 'reviewer',
    role: 'Verify budget adherence across all locations',
    instructions: `
      1. Read all draft schedules and forecasts from memory
      2. Calculate projected labor cost % per location
      3. Flag locations over budget
      4. Suggest cost-saving alternatives (shorter shifts, fewer overtime)
      5. Store budget report in memory
    `,
  },
};

/** Build the swarm initialization config for RuFlo */
export function buildSwarmConfig(locationIds: string[]): SwarmOptimizationConfig {
  return {
    locations: locationIds,
    weekStartDate: '', // Set at runtime
    maxAgents: Math.min(2 + locationIds.length * 2, 15), // coordinator + forecast + optimizer per location, capped at 15
    topology: 'hierarchical',
    strategy: 'specialized',
    consensus: 'raft',
  };
}

/** Build the task descriptions for each agent in the swarm */
export function buildAgentTasks(
  locationIds: string[],
  weekStartDate: string,
): { role: string; task: string; agentType: string }[] {
  const tasks: { role: string; task: string; agentType: string }[] = [];

  // Coordinator
  tasks.push({
    role: 'coordinator',
    task: `Coordinate schedule optimization for ${locationIds.length} locations, week of ${weekStartDate}. ${OPTIMIZATION_AGENTS.coordinator.instructions}`,
    agentType: OPTIMIZATION_AGENTS.coordinator.type,
  });

  // Per-location forecast + optimizer
  for (const locId of locationIds) {
    tasks.push({
      role: `forecast-${locId}`,
      task: `Generate demand forecast for location ${locId}, week of ${weekStartDate}. ${OPTIMIZATION_AGENTS.forecastAgent.instructions}`,
      agentType: OPTIMIZATION_AGENTS.forecastAgent.type,
    });

    tasks.push({
      role: `optimizer-${locId}`,
      task: `Optimize schedule for location ${locId}, week of ${weekStartDate}. ${OPTIMIZATION_AGENTS.optimizerAgent.instructions}`,
      agentType: OPTIMIZATION_AGENTS.optimizerAgent.type,
    });
  }

  // Compliance + cost (run after all optimizers)
  tasks.push({
    role: 'compliance-auditor',
    task: `Audit all generated schedules for compliance. ${OPTIMIZATION_AGENTS.complianceAuditor.instructions}`,
    agentType: OPTIMIZATION_AGENTS.complianceAuditor.type,
  });

  tasks.push({
    role: 'cost-analyzer',
    task: `Analyze budget adherence across all locations. ${OPTIMIZATION_AGENTS.costAnalyzer.instructions}`,
    agentType: OPTIMIZATION_AGENTS.costAnalyzer.type,
  });

  return tasks;
}
