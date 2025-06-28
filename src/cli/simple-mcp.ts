/**
 * Simple MCP command implementation for Node.js compatibility
 */

import { Command } from 'commander';
import http from 'http';
import { createDefaultLoggingConfig } from '../types/unified-cli.js';

function printSuccess(message: string) {
  console.log(`✅ ${message}`);
}

function printError(message: string) {
  console.error(`❌ Error: ${message}`);
}

// Check if MCP server is running
async function checkMCPStatus(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const options = {
      hostname: host,
      port: port,
      path: '/health',
      method: 'GET',
      timeout: 2000
    };

    const req = http.request(options, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 404);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

export function createMCPCommand() {
  const mcpCmd = new Command('mcp')
    .description('Manage MCP server and tools')
    .action(() => {
      printSuccess('MCP Server Management');
      console.log('\n🌐 Available MCP commands:');
      console.log('  • mcp start - Start MCP server (stdio mode for Claude Code)');
      console.log('  • mcp start --http - Start MCP server in HTTP mode');
      console.log('  • mcp status - Show MCP server status');
      console.log('  • mcp tools - List available MCP tools');
      console.log('  • mcp stop - Stop the MCP server');
      console.log('\n💡 Use "mcp start --http --port 3001" for HTTP mode on different port');
    });

  mcpCmd
    .command('start')
    .description('Start the MCP server (stdio by default, use --http for HTTP transport)')
    .option('--port <port>', 'Port for MCP server (HTTP mode only)', '3000')
    .option('--host <host>', 'Host for MCP server (HTTP mode only)', 'localhost')
    .option('--http', 'Use HTTP transport instead of stdio')
    .option('--verbose', 'Enable verbose logging to stderr')
    .action(async (options) => {
      // Default to stdio mode (same as serve)
      if (!options.http) {
        // Use the dedicated stdio server (exact same as serve command)
        const { spawn } = await import('child_process');
        const serverPath = '/workspaces/claude-code-flow/src/cli/mcp-stdio-server.ts';
        
        const child = spawn('npx', ['tsx', serverPath], {
          stdio: 'inherit',
          env: {
            ...process.env,
            NODE_ENV: 'production'
          }
        });
        
        child.on('error', (err) => {
          console.error('Failed to start MCP stdio server:', err);
          process.exit(1);
        });
        
        child.on('exit', (code) => {
          process.exit(code || 0);
        });
        
        return; // Exit early for stdio
      }
      
      // HTTP mode - original code follows...
      try {
        const { MCPServer } = await import('../mcp/server.js');
        const { EventBus } = await import('../core/event-bus.js');
        const { Logger } = await import('../core/logger.js');
        const { ConfigManager } = await import('../config/config-manager.js');
        
        const eventBus = EventBus.getInstance();
        const logger = new Logger(createDefaultLoggingConfig({ level: 'info' }));
        const configManager = ConfigManager.getInstance();
        
        try {
          await configManager.load('claude-flow.config.json');
        } catch (error) {
          // Use defaults if config file doesn't exist
          console.log('⚠️  Warning: Using default configuration');
        }
        const config = configManager.show();
        
        const mcpConfig = {
          ...config.mcp,
          port: parseInt(options.port),
          host: options.host,
          transport: options.transport as 'http' | 'stdio',
          corsEnabled: true,
          corsOrigins: ['*']
        };

        const server = new MCPServer(mcpConfig, eventBus, logger);
        await server.start();

        printSuccess(`MCP server started on ${options.host}:${options.port}`);
        console.log(`📡 Server URL: http://${options.host}:${options.port}`);
        console.log(`🔧 Transport: ${options.transport}`);
        console.log(`🔧 Available tools: System, Tools`);
        console.log('\n💡 Press Ctrl+C to stop the server');
        
        // Keep process alive
        process.on('SIGINT', async () => {
          console.log('\n⏹️  Stopping MCP server...');
          await server.stop();
          process.exit(0);
        });
        
        // Prevent CLI from exiting
        await new Promise(() => {}); // Keep running
      } catch (error) {
        printError(`Failed to start MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  mcpCmd
    .command('status')
    .description('Show MCP server status')
    .option('--port <port>', 'Port to check', '3000')
    .option('--host <host>', 'Host to check', 'localhost')
    .action(async (options) => {
      printSuccess('MCP Server Status:');
      
      const host = options.host || 'localhost';
      const port = parseInt(options.port) || 3000;
      
      // Check if server is actually running
      const isRunning = await checkMCPStatus(host, port);
      
      if (isRunning) {
        console.log('🟢 Status: Running');
        console.log(`📍 Address: ${host}:${port}`);
        console.log('🔐 Authentication: Disabled');
        console.log('🔧 Tools: System, Health, Tools');
        console.log('📡 Transport: http');
        console.log('\n💡 Use "mcp tools" to see available tools');
      } else {
        console.log('🟡 Status: Not running (use "mcp start" to start)');
        console.log(`📍 Checked address: ${host}:${port}`);
        console.log('🔐 Authentication: Disabled');
        console.log('🔧 Tools: System, Health, Tools (when running)');
      }
    });

  mcpCmd
    .command('tools')
    .description('List available MCP tools')
    .action(() => {
      printSuccess('Available MCP Tools:');
      console.log('\n📊 System Tools:');
      console.log('  • system/info - Get system information');
      console.log('  • system/health - Get system health status');
      console.log('\n🔧 Tool Management:');
      console.log('  • tools/list - List all available tools');
      console.log('  • tools/schema - Get schema for a specific tool');
      console.log('\n💡 Note: Additional tools available when orchestrator is running');
    });

  mcpCmd
    .command('stop')
    .description('Stop the MCP server')
    .action(() => {
      printSuccess('Stopping MCP server...');
      console.log('🛑 MCP server stop requested');
      console.log('💡 Use Ctrl+C in the terminal running "mcp start" to stop');
    });

  mcpCmd
    .command('serve')
    .description('Start MCP server in stdio mode for Claude Code')
    .option('--verbose', 'Enable verbose logging to stderr')
    .action(async (options) => {
      // Use the dedicated stdio server
      const { spawn } = await import('child_process');
      const serverPath = '/workspaces/claude-code-flow/src/cli/mcp-stdio-server.ts';
      
      const child = spawn('npx', ['tsx', serverPath], {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'production'
        }
      });
      
      child.on('error', (err) => {
        console.error('Failed to start MCP stdio server:', err);
        process.exit(1);
      });
      
      child.on('exit', (code) => {
        process.exit(code || 0);
      });
    });

  mcpCmd
    .command('serve-old')
    .description('Start MCP server in stdio mode (legacy)')
    .option('--verbose', 'Enable verbose logging to stderr')
    .action(async (options) => {
      try {
        const { MCPServer } = await import('../mcp/server.js');
        const { EventBus } = await import('../core/event-bus.js');
        const { Logger } = await import('../core/logger.js');
        const { ConfigManager } = await import('../config/config-manager.js');
        const { StdioTransport } = await import('../mcp/transports/stdio.js');
        
        const eventBus = EventBus.getInstance();
        const logger = new Logger(createDefaultLoggingConfig({ level: 'info' }));
        const configManager = ConfigManager.getInstance();
        
        // Configure logger to use stderr for logs to avoid polluting stdio
        if (!options.verbose) {
          await logger.configure(createDefaultLoggingConfig({ level: 'error' }));
        }
        
        try {
          await configManager.load('claude-flow.config.json');
        } catch (error) {
          // Use defaults if config file doesn't exist
          if (options.verbose) {
            console.error('⚠️  Using default configuration');
          }
        }
        const config = configManager.show();
        
        // Force stdio transport for Claude Code
        const mcpConfig = {
          ...config.mcp,
          transport: 'stdio' as const,
          // Remove HTTP-specific settings
          port: undefined,
          host: undefined,
          corsEnabled: false
        };

        const server = new MCPServer(mcpConfig, eventBus, logger);
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
          await server.stop();
          process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
          await server.stop();
          process.exit(0);
        });
        
        // Start the server
        await server.start();
        
        // Log to stderr if verbose
        if (options.verbose) {
          console.error('✅ MCP server started in stdio mode for Claude Code');
        }
        
        // Keep process alive
        await new Promise(() => {}); // Keep running
      } catch (error) {
        // Send error response in MCP format
        console.log(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: `Failed to start MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        }));
        process.exit(1);
      }
    });

  return mcpCmd;
}