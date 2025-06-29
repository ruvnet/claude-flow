/**
 * Swarm Coordination Facade
 * Provides a high-level interface for CLI commands to interact with swarm coordination
 */

import { SwarmCoordinator } from '../swarm-coordinator.js';
import { BackgroundExecutor } from '../background-executor.js';
import type { SwarmStrategy, SwarmMode } from '../../types/missing-types.js';
import type { ILogger } from '../../core/logger.js';

export interface SwarmOperationOptions {
  objective: string;
  strategy: SwarmStrategy;
  mode: SwarmMode;
  maxAgents: number;
  timeout: number;
  parallel: boolean;
  monitor: boolean;
  background: boolean;
  distributed: boolean;
  memoryNamespace: string;
  persistence: boolean;
  ui?: boolean;
  review?: boolean;
  research?: boolean;
  output?: string;
}

/**
 * Swarm Facade provides a clean interface for CLI commands
 */
export class SwarmFacade {
  private coordinator: SwarmCoordinator | null = null;
  private backgroundExecutor: BackgroundExecutor | null = null;

  constructor(private logger: ILogger) {}

  /**
   * Initialize and run a swarm operation
   */
  async runSwarm(options: SwarmOperationOptions): Promise<void> {
    try {
      // Initialize coordinator
      this.coordinator = new SwarmCoordinator({
        logger: this.logger,
        maxAgents: options.maxAgents,
        timeout: options.timeout,
        mode: options.mode,
        parallel: options.parallel,
        distributed: options.distributed,
        memoryNamespace: options.memoryNamespace,
        persistence: options.persistence,
      });

      // Handle background execution if requested
      if (options.background) {
        this.backgroundExecutor = new BackgroundExecutor({});
        await this.backgroundExecutor.execute({
          coordinator: this.coordinator,
          objective: options.objective,
          strategy: options.strategy,
          options,
        });
      } else {
        // Direct execution
        await this.coordinator.execute({
          objective: options.objective,
          strategy: options.strategy,
          monitor: options.monitor,
          ui: options.ui,
          review: options.review,
          research: options.research,
          output: options.output,
        });
      }
    } catch (error) {
      this.logger.error('Swarm operation failed', { error });
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Get swarm status
   */
  async getStatus(): Promise<any> {
    if (!this.coordinator) {
      return { status: 'idle', message: 'No active swarm operation' };
    }
    return this.coordinator.getStatus();
  }

  /**
   * Stop the swarm operation
   */
  async stop(): Promise<void> {
    if (this.coordinator) {
      await this.coordinator.stop();
    }
    if (this.backgroundExecutor) {
      await this.backgroundExecutor.stop();
    }
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    if (this.coordinator) {
      await this.coordinator.cleanup();
      this.coordinator = null;
    }
    if (this.backgroundExecutor) {
      await this.backgroundExecutor.cleanup();
      this.backgroundExecutor = null;
    }
  }
}