/**
 * V3 CLI MCP Server Management
 *
 * Provides server lifecycle management for MCP integration:
 * - Start/stop/status methods with process management
 * - Health check endpoint integration
 * - Graceful shutdown handling
 * - PID file management for daemon detection
 * - Event-based status monitoring
 *
 * Performance Targets:
 * - Server startup: <400ms
 * - Health check: <10ms
 * - Graceful shutdown: <5s
 *
 * @module @claude-flow/cli/mcp-server
 * @version 3.0.0
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { createServer, Server } from 'http';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * MCP Server configuration
 */
export interface MCPServerOptions {
  transport?: 'stdio' | 'http' | 'websocket';
  host?: string;
  port?: number;
  pidFile?: string;
  logFile?: string;
  tools?: string[] | 'all';
  daemonize?: boolean;
  timeout?: number;
}

/**
 * MCP Server status
 */
export interface MCPServerStatus {
  running: boolean;
  pid?: number;
  transport?: string;
  host?: string;
  port?: number;
  uptime?: number;
  tools?: number;
  startedAt?: string;
  health?: {
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  };
}

/**
 * Default configuration
 */
const DEFAULT_OPTIONS: Required<MCPServerOptions> = {
  transport: 'stdio',
  host: 'localhost',
  port: 3000,
  pidFile: path.join(os.tmpdir(), 'claude-flow-mcp.pid'),
  logFile: path.join(os.tmpdir(), 'claude-flow-mcp.log'),
  tools: 'all',
  daemonize: false,
  timeout: 30000,
};

/**
 * MCP Server Manager
 *
 * Manages the lifecycle of the MCP server process
 */
