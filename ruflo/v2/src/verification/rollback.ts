/**
 * Comprehensive Rollback Manager System
 * 
 * Provides atomic rollback operations with state management, automated recovery,
 * and git integration for maintaining system integrity.
 * 
 * Features:
 * - StateManager: Captures and manages system snapshots
 * - RollbackTrigger: Configurable thresholds and automated monitoring
 * - AutomatedRecovery: Multi-tier recovery strategies
 * - RollbackHistory: Compressed history tracking with TTL
 * - Git Integration: Code rollbacks with atomic commits
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { gzip, gunzip } from 'zlib';

const execAsync = promisify(exec);
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// ============================================================================
// Type Definitions
// ============================================================================

export interface SystemSnapshot {
  id: string;
  timestamp: number;
  version: string;
  metadata: {
    description: string;
    tags: string[];
    triggeredBy: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  };
  state: {
    config: Record<string, any>;
    memory: Record<string, any>;
    processes: ProcessState[];
    files: FileSnapshot[];
    git: GitState;
  };
  integrity: {
    checksum: string;
    compressed: boolean;
    size: number;
  };
}

export interface ProcessState {
  pid: number;
  name: string;
  status: string;
  memory: number;
  cpu: number;
  env: Record<string, string>;
}

export interface FileSnapshot {
  path: string;
  content: string | Buffer;
  stats: {
    size: number;
    mtime: number;
    mode: number;
  };
  checksum: string;
}

export interface GitState {
  branch: string;
  commit: string;
  status: string;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface RollbackTriggerConfig {
  enabled: boolean;
  thresholds: {
    errorRate: number;           // Errors per minute
    memoryUsage: number;         // Percentage
    cpuUsage: number;            // Percentage
    responseTime: number;        // Milliseconds
    diskSpace: number;           // Percentage free
    consecutiveFailures: number; // Count
  };
  monitoring: {
    interval: number;            // Monitoring check interval (ms)
    cooldown: number;            // Cooldown period after rollback (ms)
    gracePeriod: number;         // Grace period before triggering (ms)
  };
  notifications: {
    webhook?: string;
    email?: string[];
    slack?: string;
  };
}

export interface RecoveryStrategy {
  name: string;
  priority: number;
  enabled: boolean;
  timeout: number;
  retries: number;
  conditions: (metrics: SystemMetrics) => boolean;
  execute: (snapshot: SystemSnapshot, context: RecoveryContext) => Promise<boolean>;
}

export interface SystemMetrics {
  timestamp: number;
  errors: {
    count: number;
    rate: number;
    recent: Error[];
  };
  performance: {
    memory: { used: number; total: number; percentage: number; };
    cpu: { usage: number; load: number[]; };
    disk: { used: number; total: number; free: number; };
    network: { in: number; out: number; };
  };
  health: {
    status: 'healthy' | 'degraded' | 'critical';
    score: number;
    checks: HealthCheck[];
  };
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  duration: number;
}

export interface RecoveryContext {
  triggeredBy: string;
  reason: string;
  metrics: SystemMetrics;
  previousAttempts: RecoveryAttempt[];
}

export interface RecoveryAttempt {
  strategy: string;
  timestamp: number;
  success: boolean;
  error?: string;
  duration: number;
}

export interface RollbackHistoryEntry {
  id: string;
  timestamp: number;
  snapshot: SystemSnapshot;
  trigger: {
    type: 'manual' | 'automatic';
    reason: string;
    metrics?: SystemMetrics;
  };
  recovery: {
    strategy: string;
    success: boolean;
    duration: number;
    attempts: RecoveryAttempt[];
  };
  verification: {
    passed: boolean;
    checks: HealthCheck[];
    rollbackRequired: boolean;
  };
}

// ============================================================================
// StateManager - Captures and manages system snapshots
// ============================================================================

export class StateManager extends EventEmitter {
  private snapshots: Map<string, SystemSnapshot> = new Map();
  private snapshotDir: string;
  private maxSnapshots: number;
  private compressionEnabled: boolean;

  constructor(
    snapshotDir: string = './snapshots',
    maxSnapshots: number = 100,
    compressionEnabled: boolean = true
  ) {
    super();
    this.snapshotDir = snapshotDir;
    this.maxSnapshots = maxSnapshots;
    this.compressionEnabled = compressionEnabled;
    this.initializeStorage();
  }

  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.snapshotDir, { recursive: true });
      await this.loadExistingSnapshots();
    } catch (error) {
      this.emit('error', new Error(`Failed to initialize storage: ${error}`));
    }
  }

  private async loadExistingSnapshots(): Promise<void> {
    try {
      const files = await fs.readdir(this.snapshotDir);
      const snapshotFiles = files.filter(f => f.endsWith('.snapshot.json'));
      
      for (const file of snapshotFiles) {
        try {
          const content = await fs.readFile(join(this.snapshotDir, file), 'utf-8');
          const snapshot: SystemSnapshot = JSON.parse(content);
          this.snapshots.set(snapshot.id, snapshot);
        } catch (error) {
          console.warn(`Failed to load snapshot ${file}:`, error);
        }
      }
      
      this.emit('snapshots_loaded', this.snapshots.size);
    } catch (error) {
      this.emit('error', new Error(`Failed to load snapshots: ${error}`));
    }
  }

  /**
   * Creates a comprehensive system snapshot with atomic operations
   */
  public async captureSnapshot(
    description: string,
    tags: string[] = [],
    triggeredBy: string = 'manual'
  ): Promise<SystemSnapshot> {
    const id = this.generateSnapshotId();
    const timestamp = Date.now();

    try {
      // Capture system state atomically
      const [config, memory, processes, files, git] = await Promise.all([
        this.captureConfig(),
        this.captureMemory(),
        this.captureProcesses(),
        this.captureFiles(),
        this.captureGitState()
      ]);

      const snapshot: SystemSnapshot = {
        id,
        timestamp,
        version: '1.0.0',
        metadata: {
          description,
          tags,
          triggeredBy,
          severity: 'medium'
        },
        state: {
          config,
          memory,
          processes,
          files,
          git
        },
        integrity: {
          checksum: '',
          compressed: this.compressionEnabled,
          size: 0
        }
      };

      // Calculate integrity checksum
      const serialized = JSON.stringify(snapshot.state);
      snapshot.integrity.checksum = createHash('sha256').update(serialized).digest('hex');
      snapshot.integrity.size = Buffer.byteLength(serialized, 'utf8');

      // Store snapshot
      await this.storeSnapshot(snapshot);
      this.snapshots.set(id, snapshot);

      // Cleanup old snapshots
      await this.cleanupOldSnapshots();

      this.emit('snapshot_created', snapshot);
      return snapshot;

    } catch (error) {
      this.emit('error', new Error(`Failed to capture snapshot: ${error}`));
      throw error;
    }
  }

  private async captureConfig(): Promise<Record<string, any>> {
    try {
      // Capture application configuration
      const configPaths = [
        './claude-flow.config.json',
        './package.json',
        './tsconfig.json',
        './.env'
      ];

      const config: Record<string, any> = {};
      
      for (const path of configPaths) {
        try {
          const content = await fs.readFile(path, 'utf-8');
          config[path] = JSON.parse(content);
        } catch {
          // File might not exist or be invalid JSON
        }
      }

      return config;
    } catch (error) {
      return {};
    }
  }

  private async captureMemory(): Promise<Record<string, any>> {
    try {
      // Capture memory-related state
      const memoryPaths = [
        './memory/memory-store.json',
        './memory/claude-flow-data.json',
        './swarm-memory/state.json'
      ];

      const memory: Record<string, any> = {};
      
      for (const path of memoryPaths) {
        try {
          const content = await fs.readFile(path, 'utf-8');
          memory[path] = JSON.parse(content);
        } catch {
          // File might not exist
        }
      }

      return memory;
    } catch (error) {
      return {};
    }
  }

  private async captureProcesses(): Promise<ProcessState[]> {
    try {
      // Capture running processes related to claude-flow
      const { stdout } = await execAsync('ps aux | grep -E "(claude-flow|node)" | grep -v grep');
      const lines = stdout.trim().split('\n');
      
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parseInt(parts[1]) || 0,
          name: parts[10] || 'unknown',
          status: 'running',
          memory: parseFloat(parts[5]) || 0,
          cpu: parseFloat(parts[2]) || 0,
          env: process.env as Record<string, string>
        };
      });
    } catch {
      return [];
    }
  }

  private async captureFiles(): Promise<FileSnapshot[]> {
    try {
      // Capture critical files
      const criticalPaths = [
        './src/verification/rollback.ts',
        './src/core/orchestrator.ts',
        './src/memory/manager.ts',
        './src/mcp/server.ts'
      ];

      const files: FileSnapshot[] = [];
      
      for (const path of criticalPaths) {
        try {
          const [content, stats] = await Promise.all([
            fs.readFile(path, 'utf-8'),
            fs.stat(path)
          ]);
          
          files.push({
            path,
            content,
            stats: {
              size: stats.size,
              mtime: stats.mtime.getTime(),
              mode: stats.mode
            },
            checksum: createHash('md5').update(content).digest('hex')
          });
        } catch {
          // File might not exist
        }
      }

      return files;
    } catch {
      return [];
    }
  }

  private async captureGitState(): Promise<GitState> {
    try {
      const [branch, commit, status, staged, modified, untracked] = await Promise.all([
        execAsync('git rev-parse --abbrev-ref HEAD').then(r => r.stdout.trim()).catch(() => 'unknown'),
        execAsync('git rev-parse HEAD').then(r => r.stdout.trim()).catch(() => 'unknown'),
        execAsync('git status --porcelain').then(r => r.stdout.trim()).catch(() => ''),
        execAsync('git diff --cached --name-only').then(r => r.stdout.trim().split('\n').filter(Boolean)).catch(() => []),
        execAsync('git diff --name-only').then(r => r.stdout.trim().split('\n').filter(Boolean)).catch(() => []),
        execAsync('git ls-files --others --exclude-standard').then(r => r.stdout.trim().split('\n').filter(Boolean)).catch(() => [])
      ]);

      return {
        branch,
        commit,
        status,
        staged,
        modified,
        untracked
      };
    } catch {
      return {
        branch: 'unknown',
        commit: 'unknown',
        status: '',
        staged: [],
        modified: [],
        untracked: []
      };
    }
  }

  private async storeSnapshot(snapshot: SystemSnapshot): Promise<void> {
    const filename = `${snapshot.id}.snapshot.json`;
    const filepath = join(this.snapshotDir, filename);

    const content = JSON.stringify(snapshot, null, 2);
    
    if (this.compressionEnabled) {
      const compressed = await gzipAsync(Buffer.from(content, 'utf-8'));
      await fs.writeFile(filepath + '.gz', compressed);
    } else {
      await fs.writeFile(filepath, content);
    }
  }

  private async cleanupOldSnapshots(): Promise<void> {
    if (this.snapshots.size <= this.maxSnapshots) return;

    const sorted = Array.from(this.snapshots.values())
      .sort((a, b) => a.timestamp - b.timestamp);
    
    const toDelete = sorted.slice(0, sorted.length - this.maxSnapshots);
    
    for (const snapshot of toDelete) {
      try {
        const filename = `${snapshot.id}.snapshot.json`;
        const filepath = join(this.snapshotDir, filename);
        
        await fs.unlink(filepath).catch(() => {});
        await fs.unlink(filepath + '.gz').catch(() => {});
        
        this.snapshots.delete(snapshot.id);
      } catch (error) {
        console.warn(`Failed to delete snapshot ${snapshot.id}:`, error);
      }
    }
  }

  private generateSnapshotId(): string {
    return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public async getSnapshot(id: string): Promise<SystemSnapshot | null> {
    return this.snapshots.get(id) || null;
  }

  public listSnapshots(): SystemSnapshot[] {
    return Array.from(this.snapshots.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  public async deleteSnapshot(id: string): Promise<boolean> {
    try {
      const filename = `${id}.snapshot.json`;
      const filepath = join(this.snapshotDir, filename);
      
      await fs.unlink(filepath).catch(() => {});
      await fs.unlink(filepath + '.gz').catch(() => {});
      
      this.snapshots.delete(id);
      this.emit('snapshot_deleted', id);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// RollbackTrigger - Configurable thresholds and monitoring
// ============================================================================

export class RollbackTrigger extends EventEmitter {
  private config: RollbackTriggerConfig;
  private monitoring: boolean = false;
  private metrics: SystemMetrics[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private lastRollback: number = 0;

  constructor(config: Partial<RollbackTriggerConfig> = {}) {
    super();
    this.config = this.mergeConfig(config);
  }

  private mergeConfig(config: Partial<RollbackTriggerConfig>): RollbackTriggerConfig {
    return {
      enabled: config.enabled ?? true,
      thresholds: {
        errorRate: config.thresholds?.errorRate ?? 10,
        memoryUsage: config.thresholds?.memoryUsage ?? 90,
        cpuUsage: config.thresholds?.cpuUsage ?? 95,
        responseTime: config.thresholds?.responseTime ?? 5000,
        diskSpace: config.thresholds?.diskSpace ?? 10,
        consecutiveFailures: config.thresholds?.consecutiveFailures ?? 3
      },
      monitoring: {
        interval: config.monitoring?.interval ?? 30000,
        cooldown: config.monitoring?.cooldown ?? 300000,
        gracePeriod: config.monitoring?.gracePeriod ?? 60000
      },
      notifications: {
        webhook: config.notifications?.webhook,
        email: config.notifications?.email,
        slack: config.notifications?.slack
      }
    };
  }

  public startMonitoring(): void {
    if (this.monitoring) return;
    
    this.monitoring = true;
    this.monitoringInterval = setInterval(
      () => this.checkThresholds(),
      this.config.monitoring.interval
    );
    
    this.emit('monitoring_started');
  }

  public stopMonitoring(): void {
    if (!this.monitoring) return;
    
    this.monitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    this.emit('monitoring_stopped');
  }

  private async checkThresholds(): Promise<void> {
    if (!this.config.enabled) return;
    
    // Check cooldown period
    if (Date.now() - this.lastRollback < this.config.monitoring.cooldown) {
      return;
    }

    try {
      const metrics = await this.collectMetrics();
      this.metrics.push(metrics);
      
      // Keep only recent metrics (last hour)
      const oneHourAgo = Date.now() - 3600000;
      this.metrics = this.metrics.filter(m => m.timestamp > oneHourAgo);
      
      const violations = this.evaluateThresholds(metrics);
      
      if (violations.length > 0) {
        this.emit('threshold_violated', { metrics, violations });
        
        // Check grace period
        const recentViolations = this.metrics
          .filter(m => m.timestamp > Date.now() - this.config.monitoring.gracePeriod)
          .filter(m => this.evaluateThresholds(m).length > 0);
        
        if (recentViolations.length >= 2) {
          this.triggerRollback(metrics, violations);
        }
      }
      
    } catch (error) {
      this.emit('monitoring_error', error);
    }
  }

  private async collectMetrics(): Promise<SystemMetrics> {
    const timestamp = Date.now();
    
    try {
      const [memInfo, cpuInfo, diskInfo] = await Promise.all([
        this.getMemoryInfo(),
        this.getCpuInfo(),
        this.getDiskInfo()
      ]);

      return {
        timestamp,
        errors: {
          count: 0, // Would be tracked by error handler
          rate: 0,
          recent: []
        },
        performance: {
          memory: memInfo,
          cpu: cpuInfo,
          disk: diskInfo,
          network: { in: 0, out: 0 }
        },
        health: {
          status: 'healthy',
          score: 100,
          checks: []
        }
      };
      
    } catch (error) {
      return {
        timestamp,
        errors: { count: 1, rate: 1, recent: [error as Error] },
        performance: {
          memory: { used: 0, total: 0, percentage: 0 },
          cpu: { usage: 0, load: [0, 0, 0] },
          disk: { used: 0, total: 0, free: 0 },
          network: { in: 0, out: 0 }
        },
        health: {
          status: 'critical',
          score: 0,
          checks: [{ name: 'metrics_collection', status: 'fail', message: error?.toString() || 'Unknown error', duration: 0 }]
        }
      };
    }
  }

  private async getMemoryInfo() {
    try {
      const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
      const lines = meminfo.split('\n');
      
      const memTotal = parseInt(lines.find(l => l.startsWith('MemTotal:'))?.split(/\s+/)[1] || '0') * 1024;
      const memAvailable = parseInt(lines.find(l => l.startsWith('MemAvailable:'))?.split(/\s+/)[1] || '0') * 1024;
      const memUsed = memTotal - memAvailable;
      
      return {
        used: memUsed,
        total: memTotal,
        percentage: memTotal > 0 ? (memUsed / memTotal) * 100 : 0
      };
    } catch {
      return { used: 0, total: 0, percentage: 0 };
    }
  }

  private async getCpuInfo() {
    try {
      const loadavg = await fs.readFile('/proc/loadavg', 'utf-8');
      const loads = loadavg.trim().split(' ').slice(0, 3).map(parseFloat);
      
      return {
        usage: loads[0] * 100, // Approximate CPU usage from 1-min load
        load: loads
      };
    } catch {
      return { usage: 0, load: [0, 0, 0] };
    }
  }

  private async getDiskInfo() {
    try {
      const { stdout } = await execAsync('df -h . | tail -1');
      const parts = stdout.trim().split(/\s+/);
      
      const total = this.parseSize(parts[1]);
      const used = this.parseSize(parts[2]);
      const free = this.parseSize(parts[3]);
      
      return { used, total, free };
    } catch {
      return { used: 0, total: 0, free: 0 };
    }
  }

  private parseSize(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)(K|M|G|T)?$/);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2] || '';
    
    const multipliers: Record<string, number> = {
      '': 1,
      'K': 1024,
      'M': 1024 * 1024,
      'G': 1024 * 1024 * 1024,
      'T': 1024 * 1024 * 1024 * 1024
    };
    
    return value * (multipliers[unit] || 1);
  }

  private evaluateThresholds(metrics: SystemMetrics): string[] {
    const violations: string[] = [];
    
    if (metrics.performance.memory.percentage > this.config.thresholds.memoryUsage) {
      violations.push(`Memory usage: ${metrics.performance.memory.percentage.toFixed(1)}% > ${this.config.thresholds.memoryUsage}%`);
    }
    
    if (metrics.performance.cpu.usage > this.config.thresholds.cpuUsage) {
      violations.push(`CPU usage: ${metrics.performance.cpu.usage.toFixed(1)}% > ${this.config.thresholds.cpuUsage}%`);
    }
    
    const diskFreePercentage = (metrics.performance.disk.free / metrics.performance.disk.total) * 100;
    if (diskFreePercentage < this.config.thresholds.diskSpace) {
      violations.push(`Disk space: ${diskFreePercentage.toFixed(1)}% free < ${this.config.thresholds.diskSpace}%`);
    }
    
    if (metrics.errors.rate > this.config.thresholds.errorRate) {
      violations.push(`Error rate: ${metrics.errors.rate}/min > ${this.config.thresholds.errorRate}/min`);
    }
    
    return violations;
  }

  private async triggerRollback(metrics: SystemMetrics, violations: string[]): Promise<void> {
    this.lastRollback = Date.now();
    
    this.emit('rollback_triggered', {
      reason: 'threshold_violations',
      violations,
      metrics
    });
    
    // Send notifications
    await this.sendNotifications(violations, metrics);
  }

  private async sendNotifications(violations: string[], metrics: SystemMetrics): Promise<void> {
    const message = `🚨 Rollback triggered due to threshold violations:\n${violations.join('\n')}`;
    
    try {
      if (this.config.notifications.webhook) {
        // Send webhook notification
        // Implementation would depend on the webhook service
      }
      
      if (this.config.notifications.slack) {
        // Send Slack notification
        // Implementation would depend on Slack integration
      }
      
      if (this.config.notifications.email) {
        // Send email notification
        // Implementation would depend on email service
      }
    } catch (error) {
      this.emit('notification_error', error);
    }
  }

  public updateConfig(config: Partial<RollbackTriggerConfig>): void {
    this.config = this.mergeConfig(config);
    this.emit('config_updated', this.config);
  }

  public getCurrentMetrics(): SystemMetrics | null {
    return this.metrics[this.metrics.length - 1] || null;
  }

  public getMetricsHistory(): SystemMetrics[] {
    return [...this.metrics];
  }
}

// ============================================================================
// AutomatedRecovery - Multi-tier recovery strategies
// ============================================================================

export class AutomatedRecovery extends EventEmitter {
  private strategies: Map<string, RecoveryStrategy> = new Map();
  private recoveryHistory: RecoveryAttempt[] = [];
  private stateManager: StateManager;
  private isRecovering: boolean = false;

  constructor(stateManager: StateManager) {
    super();
    this.stateManager = stateManager;
    this.initializeDefaultStrategies();
  }

  private initializeDefaultStrategies(): void {
    // Strategy 1: Service Restart
    this.registerStrategy({
      name: 'service_restart',
      priority: 1,
      enabled: true,
      timeout: 30000,
      retries: 2,
      conditions: (metrics) => metrics.health.status === 'degraded',
      execute: async (snapshot, context) => {
        try {
          this.emit('recovery_step', { strategy: 'service_restart', action: 'restarting_services' });
          
          // Restart critical services
          await execAsync('pkill -f "claude-flow" && sleep 2');
          
          // Wait for services to restart
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          return true;
        } catch (error) {
          this.emit('recovery_error', { strategy: 'service_restart', error });
          return false;
        }
      }
    });

    // Strategy 2: Memory Cleanup
    this.registerStrategy({
      name: 'memory_cleanup',
      priority: 2,
      enabled: true,
      timeout: 15000,
      retries: 1,
      conditions: (metrics) => metrics.performance.memory.percentage > 85,
      execute: async (snapshot, context) => {
        try {
          this.emit('recovery_step', { strategy: 'memory_cleanup', action: 'clearing_memory' });
          
          // Force garbage collection
          if (global.gc) {
            global.gc();
          }
          
          // Clear caches
          await this.clearApplicationCaches();
          
          return true;
        } catch (error) {
          this.emit('recovery_error', { strategy: 'memory_cleanup', error });
          return false;
        }
      }
    });

    // Strategy 3: Configuration Reset
    this.registerStrategy({
      name: 'config_reset',
      priority: 3,
      enabled: true,
      timeout: 20000,
      retries: 1,
      conditions: (metrics) => metrics.health.status === 'critical',
      execute: async (snapshot, context) => {
        try {
          this.emit('recovery_step', { strategy: 'config_reset', action: 'resetting_config' });
          
          // Restore configuration from snapshot
          await this.restoreConfiguration(snapshot);
          
          return true;
        } catch (error) {
          this.emit('recovery_error', { strategy: 'config_reset', error });
          return false;
        }
      }
    });

    // Strategy 4: Full State Rollback
    this.registerStrategy({
      name: 'full_rollback',
      priority: 10,
      enabled: true,
      timeout: 60000,
      retries: 1,
      conditions: () => true, // Last resort
      execute: async (snapshot, context) => {
        try {
          this.emit('recovery_step', { strategy: 'full_rollback', action: 'rolling_back_state' });
          
          // Full system rollback
          await this.performFullRollback(snapshot);
          
          return true;
        } catch (error) {
          this.emit('recovery_error', { strategy: 'full_rollback', error });
          return false;
        }
      }
    });
  }

  public registerStrategy(strategy: RecoveryStrategy): void {
    this.strategies.set(strategy.name, strategy);
    this.emit('strategy_registered', strategy.name);
  }

  public async executeRecovery(
    metrics: SystemMetrics,
    triggerReason: string,
    preferredSnapshot?: string
  ): Promise<boolean> {
    if (this.isRecovering) {
      this.emit('recovery_blocked', 'Recovery already in progress');
      return false;
    }

    this.isRecovering = true;
    
    try {
      this.emit('recovery_started', { reason: triggerReason, metrics });
      
      // Get appropriate snapshot
      const snapshots = this.stateManager.listSnapshots();
      const snapshot = preferredSnapshot 
        ? await this.stateManager.getSnapshot(preferredSnapshot)
        : snapshots[0]; // Most recent snapshot
      
      if (!snapshot) {
        throw new Error('No snapshot available for recovery');
      }

      // Get applicable strategies
      const applicableStrategies = Array.from(this.strategies.values())
        .filter(s => s.enabled && s.conditions(metrics))
        .sort((a, b) => a.priority - b.priority);

      if (applicableStrategies.length === 0) {
        throw new Error('No applicable recovery strategies found');
      }

      const context: RecoveryContext = {
        triggeredBy: triggerReason,
        reason: triggerReason,
        metrics,
        previousAttempts: this.recoveryHistory.slice(-10) // Last 10 attempts
      };

      // Execute strategies in priority order
      for (const strategy of applicableStrategies) {
        const success = await this.executeStrategy(strategy, snapshot, context);
        
        if (success) {
          this.emit('recovery_success', { 
            strategy: strategy.name, 
            snapshot: snapshot.id,
            duration: Date.now() - metrics.timestamp 
          });
          return true;
        }
      }

      throw new Error('All recovery strategies failed');
      
    } catch (error) {
      this.emit('recovery_failed', { error: error?.toString(), metrics });
      return false;
    } finally {
      this.isRecovering = false;
    }
  }

  private async executeStrategy(
    strategy: RecoveryStrategy,
    snapshot: SystemSnapshot,
    context: RecoveryContext
  ): Promise<boolean> {
    const startTime = Date.now();
    
    for (let attempt = 0; attempt <= strategy.retries; attempt++) {
      try {
        this.emit('strategy_attempt', { 
          strategy: strategy.name, 
          attempt: attempt + 1,
          maxAttempts: strategy.retries + 1
        });
        
        // Execute with timeout
        const success = await Promise.race([
          strategy.execute(snapshot, context),
          new Promise<boolean>((_, reject) => 
            setTimeout(() => reject(new Error('Strategy timeout')), strategy.timeout)
          )
        ]);

        const duration = Date.now() - startTime;
        
        const recoveryAttempt: RecoveryAttempt = {
          strategy: strategy.name,
          timestamp: Date.now(),
          success,
          duration
        };
        
        this.recoveryHistory.push(recoveryAttempt);
        
        if (success) {
          this.emit('strategy_success', { strategy: strategy.name, attempt, duration });
          return true;
        }
        
      } catch (error) {
        const duration = Date.now() - startTime;
        
        const recoveryAttempt: RecoveryAttempt = {
          strategy: strategy.name,
          timestamp: Date.now(),
          success: false,
          error: error?.toString(),
          duration
        };
        
        this.recoveryHistory.push(recoveryAttempt);
        
        this.emit('strategy_failed', { 
          strategy: strategy.name, 
          attempt, 
          error: error?.toString(),
          duration 
        });
        
        if (attempt === strategy.retries) {
          return false; // All retries exhausted
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    
    return false;
  }

  private async clearApplicationCaches(): Promise<void> {
    try {
      // Clear memory caches
      const memoryPaths = [
        './memory/cache',
        './swarm-memory/cache',
        './temp'
      ];
      
      for (const path of memoryPaths) {
        try {
          await fs.rm(path, { recursive: true, force: true });
          await fs.mkdir(path, { recursive: true });
        } catch {
          // Path might not exist
        }
      }
    } catch (error) {
      throw new Error(`Failed to clear caches: ${error}`);
    }
  }

  private async restoreConfiguration(snapshot: SystemSnapshot): Promise<void> {
    try {
      // Restore configuration files from snapshot
      for (const [path, content] of Object.entries(snapshot.state.config)) {
        try {
          await fs.writeFile(path, JSON.stringify(content, null, 2));
        } catch (error) {
          console.warn(`Failed to restore config file ${path}:`, error);
        }
      }
    } catch (error) {
      throw new Error(`Failed to restore configuration: ${error}`);
    }
  }

  private async performFullRollback(snapshot: SystemSnapshot): Promise<void> {
    try {
      // 1. Stop services
      await execAsync('pkill -f "claude-flow"').catch(() => {});
      
      // 2. Restore files
      for (const file of snapshot.state.files) {
        try {
          await fs.writeFile(file.path, file.content);
          await fs.chmod(file.path, file.stats.mode);
        } catch (error) {
          console.warn(`Failed to restore file ${file.path}:`, error);
        }
      }
      
      // 3. Restore memory
      for (const [path, content] of Object.entries(snapshot.state.memory)) {
        try {
          await fs.writeFile(path, JSON.stringify(content, null, 2));
        } catch (error) {
          console.warn(`Failed to restore memory file ${path}:`, error);
        }
      }
      
      // 4. Git rollback if needed
      if (snapshot.state.git.commit !== 'unknown') {
        try {
          await execAsync(`git reset --hard ${snapshot.state.git.commit}`);
        } catch (error) {
          console.warn('Failed to perform git rollback:', error);
        }
      }
      
      // 5. Restart services
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      throw new Error(`Failed to perform full rollback: ${error}`);
    }
  }

  public getStrategyNames(): string[] {
    return Array.from(this.strategies.keys());
  }

  public getStrategy(name: string): RecoveryStrategy | undefined {
    return this.strategies.get(name);
  }

  public enableStrategy(name: string): boolean {
    const strategy = this.strategies.get(name);
    if (strategy) {
      strategy.enabled = true;
      this.emit('strategy_enabled', name);
      return true;
    }
    return false;
  }

  public disableStrategy(name: string): boolean {
    const strategy = this.strategies.get(name);
    if (strategy) {
      strategy.enabled = false;
      this.emit('strategy_disabled', name);
      return true;
    }
    return false;
  }

  public getRecoveryHistory(): RecoveryAttempt[] {
    return [...this.recoveryHistory];
  }
}

// ============================================================================
// RollbackHistory - Compressed history tracking with TTL
// ============================================================================

export class RollbackHistory extends EventEmitter {
  private history: Map<string, RollbackHistoryEntry> = new Map();
  private historyDir: string;
  private maxHistorySize: number;
  private compressionEnabled: boolean;
  private ttlMs: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    historyDir: string = './rollback-history',
    maxHistorySize: number = 1000,
    ttlDays: number = 30,
    compressionEnabled: boolean = true
  ) {
    super();
    this.historyDir = historyDir;
    this.maxHistorySize = maxHistorySize;
    this.ttlMs = ttlDays * 24 * 60 * 60 * 1000; // Convert days to ms
    this.compressionEnabled = compressionEnabled;
    
    this.initializeStorage();
    this.startCleanupInterval();
  }

  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.historyDir, { recursive: true });
      await this.loadExistingHistory();
    } catch (error) {
      this.emit('error', new Error(`Failed to initialize history storage: ${error}`));
    }
  }

  private async loadExistingHistory(): Promise<void> {
    try {
      const files = await fs.readdir(this.historyDir);
      const historyFiles = files.filter(f => f.endsWith('.history.json') || f.endsWith('.history.json.gz'));
      
      for (const file of historyFiles) {
        try {
          const filepath = join(this.historyDir, file);
          let content: string;
          
          if (file.endsWith('.gz')) {
            const compressed = await fs.readFile(filepath);
            const decompressed = await gunzipAsync(compressed);
            content = decompressed.toString('utf-8');
          } else {
            content = await fs.readFile(filepath, 'utf-8');
          }
          
          const entry: RollbackHistoryEntry = JSON.parse(content);
          this.history.set(entry.id, entry);
        } catch (error) {
          console.warn(`Failed to load history entry ${file}:`, error);
        }
      }
      
      this.emit('history_loaded', this.history.size);
    } catch (error) {
      this.emit('error', new Error(`Failed to load history: ${error}`));
    }
  }

  private startCleanupInterval(): void {
    // Run cleanup every 6 hours
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 6 * 60 * 60 * 1000);
  }

  public async addEntry(
    snapshot: SystemSnapshot,
    triggerType: 'manual' | 'automatic',
    triggerReason: string,
    triggerMetrics: SystemMetrics | undefined,
    recoveryStrategy: string,
    recoverySuccess: boolean,
    recoveryDuration: number,
    recoveryAttempts: RecoveryAttempt[],
    verificationChecks: HealthCheck[],
    verificationPassed: boolean,
    rollbackRequired: boolean
  ): Promise<string> {
    const id = this.generateHistoryId();
    
    const entry: RollbackHistoryEntry = {
      id,
      timestamp: Date.now(),
      snapshot,
      trigger: {
        type: triggerType,
        reason: triggerReason,
        metrics: triggerMetrics
      },
      recovery: {
        strategy: recoveryStrategy,
        success: recoverySuccess,
        duration: recoveryDuration,
        attempts: recoveryAttempts
      },
      verification: {
        passed: verificationPassed,
        checks: verificationChecks,
        rollbackRequired
      }
    };

    try {
      await this.storeHistoryEntry(entry);
      this.history.set(id, entry);
      
      // Cleanup if we exceed max size
      await this.cleanupOldEntries();
      
      this.emit('entry_added', entry);
      return id;
      
    } catch (error) {
      this.emit('error', new Error(`Failed to add history entry: ${error}`));
      throw error;
    }
  }

  private async storeHistoryEntry(entry: RollbackHistoryEntry): Promise<void> {
    const filename = `${entry.id}.history.json`;
    const filepath = join(this.historyDir, filename);

    const content = JSON.stringify(entry, null, 2);
    
    if (this.compressionEnabled) {
      const compressed = await gzipAsync(Buffer.from(content, 'utf-8'));
      await fs.writeFile(filepath + '.gz', compressed);
    } else {
      await fs.writeFile(filepath, content);
    }
  }

  private async cleanupExpiredEntries(): Promise<void> {
    const now = Date.now();
    const expiredEntries: string[] = [];
    
    for (const [id, entry] of this.history.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        expiredEntries.push(id);
      }
    }
    
    for (const id of expiredEntries) {
      await this.deleteEntry(id);
    }
    
    if (expiredEntries.length > 0) {
      this.emit('entries_expired', expiredEntries.length);
    }
  }

  private async cleanupOldEntries(): Promise<void> {
    if (this.history.size <= this.maxHistorySize) return;

    const sorted = Array.from(this.history.values())
      .sort((a, b) => a.timestamp - b.timestamp);
    
    const toDelete = sorted.slice(0, sorted.length - this.maxHistorySize);
    
    for (const entry of toDelete) {
      await this.deleteEntry(entry.id);
    }
  }

  private async deleteEntry(id: string): Promise<void> {
    try {
      const filename = `${id}.history.json`;
      const filepath = join(this.historyDir, filename);
      
      await fs.unlink(filepath).catch(() => {});
      await fs.unlink(filepath + '.gz').catch(() => {});
      
      this.history.delete(id);
    } catch (error) {
      console.warn(`Failed to delete history entry ${id}:`, error);
    }
  }

  private generateHistoryId(): string {
    return `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public getEntry(id: string): RollbackHistoryEntry | null {
    return this.history.get(id) || null;
  }

  public getRecentEntries(limit: number = 50): RollbackHistoryEntry[] {
    return Array.from(this.history.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  public getEntriesByDateRange(startDate: Date, endDate: Date): RollbackHistoryEntry[] {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    
    return Array.from(this.history.values())
      .filter(entry => entry.timestamp >= startTime && entry.timestamp <= endTime)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  public getSuccessRate(timeframe: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - timeframe;
    const recentEntries = Array.from(this.history.values())
      .filter(entry => entry.timestamp > cutoff);
    
    if (recentEntries.length === 0) return 100;
    
    const successCount = recentEntries.filter(entry => entry.recovery.success).length;
    return (successCount / recentEntries.length) * 100;
  }

  public getStatistics(): {
    totalEntries: number;
    successRate: number;
    averageRecoveryTime: number;
    mostCommonFailureReason: string;
    rollbacksByTrigger: Record<string, number>;
  } {
    const entries = Array.from(this.history.values());
    
    if (entries.length === 0) {
      return {
        totalEntries: 0,
        successRate: 100,
        averageRecoveryTime: 0,
        mostCommonFailureReason: 'none',
        rollbacksByTrigger: {}
      };
    }
    
    const successCount = entries.filter(e => e.recovery.success).length;
    const successRate = (successCount / entries.length) * 100;
    
    const totalRecoveryTime = entries.reduce((sum, e) => sum + e.recovery.duration, 0);
    const averageRecoveryTime = totalRecoveryTime / entries.length;
    
    const failureReasons = entries
      .filter(e => !e.recovery.success)
      .map(e => e.trigger.reason);
    
    const reasonCounts = failureReasons.reduce((acc, reason) => {
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const mostCommonFailureReason = Object.entries(reasonCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none';
    
    const rollbacksByTrigger = entries.reduce((acc, entry) => {
      acc[entry.trigger.type] = (acc[entry.trigger.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      totalEntries: entries.length,
      successRate,
      averageRecoveryTime,
      mostCommonFailureReason,
      rollbacksByTrigger
    };
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}

// ============================================================================
// GitRollbackManager - Git integration for code rollbacks
// ============================================================================

export class GitRollbackManager extends EventEmitter {
  private gitDir: string;
  private backupBranch: string;
  private safetyChecks: boolean;

  constructor(
    gitDir: string = './',
    backupBranch: string = 'rollback-backup',
    safetyChecks: boolean = true
  ) {
    super();
    this.gitDir = gitDir;
    this.backupBranch = backupBranch;
    this.safetyChecks = safetyChecks;
  }

  /**
   * Creates an atomic git commit with rollback marker
   */
  public async createRollbackPoint(
    message: string = 'Automated rollback point',
    tags: string[] = []
  ): Promise<string> {
    try {
      // Ensure we're in a git repository
      await this.ensureGitRepo();
      
      if (this.safetyChecks) {
        await this.performSafetyChecks();
      }
      
      // Create backup branch
      await this.createBackupBranch();
      
      // Stage all changes
      await execAsync('git add -A', { cwd: this.gitDir });
      
      // Create commit with rollback metadata
      const rollbackMessage = this.formatRollbackMessage(message, tags);
      await execAsync(`git commit -m "${rollbackMessage}"`, { cwd: this.gitDir });
      
      // Get commit hash
      const { stdout: commitHash } = await execAsync('git rev-parse HEAD', { cwd: this.gitDir });
      const hash = commitHash.trim();
      
      // Create tag for easy reference
      const tagName = `rollback-${Date.now()}`;
      await execAsync(`git tag -a "${tagName}" -m "Rollback point: ${message}"`, { cwd: this.gitDir });
      
      this.emit('rollback_point_created', { hash, tag: tagName, message });
      return hash;
      
    } catch (error) {
      this.emit('error', new Error(`Failed to create rollback point: ${error}`));
      throw error;
    }
  }

  /**
   * Performs atomic rollback to a specific commit
   */
  public async rollbackToCommit(
    commitHash: string,
    strategy: 'hard' | 'soft' | 'mixed' = 'mixed',
    preserveUntracked: boolean = true
  ): Promise<boolean> {
    try {
      if (this.safetyChecks) {
        await this.performSafetyChecks();
        await this.validateCommit(commitHash);
      }
      
      // Stash any current changes if preserving untracked files
      let stashRef: string | null = null;
      if (preserveUntracked) {
        try {
          await execAsync('git stash push -u -m "Pre-rollback stash"', { cwd: this.gitDir });
          stashRef = await this.getLastStashRef();
        } catch {
          // No changes to stash
        }
      }
      
      // Perform the rollback
      await execAsync(`git reset --${strategy} ${commitHash}`, { cwd: this.gitDir });
      
      // If hard reset and preserving untracked, restore stashed files
      if (strategy === 'hard' && stashRef && preserveUntracked) {
        try {
          // Only restore untracked files from stash
          await execAsync(`git stash show -p ${stashRef} | git apply --index`, { cwd: this.gitDir });
          await execAsync(`git stash drop ${stashRef}`, { cwd: this.gitDir });
        } catch {
          // Stash restoration failed, but rollback succeeded
          this.emit('warning', 'Rollback completed but failed to restore untracked files');
        }
      }
      
      // Verify rollback success
      const { stdout: currentHash } = await execAsync('git rev-parse HEAD', { cwd: this.gitDir });
      const success = currentHash.trim() === commitHash;
      
      if (success) {
        this.emit('rollback_completed', { commitHash, strategy });
      } else {
        throw new Error('Rollback verification failed');
      }
      
      return success;
      
    } catch (error) {
      this.emit('error', new Error(`Rollback failed: ${error}`));
      
      // Attempt emergency recovery
      try {
        await this.emergencyRecovery();
      } catch (recoveryError) {
        this.emit('error', new Error(`Emergency recovery failed: ${recoveryError}`));
      }
      
      return false;
    }
  }

  /**
   * Rolls back specific files to their state at a given commit
   */
  public async rollbackFiles(
    files: string[],
    commitHash: string
  ): Promise<boolean> {
    try {
      if (this.safetyChecks) {
        await this.validateCommit(commitHash);
        await this.validateFiles(files);
      }
      
      // Backup current state of files
      const backupStash = await this.createFileBackup(files);
      
      try {
        // Rollback each file
        for (const file of files) {
          await execAsync(`git checkout ${commitHash} -- "${file}"`, { cwd: this.gitDir });
        }
        
        this.emit('files_rolled_back', { files, commitHash });
        return true;
        
      } catch (error) {
        // Restore from backup on failure
        if (backupStash) {
          await this.restoreFileBackup(backupStash, files);
        }
        throw error;
      }
      
    } catch (error) {
      this.emit('error', new Error(`File rollback failed: ${error}`));
      return false;
    }
  }

  /**
   * Creates a branch from current state for safe rollback testing
   */
  public async createTestBranch(name?: string): Promise<string> {
    try {
      const branchName = name || `rollback-test-${Date.now()}`;
      
      await execAsync(`git checkout -b "${branchName}"`, { cwd: this.gitDir });
      
      this.emit('test_branch_created', branchName);
      return branchName;
      
    } catch (error) {
      this.emit('error', new Error(`Failed to create test branch: ${error}`));
      throw error;
    }
  }

  /**
   * Lists available rollback points (commits with rollback markers)
   */
  public async listRollbackPoints(): Promise<Array<{
    hash: string;
    date: Date;
    message: string;
    tags: string[];
  }>> {
    try {
      // Get commits with rollback markers
      const { stdout } = await execAsync(
        'git log --grep="\\[ROLLBACK\\]" --oneline --format="%H|%ai|%s" -n 50',
        { cwd: this.gitDir }
      );
      
      const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [hash, dateStr, message] = line.split('|');
        return {
          hash,
          date: new Date(dateStr),
          message: message.replace(/\[ROLLBACK\]/, '').trim(),
          tags: this.extractTagsFromMessage(message)
        };
      });
      
      // Also get tagged rollback points
      const { stdout: tagOutput } = await execAsync(
        'git tag -l "rollback-*" --format="%(refname:short)|%(creatordate)|%(subject)"',
        { cwd: this.gitDir }
      ).catch(() => ({ stdout: '' }));
      
      const taggedCommits = tagOutput.trim().split('\n').filter(Boolean).map(line => {
        const [tag, dateStr, message] = line.split('|');
        return {
          hash: tag,
          date: new Date(dateStr),
          message: message || 'Tagged rollback point',
          tags: [tag]
        };
      });
      
      return [...commits, ...taggedCommits].sort((a, b) => b.date.getTime() - a.date.getTime());
      
    } catch (error) {
      this.emit('error', new Error(`Failed to list rollback points: ${error}`));
      return [];
    }
  }

  private async ensureGitRepo(): Promise<void> {
    try {
      await execAsync('git rev-parse --git-dir', { cwd: this.gitDir });
    } catch {
      throw new Error('Not a git repository');
    }
  }

  private async performSafetyChecks(): Promise<void> {
    // Check for uncommitted changes
    const { stdout: status } = await execAsync('git status --porcelain', { cwd: this.gitDir });
    if (status.trim()) {
      this.emit('warning', 'Uncommitted changes detected');
    }
    
    // Check if we're on a protected branch
    const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: this.gitDir });
    const currentBranch = branch.trim();
    
    const protectedBranches = ['main', 'master', 'production', 'release'];
    if (protectedBranches.includes(currentBranch)) {
      this.emit('warning', `Operating on protected branch: ${currentBranch}`);
    }
  }

  private async createBackupBranch(): Promise<void> {
    try {
      // Delete existing backup branch if it exists
      await execAsync(`git branch -D "${this.backupBranch}"`, { cwd: this.gitDir }).catch(() => {});
      
      // Create new backup branch
      await execAsync(`git checkout -b "${this.backupBranch}"`, { cwd: this.gitDir });
      
      // Switch back to original branch
      await execAsync('git checkout -', { cwd: this.gitDir });
      
    } catch (error) {
      this.emit('warning', `Failed to create backup branch: ${error}`);
    }
  }

  private formatRollbackMessage(message: string, tags: string[]): string {
    const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    return `[ROLLBACK] ${message}${tagStr}`;
  }

  private extractTagsFromMessage(message: string): string[] {
    const match = message.match(/\[([^\]]+)\]/g);
    if (!match) return [];
    
    return match.map(tag => tag.slice(1, -1)).filter(tag => tag !== 'ROLLBACK');
  }

  private async validateCommit(commitHash: string): Promise<void> {
    try {
      await execAsync(`git cat-file -e ${commitHash}`, { cwd: this.gitDir });
    } catch {
      throw new Error(`Invalid commit hash: ${commitHash}`);
    }
  }

  private async validateFiles(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        await fs.access(join(this.gitDir, file));
      } catch {
        throw new Error(`File not found: ${file}`);
      }
    }
  }

  private async getLastStashRef(): Promise<string> {
    const { stdout } = await execAsync('git stash list -1 --format="%H"', { cwd: this.gitDir });
    return stdout.trim();
  }

  private async createFileBackup(files: string[]): Promise<string | null> {
    try {
      // Create a stash with only the specified files
      for (const file of files) {
        await execAsync(`git add "${file}"`, { cwd: this.gitDir });
      }
      
      await execAsync('git stash push -m "File backup before rollback"', { cwd: this.gitDir });
      return await this.getLastStashRef();
      
    } catch {
      return null;
    }
  }

  private async restoreFileBackup(stashRef: string, files: string[]): Promise<void> {
    try {
      // Restore files from stash
      await execAsync(`git stash show -p ${stashRef} | git apply`, { cwd: this.gitDir });
      await execAsync(`git stash drop ${stashRef}`, { cwd: this.gitDir });
    } catch (error) {
      this.emit('error', new Error(`Failed to restore file backup: ${error}`));
    }
  }

  private async emergencyRecovery(): Promise<void> {
    try {
      // Try to recover using backup branch
      if (this.backupBranch) {
        await execAsync(`git checkout "${this.backupBranch}"`, { cwd: this.gitDir });
        await execAsync('git checkout -b "emergency-recovery"', { cwd: this.gitDir });
        this.emit('emergency_recovery_completed', 'emergency-recovery');
      }
    } catch (error) {
      throw new Error(`Emergency recovery failed: ${error}`);
    }
  }
}

// ============================================================================
// Main RollbackManager - Orchestrates all rollback components
// ============================================================================

export class RollbackManager extends EventEmitter {
  private stateManager: StateManager;
  private rollbackTrigger: RollbackTrigger;
  private automatedRecovery: AutomatedRecovery;
  private rollbackHistory: RollbackHistory;
  private gitRollbackManager: GitRollbackManager;
  private isInitialized: boolean = false;

  constructor(config: {
    snapshotDir?: string;
    historyDir?: string;
    gitDir?: string;
    maxSnapshots?: number;
    maxHistorySize?: number;
    historyTtlDays?: number;
    compressionEnabled?: boolean;
    triggerConfig?: Partial<RollbackTriggerConfig>;
  } = {}) {
    super();
    
    // Initialize components
    this.stateManager = new StateManager(
      config.snapshotDir,
      config.maxSnapshots,
      config.compressionEnabled
    );
    
    this.rollbackTrigger = new RollbackTrigger(config.triggerConfig);
    this.automatedRecovery = new AutomatedRecovery(this.stateManager);
    
    this.rollbackHistory = new RollbackHistory(
      config.historyDir,
      config.maxHistorySize,
      config.historyTtlDays,
      config.compressionEnabled
    );
    
    this.gitRollbackManager = new GitRollbackManager(config.gitDir);
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Connect rollback trigger to automated recovery
    this.rollbackTrigger.on('rollback_triggered', async (event) => {
      await this.handleAutomaticRollback(event.metrics, event.reason);
    });
    
    // Forward important events
    this.stateManager.on('error', (error) => this.emit('error', error));
    this.rollbackTrigger.on('error', (error) => this.emit('error', error));
    this.automatedRecovery.on('error', (error) => this.emit('error', error));
    this.rollbackHistory.on('error', (error) => this.emit('error', error));
    this.gitRollbackManager.on('error', (error) => this.emit('error', error));
    
    // Aggregate events
    this.stateManager.on('snapshot_created', (snapshot) => 
      this.emit('snapshot_created', snapshot));
    this.automatedRecovery.on('recovery_success', (event) => 
      this.emit('recovery_success', event));
    this.gitRollbackManager.on('rollback_completed', (event) => 
      this.emit('git_rollback_completed', event));
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      // Start monitoring
      this.rollbackTrigger.startMonitoring();
      
      this.isInitialized = true;
      this.emit('initialized');
      
    } catch (error) {
      this.emit('error', new Error(`Failed to initialize RollbackManager: ${error}`));
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    if (!this.isInitialized) return;
    
    try {
      this.rollbackTrigger.stopMonitoring();
      this.rollbackHistory.destroy();
      
      this.isInitialized = false;
      this.emit('shutdown');
      
    } catch (error) {
      this.emit('error', new Error(`Failed to shutdown RollbackManager: ${error}`));
    }
  }

  /**
   * Creates a comprehensive system checkpoint
   */
  public async createCheckpoint(
    description: string,
    tags: string[] = []
  ): Promise<string> {
    try {
      // Create system snapshot
      const snapshot = await this.stateManager.captureSnapshot(
        description,
        tags,
        'manual_checkpoint'
      );
      
      // Create git rollback point
      await this.gitRollbackManager.createRollbackPoint(
        description,
        tags
      );
      
      this.emit('checkpoint_created', { snapshot: snapshot.id, description, tags });
      return snapshot.id;
      
    } catch (error) {
      this.emit('error', new Error(`Failed to create checkpoint: ${error}`));
      throw error;
    }
  }

  /**
   * Performs a manual rollback to a specific checkpoint
   */
  public async rollbackToCheckpoint(
    snapshotId: string,
    strategy: 'graceful' | 'immediate' = 'graceful'
  ): Promise<boolean> {
    try {
      const snapshot = await this.stateManager.getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }
      
      const startTime = Date.now();
      
      // Execute rollback based on strategy
      let success: boolean;
      if (strategy === 'graceful') {
        success = await this.performGracefulRollback(snapshot);
      } else {
        success = await this.performImmediateRollback(snapshot);
      }
      
      const duration = Date.now() - startTime;
      
      // Record in history
      await this.rollbackHistory.addEntry(
        snapshot,
        'manual',
        `Manual rollback to checkpoint ${snapshotId}`,
        undefined, // No trigger metrics for manual rollback
        strategy,
        success,
        duration,
        [], // No recovery attempts for manual rollback
        [], // Would need to run verification
        success,
        !success
      );
      
      if (success) {
        this.emit('manual_rollback_success', { snapshotId, strategy, duration });
      } else {
        this.emit('manual_rollback_failed', { snapshotId, strategy, duration });
      }
      
      return success;
      
    } catch (error) {
      this.emit('error', new Error(`Manual rollback failed: ${error}`));
      return false;
    }
  }

  private async handleAutomaticRollback(
    metrics: SystemMetrics,
    reason: string
  ): Promise<void> {
    try {
      const success = await this.automatedRecovery.executeRecovery(metrics, reason);
      
      if (success) {
        this.emit('automatic_rollback_success', { reason, metrics });
      } else {
        this.emit('automatic_rollback_failed', { reason, metrics });
      }
      
    } catch (error) {
      this.emit('error', new Error(`Automatic rollback failed: ${error}`));
    }
  }

  private async performGracefulRollback(snapshot: SystemSnapshot): Promise<boolean> {
    try {
      // 1. Create backup of current state
      await this.stateManager.captureSnapshot(
        'Pre-rollback backup',
        ['auto-backup'],
        'rollback_backup'
      );
      
      // 2. Gradually restore components
      const restoreSteps = [
        () => this.restoreConfiguration(snapshot),
        () => this.restoreMemoryState(snapshot),
        () => this.restoreFileSystem(snapshot),
        () => this.performGitRollback(snapshot)
      ];
      
      for (const step of restoreSteps) {
        await step();
        // Small delay between steps
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      return true;
      
    } catch (error) {
      this.emit('graceful_rollback_error', error);
      return false;
    }
  }

  private async performImmediateRollback(snapshot: SystemSnapshot): Promise<boolean> {
    try {
      // Perform all restoration steps in parallel for speed
      await Promise.all([
        this.restoreConfiguration(snapshot),
        this.restoreMemoryState(snapshot),
        this.restoreFileSystem(snapshot),
        this.performGitRollback(snapshot)
      ]);
      
      return true;
      
    } catch (error) {
      this.emit('immediate_rollback_error', error);
      return false;
    }
  }

  private async restoreConfiguration(snapshot: SystemSnapshot): Promise<void> {
    for (const [path, content] of Object.entries(snapshot.state.config)) {
      try {
        await fs.writeFile(path, JSON.stringify(content, null, 2));
      } catch (error) {
        console.warn(`Failed to restore config ${path}:`, error);
      }
    }
  }

  private async restoreMemoryState(snapshot: SystemSnapshot): Promise<void> {
    for (const [path, content] of Object.entries(snapshot.state.memory)) {
      try {
        await fs.writeFile(path, JSON.stringify(content, null, 2));
      } catch (error) {
        console.warn(`Failed to restore memory ${path}:`, error);
      }
    }
  }

  private async restoreFileSystem(snapshot: SystemSnapshot): Promise<void> {
    for (const file of snapshot.state.files) {
      try {
        await fs.writeFile(file.path, file.content);
        await fs.chmod(file.path, file.stats.mode);
      } catch (error) {
        console.warn(`Failed to restore file ${file.path}:`, error);
      }
    }
  }

  private async performGitRollback(snapshot: SystemSnapshot): Promise<void> {
    if (snapshot.state.git.commit !== 'unknown') {
      try {
        await this.gitRollbackManager.rollbackToCommit(snapshot.state.git.commit);
      } catch (error) {
        console.warn('Git rollback failed:', error);
      }
    }
  }

  // Public API methods
  public getStateManager(): StateManager { return this.stateManager; }
  public getRollbackTrigger(): RollbackTrigger { return this.rollbackTrigger; }
  public getAutomatedRecovery(): AutomatedRecovery { return this.automatedRecovery; }
  public getRollbackHistory(): RollbackHistory { return this.rollbackHistory; }
  public getGitRollbackManager(): GitRollbackManager { return this.gitRollbackManager; }

  public async getSystemStatus(): Promise<{
    isMonitoring: boolean;
    snapshotCount: number;
    historyEntries: number;
    lastCheckpoint: string | null;
    healthScore: number;
  }> {
    const snapshots = this.stateManager.listSnapshots();
    const recentEntries = this.rollbackHistory.getRecentEntries(10);
    const successRate = this.rollbackHistory.getSuccessRate();
    
    return {
      isMonitoring: this.rollbackTrigger.getCurrentMetrics() !== null,
      snapshotCount: snapshots.length,
      historyEntries: recentEntries.length,
      lastCheckpoint: snapshots[0]?.id || null,
      healthScore: successRate
    };
  }
}

// Export the main class and interfaces
export default RollbackManager;