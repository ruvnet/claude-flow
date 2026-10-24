/**
 * ExtensionPoint
 *
 * Represents a hook point where plugins can extend functionality.
 */

export interface ExtensionPoint {
  name: string;
  handler: (context: unknown) => Promise<unknown>;
  priority?: number;
}

/**
 * Standard extension point names
 */
export const ExtensionPointNames = {
  // Task lifecycle
  TASK_BEFORE_EXECUTE: 'task.beforeExecute',
  TASK_AFTER_EXECUTE: 'task.afterExecute',
  TASK_VALIDATE: 'task.validate',

  // Workflow lifecycle
  WORKFLOW_BEFORE_EXECUTE: 'workflow.beforeExecute',
  WORKFLOW_AFTER_EXECUTE: 'workflow.afterExecute',
  WORKFLOW_ON_ERROR: 'workflow.onError',

  // Agent lifecycle
  AGENT_BEFORE_SPAWN: 'agent.beforeSpawn',
  AGENT_AFTER_SPAWN: 'agent.afterSpawn',
  AGENT_BEFORE_TERMINATE: 'agent.beforeTerminate',

  // Memory lifecycle
  MEMORY_BEFORE_STORE: 'memory.beforeStore',
  MEMORY_AFTER_STORE: 'memory.afterStore',
  MEMORY_BEFORE_QUERY: 'memory.beforeQuery',

  // Coordination
  SWARM_BEFORE_COORDINATE: 'swarm.beforeCoordinate',
  SWARM_AFTER_COORDINATE: 'swarm.afterCoordinate',
  CONSENSUS_BEFORE_VOTE: 'consensus.beforeVote',
  CONSENSUS_AFTER_VOTE: 'consensus.afterVote'
} as const;

export type ExtensionPointName = typeof ExtensionPointNames[keyof typeof ExtensionPointNames];

export { ExtensionPoint as default };
