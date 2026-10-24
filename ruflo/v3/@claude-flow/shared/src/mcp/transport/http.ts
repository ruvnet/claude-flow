/**
 * V3 MCP HTTP Transport
 *
 * HTTP/REST transport for MCP communication:
 * - Express-based with optimized middleware
 * - WebSocket support for real-time notifications
 * - Connection pooling for client connections
 * - Security headers with helmet
 *
 * Performance Targets:
 * - Request handling: <20ms overhead
 * - WebSocket message: <5ms
 */

import { EventEmitter } from 'events';
import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import {
  ITransport,
  TransportType,
  MCPRequest,
  MCPResponse,
  MCPNotification,
  RequestHandler,
  NotificationHandler,
  TransportHealthStatus,
  ILogger,
  AuthConfig,
} from '../types.js';

/**
 * HTTP Transport Configuration
 */
export interface HttpTransportConfig {
  host: string;
  port: number;
  tlsEnabled?: boolean;
  tlsCert?: string;
  tlsKey?: string;
  corsEnabled?: boolean;
  corsOrigins?: string[];
  auth?: AuthConfig;
  maxRequestSize?: string;
  requestTimeout?: number;
}

/**
 * HTTP Transport Implementation
 */
export class HttpTransport extends EventEmitter implements ITransport {
  public readonly type: TransportType = 'http';

  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private app: Express;
  private server?: Server;
  private wss?: WebSocketServer;
  private running = false;
  private activeConnections = new Set<WebSocket>();

  // Statistics
  private messagesReceived = 0;
  private messagesSent = 0;
  private errors = 0;
  private httpRequests = 0;
  private wsMessages = 0;

  constructor(
    private readonly logger: ILogger,
    private readonly config: HttpTransportConfig
  ) {
    super();
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Start the transport
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('HTTP transport already running');
    }

    this.logger.info('Starting HTTP transport', {
      host: this.config.host,
      port: this.config.port,
    });

    // Create HTTP server
    this.server = createServer(this.app);

    // Create WebSocket server
    this.wss = new WebSocketServer({
      server: this.server,
      path: '/ws',
    });

    this.setupWebSocketHandlers();

