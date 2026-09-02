/**
 * StandardInit - Standard initialization mode
 * Basic initialization with minimal configuration
 */

import { IInitMode, InitConfig, InitResult } from '../types/interfaces.js';

export class StandardInit implements IInitMode {
  getDescription(): string {
    return 'Standard initialization mode with basic agent coordination and mesh topology';
  }

  getRequiredComponents(): string[] {
    return ['ConfigManager', 'DatabaseManager', 'TopologyManager', 'AgentRegistry'];
  }

  validate(): boolean {
    return true; // Standard mode is always valid
  }

  async initialize(config: InitConfig): Promise<InitResult> {
    const components: string[] = [];

    try {
      // Set up basic configuration
      if (config.configManager) {
        components.push('ConfigManager');
      }

      // Initialize database
      if (config.databaseManager) {
        await config.databaseManager.initialize();
        components.push('DatabaseManager');
      }

      // Configure mesh topology (default)
      if (config.topologyManager) {
        await config.topologyManager.configure('mesh', []);
        components.push('TopologyManager');
      }

      // Initialize agent registry
      if (config.agentRegistry) {
        await config.agentRegistry.initialize();
        components.push('AgentRegistry');
      }

      // Spawn default agents
      if (config.agentRegistry) {
        await config.agentRegistry.spawn('coordinator', { capabilities: ['coordination', 'task-management'] });
        await config.agentRegistry.spawn('researcher', { capabilities: ['research', 'analysis'] });
        await config.agentRegistry.spawn('coder', { capabilities: ['programming', 'debugging'] });
        components.push('DefaultAgents');
      }

      return {
        success: true,
        mode: 'standard',
        components,
        topology: 'mesh',
        message: 'Standard initialization completed successfully'
      };

    } catch (error) {
      return {
        success: false,
        mode: 'standard',
        components,
        error: error instanceof Error ? error.message : String(error),
        message: 'Standard initialization failed'
      };
    }
  }
}