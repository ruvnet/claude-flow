/**
 * @claude-flow/mcp - Transport Factory
 *
 * Central factory for creating transport instances
 */

import type {
  ITransport,
  TransportType,
  TransportHealthStatus,
  ILogger,
} from '../types.js';
import { StdioTransport, StdioTransportConfig, createStdioTransport } from './stdio.js';
import { HttpTransport, HttpTransportConfig, createHttpTransport } from './http.js';
import { WebSocketTransport, WebSocketTransportConfig, createWebSocketTransport } from './websocket.js';

export { StdioTransport } from './stdio.js';
export { HttpTransport } from './http.js';
export { WebSocketTransport } from './websocket.js';

export type { StdioTransportConfig } from './stdio.js';
export type { HttpTransportConfig } from './http.js';
export type { WebSocketTransportConfig } from './websocket.js';

export type TransportConfig =
  | { type: 'stdio' } & StdioTransportConfig
  | { type: 'http' } & HttpTransportConfig
  | { type: 'websocket' } & WebSocketTransportConfig
  | { type: 'in-process' };

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
      return createInProcessTransport(logger);

    default:
      throw new Error(`Unknown transport type: ${type}`);
  }
}

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

  async getHealthStatus(): Promise<TransportHealthStatus> {
    return {
      healthy: true,
      metrics: {
        latency: 0,
        connections: 1,
      },
    };
  }
}

export function createInProcessTransport(logger: ILogger): ITransport {
  return new InProcessTransport(logger);
}

export class TransportManager {
  private transports: Map<string, ITransport> = new Map();
  private running = false;

  constructor(private readonly logger: ILogger) {}

  addTransport(name: string, transport: ITransport): void {
    if (this.transports.has(name)) {
      throw new Error(`Transport "${name}" already exists`);
    }
    this.transports.set(name, transport);
    this.logger.debug('Transport added', { name, type: transport.type });
  }

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

  getTransport(name: string): ITransport | undefined {
    return this.transports.get(name);
  }

  getTransportNames(): string[] {
    return Array.from(this.transports.keys());
  }

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

  isRunning(): boolean {
    return this.running;
  }
}

export function createTransportManager(logger: ILogger): TransportManager {
  return new TransportManager(logger);
}

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
