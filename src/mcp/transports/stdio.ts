/**
 * Standard I/O transport for MCP
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface, Interface } from 'node:readline';
import { ITransport, RequestHandler, NotificationHandler } from './base.js';
import { MCPRequest, MCPResponse, MCPNotification } from '../../utils/types.js';
import { ILogger } from '../../core/logger.js';
import { MCPTransportError } from '../../utils/errors.js';

/**
 * Stdio transport implementation
 */
export class StdioTransport implements ITransport {
  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private readline?: Interface;
  private messageCount = 0;
  private notificationCount = 0;
  private running = false;

  constructor(private logger: ILogger) {}

  async start(): Promise<void> {
    if (this.running) {
      throw new MCPTransportError('Transport already running');
    }

    this.logger.info('Starting stdio transport');

    try {
      // Create readline interface for stdin
      this.readline = createInterface({
        input: stdin,
        output: stdout,
        terminal: false,
      });

      // Set up line handler
      this.readline.on('line', (line: string) => {
        this.processMessage(line.trim()).catch((error) => {
          this.logger.error('Error processing message', { line, error });
        });
      });

      this.readline.on('close', () => {
        this.logger.info('Stdin closed');
        this.running = false;
      });

      this.running = true;
      this.logger.info('Stdio transport started');
    } catch (error) {
      throw new MCPTransportError('Failed to start stdio transport', { error });
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping stdio transport');

    this.running = false;
    
    if (this.readline) {
      this.readline.close();
      this.readline = undefined;
    }

    this.logger.info('Stdio transport stopped');
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }


  async getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }> {
    return {
      healthy: this.running,
      metrics: {
        messagesReceived: this.messageCount,
        notificationsSent: this.notificationCount,
        stdinOpen: this.readline ? 1 : 0,
      },
    };
  }


  private async processMessage(line: string): Promise<void> {
    let message: any;

    try {
      message = JSON.parse(line);
      
      if (!message.jsonrpc || message.jsonrpc !== '2.0') {
        throw new Error('Invalid JSON-RPC version');
      }

      if (!message.method) {
        throw new Error('Missing method');
      }
    } catch (error) {
      this.logger.error('Failed to parse message', { line, error });
      
      // Send error response if we can extract an ID
      let id = 'unknown';
      try {
        const parsed = JSON.parse(line);
        if (parsed.id !== undefined) {
          id = parsed.id;
        }
      } catch {
        // Ignore parse error for ID extraction
      }

      await this.sendResponse({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      });
      return;
    }

    this.messageCount++;

    // Check if this is a notification (no id field) or a request
    if (message.id === undefined) {
      // This is a notification
      await this.handleNotification(message as MCPNotification);
    } else {
      // This is a request
      await this.handleRequest(message as MCPRequest);
    }
  }

  private async handleRequest(request: MCPRequest): Promise<void> {
    if (!this.requestHandler) {
      await this.sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'No request handler registered',
        },
      });
      return;
    }

    try {
      const response = await this.requestHandler(request);
      await this.sendResponse(response);
    } catch (error) {
      this.logger.error('Request handler error', { request, error });
      
      await this.sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleNotification(notification: MCPNotification): Promise<void> {
    if (!this.notificationHandler) {
      this.logger.warn('Received notification but no handler registered', {
        method: notification.method,
      });
      return;
    }

    try {
      await this.notificationHandler(notification);
    } catch (error) {
      this.logger.error('Notification handler error', { notification, error });
      // Notifications don't send error responses
    }
  }

  private async sendResponse(response: MCPResponse): Promise<void> {
    try {
      const json = JSON.stringify(response);
      stdout.write(json + '\n');
    } catch (error) {
      this.logger.error('Failed to send response', { response, error });
    }
  }

  async connect(): Promise<void> {
    // For STDIO transport, connect is handled by start()
    if (!this.running) {
      await this.start();
    }
  }

  async disconnect(): Promise<void> {
    // For STDIO transport, disconnect is handled by stop()
    await this.stop();
  }

  async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    // Send request to stdout
    const json = JSON.stringify(request);
    stdout.write(json + '\n');
    
    // In STDIO transport, responses are handled asynchronously
    // This would need a proper request/response correlation mechanism
    throw new Error('STDIO transport sendRequest requires request/response correlation');
  }

  async sendNotification(notification: MCPNotification): Promise<void> {
    try {
      const json = JSON.stringify(notification);
      stdout.write(json + '\n');
      this.notificationCount++;
    } catch (error) {
      this.logger.error('Failed to send notification', { notification, error });
      throw error;
    }
  }
}