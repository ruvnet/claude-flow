/**
 * Swarm Application Layer - Public Exports
 *
 * @module v3/swarm/application
 */

// Commands
export {
  SpawnAgentCommandHandler,
  TerminateAgentCommandHandler,
  type SpawnAgentInput,
  type SpawnAgentResult,
  type TerminateAgentInput,
  type TerminateAgentResult,
} from './commands/spawn-agent.command.js';

export {
  CreateTaskCommandHandler,
  CancelTaskCommandHandler,
  type CreateTaskInput,
  type CreateTaskResult,
  type CancelTaskInput,
  type CancelTaskResult,
} from './commands/create-task.command.js';

// Application Service
export {
  SwarmApplicationService,
  type SwarmConfig,
} from './services/swarm-application-service.js';
