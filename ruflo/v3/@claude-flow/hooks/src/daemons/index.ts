/**
 * V3 Daemon Manager
 *
 * Manages background daemon processes for:
 * - Metrics collection
 * - Swarm monitoring
 * - Pattern learning consolidation
 * - Statusline updates
 */

import type {
  DaemonConfig,
  DaemonState,
  DaemonStatus,
  DaemonManagerConfig,
} from '../types.js';

/**
 * Daemon instance
 */
interface DaemonInstance {
  config: DaemonConfig;
  state: DaemonState;
  timer?: ReturnType<typeof setInterval>;
  task?: () => Promise<void>;
}

/**
 * Default daemon manager configuration
 */
const DEFAULT_CONFIG: DaemonManagerConfig = {
  pidDirectory: '.claude-flow/pids',
  logDirectory: '.claude-flow/logs',
  daemons: [],
  autoRestart: true,
  maxRestartAttempts: 3,
};

/**
 * Daemon Manager - controls background daemon processes
 */
export class DaemonManager {
  private config: DaemonManagerConfig;
  private daemons: Map<string, DaemonInstance> = new Map();
  private restartCounts: Map<string, number> = new Map();

  constructor(config?: Partial<DaemonManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a daemon
   */
  register(config: DaemonConfig, task: () => Promise<void>): void {
    if (this.daemons.has(config.name)) {
      throw new Error(`Daemon '${config.name}' is already registered`);
    }

    const state: DaemonState = {
      name: config.name,
      status: 'stopped',
      executionCount: 0,
      failureCount: 0,
    };

    this.daemons.set(config.name, { config, state, task });
  }

  /**
   * Start a daemon
   */
  async start(name: string): Promise<void> {
    const daemon = this.daemons.get(name);
    if (!daemon) {
      throw new Error(`Daemon '${name}' not found`);
    }

    if (daemon.state.status === 'running') {
      return; // Already running
    }

    if (!daemon.config.enabled) {
      throw new Error(`Daemon '${name}' is disabled`);
    }

    daemon.state.status = 'starting';
    daemon.state.startedAt = new Date();

    try {
      // Start interval timer
      daemon.timer = setInterval(async () => {
        await this.executeDaemonTask(name);
      }, daemon.config.interval);

      daemon.state.status = 'running';
      daemon.state.pid = process.pid; // Use current process for in-process daemons

      // Run initial execution
      await this.executeDaemonTask(name);
    } catch (error) {
      daemon.state.status = 'error';
      daemon.state.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Stop a daemon
   */
  async stop(name: string): Promise<void> {
    const daemon = this.daemons.get(name);
    if (!daemon) {
      throw new Error(`Daemon '${name}' not found`);
    }

    if (daemon.state.status === 'stopped') {
      return; // Already stopped
    }

    daemon.state.status = 'stopping';

    if (daemon.timer) {
      clearInterval(daemon.timer);
      daemon.timer = undefined;
    }

    daemon.state.status = 'stopped';
    daemon.state.pid = undefined;
  }

  /**
   * Restart a daemon
   */
  async restart(name: string): Promise<void> {
    await this.stop(name);
    await this.start(name);
  }

  /**
   * Start all registered daemons
   */
  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [name, daemon] of this.daemons) {
      if (daemon.config.enabled) {
        promises.push(this.start(name));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Stop all daemons
   */
  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const name of this.daemons.keys()) {
      promises.push(this.stop(name));
    }
    await Promise.all(promises);
  }

  /**
   * Get daemon state
   */
  getState(name: string): DaemonState | undefined {
    return this.daemons.get(name)?.state;
  }

  /**
   * Get all daemon states
   */
  getAllStates(): DaemonState[] {
    return Array.from(this.daemons.values()).map((d) => d.state);
  }

  /**
   * Check if daemon is running
   */
  isRunning(name: string): boolean {
    return this.daemons.get(name)?.state.status === 'running';
  }

  /**
   * Update daemon interval
   */
  updateInterval(name: string, interval: number): void {
    const daemon = this.daemons.get(name);
    if (!daemon) {
      throw new Error(`Daemon '${name}' not found`);
    }

    daemon.config.interval = interval;

    // Restart if running to apply new interval
    if (daemon.state.status === 'running') {
      this.restart(name).catch(() => {});
    }
  }

  /**
   * Enable a daemon
   */
  enable(name: string): void {
    const daemon = this.daemons.get(name);
    if (daemon) {
      daemon.config.enabled = true;
    }
  }

  /**
   * Disable a daemon
   */
  disable(name: string): void {
    const daemon = this.daemons.get(name);
    if (daemon) {
      daemon.config.enabled = false;
      this.stop(name).catch(() => {});
    }
  }

  /**
   * Get daemon count
   */
  get count(): number {
    return this.daemons.size;
  }

  /**
   * Get running daemon count
   */
  get runningCount(): number {
    return Array.from(this.daemons.values()).filter(
      (d) => d.state.status === 'running'
    ).length;
  }

  /**
   * Execute a daemon task
   */
  private async executeDaemonTask(name: string): Promise<void> {
    const daemon = this.daemons.get(name);
    if (!daemon || !daemon.task) {
      return;
    }

    try {
      await daemon.task();
      daemon.state.executionCount++;
      daemon.state.lastUpdateAt = new Date();
      daemon.state.error = undefined;

      // Reset restart count on successful execution
      this.restartCounts.set(name, 0);
    } catch (error) {
      daemon.state.failureCount++;
      daemon.state.error = error instanceof Error ? error.message : String(error);

      // Handle auto-restart
      if (this.config.autoRestart) {
        const restartCount = (this.restartCounts.get(name) ?? 0) + 1;
        this.restartCounts.set(name, restartCount);

        if (restartCount <= this.config.maxRestartAttempts) {
          // Schedule restart
          setTimeout(() => {
            this.restart(name).catch(() => {});
          }, 1000 * restartCount); // Exponential backoff
        } else {
          daemon.state.status = 'error';
        }
      }
    }
  }
}

/**
 * Metrics Daemon - collects and syncs metrics
 */
export class MetricsDaemon {
  private manager: DaemonManager;
  private metricsStore: Map<string, unknown> = new Map();

  constructor(manager?: DaemonManager) {
    this.manager = manager ?? new DaemonManager();

    // Register metrics daemon
    this.manager.register(
      {
        name: 'metrics-sync',
        interval: 30000, // 30 seconds
        enabled: true,
      },
      () => this.syncMetrics()
    );
  }

  /**
   * Start metrics collection
   */
  async start(): Promise<void> {
    await this.manager.start('metrics-sync');
  }

  /**
   * Stop metrics collection
   */
  async stop(): Promise<void> {
    await this.manager.stop('metrics-sync');
  }

  /**
   * Sync metrics
   */
  private async syncMetrics(): Promise<void> {
    // Collect various metrics
    this.metricsStore.set('timestamp', new Date().toISOString());
    this.metricsStore.set('memory', process.memoryUsage());

    // Additional metrics would be collected here
  }

  /**
   * Get current metrics
   */
  getMetrics(): Record<string, unknown> {
    return Object.fromEntries(this.metricsStore);
  }
}

/**
 * Swarm Monitor Daemon - monitors swarm activity
 */
export class SwarmMonitorDaemon {
  private manager: DaemonManager;
  private swarmData: {
    activeAgents: number;
    maxAgents: number;
    coordinationActive: boolean;
    lastCheck: Date | null;
  } = {
    activeAgents: 0,
    maxAgents: 15,
    coordinationActive: false,
    lastCheck: null,
  };

  constructor(manager?: DaemonManager) {
    this.manager = manager ?? new DaemonManager();

    // Register swarm monitor daemon
    this.manager.register(
      {
        name: 'swarm-monitor',
        interval: 3000, // 3 seconds
        enabled: true,
      },
      () => this.checkSwarm()
    );
  }

  /**
   * Start swarm monitoring
   */
  async start(): Promise<void> {
    await this.manager.start('swarm-monitor');
  }

  /**
   * Stop swarm monitoring
   */
  async stop(): Promise<void> {
    await this.manager.stop('swarm-monitor');
  }

  /**
   * Check swarm status
   */
  private async checkSwarm(): Promise<void> {
    // In a real implementation, this would check running processes
    // and coordination state
    this.swarmData.lastCheck = new Date();
  }

  /**
   * Get swarm data
   */
  getSwarmData(): typeof this.swarmData {
    return { ...this.swarmData };
  }

  /**
   * Update active agent count
   */
  updateAgentCount(count: number): void {
    this.swarmData.activeAgents = count;
  }

  /**
   * Set coordination state
   */
  setCoordinationActive(active: boolean): void {
    this.swarmData.coordinationActive = active;
  }
}

/**
 * Hooks Learning Daemon - consolidates learned patterns using ReasoningBank
 */
export class HooksLearningDaemon {
  private manager: DaemonManager;
  private patternsLearned = 0;
  private routingAccuracy = 0;
  private reasoningBank: any = null;
  private lastConsolidation: Date | null = null;
  private consolidationStats = {
    totalRuns: 0,
    patternsPromoted: 0,
    patternsPruned: 0,
    duplicatesRemoved: 0,
  };

  constructor(manager?: DaemonManager) {
    this.manager = manager ?? new DaemonManager();

    // Register hooks learning daemon
    this.manager.register(
      {
        name: 'hooks-learning',
        interval: 60000, // 60 seconds
        enabled: true,
      },
      () => this.consolidate()
    );
  }

  /**
   * Start learning consolidation
   */
  async start(): Promise<void> {
    // Lazy load ReasoningBank to avoid circular dependencies
    try {
      const { reasoningBank } = await import('../reasoningbank/index.js');
      this.reasoningBank = reasoningBank;
      await this.reasoningBank.initialize();
    } catch (error) {
      console.warn('[HooksLearningDaemon] ReasoningBank not available:', error);
    }

    await this.manager.start('hooks-learning');
  }

  /**
   * Stop learning consolidation
   */
  async stop(): Promise<void> {
    await this.manager.stop('hooks-learning');
  }

  /**
   * Consolidate learned patterns using ReasoningBank
   */
  private async consolidate(): Promise<void> {
    if (!this.reasoningBank) {
      return;
    }

    try {
      const result = await this.reasoningBank.consolidate();

      // Update stats
      this.consolidationStats.totalRuns++;
      this.consolidationStats.patternsPromoted += result.patternsPromoted;
      this.consolidationStats.patternsPruned += result.patternsPruned;
      this.consolidationStats.duplicatesRemoved += result.duplicatesRemoved;
      this.lastConsolidation = new Date();

      // Update pattern count from ReasoningBank stats
      const stats = this.reasoningBank.getStats();
      this.patternsLearned = stats.shortTermCount + stats.longTermCount;

      // Emit consolidation event
      if (result.patternsPromoted > 0 || result.patternsPruned > 0) {
        console.log(
          `[HooksLearningDaemon] Consolidated: ${result.patternsPromoted} promoted, ` +
          `${result.patternsPruned} pruned, ${result.duplicatesRemoved} deduped`
        );
      }
    } catch (error) {
      console.error('[HooksLearningDaemon] Consolidation failed:', error);
    }
  }

  /**
   * Get learning stats
   */
  getStats(): {
    patternsLearned: number;
    routingAccuracy: number;
    consolidationStats: {
      totalRuns: number;
      patternsPromoted: number;
      patternsPruned: number;
      duplicatesRemoved: number;
    };
    lastConsolidation: Date | null;
  } {
    return {
      patternsLearned: this.patternsLearned,
      routingAccuracy: this.routingAccuracy,
      consolidationStats: { ...this.consolidationStats },
      lastConsolidation: this.lastConsolidation,
    };
  }

  /**
   * Update pattern count
   */
  updatePatternCount(count: number): void {
    this.patternsLearned = count;
  }

  /**
   * Update routing accuracy
   */
  updateRoutingAccuracy(accuracy: number): void {
    this.routingAccuracy = accuracy;
  }

  /**
   * Get ReasoningBank stats (if available)
   */
  getReasoningBankStats(): any {
    if (!this.reasoningBank) {
      return null;
    }
    return this.reasoningBank.getStats();
  }

  /**
   * Force immediate consolidation
   */
  async forceConsolidate(): Promise<void> {
    await this.consolidate();
  }
}

/**
 * Default daemon manager instance
 */
export const defaultDaemonManager = new DaemonManager();

export {
  DaemonManager as default,
  type DaemonInstance,
};
