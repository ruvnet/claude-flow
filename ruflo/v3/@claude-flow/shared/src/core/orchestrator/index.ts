/**
 * V3 Orchestrator Facade
 * Unified interface to decomposed orchestrator components
 * ~50 lines (target achieved)
 */

import type { IOrchestrator, IHealthStatus, IOrchestratorMetrics } from '../interfaces/coordinator.interface.js';
import type { ITask, ITaskCreate, ITaskResult } from '../interfaces/task.interface.js';
import type { IAgent, IAgentConfig } from '../interfaces/agent.interface.js';
import type { IEventBus } from '../interfaces/event.interface.js';

import { TaskManager } from './task-manager.js';
import { SessionManager, type ISessionManager, type SessionManagerConfig } from './session-manager.js';
import { HealthMonitor, type HealthMonitorConfig } from './health-monitor.js';
import { LifecycleManager, type LifecycleManagerConfig } from './lifecycle-manager.js';
import { EventCoordinator } from './event-coordinator.js';
import { EventBus } from '../event-bus.js';

export * from './task-manager.js';
export * from './session-manager.js';
export * from './health-monitor.js';
export * from './lifecycle-manager.js';
export * from './event-coordinator.js';

/**
 * Orchestrator facade configuration
 * (Note: For schema-validated config, use OrchestratorConfig from config/schema.ts)
 */
export interface OrchestratorFacadeConfig {
  session: SessionManagerConfig;
  health: HealthMonitorConfig;
  lifecycle: LifecycleManagerConfig;
}

/**
 * Default orchestrator facade configuration
 */
export const defaultOrchestratorFacadeConfig: OrchestratorFacadeConfig = {
  session: {
    persistSessions: true,
    dataDir: './data',
    sessionRetentionMs: 3600000,
  },
  health: {
    checkInterval: 30000,
    historyLimit: 100,
    degradedThreshold: 1,
    unhealthyThreshold: 2,
  },
  lifecycle: {
    maxConcurrentAgents: 20,
    spawnTimeout: 30000,
    terminateTimeout: 10000,
    maxSpawnRetries: 3,
  },
};

/**
 * Create orchestrator components
 */
export function createOrchestrator(config: Partial<OrchestratorFacadeConfig> = {}) {
  const mergedConfig: OrchestratorFacadeConfig = {
    session: { ...defaultOrchestratorFacadeConfig.session, ...config.session },
    health: { ...defaultOrchestratorFacadeConfig.health, ...config.health },
    lifecycle: { ...defaultOrchestratorFacadeConfig.lifecycle, ...config.lifecycle },
  };

  const eventBus = new EventBus();
  const taskManager = new TaskManager(eventBus);
  const sessionManager = new SessionManager(eventBus, mergedConfig.session);
  const healthMonitor = new HealthMonitor(eventBus, mergedConfig.health);
  const lifecycleManager = new LifecycleManager(eventBus, mergedConfig.lifecycle);
  const eventCoordinator = new EventCoordinator(eventBus);

  return {
    eventBus,
    taskManager,
    sessionManager,
    healthMonitor,
    lifecycleManager,
    eventCoordinator,
    config: mergedConfig,
  };
}

/**
 * Orchestrator type for facade
 */
export type OrchestratorComponents = ReturnType<typeof createOrchestrator>;
