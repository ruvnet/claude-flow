/**
 * @claude-flow/mcp - Stdio Transport
 *
 * Standard I/O transport for MCP communication
 */

import { EventEmitter } from 'events';
import * as readline from 'readline';
import type {
  ITransport,
  TransportType,
  MCPRequest,
  MCPResponse,
  MCPNotification,
  RequestHandler,
  NotificationHandler,
  TransportHealthStatus,
  ILogger,
} from '../types.js';

export interface StdioTransportConfig {
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
  maxMessageSize?: number;
}

export class StdioTransport extends EventEmitter implements ITransport {
  public readonly type: TransportType = 'stdio';

  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private rl?: readline.Interface;
  private running = false;

  private messagesReceived = 0;
  private messagesSent = 0;
  private errors = 0;

  private readonly inputStream: NodeJS.ReadableStream;
  private readonly outputStream: NodeJS.WritableStream;
  private readonly maxMessageSize: number;

  constructor(
    private readonly logger: ILogger,
    config: StdioTransportConfig = {}
  ) {
    super();
    this.inputStream = config.inputStream || process.stdin;
    this.outputStream = config.outputStream || process.stdout;
    this.maxMessageSize = config.maxMessageSize || 10 * 1024 * 1024;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Stdio transport already running');
    }

    this.logger.info('Starting stdio transport');

    this.rl = readline.createInterface({
      input: this.inputStream,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line) => {
      this.handleLine(line);
    });

    this.rl.on('close', () => {
      this.handleClose();
    });

    this.inputStream.on('error', (error) => {
      this.handleError(error);
    });

    this.running = true;
    this.logger.info('Stdio transport started');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping stdio transport');
    this.running = false;

    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }

    this.logger.info('Stdio transport stopped');
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  async getHealthStatus(): Promise<TransportHealthStatus> {
    return {
      healthy: this.running,
      metrics: {
        messagesReceived: this.messagesReceived,
        messagesSent: this.messagesSent,
        errors: this.errors,
      },
    };
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) {
      return;
    }

    if (line.length > this.maxMessageSize) {
      this.logger.error('Message exceeds maximum size', {
        size: line.length,
        max: this.maxMessageSize,
      });
      this.errors++;
      return;
    }

    try {
      const message = JSON.parse(line);
      this.messagesReceived++;

      if (message.jsonrpc !== '2.0') {
        this.logger.warn('Invalid JSON-RPC version', { received: message.jsonrpc });
        await this.sendError(message.id, -32600, 'Invalid JSON-RPC version');
        return;
      }

      if (!message.method) {
        this.logger.warn('Missing method in request');
        await this.sendError(message.id, -32600, 'Missing method');
        return;
      }

      if (message.id !== undefined) {
        await this.handleRequest(message as MCPRequest);
      } else {
        await this.handleNotification(message as MCPNotification);
      }
    } catch (error) {
      this.errors++;
      this.logger.error('Failed to parse message', { error, line: line.substring(0, 100) });
      await this.sendError(null, -32700, 'Parse error');
    }
  }

  private async handleRequest(request: MCPRequest): Promise<void> {
    if (!this.requestHandler) {
      this.logger.warn('No request handler registered');
      await this.sendError(request.id, -32603, 'No request handler');
      return;
    }

    try {
      const startTime = performance.now();
      const response = await this.requestHandler(request);
      const duration = performance.now() - startTime;

      this.logger.debug('Request processed', {
        method: request.method,
        duration: `${duration.toFixed(2)}ms`,
      });

      await this.sendResponse(response);
    } catch (error) {
      this.logger.error('Request handler error', { method: request.method, error });
      await this.sendError(
        request.id,
        -32603,
        error instanceof Error ? error.message : 'Internal error'
      );
    }
  }

  private async handleNotification(notification: MCPNotification): Promise<void> {
    if (!this.notificationHandler) {
      this.logger.debug('Notification received but no handler', { method: notification.method });
      return;
    }

    try {
      await this.notificationHandler(notification);
    } catch (error) {
      this.logger.error('Notification handler error', { method: notification.method, error });
    }
  }

  private async sendResponse(response: MCPResponse): Promise<void> {
    const json = JSON.stringify(response);
    await this.write(json);
    this.messagesSent++;
  }

  private async sendError(id: string | number | null, code: number, message: string): Promise<void> {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    await this.sendResponse(response);
    this.errors++;
  }

  async sendNotification(notification: MCPNotification): Promise<void> {
    const json = JSON.stringify(notification);
    await this.write(json);
    this.messagesSent++;
  }

  private write(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.outputStream.write(data + '\n', (error) => {
        if (error) {
          this.errors++;
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private handleClose(): void {
    this.logger.info('Stdio stream closed');
    this.running = false;
    this.emit('close');
  }

  private handleError(error: Error): void {
    this.logger.error('Stdio stream error', error);
    this.errors++;
    this.emit('error', error);
  }
}

export function createStdioTransport(
  logger: ILogger,
  config: StdioTransportConfig = {}
): StdioTransport {
  return new StdioTransport(logger, config);
}
