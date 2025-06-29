/**
 * Base Transport Implementation
 * Abstract base class for all IPC transport implementations
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  IPCTransport,
  IPCConnection,
  IPCMessage,
  TransportType,
  MessageType,
  ConnectionInfo,
  IPCError,
  IPCErrorCode
} from '../types.js';

/**
 * Base connection implementation
 */
export abstract class BaseConnection extends EventEmitter implements IPCConnection {
  public readonly id: string = randomUUID();
  public connected: boolean = false;
  public remoteInfo?: ConnectionInfo;
  
  private messageQueue: IPCMessage[] = [];
  private processing: boolean = false;
  
  constructor() {
    super();
    this.setMaxListeners(100); // Allow many listeners for complex scenarios
  }
  
  /**
   * Send a message through the connection
   */
  async send(message: IPCMessage): Promise<void> {
    if (!this.connected) {
      throw new IPCError(
        IPCErrorCode.CONNECTION_LOST,
        'Cannot send message: connection is closed'
      );
    }
    
    // Add to queue and process
    this.messageQueue.push(message);
    await this.processMessageQueue();
  }
  
  /**
   * Process message queue
   */
  private async processMessageQueue(): Promise<void> {
    if (this.processing || this.messageQueue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    try {
      while (this.messageQueue.length > 0 && this.connected) {
        const message = this.messageQueue.shift()!;
        await this.sendRaw(message);
      }
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Send raw message - must be implemented by subclasses
   */
  protected abstract sendRaw(message: IPCMessage): Promise<void>;
  
  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (!this.connected) {
      return;
    }
    
    this.connected = false;
    this.messageQueue = [];
    await this.closeRaw();
    this.emit('close');
  }
  
  /**
   * Close raw connection - must be implemented by subclasses
   */
  protected abstract closeRaw(): Promise<void>;
  
  /**
   * Handle incoming message
   */
  protected handleMessage(data: Buffer | string): void {
    try {
      const message = this.parseMessage(data);
      this.emit('message', message);
    } catch (error) {
      this.emit('error', new IPCError(
        IPCErrorCode.PROTOCOL_ERROR,
        'Failed to parse message',
        error
      ));
    }
  }
  
  /**
   * Parse incoming message
   */
  protected parseMessage(data: Buffer | string): IPCMessage {
    const text = typeof data === 'string' ? data : data.toString('utf8');
    
    try {
      const parsed = JSON.parse(text);
      
      // Validate message structure
      if (!parsed.id || !parsed.type || !parsed.timestamp) {
        throw new Error('Invalid message structure');
      }
      
      // Convert timestamp to Date
      parsed.timestamp = new Date(parsed.timestamp);
      
      return parsed as IPCMessage;
    } catch (error) {
      throw new IPCError(
        IPCErrorCode.PROTOCOL_ERROR,
        'Invalid message format',
        { originalData: text, error }
      );
    }
  }
  
  /**
   * Serialize message for sending
   */
  protected serializeMessage(message: IPCMessage): Buffer {
    const serialized = JSON.stringify({
      ...message,
      timestamp: message.timestamp.toISOString()
    });
    
    return Buffer.from(serialized, 'utf8');
  }
}

/**
 * Base transport implementation
 */
export abstract class BaseTransport implements IPCTransport {
  protected _listening: boolean = false;
  protected connections: Set<IPCConnection> = new Set();
  
  constructor(
    public readonly type: TransportType,
    public readonly path: string
  ) {}
  
  /**
   * Check if transport is listening
   */
  isListening(): boolean {
    return this._listening;
  }
  
  /**
   * Start listening for connections
   */
  abstract listen(callback: (connection: IPCConnection) => void): Promise<void>;
  
  /**
   * Connect to a server
   */
  abstract connect(): Promise<IPCConnection>;
  
  /**
   * Close the transport
   */
  async close(): Promise<void> {
    this._listening = false;
    
    // Close all connections
    const closePromises = Array.from(this.connections).map(conn => conn.close());
    await Promise.all(closePromises);
    
    this.connections.clear();
    await this.closeTransport();
  }
  
  /**
   * Close transport-specific resources
   */
  protected abstract closeTransport(): Promise<void>;
  
  /**
   * Add connection to tracking
   */
  protected trackConnection(connection: IPCConnection): void {
    this.connections.add(connection);
    
    connection.once('close', () => {
      this.connections.delete(connection);
    });
  }
  
  /**
   * Create handshake message
   */
  protected createHandshakeMessage(info?: Partial<ConnectionInfo>): IPCMessage {
    return {
      id: randomUUID(),
      type: MessageType.HANDSHAKE,
      timestamp: new Date(),
      payload: {
        pid: process.pid,
        processName: process.title || 'claude-flow',
        version: '1.0.0',
        ...info
      }
    };
  }
  
  /**
   * Perform handshake
   */
  protected async performHandshake(
    connection: BaseConnection,
    timeout: number = 5000
  ): Promise<ConnectionInfo> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new IPCError(
          IPCErrorCode.TIMEOUT,
          'Handshake timeout'
        ));
      }, timeout);
      
      // Listen for handshake response
      const handleHandshake = (message: IPCMessage) => {
        if (message.type === MessageType.HANDSHAKE) {
          clearTimeout(timer);
          connection.off('message', handleHandshake);
          
          const remoteInfo = message.payload as ConnectionInfo;
          connection.remoteInfo = remoteInfo;
          
          resolve(remoteInfo);
        }
      };
      
      connection.on('message', handleHandshake);
      
      // Send handshake
      const handshake = this.createHandshakeMessage();
      connection.send(handshake).catch(reject);
    });
  }
}

/**
 * Message framing utilities for stream-based transports
 */
export class MessageFramer {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly delimiter = '\n';
  
  /**
   * Add data to buffer and extract complete messages
   */
  addData(data: Buffer): IPCMessage[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    
    const messages: IPCMessage[] = [];
    let delimiterIndex: number;
    
    while ((delimiterIndex = this.buffer.indexOf(this.delimiter)) !== -1) {
      const messageData = this.buffer.subarray(0, delimiterIndex);
      this.buffer = this.buffer.subarray(delimiterIndex + 1);
      
      try {
        const text = messageData.toString('utf8');
        const message = JSON.parse(text);
        message.timestamp = new Date(message.timestamp);
        messages.push(message);
      } catch (error) {
        // Skip malformed messages
        console.error('Failed to parse IPC message:', error);
      }
    }
    
    return messages;
  }
  
  /**
   * Frame a message for sending
   */
  frameMessage(message: IPCMessage): Buffer {
    const serialized = JSON.stringify({
      ...message,
      timestamp: message.timestamp.toISOString()
    });
    
    return Buffer.from(serialized + this.delimiter, 'utf8');
  }
  
  /**
   * Clear buffer
   */
  clear(): void {
    this.buffer = Buffer.alloc(0);
  }
}