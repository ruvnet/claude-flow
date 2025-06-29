/**
 * Unix Socket Transport Implementation
 * IPC transport using Unix domain sockets for Unix/Linux/macOS
 */

import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';
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
 * Unix socket connection implementation
 */
class UnixSocketConnection extends BaseConnection {
  private framer: MessageFramer = new MessageFramer();
  private closeTimer?: NodeJS.Timeout;
  private errorCount = 0;
  private maxErrors = 10;
  
  constructor(private socket: net.Socket) {
    super();
    
    this.connected = socket.readyState === 'open';
    this.setupSocketHandlers();
  }
  
  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    this.socket.on('data', (data: Buffer) => {
      try {
        const messages = this.framer.addData(data);
        messages.forEach(message => this.handleMessage(JSON.stringify(message)));
        // Reset error count on successful data processing
        this.errorCount = 0;
      } catch (error) {
        this.errorCount++;
        if (this.errorCount > this.maxErrors) {
          this.emit('error', new IPCError(
            IPCErrorCode.PROTOCOL_ERROR,
            'Too many data processing errors',
            error
          ));
          this.forceClose();
        }
      }
    });
    
    this.socket.on('error', (error: Error) => {
      this.errorCount++;
      this.emit('error', new IPCError(
        IPCErrorCode.TRANSPORT_ERROR,
        'Socket error',
        error
      ));
      
      if (this.errorCount > this.maxErrors) {
        this.forceClose();
      }
    });
    
    this.socket.on('close', (hadError: boolean) => {
      this.connected = false;
      this.clearTimers();
      this.emit('close');
    });
    
    this.socket.on('end', () => {
      this.connected = false;
    });
    
    this.socket.on('timeout', () => {
      this.emit('error', new IPCError(
        IPCErrorCode.TIMEOUT,
        'Socket timeout'
      ));
      this.forceClose();
    });
    
    // Set socket timeout
    this.socket.setTimeout(300000); // 5 minutes
  }
  
  /**
   * Send raw message through socket
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
   * Close the socket connection
   */
  protected async closeRaw(): Promise<void> {
    return new Promise((resolve) => {
      this.clearTimers();
      this.framer.clear();
      
      if (this.socket.destroyed) {
        resolve();
        return;
      }
      
      // Set a timeout for graceful close
      this.closeTimer = setTimeout(() => {
        if (!this.socket.destroyed) {
          this.socket.destroy();
        }
        resolve();
      }, 5000); // 5 second timeout
      
      this.socket.end(() => {
        this.clearTimers();
        this.socket.destroy();
        resolve();
      });
    });
  }
  
  /**
   * Force close the connection immediately
   */
  private forceClose(): void {
    this.connected = false;
    this.clearTimers();
    this.framer.clear();
    
    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
  }
  
  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }
  }
}

/**
 * Unix socket transport implementation
 */
export interface UnixSocketConfig {
  socketPath?: string;
  connectionTimeout?: number;
  maxConnections?: number;
  socketPermissions?: string;
}

export class UnixSocketTransport extends BaseTransport {
  private server?: net.Server;
  private readonly socketDir: string;
  private readonly socketFile: string;
  private readonly config: Required<UnixSocketConfig>;
  private connectionCount = 0;
  
  constructor(config: UnixSocketConfig = {}) {
    const defaultPath = path.join(
      process.platform === 'darwin' ? '/tmp' : '/var/run',
      'claude-flow',
      `claude-flow-${process.pid}.sock`
    );
    
    const fullPath = config.socketPath || defaultPath;
    super(TransportType.UNIX_SOCKET, fullPath);
    
    this.config = {
      socketPath: fullPath,
      connectionTimeout: 5000,
      maxConnections: 100,
      socketPermissions: '0666',
      ...config
    };
    
    this.socketDir = path.dirname(fullPath);
    this.socketFile = path.basename(fullPath);
  }
  
