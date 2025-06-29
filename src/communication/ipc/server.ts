/**
 * IPC Server Implementation
 * Manages incoming connections and message routing
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  IPCServer,
  IPCTransport,
  IPCConnection,
  IPCMessage,
  IPCConfig,
  IPCSecurityOptions,
  MessageType,
  IPCError,
  IPCErrorCode,
  MessageHandler
} from './types.js';

/**
 * IPC Server implementation
 */
export class IPCServerImpl extends EventEmitter implements IPCServer {
  public readonly connections: Map<string, IPCConnection> = new Map();
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private started: boolean = false;
  
  constructor(
    public readonly transport: IPCTransport,
    private readonly config: IPCConfig
  ) {
    super();
    this.setupDefaultHandlers();
  }
  
  /**
   * Start the IPC server
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new IPCError(
        IPCErrorCode.TRANSPORT_ERROR,
        'Server is already started'
      );
    }
    
    await this.transport.listen((connection) => {
      this.handleNewConnection(connection);
    });
    
    this.started = true;
    this.emit('listening');
  }
  
  /**
   * Stop the IPC server
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    
    // Close all connections
    const closePromises = Array.from(this.connections.values()).map(
      conn => conn.close()
    );
    await Promise.all(closePromises);
    
    // Close transport
    await this.transport.close();
    
    this.connections.clear();
    this.rateLimiters.clear();
    this.started = false;
  }
  
  /**
   * Broadcast a message to all connections
   */
  async broadcast(message: IPCMessage, excludeConnection?: string): Promise<void> {
    const promises = Array.from(this.connections.entries())
      .filter(([id]) => id !== excludeConnection)
      .map(([_, conn]) => conn.send(message).catch(err => {
        console.error(`Failed to broadcast to connection ${conn.id}:`, err);
      }));
    
    await Promise.all(promises);
  }
  
  /**
   * Register a message handler
   */
  registerHandler(command: string, handler: MessageHandler): void {
    this.messageHandlers.set(command, handler);
  }
  
  /**
   * Unregister a message handler
   */
  unregisterHandler(command: string): void {
    this.messageHandlers.delete(command);
  }
  
  /**
   * Handle new connection
   */
  private handleNewConnection(connection: IPCConnection): void {
    // Apply security checks
    if (!this.validateConnection(connection)) {
      connection.close();
      return;
    }
    
    // Store connection
    this.connections.set(connection.id, connection);
    
    // Setup rate limiter if enabled
    if (this.config.security?.rateLimitPerSecond) {
      this.rateLimiters.set(
        connection.id,
        new RateLimiter(this.config.security.rateLimitPerSecond)
      );
    }
    
    // Setup connection handlers
    connection.on('message', (message) => {
      this.handleMessage(connection, message);
    });
    
    connection.on('error', (error) => {
      console.error(`Connection ${connection.id} error:`, error);
      this.emit('error', error);
    });
    
    connection.on('close', () => {
      this.connections.delete(connection.id);
      this.rateLimiters.delete(connection.id);
    });
    
    // Emit connection event
    this.emit('connection', connection);
  }
  
