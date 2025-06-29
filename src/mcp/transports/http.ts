/**
 * HTTP transport for MCP
 */

import type { Express, Request, Response } from 'express';
import { createServer, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITransport, RequestHandler, NotificationHandler } from './base.js';
import { MCPRequest, MCPResponse, MCPNotification, MCPConfig } from '../../utils/types.js';
import { ILogger } from '../../core/logger.js';
import { MCPTransportError } from '../../utils/errors.js';

/**
 * HTTP transport implementation
 */
export class HttpTransport implements ITransport {
  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private app: Express;
  private server?: Server;
  private wss?: WebSocketServer;
  private messageCount = 0;
  private notificationCount = 0;
  private running = false;
  private connections = new Set<WebSocket>();
  private activeWebSockets = new Set<WebSocket>();

  constructor(
    private host: string,
    private port: number,
    private tlsEnabled: boolean,
    private logger: ILogger,
    private config?: MCPConfig,
  ) {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new MCPTransportError('Transport already running');
    }

    this.logger.info('Starting HTTP transport', { 
      host: this.host,
      port: this.port,
      tls: this.tlsEnabled,
    });

    try {
      // Create HTTP server
      this.server = createServer(this.app);

      // Create WebSocket server
      this.wss = new WebSocketServer({ 
        server: this.server,
        path: '/ws'
      });

      this.setupWebSocketHandlers();

      // Start server
      await new Promise<void>((resolve, reject) => {
        this.server!.listen(this.port, this.host, () => {
          this.logger.info(`HTTP server listening on ${this.host}:${this.port}`);
          resolve();
        });
        
        this.server!.on('error', reject);
      });

      this.running = true;
      this.logger.info('HTTP transport started');
    } catch (error) {
      throw new MCPTransportError('Failed to start HTTP transport', { error });
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping HTTP transport');

    this.running = false;

    // Close all WebSocket connections
    for (const ws of Array.from(this.activeWebSockets)) {
      try {
        ws.close();
      } catch {
        // Ignore errors
      }
    }
    this.activeWebSockets.clear();
    this.connections.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }

    // Shutdown HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }

