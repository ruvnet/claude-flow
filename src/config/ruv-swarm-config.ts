import { getErrorMessage } from '../utils/error-handler.js';
/**
 * ruv-swarm configuration management for Claude Code integration
 * 
 * This module handles configuration settings for ruv-swarm integration,
 * including topology preferences, agent limits, and coordination patterns.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ILogger } from '../core/logger.js';
import { deepMerge } from '../utils/helpers.js';

/**
 * ruv-swarm integration configuration
 */
export interface RuvSwarmConfig {
  // Core swarm settings
  swarm: {
    defaultTopology: 'mesh' | 'hierarchical' | 'ring' | 'star';
    maxAgents: number;
    defaultStrategy: 'balanced' | 'specialized' | 'adaptive';
    autoInit: boolean;
    enableHooks: boolean;
  };
  
  // Agent configuration
  agents: {
    defaultCapabilities: string[];
    spawnTimeout: number;
    heartbeatInterval: number;
    maxRetries: number;
  };
  
  // Task orchestration
  tasks: {
    defaultStrategy: 'parallel' | 'sequential' | 'adaptive';
    defaultPriority: 'low' | 'medium' | 'high' | 'critical';
    timeout: number;
    enableMonitoring: boolean;
  };
  
  // Memory and persistence
  memory: {
    enablePersistence: boolean;
    compressionLevel: number;
    ttl: number;
    maxSize: number;
  };
  
  // Neural capabilities
  neural: {
    enableTraining: boolean;
    patterns: string[];
    learningRate: number;
    trainingIterations: number;
  };
  
  // Performance monitoring
  monitoring: {
    enableMetrics: boolean;
    metricsInterval: number;
    enableAlerts: boolean;
    alertThresholds: {
      cpu: number;
      memory: number;
      taskFailureRate: number;
    };
  };
  
  // Integration settings
  integration: {
    enableMCPTools: boolean;
    enableCLICommands: boolean;
    enableHooks: boolean;
    workingDirectory?: string;
    sessionTimeout: number;
  };
}

/**
 * Default ruv-swarm configuration
 */
export const defaultRuvSwarmConfig: RuvSwarmConfig = {
  swarm: {
    defaultTopology: 'mesh',
    maxAgents: 8,
    defaultStrategy: 'adaptive',
    autoInit: true,
    enableHooks: true
  },
  
  agents: {
    defaultCapabilities: ['filesystem', 'search', 'memory', 'coordination'],
    spawnTimeout: 30000,
    heartbeatInterval: 5000,
    maxRetries: 3
  },
  
  tasks: {
    defaultStrategy: 'adaptive',
    defaultPriority: 'medium',
    timeout: 300000, // 5 minutes
    enableMonitoring: true
  },
  
  memory: {
    enablePersistence: true,
    compressionLevel: 6,
    ttl: 86400000, // 24 hours
    maxSize: 100 * 1024 * 1024 // 100MB
  },
  
  neural: {
    enableTraining: true,
    patterns: ['convergent', 'divergent', 'lateral', 'systems'],
    learningRate: 0.1,
    trainingIterations: 10
  },
  
  monitoring: {
    enableMetrics: true,
    metricsInterval: 10000,
    enableAlerts: true,
    alertThresholds: {
      cpu: 80,
      memory: 85,
      taskFailureRate: 20
    }
  },
  
  integration: {
    enableMCPTools: true,
    enableCLICommands: true,
    enableHooks: true,
    sessionTimeout: 3600000 // 1 hour
  }
};

/**
 * ruv-swarm configuration manager
 */
export class RuvSwarmConfigManager {
  private config: RuvSwarmConfig;
  private configPath: string;
  
  constructor(
    private logger: ILogger,
    configPath?: string
  ) {
    this.configPath = configPath || join(process.cwd(), '.claude', 'ruv-swarm-config.json');
    this.config = this.loadConfig();
  }
  
  /**
   * Load configuration from file or use defaults
   */
  private loadConfig(): RuvSwarmConfig {
    try {
      if (existsSync(this.configPath)) {
        const configData = readFileSync(this.configPath, 'utf-8');
        const userConfig = JSON.parse(configData) as Partial<RuvSwarmConfig>;
        
        // Merge with defaults
        const mergedConfig = deepMerge(defaultRuvSwarmConfig as any, userConfig as any) as RuvSwarmConfig;
        
        this.logger.debug('Loaded ruv-swarm config from file', { 
          path: this.configPath,
          config: mergedConfig 
        });
        
        return mergedConfig;
      }
    } catch (error) {
      this.logger.warn('Failed to load ruv-swarm config, using defaults', { 
        error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : error 
      });
    }
    
    this.logger.debug('Using default ruv-swarm config');
    return { ...defaultRuvSwarmConfig };
  }
  
  /**
   * Save configuration to file
   */
  saveConfig(): void {
    try {
      const configDir = join(this.configPath, '..');
      
      // Ensure config directory exists
      if (!existsSync(configDir)) {
        const fs = require('fs');
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      
      this.logger.debug('Saved ruv-swarm config to file', { path: this.configPath });
    } catch (error) {
      this.logger.error('Failed to save ruv-swarm config', { 
        error: error instanceof Error ? (error instanceof Error ? error.message : String(error)) : error 
      });
    }
  }
  
  /**
   * Get current configuration
   */
  getConfig(): RuvSwarmConfig {
    return { ...this.config };
  }
  
  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RuvSwarmConfig>): void {
    this.config = deepMerge(this.config as any, updates as any) as RuvSwarmConfig;
    this.saveConfig();
    
    this.logger.info('Updated ruv-swarm config', { updates });
  }
  
