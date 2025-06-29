/**
 * State Adapters Index
 * Exports all state adapters for easy importing
 */

export { SwarmStateAdapter } from './swarm-adapter.js';
export type { SwarmStateAdapterConfig } from './swarm-adapter.js';

export { AgentStateAdapter } from './agent-adapter.js';
export type { AgentStateAdapterConfig } from './agent-adapter.js';

export { TaskStateAdapter } from './task-adapter.js';
export type { 
  TaskStateAdapterConfig,
  Task,
  Workflow,
  TaskExecution,
  TaskDependency,
  TaskSchedule
} from './task-adapter.js';

export { MemoryStateAdapter } from './memory-adapter.js';
export type { 
  MemoryStateAdapterConfig,
  MemoryEntry
} from './memory-adapter.js';

/**
 * Factory function to create all adapters with a single state manager
 */
import { UnifiedStateManager } from '../state-manager.js';
import { SwarmStateAdapter, SwarmStateAdapterConfig } from './swarm-adapter.js';
import { AgentStateAdapter, AgentStateAdapterConfig } from './agent-adapter.js';
import { TaskStateAdapter, TaskStateAdapterConfig } from './task-adapter.js';
import { MemoryStateAdapter, MemoryStateAdapterConfig } from './memory-adapter.js';

export interface StateAdapterFactory {
  swarm: SwarmStateAdapter;
  agent: AgentStateAdapter;
  task: TaskStateAdapter;
  memory: MemoryStateAdapter;
}

export function createStateAdapters(stateManager: UnifiedStateManager): StateAdapterFactory {
  return {
    swarm: new SwarmStateAdapter(stateManager, { coordinatorId: 'default' }),
    agent: new AgentStateAdapter(stateManager, { managerId: 'default' }),
    task: new TaskStateAdapter(stateManager, { engineId: 'default' }),
    memory: new MemoryStateAdapter(stateManager, { managerId: 'default' })
  };
}

/**
 * Factory function to create adapters with custom configurations
 */
export function createCustomStateAdapters(
  stateManager: UnifiedStateManager,
  configs: {
    swarm?: SwarmStateAdapterConfig;
    agent?: AgentStateAdapterConfig;
    task?: TaskStateAdapterConfig;
    memory?: MemoryStateAdapterConfig;
  }
): StateAdapterFactory {
  return {
    swarm: new SwarmStateAdapter(stateManager, configs.swarm || { coordinatorId: 'default' }),
    agent: new AgentStateAdapter(stateManager, configs.agent || { managerId: 'default' }),
    task: new TaskStateAdapter(stateManager, configs.task || { engineId: 'default' }),
    memory: new MemoryStateAdapter(stateManager, configs.memory || { managerId: 'default' })
  };
}