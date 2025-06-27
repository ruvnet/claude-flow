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
import { SwarmCoordinator } from '../../coordination/swarm-coordinator.js';
import { AgentManager } from '../../agents/agent-manager.js';
import { ResourceManager } from '../../resources/resource-manager.js';
import { MessageBus } from '../../communication/message-bus.js';
import { RealTimeMonitor } from '../../monitoring/real-time-monitor.js';
import { MemoryManager } from '../../memory/manager.js';
import { StdioTransport } from '../../mcp/transports/stdio.js';

/**
 * Main function to start MCP server
 */
async function main() {
  // Initialize core components
  const eventBus = EventBus.getInstance();
  const logger = new Logger({
    level: (process.env.CLAUDE_FLOW_LOG_LEVEL || 'error') as 'debug' | 'info' | 'warn' | 'error',
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
    const orchestrator = new Orchestrator(config, eventBus, logger);
    const swarmCoordinator = new SwarmCoordinator(
      config.swarm || { coordinationMode: 'centralized', consensusThreshold: 0.7, enableMetrics: true },
      logger,
      eventBus
    );
    const agentManager = new AgentManager(
      config.orchestrator || {},
      logger,
      eventBus,
      memoryManager
    );
    const resourceManager = new ResourceManager(eventBus, logger);
    const messageBus = new MessageBus(logger, eventBus);
    const monitor = new RealTimeMonitor(
      { enableWebUI: false, webPort: 3001, refreshInterval: 1000 },
      logger,
      eventBus
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