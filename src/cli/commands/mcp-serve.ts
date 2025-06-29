#!/usr/bin/env node
/**
 * MCP server entry point for Claude Code integration
 * This provides a stdio-based MCP server that Claude Code can connect to
 */

import { MCPServer } from '../../mcp/server.js';
import { EventBus } from '../../core/event-bus.js';
import { Logger } from '../../core/logger.js';
import { ConfigManager } from '../../config/config-manager.js';
import { Orchestrator } from '../../core/orchestrator.js';
import { SwarmCoordinator, SwarmConfig as SwarmCoordinatorConfig } from '../../coordination/swarm-coordinator.js';
import { AgentManager } from '../../agents/agent-manager.js';
import { ResourceManager } from '../../resources/resource-manager.js';
import { MessageBus } from '../../communication/message-bus.js';
import { RealTimeMonitor } from '../../monitoring/real-time-monitor.js';
import { MemoryManager } from '../../memory/manager.js';
import { DistributedMemorySystem } from '../../memory/distributed-memory.js';
import { StdioTransport } from '../../mcp/transports/stdio.js';
import { TerminalManager } from '../../terminal/manager.js';
import { CoordinationManager } from '../../coordination/manager.js';
import { SwarmConfig } from '../../swarm/types.js';

/**
 * Main function to start MCP server
 */
async function main() {
  // Initialize core components
  const eventBus = EventBus.getInstance();
  const logger = new Logger({
    level: (process.env['CLAUDE_FLOW_LOG_LEVEL'] || 'error') as 'debug' | 'info' | 'warn' | 'error',
    format: 'text',
    destination: 'console'
  });
  const configManager = ConfigManager.getInstance();
  
  try {
    // Load configuration
    await configManager.load('claude-flow.config.json').catch(() => {
      // Use defaults if config doesn't exist
      logger.info('Using default configuration');
    });
    
    const config = configManager.show();
    
    // Initialize orchestration components
    const memoryManager = new MemoryManager(config.memory, eventBus, logger);
    const distributedMemory = new DistributedMemorySystem({
      replicationFactor: 1,
      consistency: 'eventual',
      syncInterval: 5000,
      cacheTtl: 60000,
      compressionEnabled: false,
      encryptionEnabled: false
    }, logger, eventBus);
    
    // Create missing dependencies for Orchestrator
    const terminalManager = new TerminalManager(config.terminal, eventBus, logger);
    const coordinationManager = new CoordinationManager(
      config.coordination || { strategy: 'round-robin', maxConcurrentTasks: 10 },
      eventBus,
      logger
    );
    
    // MCPServer will be created later, but we need a placeholder
    const mcpServer = null as any; // Will be set after creation
    
    const orchestrator = new Orchestrator(
      config,
      terminalManager,
      memoryManager,
      coordinationManager,
      mcpServer,
      eventBus,
      logger
    );
    const swarmCoordinator = new SwarmCoordinator(
      config.swarm as Partial<SwarmCoordinatorConfig> || { 
        coordinationStrategy: 'centralized',
        maxAgents: 10,
        maxConcurrentTasks: 20,
        taskTimeout: 60000,
        enableMonitoring: true,
        enableWorkStealing: true,
        enableCircuitBreaker: true
      }
    );
    const agentManager = new AgentManager(
      config.orchestrator || {},
      logger,
      eventBus,
      distributedMemory
    );
    const resourceManager = new ResourceManager({}, logger, eventBus);
    const messageBus = new MessageBus({}, logger, eventBus);
    const monitor = new RealTimeMonitor(
      { 
        updateInterval: 1000,
        retentionPeriod: 86400000,
        alertingEnabled: true,
        alertThresholds: {
          cpu: { warning: 70, critical: 90 },
          memory: { warning: 75, critical: 85 },
          disk: { warning: 80, critical: 90 },
          errorRate: { warning: 5, critical: 10 },
          responseTime: { warning: 1000, critical: 3000 },
          queueDepth: { warning: 100, critical: 500 },
          agentHealth: { warning: 3, critical: 1 },
          swarmUtilization: { warning: 80, critical: 95 }
        },
        metricsEnabled: true,
        tracingEnabled: false,
        dashboardEnabled: false,
        exportEnabled: false,
        exportFormat: 'json',
        debugMode: false
      },
      logger,
      eventBus,
      distributedMemory
    );

    // Set memory manager on orchestrator
    (orchestrator as any).memoryManager = memoryManager;
    
    // Configure MCP for stdio transport
    const mcpConfig = {
      ...config.mcp,
      transport: 'stdio' as const,
      // Override any HTTP settings for stdio mode
      port: undefined,
      host: undefined,
      corsEnabled: false
    };

    // Create MCP server with full orchestration support
    const server = new MCPServer(
      mcpConfig,
      eventBus,
      logger,
      orchestrator,
      swarmCoordinator,
      agentManager,
      resourceManager,
      messageBus,
      monitor
    );

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down MCP server...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down MCP server...');
      await server.stop();
      process.exit(0);
    });

    // Start the server
    await server.start();
    logger.info('MCP server started in stdio mode');

    // Keep the process alive
    await new Promise(() => {});
    
  } catch (error) {
    logger.error('Failed to start MCP server', error);
    // Write error to stderr to avoid polluting stdio
    console.error(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: `Failed to start MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }));
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}