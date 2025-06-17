/**
 * Base transport interface for MCP
 */

import { MCPRequest, MCPResponse, MCPNotification } from '../../utils/types.js';

export type RequestHandler = (request: MCPRequest) => Promise<MCPResponse>;
export type NotificationHandler = (notification: MCPNotification) => Promise<void>;

export interface ITransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onRequest(handler: RequestHandler): void;
  onNotification?(handler: NotificationHandler): void;
  sendRequest(request: MCPRequest): Promise<MCPResponse>;
  sendNotification?(notification: MCPNotification): Promise<void>;
  getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }>;
}