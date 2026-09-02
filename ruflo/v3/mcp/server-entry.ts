#!/usr/bin/env npx tsx
/**
 * V3 MCP Server Entry Point
 *
 * Main entry point for the MCP server process.
 * Loads all tools from tools/index.ts and starts the server.
 *
 * Usage:
 *   npx tsx v3/mcp/server-entry.ts [options]
 *
 * Options:
 *   --transport <type>  Transport type: stdio, http, websocket (default: stdio)
 *   --host <host>       Server host (default: localhost)
 *   --port <port>       Server port (default: 3000)
 *   --tools <list>      Comma-separated tool list or "all" (default: all)
 *   --log-level <level> Log level: debug, info, warn, error (default: info)
 *
 * @module @claude-flow/mcp/server-entry
 * @version 3.0.0
 */

import { MCPServer, createMCPServer } from './server.js';
import { getAllTools, getToolStats, validateToolRegistration } from './tools/index.js';
import type { ILogger, TransportType, MCPServerConfig } from './types.js';

/**
 * Parse command line arguments
 */
function parseArgs(): {
  transport: TransportType;
  host: string;
  port: number;
  tools: string[];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
} {
  const args = process.argv.slice(2);
  const options = {
    transport: 'stdio' as TransportType,
    host: 'localhost',
    port: 3000,
    tools: ['all'],
    logLevel: 'info' as 'debug' | 'info' | 'warn' | 'error',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--transport':
      case '-t':
        if (nextArg && ['stdio', 'http', 'websocket'].includes(nextArg)) {
          options.transport = nextArg as TransportType;
          i++;
        }
        break;

      case '--host':
      case '-h':
        if (nextArg && !nextArg.startsWith('-')) {
          options.host = nextArg;
          i++;
        }
        break;

      case '--port':
      case '-p':
        if (nextArg && !isNaN(parseInt(nextArg))) {
          options.port = parseInt(nextArg);
          i++;
        }
        break;

      case '--tools':
        if (nextArg && !nextArg.startsWith('-')) {
          options.tools = nextArg === 'all' ? ['all'] : nextArg.split(',');
          i++;
        }
        break;

      case '--log-level':
      case '-l':
        if (nextArg && ['debug', 'info', 'warn', 'error'].includes(nextArg)) {
          options.logLevel = nextArg as typeof options.logLevel;
          i++;
        }
        break;

      case '--help':
        showHelp();
        process.exit(0);
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
Claude-Flow MCP Server V3

Usage:
  npx tsx v3/mcp/server-entry.ts [options]

Options:
  --transport, -t <type>   Transport type: stdio, http, websocket (default: stdio)
  --host, -h <host>        Server host (default: localhost)
  --port, -p <port>        Server port (default: 3000)
  --tools <list>           Comma-separated tool list or "all" (default: all)
  --log-level, -l <level>  Log level: debug, info, warn, error (default: info)
  --help                   Show this help message

Examples:
  npx tsx v3/mcp/server-entry.ts
  npx tsx v3/mcp/server-entry.ts --transport http --port 8080
  npx tsx v3/mcp/server-entry.ts --tools agent/spawn,swarm/init
`);
}

/**
 * Create logger instance
 */
function createLogger(level: 'debug' | 'info' | 'warn' | 'error'): ILogger {
  const levels = ['debug', 'info', 'warn', 'error'];
  const minLevel = levels.indexOf(level);

  const shouldLog = (logLevel: string): boolean => {
    return levels.indexOf(logLevel) >= minLevel;
  };

  const formatMessage = (logLevel: string, msg: string, data?: unknown): string => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${logLevel.toUpperCase()}] ${msg}${dataStr}`;
  };

  return {
    debug: (msg: string, data?: unknown) => {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', msg, data));
      }
    },
    info: (msg: string, data?: unknown) => {
      if (shouldLog('info')) {
        console.info(formatMessage('info', msg, data));
      }
    },
    warn: (msg: string, data?: unknown) => {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', msg, data));
      }
    },
    error: (msg: string, data?: unknown) => {
      if (shouldLog('error')) {
        console.error(formatMessage('error', msg, data));
      }
    },
  };
}

/**
 * Initialize tool context with services
 */
function createToolContext(): Record<string, unknown> {
  return {
    sessionId: `server-${Date.now().toString(36)}`,
    orchestrator: null, // Will be injected when available
    swarmCoordinator: null, // Will be injected when available
    agentManager: null, // Will be injected when available
    metadata: {
      serverMode: true,
      startedAt: new Date().toISOString(),
    },
  };
}

/**
 * Main server initialization
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const logger = createLogger(options.logLevel);

  logger.info('Starting Claude-Flow MCP Server V3', {
    transport: options.transport,
    host: options.host,
    port: options.port,
  });

  // Validate tools before starting
  const validation = validateToolRegistration();
  if (!validation.valid) {
    logger.warn('Tool validation warnings', {
      issues: validation.issues,
    });
  }

  // Get tool statistics
  const stats = getToolStats();
  logger.info('Tool registry initialized', {
    total: stats.total,
    categories: stats.categories,
    cacheable: stats.cacheable,
  });

  // Server configuration
  const config: Partial<MCPServerConfig> = {
    name: 'Claude-Flow MCP Server V3',
    version: '3.0.0',
    transport: options.transport,
    host: options.host,
    port: options.port,
    enableMetrics: true,
    enableCaching: true,
    cacheTTL: 10000,
    logLevel: options.logLevel,
    requestTimeout: 30000,
    maxRequestSize: 10 * 1024 * 1024,
  };

  // Create server
  const server = createMCPServer(config, logger);

  // Setup graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await server.stop();
      logger.info('Server stopped successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });

  // Server event handlers
  server.on('server:started', (data) => {
    logger.info('Server started', data);

    // Send ready signal for stdio transport
    if (options.transport === 'stdio') {
      // Write ready notification
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/server/ready',
        params: {
          serverInfo: {
            name: 'Claude-Flow MCP Server V3',
            version: '3.0.0',
          },
          tools: stats.total,
        },
      };
      console.log(JSON.stringify(notification));
    }
  });

  server.on('tool:registered', (name) => {
    logger.debug('Tool registered', { name });
  });

  server.on('tool:called', (data) => {
    logger.debug('Tool called', data);
  });

  server.on('tool:completed', (data) => {
    logger.debug('Tool completed', data);
  });

  server.on('tool:error', (data) => {
    logger.error('Tool error', data);
  });

  server.on('session:created', (session) => {
    logger.info('Session created', { id: session.id });
  });

  server.on('session:closed', (data) => {
    logger.info('Session closed', data);
  });

  // Start server
  try {
    await server.start();

    if (options.transport !== 'stdio') {
      logger.info(`MCP Server listening on ${options.host}:${options.port}`);
      logger.info(`Health check: http://${options.host}:${options.port}/health`);
      logger.info(`RPC endpoint: http://${options.host}:${options.port}/rpc`);
    }
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
