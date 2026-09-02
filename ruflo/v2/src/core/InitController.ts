/**
 * InitController - Main orchestration and mode selection
 * Handles the core initialization flow and coordinates with all other components
 */

import { ConfigManager } from './ConfigManager.js';
import { DatabaseManager } from './DatabaseManager.js';
import { ModeFactory } from './ModeFactory.js';
import { TopologyManager } from './TopologyManager.js';
import { AgentRegistry } from './AgentRegistry.js';
import { MetricsCollector } from './MetricsCollector.js';
import { IInitMode, InitConfig, InitResult, InitMode } from '../types/interfaces.js';

export interface InitControllerConfig {
  mode?: InitMode;
  topology?: 'mesh' | 'hierarchical' | 'ring' | 'star';
  maxAgents?: number;
  strategy?: 'balanced' | 'specialized' | 'adaptive';
  database?: 'sqlite' | 'json';
  configPath?: string;
  debug?: boolean;
}

export class InitController {
  private configManager: ConfigManager;
  private databaseManager: DatabaseManager;
  private modeFactory: ModeFactory;
  private topologyManager: TopologyManager;
  private agentRegistry: AgentRegistry;
  private metricsCollector: MetricsCollector;
  private initialized: boolean = false;

  constructor(private config: InitControllerConfig = {}) {
    this.configManager = new ConfigManager(config.configPath);
    this.databaseManager = new DatabaseManager(config.database || 'sqlite');
    this.modeFactory = new ModeFactory();
    this.topologyManager = new TopologyManager(this.databaseManager);
    this.agentRegistry = new AgentRegistry(this.databaseManager);
    this.metricsCollector = new MetricsCollector(this.databaseManager);
  }

  /**
   * Main initialization method - orchestrates the entire init process
   */
  async initialize(): Promise<InitResult> {
    const startTime = Date.now();

    try {
      // Validate and load configuration
      const validationResult = await this.configManager.validate();
      if (!validationResult.valid) {
        throw new Error(`Configuration validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Initialize database
      await this.databaseManager.initialize();

      // Set up topology
      await this.topologyManager.configure(this.config.topology || 'mesh');

      // Initialize agent registry
      await this.agentRegistry.initialize();

      // Create and execute the specific initialization mode
      const mode = this.modeFactory.createMode(this.config.mode || 'standard');
      const initConfig: InitConfig = {
        ...this.config,
        configManager: this.configManager,
        databaseManager: this.databaseManager,
        topologyManager: this.topologyManager,
        agentRegistry: this.agentRegistry,
        metricsCollector: this.metricsCollector
      };

      const result = await mode.initialize(initConfig);

      // Collect initialization metrics
      const endTime = Date.now();
      await this.metricsCollector.recordInitialization({
        mode: this.config.mode || 'standard',
        duration: endTime - startTime,
        success: true,
        components: result.components || [],
        timestamp: new Date().toISOString()
      });

      this.initialized = true;

      return {
        success: true,
        mode: this.config.mode || 'standard',
        components: result.components,
        topology: this.config.topology || 'mesh',
        duration: endTime - startTime,
        message: result.message || 'Initialization completed successfully',
        metadata: {
          configValid: true,
          databaseInitialized: true,
          topologyConfigured: true,
          agentRegistryReady: true,
          ...result.metadata
        }
      };

    } catch (error) {
      const endTime = Date.now();
      await this.metricsCollector.recordInitialization({
        mode: this.config.mode || 'standard',
        duration: endTime - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });

      return {
        success: false,
        mode: this.config.mode || 'standard',
        duration: endTime - startTime,
        error: error instanceof Error ? error.message : String(error),
        message: 'Initialization failed'
      };
    }
  }

  /**
   * Get current initialization status
   */
  getStatus(): { initialized: boolean; mode?: InitMode; components?: string[] } {
    return {
      initialized: this.initialized,
      mode: this.config.mode,
      components: this.initialized ? ['ConfigManager', 'DatabaseManager', 'TopologyManager', 'AgentRegistry'] : []
    };
  }

  /**
   * Shutdown and cleanup resources
   */
  async shutdown(): Promise<void> {
    if (this.databaseManager) {
      await this.databaseManager.close();
    }
    this.initialized = false;
  }

  /**
   * Validate the current configuration
   */
  async validateConfiguration(): Promise<{ valid: boolean; errors: string[] }> {
    return await this.configManager.validate();
  }

  /**
   * Get available initialization modes
   */
  getAvailableModes(): InitMode[] {
    return this.modeFactory.getAvailableModes();
  }

  /**
   * Get topology information
   */
  async getTopologyInfo(): Promise<any> {
    return await this.topologyManager.getTopologyInfo();
  }

  /**
   * Get registered agents
   */
  async getAgents(): Promise<any[]> {
    return await this.agentRegistry.getActiveAgents();
  }

  /**
   * Get initialization metrics
   */
  async getMetrics(): Promise<any> {
    return await this.metricsCollector.getInitializationMetrics();
  }
}