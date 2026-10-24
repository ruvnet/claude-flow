/**
 * @claude-flow/mcp - HTTP Transport
 *
 * HTTP/REST transport with WebSocket support
 */

import { EventEmitter } from 'events';
import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
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
  AuthConfig,
} from '../types.js';

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

export class HttpTransport extends EventEmitter implements ITransport {
  public readonly type: TransportType = 'http';

  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private app: Express;
  private server?: Server;
  private wss?: WebSocketServer;
  private running = false;
  private activeConnections = new Set<WebSocket>();

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

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('HTTP transport already running');
    }

    this.logger.info('Starting HTTP transport', {
      host: this.config.host,
      port: this.config.port,
    });

    this.server = createServer(this.app);

    this.wss = new WebSocketServer({
      server: this.server,
      path: '/ws',
    });

    this.setupWebSocketHandlers();

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

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping HTTP transport');
    this.running = false;

    for (const ws of this.activeConnections) {
      try {
        ws.close(1000, 'Server shutting down');
      } catch {
        // Ignore errors
      }
    }
    this.activeConnections.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }

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

  private setupMiddleware(): void {
    this.app.use(helmet({
      contentSecurityPolicy: false,
    }));

    if (this.config.corsEnabled !== false) {
      const allowedOrigins = this.config.corsOrigins;

      if (!allowedOrigins || allowedOrigins.length === 0) {
        this.logger.warn('CORS: No origins configured, restricting to same-origin only');
      }

      this.app.use(cors({
        origin: (origin, callback) => {
          if (!origin) {
            callback(null, true);
            return;
          }

          if (allowedOrigins && allowedOrigins.length > 0) {
            if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
              callback(null, true);
            } else {
              callback(new Error(`CORS: Origin '${origin}' not allowed`));
            }
          } else {
            callback(new Error('CORS: Cross-origin requests not allowed'));
          }
        },
        credentials: true,
        maxAge: 86400,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      }));
    }

    this.app.use(express.json({
      limit: this.config.maxRequestSize || '10mb',
    }));

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

  private setupRoutes(): void {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        connections: this.activeConnections.size,
      });
    });

    this.app.post('/rpc', async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    this.app.post('/mcp', async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

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

    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        path: req.path,
      });
    });

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

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    // SECURITY: Handle WebSocket authentication via upgrade request
    this.wss.on('connection', (ws, req) => {
      // Validate authentication if enabled
      if (this.config.auth?.enabled) {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const token = url.searchParams.get('token') || req.headers['authorization']?.replace(/^Bearer\s+/i, '');

        if (!token) {
          this.logger.warn('WebSocket connection rejected: no authentication token');
          ws.close(4001, 'Authentication required');
          return;
        }

        // SECURITY: Timing-safe token validation
        let valid = false;
        if (this.config.auth.tokens?.length) {
          for (const validToken of this.config.auth.tokens) {
            if (this.timingSafeCompare(token, validToken)) {
              valid = true;
              break;
            }
          }
        }

        if (!valid) {
          this.logger.warn('WebSocket connection rejected: invalid token');
          ws.close(4003, 'Invalid token');
          return;
        }
      }

      this.activeConnections.add(ws);
      this.logger.info('WebSocket client connected', {
        total: this.activeConnections.size,
        authenticated: !!this.config.auth?.enabled,
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

  private async handleHttpRequest(req: Request, res: Response): Promise<void> {
    this.httpRequests++;
    this.messagesReceived++;

    const requiresAuth = this.config.auth?.enabled !== false;

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
      this.logger.warn('No authentication configured - running in development mode');
    }

    const message = req.body;

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

    if (message.id === undefined) {
      if (this.notificationHandler) {
        await this.notificationHandler(message as MCPNotification);
      }
      res.status(204).end();
    } else {
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
        if (this.notificationHandler) {
          await this.notificationHandler(message as MCPNotification);
        }
      } else {
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
   * SECURITY: Timing-safe token comparison to prevent timing attacks
   */
  private timingSafeCompare(a: string, b: string): boolean {
    const crypto = require('crypto');

    // Ensure both strings are the same length for timing-safe comparison
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');

    // If lengths differ, still do a comparison to prevent length-based timing
    if (bufA.length !== bufB.length) {
      // Compare against itself to maintain constant time
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }

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
      // SECURITY: Use timing-safe comparison to prevent timing attacks
      let valid = false;
      for (const validToken of this.config.auth.tokens) {
        if (this.timingSafeCompare(token, validToken)) {
          valid = true;
          break;
        }
      }
      if (!valid) {
        return { valid: false, error: 'Invalid token' };
      }
    }

    return { valid: true };
  }
}

export function createHttpTransport(
  logger: ILogger,
  config: HttpTransportConfig
): HttpTransport {
  return new HttpTransport(logger, config);
}
