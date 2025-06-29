/**
 * IPC Client Implementation
 * Manages client-side IPC communication
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  IPCClient,
  IPCTransport,
  IPCConnection,
  IPCMessage,
  IPCConfig,
  MessageType,
  IPCError,
  IPCErrorCode
} from './types.js';

/**
 * IPC Client implementation
 */
export class IPCClientImpl extends EventEmitter implements IPCClient {
  public connection?: IPCConnection;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts: number = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  
  constructor(
    public readonly transport: IPCTransport,
    private readonly config: IPCConfig
  ) {
    super();
  }
  
  /**
   * Connect to IPC server
   */
  async connect(): Promise<void> {
    if (this.connection?.connected) {
      throw new IPCError(
        IPCErrorCode.CONNECTION_FAILED,
        'Client is already connected'
      );
    }
    
    try {
      this.connection = await this.transport.connect();
      this.setupConnectionHandlers();
      
      // Start heartbeat if configured
      if (this.config.heartbeatInterval) {
        this.startHeartbeat();
      }
      
      this.reconnectAttempts = 0;
      this.emit('connected');
    } catch (error) {
      if (this.config.reconnectAttempts && this.config.reconnectAttempts > 0) {
        this.scheduleReconnect();
      }
      throw error;
    }
  }
  
  /**
   * Disconnect from server
   */
  async disconnect(): Promise<void> {
    this.cancelReconnect();
    this.stopHeartbeat();
    
    if (this.connection) {
      await this.connection.close();
      this.connection = undefined;
    }
    
    // Cancel all pending requests
    this.pendingRequests.forEach((pending) => {
      pending.reject(new IPCError(
        IPCErrorCode.CONNECTION_LOST,
        'Client disconnected'
      ));
    });
    this.pendingRequests.clear();
    
    this.emit('disconnected');
  }
  
  /**
   * Send a message
   */
  async send(message: IPCMessage): Promise<void> {
    if (!this.connection?.connected) {
      throw new IPCError(
        IPCErrorCode.CONNECTION_LOST,
        'Not connected to server'
      );
    }
    
    await this.connection.send(message);
  }
  
  /**
   * Send a request and wait for response
   */
  async request(command: string, payload?: any, timeout?: number): Promise<any> {
    if (!this.connection?.connected) {
      throw new IPCError(
        IPCErrorCode.CONNECTION_LOST,
        'Not connected to server'
      );
    }
    
    const requestId = randomUUID();
    const effectiveTimeout = timeout || this.config.requestTimeout || 30000;
    
    const message: IPCMessage = {
      id: requestId,
      type: MessageType.COMMAND_REQUEST,
      command,
      payload,
      timestamp: new Date()
    };
    
    return new Promise((resolve, reject) => {
      // Setup timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new IPCError(
          IPCErrorCode.TIMEOUT,
          `Request timeout: ${command}`
        ));
      }, effectiveTimeout);
      
      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        command
      });
      
      // Send request
      this.send(message).catch((error) => {
        this.pendingRequests.delete(requestId);
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  
  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;
    
    this.connection.on('message', (message) => {
      this.handleMessage(message);
    });
    
    this.connection.on('error', (error) => {
      this.emit('error', error);
    });
    
    this.connection.on('close', () => {
      this.handleDisconnection();
    });
  }
  
  /**
   * Handle incoming message
   */
  private handleMessage(message: IPCMessage): void {
    switch (message.type) {
      case MessageType.COMMAND_RESPONSE:
        this.handleCommandResponse(message);
        break;
        
      case MessageType.ERROR:
        this.handleErrorMessage(message);
        break;
        
      case MessageType.HEARTBEAT:
        // Server heartbeat received
        break;
        
      default:
        // Emit for custom handling
        this.emit('message', message);
    }
  }
  
  /**
   * Handle command response
   */
  private handleCommandResponse(message: IPCMessage): void {
    const requestId = message.headers?.['in-reply-to'];
    if (!requestId) return;
    
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    
    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);
    pending.resolve(message.payload);
  }
  
  /**
   * Handle error message
   */
  private handleErrorMessage(message: IPCMessage): void {
    const originalId = message.payload?.originalMessageId;
    if (!originalId) {
      this.emit('error', new IPCError(
        message.payload?.code || IPCErrorCode.PROTOCOL_ERROR,
        message.payload?.error || 'Unknown error'
      ));
      return;
    }
    
    const pending = this.pendingRequests.get(originalId);
    if (!pending) return;
    
    clearTimeout(pending.timer);
    this.pendingRequests.delete(originalId);
    pending.reject(new IPCError(
      message.payload?.code || IPCErrorCode.PROTOCOL_ERROR,
      message.payload?.error || 'Request failed'
    ));
  }
  
  /**
   * Handle disconnection
   */
  private handleDisconnection(): void {
    this.connection = undefined;
    this.stopHeartbeat();
    
    // Reject all pending requests
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new IPCError(
        IPCErrorCode.CONNECTION_LOST,
        'Connection lost'
      ));
    });
    this.pendingRequests.clear();
    
    this.emit('disconnected');
    
    // Try to reconnect if configured
    if (this.config.reconnectAttempts && this.config.reconnectAttempts > 0) {
      this.scheduleReconnect();
    }
  }
  
  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    if (this.reconnectAttempts >= (this.config.reconnectAttempts || 0)) {
      return;
    }
    
    const delay = this.config.reconnectDelay || 1000;
    const backoffDelay = delay * Math.pow(2, this.reconnectAttempts);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectAttempts++;
      
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
        this.scheduleReconnect();
      });
    }, Math.min(backoffDelay, 30000)); // Max 30 seconds
  }
  
  /**
   * Cancel reconnection
   */
  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempts = 0;
  }
  
  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    if (!this.config.heartbeatInterval || this.heartbeatTimer) return;
    
    this.heartbeatTimer = setInterval(() => {
      if (!this.connection?.connected) {
        this.stopHeartbeat();
        return;
      }
      
      const heartbeat: IPCMessage = {
        id: randomUUID(),
        type: MessageType.HEARTBEAT,
        timestamp: new Date()
      };
      
      this.send(heartbeat).catch((error) => {
        console.error('Heartbeat failed:', error);
      });
    }, this.config.heartbeatInterval);
  }
  
  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
  
  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connection?.connected || false;
  }
  
  /**
   * Get connection info
   */
  getConnectionInfo(): {
    connected: boolean;
    remoteInfo?: any;
    reconnectAttempts: number;
  } {
    return {
      connected: this.isConnected(),
      remoteInfo: this.connection?.remoteInfo,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

/**
 * Pending request tracker
 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  command: string;
}