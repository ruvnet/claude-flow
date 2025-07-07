import { getErrorMessage } from '../utils/error-handler.js';
/**
 * ruv-swarm integration helper for Claude Code configuration
 * 
 * This module bridges the main claude-flow configuration with
 * ruv-swarm specific settings and provides utility functions
 * for seamless integration.
 */

import { configManager, ConfigManager } from './config-manager.js';
import { getRuvSwarmConfigManager, RuvSwarmConfigManager } from './ruv-swarm-config.js';
import { Logger } from '../core/logger.js';

// Create logger for integration
const logger = new Logger({ level: 'info', format: 'text', destination: 'console' });

/**
 * Integration manager that synchronizes configurations
 */
export class RuvSwarmIntegration {
  private configManager: ConfigManager;
  private ruvSwarmManager: RuvSwarmConfigManager;

  constructor(configManager: ConfigManager, ruvSwarmManager: RuvSwarmConfigManager) {
    this.configManager = configManager;
    this.ruvSwarmManager = ruvSwarmManager;
  }

  /**
   * Synchronize main config with ruv-swarm config
   */
  syncConfiguration(): void {
    const mainConfig = this.configManager.getRuvSwarmConfig();
    const ruvSwarmConfig = this.ruvSwarmManager.getConfig();

    // Update ruv-swarm config from main config
    if (mainConfig.enabled) {
      this.ruvSwarmManager.updateSwarmConfig({
        defaultTopology: mainConfig.defaultTopology,
        maxAgents: mainConfig.maxAgents,
        defaultStrategy: mainConfig.defaultStrategy,
        enableHooks: mainConfig.enableHooks
      });

      this.ruvSwarmManager.updateIntegrationConfig({
        enableMCPTools: true,
        enableCLICommands: true,
        enableHooks: mainConfig.enableHooks
      });

      this.ruvSwarmManager.updateMemoryConfig({
        enablePersistence: mainConfig.enablePersistence
      });

      this.ruvSwarmManager.updateNeuralConfig({
        enableTraining: mainConfig.enableNeuralTraining
      });
    }

    // logger.debug('Configuration synchronized between main and ruv-swarm configs');
  }

  /**
   * Get unified command arguments for ruv-swarm CLI
   */
  getUnifiedCommandArgs(): string[] {
    const mainArgs = this.configManager.getRuvSwarmArgs();
    const ruvSwarmArgs = this.ruvSwarmManager.getCommandArgs();

    // Main config takes precedence, then ruv-swarm specific
    const unified = [...mainArgs];
    
    // Add ruv-swarm specific args that aren't in main config
    for (let i = 0; i < ruvSwarmArgs.length; i += 2) {
      const flag = ruvSwarmArgs[i];
      const value = ruvSwarmArgs[i + 1];
      
      // Skip if already set by main config
      if (!unified.includes(flag)) {
        unified.push(flag, value);
      }
    }

    return unified;
  }

  /**
   * Initialize ruv-swarm integration
   */
  async initialize(): Promise<{ success: boolean; message: string }> {
    try {
      // Check if ruv-swarm is enabled in main config
      if (!this.configManager.isRuvSwarmEnabled()) {
        return {
          success: false,
          message: 'ruv-swarm is disabled in main configuration'
        };
      }

      // Sync configurations
      this.syncConfiguration();

      // Validate configurations
      const mainValidation = this.validateMainConfig();
      if (!mainValidation.valid) {
        return {
          success: false,
          message: `Main config validation failed: ${mainValidation.errors.join(', ')}`
        };
      }

      const ruvSwarmValidation = this.ruvSwarmManager.validateConfig();
      if (!ruvSwarmValidation.valid) {
        return {
          success: false,
          message: `ruv-swarm config validation failed: ${ruvSwarmValidation.errors.join(', ')}`
        };
      }

      // logger.info('ruv-swarm integration initialized successfully');
      
      return {
        success: true,
        message: 'ruv-swarm integration initialized and configured'
      };

    } catch (error) {
      const message = `Failed to initialize ruv-swarm integration: ${(error as Error).message}`;
      // logger.error(message, { error });
      
      return {
        success: false,
        message
      };
    }
  }

  /**
   * Validate main configuration for ruv-swarm compatibility
   */
  private validateMainConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const ruvSwarmConfig = this.configManager.getRuvSwarmConfig();

    // Check required fields
    if (!ruvSwarmConfig.defaultTopology) {
      errors.push('ruvSwarm.defaultTopology is required');
    }

    if (ruvSwarmConfig.maxAgents <= 0) {
      errors.push('ruvSwarm.maxAgents must be greater than 0');
    }

