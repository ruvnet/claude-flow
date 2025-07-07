/**
 * Health Check System for Claude Flow v2.0.0
 */

import { EventBus } from '../core/event-bus.js';
import { Logger } from '../core/logger.js';
import { SystemIntegration } from '../integration/system-integration.js';
import type { 
  HealthCheckResult, 
  ComponentStatus, 
  SystemHealth, 
  SystemMetrics 
} from '../integration/types.js';
import { getErrorMessage } from '../utils/error-handler.js';

export interface HealthCheckConfig {
  interval?: number; // Health check interval in ms (default: 30000)
  timeout?: number; // Health check timeout in ms (default: 5000)
  retries?: number; // Number of retries for failed checks (default: 3)
  enableMetrics?: boolean; // Collect system metrics (default: true)
  enableAlerts?: boolean; // Send alerts on health issues (default: true)
}

export interface AlertConfig {
  webhook?: string;
  email?: string;
  slack?: string;
  threshold?: number; // Alert threshold for unhealthy components
}

export class HealthCheckManager {
  private eventBus: EventBus;
  private logger: Logger;
  private systemIntegration: SystemIntegration;
  private config: Required<HealthCheckConfig>;
  private intervalId: NodeJS.Timeout | null = null;
  private healthHistory: Map<string, HealthCheckResult[]> = new Map();
  private isRunning = false;
  private lastMetrics: SystemMetrics | null = null;

  constructor(
    eventBus: EventBus,
    logger: Logger,
    config: HealthCheckConfig = {}
  ) {
    this.eventBus = eventBus;
    this.logger = logger;
    this.systemIntegration = SystemIntegration.getInstance();
    
    this.config = {
      interval: config.interval || 30000, // 30 seconds
      timeout: config.timeout || 5000, // 5 seconds
      retries: config.retries || 3,
      enableMetrics: config.enableMetrics !== false,
      enableAlerts: config.enableAlerts !== false
    };

    this.setupEventHandlers();
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Health check manager already running');
      return;
    }

    this.logger.info('Starting health check monitoring');
    this.isRunning = true;

    // Perform initial health check
    this.performHealthCheck();

    // Set up periodic health checks
    this.intervalId = setInterval(() => {
      this.performHealthCheck();
    }, this.config.interval);

