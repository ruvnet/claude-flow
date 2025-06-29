/**
 * Named Pipe Transport Implementation
 * IPC transport using Windows named pipes
 */

import * as net from 'net';
import { randomUUID } from 'crypto';
import {
  IPCConnection,
  TransportType,
  IPCMessage,
  IPCError,
  IPCErrorCode
} from '../types.js';
import { BaseTransport, BaseConnection, MessageFramer } from './base-transport.js';

/**
 * Named pipe connection implementation
 */
class NamedPipeConnection extends BaseConnection {
  private framer: MessageFramer = new MessageFramer();
  
  constructor(private socket: net.Socket) {
    super();
    
    this.connected = true;
    this.setupSocketHandlers();
  }
  
  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    this.socket.on('data', (data: Buffer) => {
      const messages = this.framer.addData(data);
      messages.forEach(message => this.handleMessage(JSON.stringify(message)));
    });
    
    this.socket.on('error', (error: Error) => {
      this.emit('error', new IPCError(
        IPCErrorCode.TRANSPORT_ERROR,
        'Named pipe error',
        error
      ));
    });
    
    this.socket.on('close', () => {
      this.connected = false;
      this.emit('close');
    });
    
    this.socket.on('end', () => {
      this.connected = false;
    });
  }
  
  /**
   * Send raw message through pipe
   */
  protected async sendRaw(message: IPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const frame = this.framer.frameMessage(message);
      
      this.socket.write(frame, (error) => {
        if (error) {
          reject(new IPCError(
            IPCErrorCode.TRANSPORT_ERROR,
            'Failed to send message',
            error
          ));
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * Close the pipe connection
   */
  protected async closeRaw(): Promise<void> {
    return new Promise((resolve) => {
      this.framer.clear();
      
      if (this.socket.destroyed) {
        resolve();
        return;
      }
      
      this.socket.end(() => {
        this.socket.destroy();
        resolve();
      });
    });
  }
}

/**
 * Named pipe transport implementation for Windows
 */
export class NamedPipeTransport extends BaseTransport {
  private server?: net.Server;
  private readonly pipeName: string;
  
  constructor(pipeName?: string) {
    const defaultName = pipeName || `claude-flow-${process.pid}`;
    const pipePath = `\\\\.\\pipe\\${defaultName}`;
    
    super(TransportType.NAMED_PIPE, pipePath);
    this.pipeName = defaultName;
  }
  
  /**
   * Start listening for connections
   */
  async listen(callback: (connection: IPCConnection) => void): Promise<void> {
    if (this._listening) {
      throw new IPCError(
        IPCErrorCode.TRANSPORT_ERROR,
        'Transport is already listening'
      );
    }
    
    return new Promise((resolve, reject) => {
      this.server = net.createServer();
      
      this.server.on('connection', async (socket: net.Socket) => {
        const connection = new NamedPipeConnection(socket);
        this.trackConnection(connection);
        
        try {
          // Perform handshake
          await this.performHandshake(connection);
          callback(connection);
        } catch (error) {
          connection.close();
          console.error('Handshake failed:', error);
        }
      });
      
      this.server.on('error', (error: Error) => {
        reject(new IPCError(
          IPCErrorCode.TRANSPORT_ERROR,
          'Named pipe server error',
          error
        ));
      });
      
      // Listen on the named pipe
      this.server.listen(this.path, () => {
        this._listening = true;
        resolve();
      });
    });
  }
  
  /**
   * Connect to a named pipe server
   */
  async connect(): Promise<IPCConnection> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.path);
      
      socket.on('connect', async () => {
        const connection = new NamedPipeConnection(socket);
        this.trackConnection(connection);
        
        try {
          // Perform handshake
          await this.performHandshake(connection);
          resolve(connection);
        } catch (error) {
          connection.close();
          reject(error);
        }
      });
      
      socket.on('error', (error: Error) => {
        reject(new IPCError(
          IPCErrorCode.CONNECTION_FAILED,
          'Failed to connect to named pipe',
          error
        ));
      });
      
      // Set connection timeout
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new IPCError(
          IPCErrorCode.TIMEOUT,
          'Connection timeout'
        ));
      });
    });
  }
  
  /**
   * Close the transport
   */
  protected async closeTransport(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          resolve();
        });
      });
    }
  }
  
  /**
   * Check if pipe exists (Windows-specific)
   */
  async exists(): Promise<boolean> {
    if (process.platform !== 'win32') {
      return false;
    }
    
    try {
      // Try to connect to check if pipe exists
      const testSocket = net.createConnection(this.path);
      
      return new Promise((resolve) => {
        testSocket.on('connect', () => {
          testSocket.destroy();
          resolve(true);
        });
        
        testSocket.on('error', () => {
          resolve(false);
        });
        
        testSocket.setTimeout(100, () => {
          testSocket.destroy();
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }
  
  /**
   * Get pipe security descriptor (Windows-specific)
   * Note: This would require native Windows API calls for full implementation
   */
  async getSecurityInfo(): Promise<{
    owner?: string;
    permissions?: string;
  }> {
    // Simplified version - full implementation would use Windows APIs
    return {
      owner: process.env.USERNAME || 'unknown',
      permissions: 'default'
    };
  }
}