    if (!ruvSwarmConfig.defaultStrategy) {
      errors.push('ruvSwarm.defaultStrategy is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get current integration status
   */
  getStatus(): {
    enabled: boolean;
    mainConfig: any;
    ruvSwarmConfig: any;
    synchronized: boolean;
  } {
    const mainConfig = this.configManager.getRuvSwarmConfig();
    const ruvSwarmConfig = this.ruvSwarmManager.getConfig();

    return {
      enabled: mainConfig.enabled,
      mainConfig,
      ruvSwarmConfig,
      synchronized: this.isConfigurationSynchronized()
    };
  }

  /**
   * Check if configurations are synchronized
   */
  private isConfigurationSynchronized(): boolean {
    const mainConfig = this.configManager.getRuvSwarmConfig();
    const ruvSwarmConfig = this.ruvSwarmManager.getConfig();

    return (
      ruvSwarmConfig.swarm.defaultTopology === mainConfig.defaultTopology &&
      ruvSwarmConfig.swarm.maxAgents === mainConfig.maxAgents &&
      ruvSwarmConfig.swarm.defaultStrategy === mainConfig.defaultStrategy &&
      ruvSwarmConfig.swarm.enableHooks === mainConfig.enableHooks &&
      ruvSwarmConfig.memory.enablePersistence === mainConfig.enablePersistence &&
      ruvSwarmConfig.neural.enableTraining === mainConfig.enableNeuralTraining
    );
  }

  /**
   * Update configuration and sync
   */
  updateConfiguration(updates: {
    main?: Partial<Parameters<ConfigManager['setRuvSwarmConfig']>[0]>;
    ruvSwarm?: Partial<Parameters<RuvSwarmConfigManager['updateConfig']>[0]>;
  }): void {
    if (updates.main) {
      this.configManager.setRuvSwarmConfig(updates.main);
    }

    if (updates.ruvSwarm) {
      this.ruvSwarmManager.updateConfig(updates.ruvSwarm);
    }

    // Re-sync after updates
    this.syncConfiguration();
  }
}

/**
 * Create singleton integration instance
 */
let integrationInstance: RuvSwarmIntegration | null = null;

export function getRuvSwarmIntegration(): RuvSwarmIntegration {
  if (!integrationInstance) {
    const ruvSwarmManager = getRuvSwarmConfigManager(logger);
    integrationInstance = new RuvSwarmIntegration(configManager, ruvSwarmManager);
  }
  return integrationInstance;
}

/**
 * Initialize ruv-swarm integration with claude-flow
 */
export async function initializeRuvSwarmIntegration(): Promise<{ success: boolean; message: string }> {
  const integration = getRuvSwarmIntegration();
  return integration.initialize();
}

/**
 * Helper functions for CLI commands
 */
export class RuvSwarmConfigHelpers {
  
  /**
   * Quick setup for development environment
   */
  static setupDevelopmentConfig(): void {
    const integration = getRuvSwarmIntegration();
    
    integration.updateConfiguration({
      main: {
        enabled: true,
        defaultTopology: 'hierarchical',
        maxAgents: 8,
        defaultStrategy: 'specialized',
        autoInit: true,
        enableHooks: true,
        enablePersistence: true,
        enableNeuralTraining: true
      }
    });

    // logger.info('Development configuration applied');
  }

  /**
   * Quick setup for research environment
   */
  static setupResearchConfig(): void {
    const integration = getRuvSwarmIntegration();
    
    integration.updateConfiguration({
      main: {
        enabled: true,
        defaultTopology: 'mesh',
        maxAgents: 12,
        defaultStrategy: 'adaptive',
        autoInit: true,
        enableHooks: true,
        enablePersistence: true,
        enableNeuralTraining: true
      }
    });

    // logger.info('Research configuration applied');
  }

  /**
   * Quick setup for production environment
   */
  static setupProductionConfig(): void {
    const integration = getRuvSwarmIntegration();
    
    integration.updateConfiguration({
      main: {
        enabled: true,
        defaultTopology: 'star',
        maxAgents: 6,
        defaultStrategy: 'balanced',
        autoInit: false,
        enableHooks: true,
        enablePersistence: true,
        enableNeuralTraining: false
      }
    });

    // logger.info('Production configuration applied');
  }

  /**
   * Get configuration for specific use case
   */
  static getConfigForUseCase(useCase: 'development' | 'research' | 'production'): any {
    const integration = getRuvSwarmIntegration();
    
    switch (useCase) {
      case 'development':
        return {
          topology: 'hierarchical',
          maxAgents: 8,
          strategy: 'specialized',
          features: ['hooks', 'persistence', 'neural-training']
        };
      
      case 'research':
        return {
          topology: 'mesh',
          maxAgents: 12,
          strategy: 'adaptive',
          features: ['hooks', 'persistence', 'neural-training', 'advanced-metrics']
        };
        
      case 'production':
        return {
          topology: 'star',
          maxAgents: 6,
          strategy: 'balanced',
          features: ['hooks', 'persistence']
        };
        
      default:
        return integration.getStatus().mainConfig;
    }
  }
}

export default {
  RuvSwarmIntegration,
  getRuvSwarmIntegration,
  initializeRuvSwarmIntegration,
  RuvSwarmConfigHelpers
};