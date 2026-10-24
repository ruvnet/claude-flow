/**
 * V3 Health Monitor
 * Decomposed from orchestrator.ts - Agent health checks
 * ~150 lines (target achieved)
 */

import type {
  IHealthMonitor,
  IHealthStatus,
  IComponentHealth,
} from '../interfaces/coordinator.interface.js';
import type { IEventBus } from '../interfaces/event.interface.js';
import { SystemEventTypes } from '../interfaces/event.interface.js';

/**
 * Health check function type
 */
export type HealthCheckFn = () => Promise<{
  healthy: boolean;
  error?: string;
  metrics?: Record<string, number>;
}>;

/**
 * Health monitor configuration
 */
export interface HealthMonitorConfig {
  checkInterval: number;
  historyLimit: number;
  degradedThreshold: number;
  unhealthyThreshold: number;
}

/**
 * Health monitor implementation
 */
export class HealthMonitor implements IHealthMonitor {
  private checks = new Map<string, HealthCheckFn>();
  private history: IHealthStatus[] = [];
  private interval?: ReturnType<typeof setInterval>;
  private listeners: Array<(status: IHealthStatus) => void> = [];
  private running = false;

  constructor(
    private eventBus: IEventBus,
    private config: HealthMonitorConfig = {
      checkInterval: 30000,
      historyLimit: 100,
      degradedThreshold: 1,
      unhealthyThreshold: 2,
    },
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.interval = setInterval(async () => {
      const status = await this.getStatus();
      this.addToHistory(status);
      this.notifyListeners(status);
      this.eventBus.emit(SystemEventTypes.SYSTEM_HEALTHCHECK, { status });
    }, this.config.checkInterval);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.running = false;
  }

  async getStatus(): Promise<IHealthStatus> {
    const components: Record<string, IComponentHealth> = {};
    let unhealthyCount = 0;
    let degradedCount = 0;

    const checkPromises = Array.from(this.checks.entries()).map(
      async ([name, check]) => {
        try {
          const result = await Promise.race([
            check(),
            this.timeout(5000, 'Health check timeout'),
          ]);

          const health: IComponentHealth = {
            name,
            status: result.healthy ? 'healthy' : 'unhealthy',
            lastCheck: new Date(),
            error: result.error,
            metrics: result.metrics,
          };

          return { name, health };
        } catch (error) {
          return {
            name,
            health: {
              name,
              status: 'unhealthy' as const,
              lastCheck: new Date(),
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      },
    );

    const results = await Promise.allSettled(checkPromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { name, health } = result.value;
        components[name] = health;

        if (health.status === 'unhealthy') {
          unhealthyCount++;
        } else if (health.status === 'degraded') {
          degradedCount++;
        }
      }
    }

    let overallStatus: IHealthStatus['status'] = 'healthy';
    if (unhealthyCount >= this.config.unhealthyThreshold) {
      overallStatus = 'unhealthy';
    } else if (
      unhealthyCount > 0 ||
      degradedCount >= this.config.degradedThreshold
    ) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      components,
      timestamp: new Date(),
    };
  }

  registerCheck(name: string, check: HealthCheckFn): void {
    this.checks.set(name, check);
  }

  unregisterCheck(name: string): void {
    this.checks.delete(name);
  }

  getHistory(limit?: number): IHealthStatus[] {
    const count = limit ?? this.config.historyLimit;
    return this.history.slice(-count);
  }

  onHealthChange(callback: (status: IHealthStatus) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private addToHistory(status: IHealthStatus): void {
    this.history.push(status);

    // Trim history to limit
    if (this.history.length > this.config.historyLimit) {
      this.history = this.history.slice(-this.config.historyLimit);
    }
  }

  private notifyListeners(status: IHealthStatus): void {
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // Ignore listener errors
      }
    }
  }

  private timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /**
   * Get component health by name
   */
  async getComponentHealth(name: string): Promise<IComponentHealth | undefined> {
    const status = await this.getStatus();
    return status.components[name];
  }

  /**
   * Check if system is healthy
   */
  async isHealthy(): Promise<boolean> {
    const status = await this.getStatus();
    return status.status === 'healthy';
  }

  /**
   * Get registered check names
   */
  getRegisteredChecks(): string[] {
    return Array.from(this.checks.keys());
  }
}