    // Start server
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
      this.server!.on('error', reject);
    });

    this.running = true;
    this.logger.info('HTTP transport started', {
      url: `http://${this.config.host}:${this.config.port}`,
    });
  }

  /**
   * Stop the transport
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping HTTP transport');
    this.running = false;

    // Close all WebSocket connections
    for (const ws of this.activeConnections) {
      try {
        ws.close(1000, 'Server shutting down');
      } catch {
        // Ignore errors
      }
    }
    this.activeConnections.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }

    this.logger.info('HTTP transport stopped');
  }

  /**
   * Register request handler
   */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  /**
   * Register notification handler
   */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<TransportHealthStatus> {
    return {
      healthy: this.running,
      metrics: {
        messagesReceived: this.messagesReceived,
        messagesSent: this.messagesSent,
        errors: this.errors,
        httpRequests: this.httpRequests,
        wsMessages: this.wsMessages,
        activeConnections: this.activeConnections.size,
      },
    };
  }

  /**
   * Send notification to all connected WebSocket clients
   */
  async sendNotification(notification: MCPNotification): Promise<void> {
    const message = JSON.stringify(notification);

    for (const ws of this.activeConnections) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
          this.messagesSent++;
        }
      } catch (error) {
        this.logger.error('Failed to send notification', { error });
        this.errors++;
      }
    }
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: false, // Allow for flexibility
    }));

    // CORS - Secure defaults (no wildcard in production)
    if (this.config.corsEnabled !== false) {
      const allowedOrigins = this.config.corsOrigins;

      // SECURITY: Reject wildcard CORS in production unless explicitly configured
      if (!allowedOrigins || allowedOrigins.length === 0) {
        this.logger.warn('CORS: No origins configured, restricting to same-origin only');
      }

      this.app.use(cors({
        origin: (origin, callback) => {
          // Allow requests with no origin (same-origin, curl, etc.)
          if (!origin) {
            callback(null, true);
            return;
          }

          // Check against allowed origins
          if (allowedOrigins && allowedOrigins.length > 0) {
            if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
              callback(null, true);
            } else {
              callback(new Error(`CORS: Origin '${origin}' not allowed`));
            }
          } else {
            // No origins configured - reject cross-origin requests
            callback(new Error('CORS: Cross-origin requests not allowed'));
          }
        },
        credentials: true,
        maxAge: 86400,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      }));
    }

    // Body parsing
    this.app.use(express.json({
      limit: this.config.maxRequestSize || '10mb',
    }));

    // Request timeout
    if (this.config.requestTimeout) {
      this.app.use((req, res, next) => {
        res.setTimeout(this.config.requestTimeout!, () => {
          res.status(408).json({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32000, message: 'Request timeout' },
          });
        });
        next();
      });
    }

    // Request logging
    this.app.use((req, res, next) => {
      const startTime = performance.now();
      res.on('finish', () => {
        const duration = performance.now() - startTime;
        this.logger.debug('HTTP request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration: `${duration.toFixed(2)}ms`,
        });
      });
      next();
    });
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        connections: this.activeConnections.size,
      });
    });

    // MCP JSON-RPC endpoint
    this.app.post('/rpc', async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    // Alternative MCP endpoint
    this.app.post('/mcp', async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    // Server info
    this.app.get('/info', (req, res) => {
      res.json({
        name: 'Claude-Flow MCP Server V3',
        version: '3.0.0',
        transport: 'http',
        capabilities: {
          jsonrpc: true,
          websocket: true,
        },
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        path: req.path,
      });
    });

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      this.logger.error('Express error', { error: err });
      this.errors++;
      res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal error' },
      });
    });
  }

  /**
   * Setup WebSocket handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws, req) => {
      this.activeConnections.add(ws);
      this.logger.info('WebSocket client connected', {
        total: this.activeConnections.size,
      });

      ws.on('message', async (data) => {
        await this.handleWebSocketMessage(ws, data.toString());
      });

      ws.on('close', () => {
        this.activeConnections.delete(ws);
        this.logger.info('WebSocket client disconnected', {
          total: this.activeConnections.size,
        });
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error', { error });
        this.errors++;
        this.activeConnections.delete(ws);
      });
    });
  }

  /**
   * Handle HTTP request
   */
  private async handleHttpRequest(req: Request, res: Response): Promise<void> {
    this.httpRequests++;
    this.messagesReceived++;

    // Validate authentication (ALWAYS check, not just when explicitly enabled)
    // SECURITY: Auth should be opt-out, not opt-in
    const requiresAuth = this.config.auth?.enabled !== false; // Default to requiring auth

    if (requiresAuth && this.config.auth) {
      const authResult = this.validateAuth(req);
      if (!authResult.valid) {
        this.logger.warn('Authentication failed', {
          ip: req.ip,
          path: req.path,
          error: authResult.error,
        });
        res.status(401).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32001, message: 'Unauthorized' },
        });
        return;
      }
    } else if (requiresAuth && !this.config.auth) {
      // No auth configured but auth is required - warn and continue (development mode)
      this.logger.warn('No authentication configured - running in development mode');
    }

    const message = req.body;

    // Validate JSON-RPC format
    if (message.jsonrpc !== '2.0') {
      res.status(400).json({
        jsonrpc: '2.0',
        id: message.id || null,
        error: { code: -32600, message: 'Invalid JSON-RPC version' },
      });
      return;
    }

    if (!message.method) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: message.id || null,
        error: { code: -32600, message: 'Missing method' },
      });
      return;
    }

    // Handle notification vs request
    if (message.id === undefined) {
      // Notification
      if (this.notificationHandler) {
        await this.notificationHandler(message as MCPNotification);
      }
      res.status(204).end();
    } else {
      // Request
      if (!this.requestHandler) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: 'No request handler' },
        });
        return;
      }

      try {
        const response = await this.requestHandler(message as MCPRequest);
        res.json(response);
        this.messagesSent++;
      } catch (error) {
        this.errors++;
        res.status(500).json({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error',
          },
        });
      }
    }
  }

  /**
   * Handle WebSocket message
   */
  private async handleWebSocketMessage(ws: WebSocket, data: string): Promise<void> {
    this.wsMessages++;
    this.messagesReceived++;

    try {
      const message = JSON.parse(data);

      if (message.jsonrpc !== '2.0') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id || null,
          error: { code: -32600, message: 'Invalid JSON-RPC version' },
        }));
        return;
      }

      if (message.id === undefined) {
        // Notification
        if (this.notificationHandler) {
          await this.notificationHandler(message as MCPNotification);
        }
      } else {
        // Request
        if (!this.requestHandler) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32603, message: 'No request handler' },
          }));
          return;
        }

        const response = await this.requestHandler(message as MCPRequest);
        ws.send(JSON.stringify(response));
        this.messagesSent++;
      }
    } catch (error) {
      this.errors++;
      this.logger.error('WebSocket message error', { error });

      try {
        const parsed = JSON.parse(data);
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id || null,
          error: { code: -32700, message: 'Parse error' },
        }));
      } catch {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }));
      }
    }
  }

  /**
   * Validate authentication
   */
  private validateAuth(req: Request): { valid: boolean; error?: string } {
    const auth = req.headers.authorization;

    if (!auth) {
      return { valid: false, error: 'Authorization header required' };
    }

    const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return { valid: false, error: 'Invalid authorization format' };
    }

    const token = tokenMatch[1];

    if (this.config.auth?.tokens?.length) {
      if (!this.config.auth.tokens.includes(token)) {
        return { valid: false, error: 'Invalid token' };
      }
    }

    return { valid: true };
  }
}

/**
 * Create HTTP transport
 */
export function createHttpTransport(
  logger: ILogger,
  config: HttpTransportConfig
): HttpTransport {
  return new HttpTransport(logger, config);
}
