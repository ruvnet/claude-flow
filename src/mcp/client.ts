/**
 * MCP Client for Model Context Protocol
 */

import { ITransport } from './transports/base.js';
import { logger } from '../core/logger.js';
import { MCPRequest, MCPResponse, MCPNotification } from '../utils/types.js';

export interface MCPClientConfig {
  transport: ITransport;
  timeout?: number;
}

export class MCPClient {
  private transport: ITransport;
  private timeout: number;
  private connected = false;

  constructor(config: MCPClientConfig) {
    this.transport = config.transport;
    this.timeout = config.timeout || 30000;
  }

  async connect(): Promise<void> {
    await this.transport.connect();
    this.connected = true;
    logger.info('MCP Client connected');
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.transport.disconnect();
      this.connected = false;
      logger.info('MCP Client disconnected');
    }
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    const request: MCPRequest = {
      jsonrpc: '2.0' as const,
      method,
      params,
      id: Math.random().toString(36).slice(2),
    };

    const response = await this.transport.sendRequest(request);
    
    if ('error' in response && response.error) {
      throw new Error(response.error.message || 'Unknown error');
    }

    return response.result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    const notification: MCPNotification = {
      jsonrpc: '2.0' as const,
      method,
      params,
    };

    if (this.transport.sendNotification) {
      await this.transport.sendNotification(notification);
    } else {
      throw new Error('Transport does not support notifications');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}