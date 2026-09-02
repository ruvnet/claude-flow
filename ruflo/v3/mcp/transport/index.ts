/**
 * V3 MCP Transport Factory
 *
 * Central factory for creating transport instances:
 * - Unified transport creation API
 * - Transport type validation
 * - Configuration defaults
 * - Multi-transport support
 *
 * Supported transports:
 * - stdio: Standard I/O (default for CLI)
 * - http: HTTP/REST with WebSocket upgrade
 * - websocket: Standalone WebSocket
 * - in-process: Direct function calls (fastest)
 */

import {
  ITransport,
  TransportType,
  ILogger,
} from '../types.js';
import { StdioTransport, StdioTransportConfig, createStdioTransport } from './stdio.js';
import { HttpTransport, HttpTransportConfig, createHttpTransport } from './http.js';
import { WebSocketTransport, WebSocketTransportConfig, createWebSocketTransport } from './websocket.js';

// Re-export transport classes
export { StdioTransport, StdioTransportConfig } from './stdio.js';
export { HttpTransport, HttpTransportConfig } from './http.js';
export { WebSocketTransport, WebSocketTransportConfig } from './websocket.js';

/**
 * Transport configuration union
 */
export type TransportConfig =
  | { type: 'stdio' } & StdioTransportConfig
  | { type: 'http' } & HttpTransportConfig
  | { type: 'websocket' } & WebSocketTransportConfig
  | { type: 'in-process' };

/**
 * Create a transport instance based on type
 */
export function createTransport(
  type: TransportType,
  logger: ILogger,
  config?: Partial<TransportConfig>
): ITransport {
  switch (type) {
    case 'stdio':
      return createStdioTransport(logger, config as StdioTransportConfig);

    case 'http':
      if (!config || !('host' in config) || !('port' in config)) {
        throw new Error('HTTP transport requires host and port configuration');
      }
      return createHttpTransport(logger, {
        host: config.host as string,
        port: config.port as number,
        ...config,
      } as HttpTransportConfig);

    case 'websocket':
      if (!config || !('host' in config) || !('port' in config)) {
        throw new Error('WebSocket transport requires host and port configuration');
      }
      return createWebSocketTransport(logger, {
        host: config.host as string,
        port: config.port as number,
        ...config,
      } as WebSocketTransportConfig);

    case 'in-process':
      // In-process transport is handled directly by the server
      // Return a no-op transport wrapper
      return createInProcessTransport(logger);

    default:
      throw new Error(`Unknown transport type: ${type}`);
  }
}

/**
 * In-process transport (no-op wrapper)
 *
 * Used when tools are executed directly without network transport
 */
class InProcessTransport implements ITransport {
  public readonly type: TransportType = 'in-process';

  constructor(private readonly logger: ILogger) {}

  async start(): Promise<void> {
    this.logger.debug('In-process transport started');
  }

  async stop(): Promise<void> {
    this.logger.debug('In-process transport stopped');
  }

  onRequest(): void {
    // No-op - requests are handled directly
  }

  onNotification(): void {
    // No-op - notifications are handled directly
  }

  async getHealthStatus() {
    return {
      healthy: true,
      metrics: {
        transport: 'in-process',
      },
    };
  }
}

/**
 * Create in-process transport
 */
export function createInProcessTransport(logger: ILogger): ITransport {
  return new InProcessTransport(logger);
}

/**
 * Transport manager for multi-transport scenarios
 */
export class TransportManager {
  private transports: Map<string, ITransport> = new Map();
  private running = false;

  constructor(private readonly logger: ILogger) {}

  /**
   * Add a transport
   */
  addTransport(name: string, transport: ITransport): void {
    if (this.transports.has(name)) {
      throw new Error(`Transport "${name}" already exists`);
    }
    this.transports.set(name, transport);
    this.logger.debug('Transport added', { name, type: transport.type });
  }

  /**
   * Remove a transport
   */
  async removeTransport(name: string): Promise<boolean> {
    const transport = this.transports.get(name);
    if (!transport) {
      return false;
    }

    await transport.stop();
    this.transports.delete(name);
    this.logger.debug('Transport removed', { name });
    return true;
  }

  /**
   * Get a transport by name
   */
  getTransport(name: string): ITransport | undefined {
    return this.transports.get(name);
  }

  /**
   * Get all transport names
   */
  getTransportNames(): string[] {
    return Array.from(this.transports.keys());
  }

  /**
   * Start all transports
   */
  async startAll(): Promise<void> {
    if (this.running) {
      throw new Error('TransportManager already running');
    }

    this.logger.info('Starting all transports', { count: this.transports.size });

    const startPromises = Array.from(this.transports.entries()).map(
      async ([name, transport]) => {
        try {
          await transport.start();
          this.logger.info('Transport started', { name, type: transport.type });
        } catch (error) {
          this.logger.error('Failed to start transport', { name, error });
          throw error;
        }
      }
    );

    await Promise.all(startPromises);
    this.running = true;
    this.logger.info('All transports started');
  }

  /**
   * Stop all transports
   */
  async stopAll(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping all transports');

    const stopPromises = Array.from(this.transports.entries()).map(
      async ([name, transport]) => {
        try {
          await transport.stop();
          this.logger.info('Transport stopped', { name });
        } catch (error) {
          this.logger.error('Error stopping transport', { name, error });
        }
      }
    );

    await Promise.all(stopPromises);
    this.running = false;
    this.logger.info('All transports stopped');
  }

  /**
   * Get health status of all transports
   */
  async getHealthStatus(): Promise<Record<string, { healthy: boolean; error?: string }>> {
    const results: Record<string, { healthy: boolean; error?: string }> = {};

    for (const [name, transport] of this.transports) {
      try {
        const status = await transport.getHealthStatus();
        results[name] = { healthy: status.healthy, error: status.error };
      } catch (error) {
        results[name] = {
          healthy: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    return results;
  }

  /**
   * Check if any transport is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Create a transport manager
 */
export function createTransportManager(logger: ILogger): TransportManager {
  return new TransportManager(logger);
}

/**
 * Default transport configurations
 */
export const DEFAULT_TRANSPORT_CONFIGS = {
  stdio: {} as StdioTransportConfig,

  http: {
    host: 'localhost',
    port: 3000,
    corsEnabled: true,
    corsOrigins: ['*'],
    maxRequestSize: '10mb',
    requestTimeout: 30000,
  } as HttpTransportConfig,

  websocket: {
    host: 'localhost',
    port: 3001,
    path: '/ws',
    maxConnections: 100,
    heartbeatInterval: 30000,
    heartbeatTimeout: 10000,
    maxMessageSize: 10 * 1024 * 1024,
  } as WebSocketTransportConfig,
} as const;