  /**
   * Ensure socket directory exists with proper permissions
   */
  private async ensureSocketDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.socketDir, { recursive: true, mode: 0o755 });
      
      // On macOS and Linux, set proper permissions
      if (process.platform !== 'win32') {
        await fs.chmod(this.socketDir, 0o755);
      }
    } catch (error) {
      throw new IPCError(
        IPCErrorCode.TRANSPORT_ERROR,
        'Failed to create socket directory',
        error
      );
    }
  }
  
  /**
   * Clean up existing socket file
   */
  private async cleanupSocket(): Promise<void> {
    try {
      await fs.unlink(this.path);
    } catch (error: any) {
      // Ignore if file doesn't exist
      if (error.code !== 'ENOENT') {
        console.warn('Failed to cleanup existing socket:', error);
      }
    }
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
    
    // Ensure directory exists and cleanup old socket
    await this.ensureSocketDirectory();
    await this.cleanupSocket();
    
    return new Promise((resolve, reject) => {
      this.server = net.createServer();
      
      this.server.on('connection', async (socket: net.Socket) => {
        // Check connection limit
        if (this.connectionCount >= this.config.maxConnections) {
          console.warn('Connection limit reached, rejecting new connection');
          socket.destroy();
          return;
        }
        
        this.connectionCount++;
        const connection = new UnixSocketConnection(socket);
        
        // Track connection cleanup
        connection.once('close', () => {
          this.connectionCount--;
        });
        
        this.trackConnection(connection);
        
        try {
          // Perform handshake with timeout
          await this.performHandshake(connection, this.config.connectionTimeout);
          callback(connection);
        } catch (error) {
          await connection.close();
          console.error('Handshake failed:', error);
        }
      });
      
      this.server.on('error', (error: Error) => {
        reject(new IPCError(
          IPCErrorCode.TRANSPORT_ERROR,
          'Server error',
          error
        ));
      });
      
      // Set max connections
      this.server.maxConnections = this.config.maxConnections;
      
      this.server.listen(this.path, async () => {
        this._listening = true;
        
        // Set socket permissions (Unix/Linux/macOS)
        if (process.platform !== 'win32') {
          try {
            await fs.chmod(this.path, parseInt(this.config.socketPermissions, 8));
          } catch (error) {
            console.warn('Failed to set socket permissions:', error);
          }
        }
        
        resolve();
      });
    });
  }
  
  /**
   * Connect to a Unix socket server
   */
  async connect(): Promise<IPCConnection> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.path);
      let handshakeCompleted = false;
      
      socket.on('connect', async () => {
        const connection = new UnixSocketConnection(socket);
        this.trackConnection(connection);
        
        try {
          // Perform handshake with configurable timeout
          await this.performHandshake(connection, this.config.connectionTimeout);
          handshakeCompleted = true;
          resolve(connection);
        } catch (error) {
          await connection.close();
          reject(error);
        }
      });
      
      socket.on('error', (error: Error) => {
        if (!handshakeCompleted) {
          reject(new IPCError(
            IPCErrorCode.CONNECTION_FAILED,
            'Failed to connect to Unix socket',
            error
          ));
        }
      });
      
      socket.on('timeout', () => {
        if (!handshakeCompleted) {
          socket.destroy();
          reject(new IPCError(
            IPCErrorCode.TIMEOUT,
            'Connection timeout'
          ));
        }
      });
      
      // Set connection timeout
      socket.setTimeout(this.config.connectionTimeout);
    });
  }
  
  /**
   * Close the transport
   */
  protected async closeTransport(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(async () => {
          await this.cleanupSocket();
          resolve();
        });
      });
    }
  }
  
  /**
   * Get socket status information
   */
  async getStatus(): Promise<{
    exists: boolean;
    permissions?: string;
    owner?: number;
    group?: number;
  }> {
    try {
      const stats = await fs.stat(this.path);
      return {
        exists: true,
        permissions: (stats.mode & parseInt('777', 8)).toString(8),
        owner: stats.uid,
        group: stats.gid
      };
    } catch (error) {
      return { exists: false };
    }
  }
}