  /**
   * Reset configuration to defaults
   */
  resetConfig(): void {
    this.config = { ...defaultRuvSwarmConfig };
    this.saveConfig();
    
    this.logger.info('Reset ruv-swarm config to defaults');
  }
  
  /**
   * Get specific configuration section
   */
  getSwarmConfig() { return this.config.swarm; }
  getAgentsConfig() { return this.config.agents; }
  getTasksConfig() { return this.config.tasks; }
  getMemoryConfig() { return this.config.memory; }
  getNeuralConfig() { return this.config.neural; }
  getMonitoringConfig() { return this.config.monitoring; }
  getIntegrationConfig() { return this.config.integration; }
  
  /**
   * Update specific configuration section
   */
  updateSwarmConfig(updates: Partial<RuvSwarmConfig['swarm']>): void {
    this.updateConfig({ swarm: { ...this.config.swarm, ...updates } });
  }
  
  updateAgentsConfig(updates: Partial<RuvSwarmConfig['agents']>): void {
    this.updateConfig({ agents: { ...this.config.agents, ...updates } });
  }
  
  updateTasksConfig(updates: Partial<RuvSwarmConfig['tasks']>): void {
    this.updateConfig({ tasks: { ...this.config.tasks, ...updates } });
  }
  
  updateMemoryConfig(updates: Partial<RuvSwarmConfig['memory']>): void {
    this.updateConfig({ memory: { ...this.config.memory, ...updates } });
  }
  
  updateNeuralConfig(updates: Partial<RuvSwarmConfig['neural']>): void {
    this.updateConfig({ neural: { ...this.config.neural, ...updates } });
  }
  
  updateMonitoringConfig(updates: Partial<RuvSwarmConfig['monitoring']>): void {
    this.updateConfig({ monitoring: { ...this.config.monitoring, ...updates } });
  }
  
  updateIntegrationConfig(updates: Partial<RuvSwarmConfig['integration']>): void {
    this.updateConfig({ integration: { ...this.config.integration, ...updates } });
  }
  
  /**
   * Validate configuration
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Validate swarm settings
    if (this.config.swarm.maxAgents < 1 || this.config.swarm.maxAgents > 100) {
      errors.push('swarm.maxAgents must be between 1 and 100');
    }
    
    // Validate agent settings
    if (this.config.agents.spawnTimeout < 1000) {
      errors.push('agents.spawnTimeout must be at least 1000ms');
    }
    
    if (this.config.agents.heartbeatInterval < 1000) {
      errors.push('agents.heartbeatInterval must be at least 1000ms');
    }
    
    // Validate task settings
    if (this.config.tasks.timeout < 10000) {
      errors.push('tasks.timeout must be at least 10000ms');
    }
    
    // Validate memory settings
    if (this.config.memory.maxSize < 1024 * 1024) { // 1MB minimum
      errors.push('memory.maxSize must be at least 1MB');
    }
    
    if (this.config.memory.compressionLevel < 0 || this.config.memory.compressionLevel > 9) {
      errors.push('memory.compressionLevel must be between 0 and 9');
    }
    
    // Validate neural settings
    if (this.config.neural.learningRate <= 0 || this.config.neural.learningRate > 1) {
      errors.push('neural.learningRate must be between 0 and 1');
    }
    
    if (this.config.neural.trainingIterations < 1) {
      errors.push('neural.trainingIterations must be at least 1');
    }
    
    // Validate monitoring settings
    const { alertThresholds } = this.config.monitoring;
    if (alertThresholds.cpu < 0 || alertThresholds.cpu > 100) {
      errors.push('monitoring.alertThresholds.cpu must be between 0 and 100');
    }
    
    if (alertThresholds.memory < 0 || alertThresholds.memory > 100) {
      errors.push('monitoring.alertThresholds.memory must be between 0 and 100');
    }
    
    if (alertThresholds.taskFailureRate < 0 || alertThresholds.taskFailureRate > 100) {
      errors.push('monitoring.alertThresholds.taskFailureRate must be between 0 and 100');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Get configuration as command-line arguments for ruv-swarm
   */
  getCommandArgs(): string[] {
    const args: string[] = [];
    
    // Add swarm configuration
    args.push('--topology', this.config.swarm.defaultTopology);
    args.push('--max-agents', String(this.config.swarm.maxAgents));
    args.push('--strategy', this.config.swarm.defaultStrategy);
    
    if (this.config.swarm.enableHooks) {
      args.push('--enable-hooks');
    }
    
    // Add task configuration
    args.push('--task-strategy', this.config.tasks.defaultStrategy);
    args.push('--task-priority', this.config.tasks.defaultPriority);
    args.push('--task-timeout', String(this.config.tasks.timeout));
    
    if (this.config.tasks.enableMonitoring) {
      args.push('--enable-monitoring');
    }
    
    // Add memory configuration
    if (this.config.memory.enablePersistence) {
      args.push('--enable-persistence');
      args.push('--compression-level', String(this.config.memory.compressionLevel));
      args.push('--memory-ttl', String(this.config.memory.ttl));
    }
    
    // Add neural configuration
    if (this.config.neural.enableTraining) {
      args.push('--enable-training');
      args.push('--learning-rate', String(this.config.neural.learningRate));
      args.push('--training-iterations', String(this.config.neural.trainingIterations));
    }
    
    return args;
  }
}

/**
 * Create or get singleton instance of ruv-swarm config manager
 */
let configManagerInstance: RuvSwarmConfigManager | null = null;

export function getRuvSwarmConfigManager(logger: ILogger, configPath?: string): RuvSwarmConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new RuvSwarmConfigManager(logger, configPath);
  }
  return configManagerInstance;
}

export default {
  RuvSwarmConfigManager,
  getRuvSwarmConfigManager,
  defaultRuvSwarmConfig
};