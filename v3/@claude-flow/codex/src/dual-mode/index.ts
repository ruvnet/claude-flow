/**
 * Dual-Mode Module
 * Collaborative execution of Claude Code + Codex workers
 */

export {
  DualModeOrchestrator,
  CollaborationTemplates,
  loadSwarmAutomationConfig,
} from './orchestrator.js';
export type {
  DualModeConfig,
  WorkerConfig,
  WorkerResult,
  CollaborationResult,
  LoadedSwarmAutomationConfig,
  WorkerCapabilityEnvelope,
} from './orchestrator.js';

export { createDualModeCommand } from './cli.js';
