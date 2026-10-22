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
import { rateLimit } from 'express-rate-limit';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
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
  rateLimit?: {
    windowMs?: number;
    limit?: number;
  };
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
  private sseClients = new Map<string, Response>();

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

    for (const response of this.sseClients.values()) {
      response.end();
    }
    this.sseClients.clear();

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

    for (const response of this.sseClients.values()) {
      response.write(`event: message\ndata: ${message}\n\n`);
      this.messagesSent++;
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

    // Bound authenticated and unauthenticated RPC traffic before route-level
    // authorization or request dispatch can consume significant resources.
    this.app.use(['/rpc', '/mcp'], rateLimit({
      windowMs: this.config.rateLimit?.windowMs ?? 60_000,
      limit: this.config.rateLimit?.limit ?? 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Rate limit exceeded' },
      },
    }));

    // Bearer-token gate for every route (health excepted, see isPublicHealthRequest).
    // Runs after CORS (so preflights are unchanged) and the rate limiter (so
    // failed attempts are bounded), and before the body parser so an
    // unauthenticated client cannot make the server read or parse a body.
    if (this.config.auth?.enabled) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        if (this.isPublicHealthRequest(req) || this.validateAuth(req).valid) {
          next();
          return;
        }
        this.rejectUnauthorized(req, res);
      });
    }

    this.app.use(express.json({
      limit: this.config.maxRequestSize || '10mb',
    }));

    if (this.config.requestTimeout) {
      this.app.use((req, res, next) => {
        res.setTimeout(this.config.requestTimeout!, () => {
          // A handler may have completed just as the socket timeout fired.
          if (res.headersSent || res.writableEnded || res.destroyed) return;
          res.status(408).json({
            jsonrpc: '2.0',
            id: req.body?.id ?? null,
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
      // With auth enabled this route is reachable without credentials, so it
      // reveals only liveness: no timestamp, no connection count.
      if (this.config.auth?.enabled) {
        res.json({ status: 'ok' });
        return;
      }
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        connections: this.activeConnections.size,
      });
    });

    this.app.post('/rpc', async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    // Legacy MCP clients fall back to the HTTP+SSE transport when
    // Streamable HTTP negotiation fails. Advertise this same POST endpoint
    // and route its responses back over the established event stream.
    this.app.get('/mcp', (req, res) => {
      if (this.config.auth?.enabled && !this.validateAuth(req).valid) {
        this.rejectUnauthorized(req, res);
        return;
      }

      const sessionId = randomUUID();
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      this.sseClients.set(sessionId, res);
      res.write(`event: endpoint\ndata: /mcp?sessionId=${encodeURIComponent(sessionId)}\n\n`);

      res.on('close', () => {
        if (this.sseClients.get(sessionId) === res) {
          this.sseClients.delete(sessionId);
        }
      });
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
      if (res.headersSent || res.writableEnded || res.destroyed) return;
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
        this.rejectUnauthorized(req, res);
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

    const sseSessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    const sseResponse = sseSessionId ? this.sseClients.get(sseSessionId) : undefined;

    if (message.id === undefined) {
      if (this.notificationHandler) {
        await this.notificationHandler(message as MCPNotification);
      }
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      res.status(sseResponse ? 202 : 204).end();
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
        // A timed-out request can still finish its tool work; its HTTP reply
        // already belongs to the timeout path and must not be written again.
        if (res.headersSent || res.writableEnded || res.destroyed) return;
        if (sseResponse) {
          sseResponse.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
          res.status(202).end();
        } else {
          res.json(response);
        }
        this.messagesSent++;
      } catch (error) {
        this.errors++;
        if (res.headersSent || res.writableEnded || res.destroyed) return;
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
   * SECURITY: constant-time token comparison. Both sides are hashed first so
   * the comparison is over equal-length digests and leaks neither content nor
   * length.
   */
  private timingSafeCompare(a: string, b: string): boolean {
    const digestA = createHash('sha256').update(a, 'utf8').digest();
    const digestB = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(digestA, digestB);
  }

  /** Only GET/HEAD of exactly /health (any case, optional trailing slash) is public. */
  private isPublicHealthRequest(req: Request): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    return req.path.toLowerCase().replace(/\/$/, '') === '/health';
  }

  /** One generic 401 for every failure mode: no hint about what was wrong. */
  private rejectUnauthorized(req: Request, res: Response): void {
    // Never log the Authorization header or any token material.
    this.logger.warn('Authentication failed', { ip: req.ip, path: req.path });
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized' },
    });
  }

  private validateAuth(req: Request): { valid: boolean } {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string') {
      return { valid: false };
    }

    const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return { valid: false };
    }

    // Fail closed: auth enabled with no configured token accepts nothing.
    const tokens = this.config.auth?.tokens ?? [];
    let valid = false;
    for (const validToken of tokens) {
      // No early exit, so timing does not depend on which token matched.
      if (this.timingSafeCompare(tokenMatch[1], validToken)) {
        valid = true;
      }
    }
    return { valid };
  }
}

export function createHttpTransport(
  logger: ILogger,
  config: HttpTransportConfig
): HttpTransport {
  return new HttpTransport(logger, config);
}
