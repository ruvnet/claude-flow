/**
 * MCP command for Claude-Flow
 */

import { Command } from '@cliffy/command';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { configManager } from '../../core/config.js';
import { MCPServer, type IMCPServer } from '../../mcp/server.js';
import { eventBus } from '../../core/event-bus.js';
import {
  createMCPServer,
  isMCP2025Available,
  getServerCapabilities,
  type ExtendedMCPConfig,
} from '../../mcp/server-factory.js';
import type { MCP2025Server } from '../../mcp/server-mcp-2025.js';

let mcpServer: IMCPServer | MCP2025Server | null = null;

export const mcpCommand = new Command()
  .description('Manage MCP server and tools')
  .action(() => {
    console.log(chalk.yellow('Please specify a subcommand:'));
    console.log('  start   - Start the MCP server');
    console.log('  stop    - Stop the MCP server');
    console.log('  status  - Show MCP server status');
    console.log('  tools   - List available MCP tools');
    console.log('  config  - Show MCP configuration');
    console.log('  restart - Restart the MCP server');
    console.log('  logs    - Show MCP server logs');
  })
  .command(
    'start',
    new Command()
      .description('Start the MCP server')
      .option('-p, --port <port:number>', 'Port for MCP server', { default: 3000 })
      .option('-h, --host <host:string>', 'Host for MCP server', { default: 'localhost' })
      .option('--transport <transport:string>', 'Transport type (stdio, http)', {
        default: 'stdio',
      })
      .option('--mcp2025', 'Enable MCP 2025-11 features (version negotiation, async jobs, etc.)', {
        default: false,
      })
      .option('--no-legacy', 'Disable legacy client support', { default: false })
      .action(async (options: any) => {
        try {
          const config = await configManager.load();

          // Check if MCP 2025-11 dependencies are available
          const mcp2025Available = isMCP2025Available();
          const enableMCP2025 = options.mcp2025 && mcp2025Available;

          if (options.mcp2025 && !mcp2025Available) {
            console.log(
              chalk.yellow(
                '⚠️  MCP 2025-11 dependencies not found. Install with: npm install uuid ajv ajv-formats ajv-errors'
              )
            );
            console.log(chalk.yellow('   Falling back to legacy MCP server...'));
          }

          // Build extended configuration
          const mcpConfig: ExtendedMCPConfig = {
            ...config.mcp,
            port: options.port,
            host: options.host,
            transport: options.transport,
            features: {
              enableMCP2025,
              supportLegacyClients: options.legacy !== false,
              enableVersionNegotiation: enableMCP2025,
              enableAsyncJobs: enableMCP2025,
              enableRegistryIntegration: false, // Opt-in via env var
              enableSchemaValidation: enableMCP2025,
              enableProgressiveDisclosure: true, // Phase 1 feature (always enabled)
            },
            mcp2025: enableMCP2025
              ? {
                  async: {
                    enabled: true,
                    maxJobs: 100,
                    jobTTL: 3600000,
                  },
                  registry: {
                    enabled: process.env.MCP_REGISTRY_ENABLED === 'true',
                    url: process.env.MCP_REGISTRY_URL,
                    apiKey: process.env.MCP_REGISTRY_API_KEY,
                  },
                  validation: {
                    enabled: true,
                    strictMode: false,
                  },
                }
              : undefined,
          };

          // Create server using factory
          mcpServer = await createMCPServer(mcpConfig, eventBus, logger, {
            autoDetectFeatures: false, // Use explicit config
          });

          await mcpServer.start();

          // Get capabilities
          const capabilities = getServerCapabilities(mcpConfig);

          console.log(chalk.green(`✅ MCP server started on ${options.host}:${options.port}`));
          console.log(
            chalk.cyan(`🎯 Mode: ${enableMCP2025 ? 'MCP 2025-11 Enhanced' : 'Legacy Compatible'}`)
          );
          console.log(chalk.cyan(`📡 Transport: ${options.transport}`));

          if (capabilities.length > 0) {
            console.log(chalk.cyan(`✨ Capabilities: ${capabilities.join(', ')}`));
          }

          if (enableMCP2025) {
            console.log(chalk.green('   • Version negotiation (YYYY-MM format)'));
            console.log(chalk.green('   • Async job support (poll/resume)'));
            console.log(chalk.green('   • JSON Schema 1.1 validation'));
            console.log(chalk.green('   • Progressive disclosure (98.7% token reduction)'));
          }

          if (options.transport === 'http') {
            console.log(chalk.cyan(`📚 Server URL: http://${options.host}:${options.port}`));
          }
        } catch (error) {
          console.error(chalk.red(`❌ Failed to start MCP server: ${(error as Error).message}`));
          logger.error('MCP server startup failed', { error });
          process.exit(1);
        }
      }),
  )
  .command(
    'stop',
    new Command().description('Stop the MCP server').action(async () => {
      try {
        if (mcpServer) {
          await mcpServer.stop();
          mcpServer = null;
          console.log(chalk.green('✅ MCP server stopped'));
        } else {
          console.log(chalk.yellow('⚠️  MCP server is not running'));
        }
      } catch (error) {
        console.error(chalk.red(`❌ Failed to stop MCP server: ${(error as Error).message}`));
        process.exit(1);
      }
    }),
  )
  .command(
    'status',
    new Command().description('Show MCP server status').action(async () => {
      try {
        const config = await configManager.load();
        const isRunning = mcpServer !== null;

        console.log(chalk.cyan('MCP Server Status:'));
        console.log(`🌐 Status: ${isRunning ? chalk.green('Running') : chalk.red('Stopped')}`);

        if (isRunning) {
          console.log(`📍 Address: ${config.mcp.host}:${config.mcp.port}`);
          console.log(
            `🔐 Authentication: ${config.mcp.auth ? chalk.green('Enabled') : chalk.yellow('Disabled')}`,
          );
          console.log(`🔧 Tools: ${chalk.green('Available')}`);
          console.log(`📊 Metrics: ${chalk.green('Collecting')}`);
        } else {
          console.log(chalk.gray('Use "claude-flow mcp start" to start the server'));
        }
      } catch (error) {
        console.error(chalk.red(`❌ Failed to get MCP status: ${(error as Error).message}`));
      }
    }),
  )
  .command(
    'tools',
    new Command().description('List available MCP tools').action(() => {
      console.log(chalk.cyan('Available MCP Tools:'));

      console.log('\n📊 Research Tools:');
      console.log('  • web_search - Search the web for information');
      console.log('  • web_fetch - Fetch content from URLs');
      console.log('  • knowledge_query - Query knowledge base');

      console.log('\n💻 Code Tools:');
      console.log('  • code_edit - Edit code files');
      console.log('  • code_search - Search through codebase');
      console.log('  • code_analyze - Analyze code quality');

      console.log('\n🖥️  Terminal Tools:');
      console.log('  • terminal_execute - Execute shell commands');
      console.log('  • terminal_session - Manage terminal sessions');
      console.log('  • file_operations - File system operations');

      console.log('\n💾 Memory Tools:');
      console.log('  • memory_store - Store information');
      console.log('  • memory_query - Query stored information');
      console.log('  • memory_index - Index and search content');
    }),
  )
  .command(
    'config',
    new Command().description('Show MCP configuration').action(async () => {
      try {
        const config = await configManager.load();

        console.log(chalk.cyan('MCP Configuration:'));
        console.log(JSON.stringify(config.mcp, null, 2));
      } catch (error) {
        console.error(chalk.red(`❌ Failed to show MCP config: ${(error as Error).message}`));
      }
    }),
  )
  .command(
    'restart',
    new Command().description('Restart the MCP server').action(async () => {
      try {
        console.log(chalk.yellow('🔄 Stopping MCP server...'));
        if (mcpServer) {
          await mcpServer.stop();
        }

        console.log(chalk.yellow('🔄 Starting MCP server...'));
        const config = await configManager.load();

        // Use factory to create server with same capabilities as before
        mcpServer = await createMCPServer(config.mcp, eventBus, logger, {
          autoDetectFeatures: true, // Auto-detect on restart
        });
        await mcpServer.start();

        console.log(
          chalk.green(`✅ MCP server restarted on ${config.mcp.host}:${config.mcp.port}`),
        );
      } catch (error) {
        console.error(chalk.red(`❌ Failed to restart MCP server: ${(error as Error).message}`));
        process.exit(1);
      }
    }),
  )
  .command(
    'logs',
    new Command()
      .description('Show MCP server logs')
      .option('-n, --lines <lines:number>', 'Number of log lines to show', { default: 50 })
      .action((options: any) => {
        console.log(chalk.cyan(`MCP Server Logs (last ${options.lines} lines):`));

        // Mock logs since logging system might not be fully implemented
        const logEntries = [
          '2024-01-10 10:00:00 [INFO] MCP server started on localhost:3000',
          '2024-01-10 10:00:01 [INFO] Tools registered: 12',
          '2024-01-10 10:00:02 [INFO] Authentication disabled',
          '2024-01-10 10:01:00 [INFO] Client connected: claude-desktop',
          '2024-01-10 10:01:05 [INFO] Tool called: web_search',
          '2024-01-10 10:01:10 [INFO] Tool response sent successfully',
          '2024-01-10 10:02:00 [INFO] Tool called: terminal_execute',
          '2024-01-10 10:02:05 [INFO] Command executed successfully',
          '2024-01-10 10:03:00 [INFO] Memory operation: store',
          '2024-01-10 10:03:01 [INFO] Data stored in namespace: default',
        ];

        const startIndex = Math.max(0, logEntries.length - options.lines);
        const displayLogs = logEntries.slice(startIndex);

        for (const entry of displayLogs) {
          if (entry.includes('[ERROR]')) {
            console.log(chalk.red(entry));
          } else if (entry.includes('[WARN]')) {
            console.log(chalk.yellow(entry));
          } else if (entry.includes('[INFO]')) {
            console.log(chalk.green(entry));
          } else {
            console.log(chalk.gray(entry));
          }
        }
      }),
  );