    this.logger.info('HTTP transport stopped');
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
        activeConnections: this.connections.size,
        activeWebSockets: this.activeWebSockets.size,
      },
    };
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());

    // CORS middleware
    if (this.config?.corsEnabled) {
      const origins = this.config.corsOrigins || ['*'];
      this.app.use(cors({
        origin: origins,
        credentials: true,
        maxAge: 86400, // 24 hours
      }));
    }

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.text());
  }

  private setupRoutes(): void {
    // Get current file directory for static files
    // Using process.cwd() as base since import.meta requires different module settings
    const consoleDir = join(process.cwd(), 'src/ui/console');

    // Serve static files for the web console
    this.app.use('/console', express.static(consoleDir));

    // Web console route
    this.app.get('/', (req, res) => {
      res.redirect('/console');
    });

    this.app.get('/console', (req, res) => {
      res.sendFile(join(consoleDir, 'index.html'));
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // MCP JSON-RPC endpoint
    this.app.post('/rpc', async (req, res) => {
      await this.handleJsonRpcRequest(req, res);
    });

    // Handle preflight requests
    this.app.options('*', (req, res) => {
      res.status(204).end();
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err: any, req: Request, res: Response, next: any) => {
      this.logger.error('Express error', err);
      res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
      });
    });
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket, req) => {
      this.activeWebSockets.add(ws);
      this.logger.info('WebSocket client connected', {
        totalClients: this.activeWebSockets.size,
      });

      ws.on('close', () => {
        this.activeWebSockets.delete(ws);
        this.logger.info('WebSocket client disconnected', {
          totalClients: this.activeWebSockets.size,
        });
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error', error);
        this.activeWebSockets.delete(ws);
      });

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.id === undefined) {
            // Notification from client
            await this.handleNotificationMessage(message as MCPNotification);
          } else {
            // Request from client
            const response = await this.handleRequestMessage(message as MCPRequest);
            ws.send(JSON.stringify(response));
          }
        } catch (error) {
          this.logger.error('Error processing WebSocket message', error);
          
          // Send error response if it was a request
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.id !== undefined) {
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id,
                error: {
                  code: -32603,
                  message: 'Internal error',
                },
              }));
            }
          } catch {
            // Ignore parse errors for error responses
          }
        }
      });
    });
  }

  private async handleJsonRpcRequest(req: Request, res: Response): Promise<void> {
    // Check content type
    if (!req.is('application/json')) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid content type - expected application/json',
        },
      });
      return;
    }

    // Check authorization if authentication is enabled
    if (this.config?.auth?.enabled) {
      const authResult = await this.validateAuth(req);
      if (!authResult.valid) {
        res.status(401).json({
          error: authResult.error || 'Unauthorized'
        });
        return;
      }
    }

    try {
      const mcpMessage = req.body;

      // Validate JSON-RPC format
      if (!mcpMessage.jsonrpc || mcpMessage.jsonrpc !== '2.0') {
        res.status(400).json({
          jsonrpc: '2.0',
          id: mcpMessage.id || null,
          error: {
            code: -32600,
            message: 'Invalid request - missing or invalid jsonrpc version',
          },
        });
        return;
      }

      if (!mcpMessage.method) {
        res.status(400).json({
          jsonrpc: '2.0',
          id: mcpMessage.id || null,
          error: {
            code: -32600,
            message: 'Invalid request - missing method',
          },
        });
        return;
      }

      this.messageCount++;

      // Check if this is a notification (no id) or request
      if (mcpMessage.id === undefined) {
        // Handle notification
        await this.handleNotificationMessage(mcpMessage as MCPNotification);
        // Notifications don't get responses
        res.status(204).end();
      } else {
        // Handle request
        const response = await this.handleRequestMessage(mcpMessage as MCPRequest);
        res.json(response);
      }
    } catch (error) {
      this.logger.error('Error handling JSON-RPC request', error);

      res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }



  private async handleRequestMessage(request: MCPRequest): Promise<MCPResponse> {
    if (!this.requestHandler) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'No request handler registered',
        },
      };
    }

    try {
      return await this.requestHandler(request);
    } catch (error) {
      this.logger.error('Request handler error', { request, error });
      
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async handleNotificationMessage(notification: MCPNotification): Promise<void> {
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

  private async validateAuth(req: Request): Promise<{ valid: boolean; error?: string }> {
    const auth = req.headers.authorization;
    
    if (!auth) {
      return { valid: false, error: 'Authorization header required' };
    }

    // Extract token from Authorization header
    const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return { valid: false, error: 'Invalid authorization format - use Bearer token' };
    }

    const token = tokenMatch[1];

    // Validate against configured tokens
    if (this.config?.auth?.tokens && this.config.auth.tokens.length > 0) {
      const isValid = this.config.auth.tokens.includes(token);
      if (!isValid) {
        return { valid: false, error: 'Invalid token' };
      }
    }

    return { valid: true };
  }

  async connect(): Promise<void> {
    // For HTTP transport, connect is handled by start()
    if (!this.running) {
      await this.start();
    }
  }

  async disconnect(): Promise<void> {
    // For HTTP transport, disconnect is handled by stop()
    await this.stop();
  }

  async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    // HTTP transport is server-side, it doesn't send requests
    throw new Error('HTTP transport does not support sending requests');
  }

  async sendNotification(notification: MCPNotification): Promise<void> {
    // Broadcast notification to all connected WebSocket clients
    const message = JSON.stringify(notification);
    
    for (const ws of Array.from(this.activeWebSockets)) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      } catch (error) {
        this.logger.error('Failed to send notification to WebSocket', error);
      }
    }
    
    this.notificationCount++;
  }
}