    this.eventBus.emit('health:monitor:started', {
      interval: this.config.interval,
      timestamp: Date.now()
    });
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping health check monitoring');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.eventBus.emit('health:monitor:stopped', {
      timestamp: Date.now()
    });
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<SystemHealth> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Performing system health check');

      // Get system health from integration manager
      const systemHealth = await this.systemIntegration.getSystemHealth();

      // Perform individual component checks
      const componentChecks = await this.checkAllComponents();
      
      // Collect system metrics if enabled
      if (this.config.enableMetrics) {
        this.lastMetrics = await this.collectSystemMetrics();
      }

      // Store health history
      this.storeHealthHistory(componentChecks);

      // Check for alerts
      if (this.config.enableAlerts) {
        await this.checkForAlerts(systemHealth);
      }

      const duration = Date.now() - startTime;
      this.logger.debug(`Health check completed in ${duration}ms`);

      // Emit health check event
      this.eventBus.emit('health:check:completed', {
        health: systemHealth,
        metrics: this.lastMetrics,
        duration,
        timestamp: Date.now()
      });

      return systemHealth;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Health check failed:', getErrorMessage(error));
      
      this.eventBus.emit('health:check:failed', {
        error: getErrorMessage(error),
        duration,
        timestamp: Date.now()
      });

      throw error;
    }
  }

  /**
   * Check all system components
   */
  private async checkAllComponents(): Promise<HealthCheckResult[]> {
    const components = [
      'orchestrator',
      'configManager',
      'memoryManager',
      'agentManager',
      'swarmCoordinator',
      'taskEngine',
      'monitor',
      'mcpServer'
    ];

    const checks = await Promise.allSettled(
      components.map(component => this.checkComponent(component))
    );

    return checks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          component: components[index],
          healthy: false,
          message: getErrorMessage(result.reason),
          timestamp: Date.now()
        };
      }
    });
  }

  /**
   * Check individual component health
   */
  private async checkComponent(componentName: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const component = this.systemIntegration.getComponent(componentName);
      
      if (!component) {
        return {
          component: componentName,
          healthy: false,
          message: 'Component not found',
          timestamp: Date.now()
        };
      }

      // Try to call health check method if available
      if (typeof (component as any).healthCheck === 'function') {
        const result = await Promise.race([
          (component as any).healthCheck(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), this.config.timeout)
          )
        ]);
        return result as HealthCheckResult;
      }

      // Basic availability check
      const duration = Date.now() - startTime;
      return {
        component: componentName,
        healthy: true,
        message: 'Component available',
        metrics: { responseTime: duration },
        timestamp: Date.now()
      };

    } catch (error) {
      return {
        component: componentName,
        healthy: false,
        message: getErrorMessage(error),
        timestamp: Date.now()
      };
    }
  }

  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<SystemMetrics> {
    const startTime = Date.now();
    
    try {
      // Get system resource usage
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      // Get component-specific metrics
      const agentManager = this.systemIntegration.getComponent('agentManager');
      const taskEngine = this.systemIntegration.getComponent('taskEngine');
      
      let activeAgents = 0;
      let activeTasks = 0;
      let queuedTasks = 0;
      let completedTasks = 0;

      if (agentManager && typeof (agentManager as any).getMetrics === 'function') {
        const agentMetrics = await (agentManager as any).getMetrics();
        activeAgents = agentMetrics.activeAgents || 0;
      }

      if (taskEngine && typeof (taskEngine as any).getMetrics === 'function') {
        const taskMetrics = await (taskEngine as any).getMetrics();
        activeTasks = taskMetrics.activeTasks || 0;
        queuedTasks = taskMetrics.queuedTasks || 0;
        completedTasks = taskMetrics.completedTasks || 0;
      }

      return {
        cpu: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to percentage
        memory: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
        network: 0, // Placeholder - would need additional monitoring
        disk: 0, // Placeholder - would need additional monitoring
        activeAgents,
        activeTasks,
        queuedTasks,
        completedTasks,
        errorCount: this.getErrorCount(),
        uptime: process.uptime() * 1000,
        timestamp: Date.now()
      };

    } catch (error) {
      this.logger.error('Failed to collect system metrics:', getErrorMessage(error));
      return {
        cpu: 0,
        memory: 0,
        network: 0,
        disk: 0,
        activeAgents: 0,
        activeTasks: 0,
        queuedTasks: 0,
        completedTasks: 0,
        errorCount: 0,
        uptime: process.uptime() * 1000,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Store health check history
   */
  private storeHealthHistory(results: HealthCheckResult[]): void {
    const maxHistorySize = 100; // Keep last 100 health checks per component

    results.forEach(result => {
      if (!this.healthHistory.has(result.component)) {
        this.healthHistory.set(result.component, []);
      }

      const history = this.healthHistory.get(result.component)!;
      history.push(result);

      // Trim history if too large
      if (history.length > maxHistorySize) {
        history.splice(0, history.length - maxHistorySize);
      }
    });
  }

  /**
   * Check for alerts and send notifications
   */
  private async checkForAlerts(health: SystemHealth): Promise<void> {
    const unhealthyComponents = Object.values(health.components)
      .filter(component => component.status === 'unhealthy');

    if (unhealthyComponents.length > 0) {
      const alert = {
        type: 'component_failure',
        severity: 'high',
        message: `${unhealthyComponents.length} component(s) are unhealthy`,
        components: unhealthyComponents.map(c => c.component),
        timestamp: Date.now()
      };

      this.eventBus.emit('health:alert', alert);
      this.logger.warn('Health alert triggered:', alert.message);
    }

    // Check system metrics for anomalies
    if (this.lastMetrics) {
      const alerts = [];

      if (this.lastMetrics.cpu > 90) {
        alerts.push({
          type: 'high_cpu',
          severity: 'medium',
          message: `High CPU usage: ${this.lastMetrics.cpu.toFixed(1)}%`,
          value: this.lastMetrics.cpu
        });
      }

      if (this.lastMetrics.memory > 90) {
        alerts.push({
          type: 'high_memory',
          severity: 'medium',
          message: `High memory usage: ${this.lastMetrics.memory.toFixed(1)}%`,
          value: this.lastMetrics.memory
        });
      }

      if (this.lastMetrics.errorCount > 10) {
        alerts.push({
          type: 'high_errors',
          severity: 'high',
          message: `High error count: ${this.lastMetrics.errorCount}`,
          value: this.lastMetrics.errorCount
        });
      }

      alerts.forEach(alert => {
        this.eventBus.emit('health:alert', {
          ...alert,
          timestamp: Date.now()
        });
      });
    }
  }

  /**
   * Get component health history
   */
  getHealthHistory(component?: string): HealthCheckResult[] {
    if (component) {
      return this.healthHistory.get(component) || [];
    }

    // Return all history
    const allHistory: HealthCheckResult[] = [];
    for (const history of this.healthHistory.values()) {
      allHistory.push(...history);
    }

    return allHistory.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get current system metrics
   */
  getCurrentMetrics(): SystemMetrics | null {
    return this.lastMetrics;
  }

  /**
   * Get system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    return await this.systemIntegration.getSystemHealth();
  }

  /**
   * Get error count from recent history
   */
  private getErrorCount(): number {
    const recentTime = Date.now() - 300000; // Last 5 minutes
    let errorCount = 0;

    for (const history of this.healthHistory.values()) {
      errorCount += history.filter(check => 
        check.timestamp > recentTime && !check.healthy
      ).length;
    }

    return errorCount;
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Listen for component status changes
    this.eventBus.on('component:status:updated', (status: ComponentStatus) => {
      if (status.status === 'unhealthy') {
        this.logger.warn(`Component ${status.component} became unhealthy: ${status.message}`);
      }
    });

    // Listen for system errors
    this.eventBus.on('system:error', (error) => {
      this.logger.error('System error detected:', error);
    });
  }

  /**
   * Check if monitoring is running
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Get monitoring configuration
   */
  getConfig(): Required<HealthCheckConfig> {
    return { ...this.config };
  }
}