  /**
   * Validate connection based on security options
   */
  private validateConnection(connection: IPCConnection): boolean {
    const security = this.config.security;
    if (!security) return true;
    
    // Check allowed processes
    if (security.allowedProcesses && connection.remoteInfo?.processName) {
      if (!security.allowedProcesses.includes(connection.remoteInfo.processName)) {
        console.warn(`Rejected connection from unauthorized process: ${connection.remoteInfo.processName}`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Handle incoming message
   */
  private async handleMessage(connection: IPCConnection, message: IPCMessage): Promise<void> {
    try {
      // Check rate limit
      const rateLimiter = this.rateLimiters.get(connection.id);
      if (rateLimiter && !rateLimiter.tryConsume()) {
        throw new IPCError(
          IPCErrorCode.RATE_LIMIT_EXCEEDED,
          'Rate limit exceeded'
        );
      }
      
      // Check message size
      if (this.config.security?.maxMessageSize) {
        const messageSize = JSON.stringify(message).length;
        if (messageSize > this.config.security.maxMessageSize) {
          throw new IPCError(
            IPCErrorCode.MESSAGE_TOO_LARGE,
            `Message size ${messageSize} exceeds limit ${this.config.security.maxMessageSize}`
          );
        }
      }
      
      // Handle based on message type
      switch (message.type) {
        case MessageType.HEARTBEAT:
          // Respond with heartbeat
          await connection.send({
            id: randomUUID(),
            type: MessageType.HEARTBEAT,
            timestamp: new Date()
          });
          break;
          
        case MessageType.COMMAND_REQUEST:
          await this.handleCommandRequest(connection, message);
          break;
          
        case MessageType.PROCESS_REGISTER:
        case MessageType.PROCESS_UNREGISTER:
        case MessageType.PROCESS_STATUS:
          // Forward to process registry if available
          this.emit('process-message', connection, message);
          break;
          
        default:
          // Emit for custom handling
          this.emit('message', connection, message);
      }
    } catch (error) {
      // Send error response
      const errorMessage: IPCMessage = {
        id: randomUUID(),
        type: MessageType.ERROR,
        timestamp: new Date(),
        payload: {
          originalMessageId: message.id,
          error: error instanceof Error ? error.message : String(error),
          code: error instanceof IPCError ? error.code : IPCErrorCode.PROTOCOL_ERROR
        }
      };
      
      await connection.send(errorMessage).catch(err => {
        console.error('Failed to send error response:', err);
      });
    }
  }
  
  /**
   * Handle command request
   */
  private async handleCommandRequest(
    connection: IPCConnection,
    message: IPCMessage
  ): Promise<void> {
    const { command, payload } = message;
    
    if (!command) {
      throw new IPCError(
        IPCErrorCode.PROTOCOL_ERROR,
        'Command request missing command field'
      );
    }
    
    const handler = this.messageHandlers.get(command);
    if (!handler) {
      throw new IPCError(
        IPCErrorCode.PROTOCOL_ERROR,
        `Unknown command: ${command}`
      );
    }
    
    try {
      const result = await handler(payload, connection, message);
      
      // Send response
      const response: IPCMessage = {
        id: randomUUID(),
        type: MessageType.COMMAND_RESPONSE,
        timestamp: new Date(),
        command,
        payload: result,
        headers: {
          'in-reply-to': message.id
        }
      };
      
      await connection.send(response);
    } catch (error) {
      throw error; // Will be caught by handleMessage
    }
  }
  
  /**
   * Setup default message handlers
   */
  private setupDefaultHandlers(): void {
    // Ping handler
    this.registerHandler('ping', async () => {
      return { pong: true, timestamp: new Date() };
    });
    
    // Server info handler
    this.registerHandler('server-info', async () => {
      return {
        version: '1.0.0',
        transport: this.transport.type,
        connections: this.connections.size,
        uptime: process.uptime()
      };
    });
    
    // List connections handler
    this.registerHandler('list-connections', async () => {
      return Array.from(this.connections.values()).map(conn => ({
        id: conn.id,
        connected: conn.connected,
        remoteInfo: conn.remoteInfo
      }));
    });
  }
}


/**
 * Simple rate limiter using token bucket algorithm
 */
class RateLimiter {
  private tokens: number;
  private lastRefill: number = Date.now();
  
  constructor(
    private readonly tokensPerSecond: number,
    private readonly maxTokens: number = tokensPerSecond
  ) {
    this.tokens = maxTokens;
  }
  
  /**
   * Try to consume a token
   */
  tryConsume(): boolean {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    
    return false;
  }
  
  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.tokensPerSecond
    );
    
    this.lastRefill = now;
  }
}