export class MCPServerManager extends EventEmitter {
  private options: Required<MCPServerOptions>;
  private process?: ChildProcess;
  private server?: Server;
  private startTime?: Date;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(options: MCPServerOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<MCPServerStatus> {
    // Check if already running
    const status = await this.getStatus();
    if (status.running) {
      throw new Error(`MCP Server already running (PID: ${status.pid})`);
    }

    const startTime = performance.now();
    this.startTime = new Date();

    this.emit('starting', { options: this.options });

    try {
      if (this.options.transport === 'stdio') {
        // For stdio transport, spawn the server process
        await this.startStdioServer();
      } else {
        // For HTTP/WebSocket, start in-process server
        await this.startHttpServer();
      }

      const duration = performance.now() - startTime;

      // Write PID file
      await this.writePidFile();

      // Start health check monitoring
      this.startHealthMonitoring();

      const finalStatus = await this.getStatus();

      this.emit('started', {
        ...finalStatus,
        startupTime: duration,
      });

      return finalStatus;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(force = false): Promise<void> {
    const status = await this.getStatus();

    if (!status.running) {
      return;
    }

    this.emit('stopping', { force });

    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      if (this.process) {
        // Graceful shutdown
        if (!force) {
          this.process.kill('SIGTERM');
          await this.waitForExit(5000);
        }

        // Force kill if still running
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }

        this.process = undefined;
      }

      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => resolve());
        });
        this.server = undefined;
      }

      // Remove PID file
      await this.removePidFile();

      this.startTime = undefined;
      this.emit('stopped');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get server status
   */
  async getStatus(): Promise<MCPServerStatus> {
    // Check PID file
    const pid = await this.readPidFile();

    if (!pid) {
      return { running: false };
    }

    // Check if process is running
    const isRunning = this.isProcessRunning(pid);

    if (!isRunning) {
      // Clean up stale PID file
      await this.removePidFile();
      return { running: false };
    }

    // Build status
    const status: MCPServerStatus = {
      running: true,
      pid,
      transport: this.options.transport,
      host: this.options.host,
      port: this.options.port,
      startedAt: this.startTime?.toISOString(),
      uptime: this.startTime
        ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
        : undefined,
    };

    // Get health status for HTTP transport
    if (this.options.transport !== 'stdio') {
      status.health = await this.checkHealth();
    }

    return status;
  }

  /**
   * Check server health
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }> {
    if (this.options.transport === 'stdio') {
      // For stdio, check if process is running
      const pid = await this.readPidFile();
      if (pid === null) {
        return { healthy: false, error: 'No PID file found' };
      }
      if (!this.isProcessRunning(pid)) {
        // Clean up stale PID file
        await this.removePidFile();
        return { healthy: false, error: 'Process not running (cleaned up stale PID)' };
      }
      return { healthy: true };
    }

    // For HTTP/WebSocket, make health check request
    try {
      const response = await this.httpRequest(
        `http://${this.options.host}:${this.options.port}/health`,
        'GET',
        this.options.timeout
      );

      return {
        healthy: response.status === 'ok',
        metrics: {
          connections: response.connections || 0,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Restart the server
   */
  async restart(): Promise<MCPServerStatus> {
    await this.stop();
    return await this.start();
  }

  /**
   * Start stdio server in-process
   * Handles stdin/stdout directly like V2 implementation
   */
  private async startStdioServer(): Promise<void> {
    // Import the tool registry
    const { listMCPTools, callMCPTool, hasTool } = await import('./mcp-client.js');

    const VERSION = '3.0.0';
    const sessionId = `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`;

    // Log to stderr to not corrupt stdout
    console.error(
      `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Starting in stdio mode`
    );
    console.error(JSON.stringify({
      arch: process.arch,
      mode: 'mcp-stdio',
      nodeVersion: process.version,
      pid: process.pid,
      platform: process.platform,
      protocol: 'stdio',
      sessionId,
      version: VERSION,
    }));

    // Send server initialization notification
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      method: 'server.initialized',
      params: {
        serverInfo: {
          name: 'claude-flow',
          version: VERSION,
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: true, listChanged: true },
          },
        },
      },
    }));

    // Handle stdin messages
    let buffer = '';

    process.stdin.on('data', async (chunk) => {
      buffer += chunk.toString();

      // Process complete JSON messages
      let lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            const response = await this.handleMCPMessage(message, sessionId);
            if (response) {
              console.log(JSON.stringify(response));
            }
          } catch (error) {
            console.error(
              `[${new Date().toISOString()}] ERROR [claude-flow-mcp] Failed to parse message:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    });

    process.stdin.on('end', () => {
      console.error(
        `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) stdin closed, shutting down...`
      );
      process.exit(0);
    });

    // Handle process termination
    process.on('SIGINT', () => {
      console.error(
        `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Received SIGINT, shutting down...`
      );
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.error(
        `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Received SIGTERM, shutting down...`
      );
      process.exit(0);
    });

    // Mark as ready immediately for stdio
    this.emit('ready');
  }

  /**
   * Handle incoming MCP message
   */
  private async handleMCPMessage(
    message: { jsonrpc: string; id?: string | number; method?: string; params?: unknown },
    sessionId: string
  ): Promise<{ jsonrpc: string; id?: string | number; result?: unknown; error?: { code: number; message: string } } | null> {
    const { listMCPTools, callMCPTool, hasTool } = await import('./mcp-client.js');

    if (!message.method) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32600, message: 'Invalid Request: missing method' },
      };
    }

    const params = (message.params || {}) as Record<string, unknown>;

    try {
      switch (message.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'claude-flow', version: '3.0.0' },
              capabilities: {
                tools: { listChanged: true },
                resources: { subscribe: true, listChanged: true },
              },
            },
          };

        case 'tools/list':
          const tools = listMCPTools();
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
              })),
            },
          };

        case 'tools/call':
          const toolName = params.name as string;
          const toolParams = (params.arguments || {}) as Record<string, unknown>;

          if (!hasTool(toolName)) {
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32601, message: `Tool not found: ${toolName}` },
            };
          }

          try {
            const result = await callMCPTool(toolName, toolParams, { sessionId });
            return {
              jsonrpc: '2.0',
              id: message.id,
              result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
            };
          } catch (error) {
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : 'Tool execution failed',
              },
            };
          }

        case 'notifications/initialized':
          // Client notification - no response needed
          console.error(
            `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Client initialized`
          );
          return null;

        case 'ping':
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {},
          };

        default:
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Method not found: ${message.method}` },
          };
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [claude-flow-mcp] Error handling ${message.method}:`,
        error
      );
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      };
    }
  }

  /**
   * Start HTTP server in-process
   */
  private async startHttpServer(): Promise<void> {
    // Dynamically import the MCP server package
    // FIX for issue #942: Use proper package import instead of broken relative path
    const { createMCPServer } = await import('@claude-flow/mcp');

    const logger = {
      debug: (msg: string, data?: unknown) => this.emit('log', { level: 'debug', msg, data }),
      info: (msg: string, data?: unknown) => this.emit('log', { level: 'info', msg, data }),
      warn: (msg: string, data?: unknown) => this.emit('log', { level: 'warn', msg, data }),
      error: (msg: string, data?: unknown) => this.emit('log', { level: 'error', msg, data }),
    };

    const mcpServer = createMCPServer(
      {
        name: 'Claude-Flow MCP Server V3',
        version: '3.0.0',
        transport: this.options.transport as 'http' | 'websocket',
        host: this.options.host,
        port: this.options.port,
        enableMetrics: true,
        enableCaching: true,
      },
      logger
    );

    await mcpServer.start();

    // Store reference for stopping
    (this as any)._mcpServer = mcpServer;
  }

  /**
   * Wait for server to be ready
   */
  private async waitForReady(timeout = 10000): Promise<void> {
    // For stdio transport, we're ready immediately (in-process)
    if (this.options.transport === 'stdio') {
      return;
    }

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const health = await this.checkHealth();
      if (health.healthy) {
        return;
      }
      await this.sleep(100);
    }

    throw new Error('Server failed to start within timeout');
  }

  /**
   * Wait for process to exit
   */
  private async waitForExit(timeout: number): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, timeout);

      this.process!.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        this.emit('health', health);

        if (!health.healthy) {
          this.emit('unhealthy', health);
        }
      } catch (error) {
        this.emit('health-error', error);
      }
    }, 30000);
  }

  /**
   * Write PID file
   */
  private async writePidFile(): Promise<void> {
    const pid = this.process?.pid || process.pid;
    await fs.promises.writeFile(this.options.pidFile, String(pid), 'utf8');
  }

  /**
   * Read PID file
   */
  private async readPidFile(): Promise<number | null> {
    try {
      const content = await fs.promises.readFile(this.options.pidFile, 'utf8');
      const pid = parseInt(content.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * Remove PID file
   */
  private async removePidFile(): Promise<void> {
    try {
      await fs.promises.unlink(this.options.pidFile);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Check if process is running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Make HTTP request
   */
  private async httpRequest(
    url: string,
    method: string,
    timeout: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const http = require('http');

      const req = http.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method,
          timeout,
        },
        (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ status: res.statusCode === 200 ? 'ok' : 'error' });
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create MCP server manager
 */
export function createMCPServerManager(
  options?: MCPServerOptions
): MCPServerManager {
  return new MCPServerManager(options);
}

/**
 * Singleton server manager instance
 */
let serverManager: MCPServerManager | null = null;
let currentTransport: string | undefined = undefined;

/**
 * Get or create server manager singleton
 *
 * FIX for issue #942: Recreate singleton if transport type changes
 * Previously, once created with stdio (default), HTTP options were ignored
 */
export function getServerManager(
  options?: MCPServerOptions
): MCPServerManager {
  const requestedTransport = options?.transport;

  // Recreate if transport type changes (fixes HTTP transport not working)
  if (serverManager && requestedTransport && requestedTransport !== currentTransport) {
    serverManager = new MCPServerManager(options);
    currentTransport = requestedTransport;
  }

  if (!serverManager) {
    serverManager = new MCPServerManager(options);
    currentTransport = options?.transport;
  }
  return serverManager;
}

/**
 * Quick start MCP server
 */
export async function startMCPServer(
  options?: MCPServerOptions
): Promise<MCPServerStatus> {
  const manager = getServerManager(options);
  return await manager.start();
}

/**
 * Quick stop MCP server
 */
export async function stopMCPServer(force = false): Promise<void> {
  if (serverManager) {
    await serverManager.stop(force);
  }
}

/**
 * Get MCP server status
 */
export async function getMCPServerStatus(): Promise<MCPServerStatus> {
  const manager = getServerManager();
  return await manager.getStatus();
}

export default MCPServerManager;
