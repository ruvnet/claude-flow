/**
 * HTTP Transport Implementation
 * Cross-platform IPC transport using HTTP as a fallback
 */

import * as http from 'http';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  IPCConnection,
  TransportType,
  IPCMessage,
  IPCError,
  IPCErrorCode,
  ConnectionInfo
} from '../types.js';
import { BaseTransport, BaseConnection } from './base-transport.js';

/**
 * HTTP-based connection using Server-Sent Events for real-time communication
 */
class HTTPConnection extends BaseConnection {
  private response?: http.ServerResponse;
  private heartbeatInterval?: NodeJS.Timeout;
  
  constructor(
    private request: http.IncomingMessage,
    response?: http.ServerResponse
  ) {
    super();
    
    this.response = response;
    this.connected = true;
    
    if (response) {
      this.setupServerConnection();
    } else {
      this.setupClientConnection();
    }
  }
  
  /**
   * Setup server-side connection
   */
  private setupServerConnection(): void {
    if (!this.response) return;
    
    // Setup Server-Sent Events
    this.response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    // Send initial connection event
    this.response.write(`event: connected\ndata: ${JSON.stringify({ id: this.id })}\n\n`);
    
    // Setup heartbeat
    this.heartbeatInterval = setInterval(() => {
      if (this.connected && this.response) {
        this.response.write(':heartbeat\n\n');
      }
    }, 30000);
    
    // Handle connection close
    this.request.on('close', () => {
      this.handleClose();
    });
    
    this.request.on('error', (error) => {
      this.emit('error', new IPCError(
        IPCErrorCode.TRANSPORT_ERROR,
        'Request error',
        error
      ));
    });
  }
  
  /**
   * Setup client-side connection
   */
  private setupClientConnection(): void {
    // Client implementation would use EventSource or similar
    // For now, this is a placeholder
  }
  
  /**
   * Send raw message through HTTP
   */
  protected async sendRaw(message: IPCMessage): Promise<void> {
    if (!this.response || !this.connected) {
      throw new IPCError(
        IPCErrorCode.CONNECTION_LOST,
        'Cannot send message: connection is closed'
      );
    }
    
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(message);
      const event = `event: message\ndata: ${data}\n\n`;
      
      this.response!.write(event, (error) => {
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
   * Close the HTTP connection
   */
  protected async closeRaw(): Promise<void> {
    this.handleClose();
  }
  
  /**
   * Handle connection close
   */
  private handleClose(): void {
    this.connected = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.response && !this.response.writableEnded) {
      this.response.write('event: close\ndata: {}\n\n');
      this.response.end();
    }
    
    this.emit('close');
  }
}

/**
 * HTTP transport implementation
 */
export class HTTPTransport extends BaseTransport {
  private server?: http.Server;
  private readonly port: number;
  private readonly host: string;
  private readonly basePath: string = '/ipc';
  
  constructor(port: number = 0, host: string = 'localhost') {
    super(TransportType.HTTP, `http://${host}:${port}/ipc`);
    
    this.port = port;
    this.host = host;
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
      this.server = http.createServer();
      
      this.server.on('request', async (req, res) => {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          });
          res.end();
          return;
        }
        
        // Handle IPC endpoint
        if (req.url === this.basePath && req.method === 'GET') {
          const connection = new HTTPConnection(req, res);
          this.trackConnection(connection);
          
          try {
            // Perform handshake
            await this.performHandshake(connection);
            callback(connection);
          } catch (error) {
            connection.close();
            console.error('Handshake failed:', error);
          }
        } else if (req.url === `${this.basePath}/message` && req.method === 'POST') {
          // Handle incoming messages
          this.handleIncomingMessage(req, res);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });
      
      this.server.on('error', (error: Error) => {
        reject(new IPCError(
          IPCErrorCode.TRANSPORT_ERROR,
          'HTTP server error',
          error
        ));
      });
      
      this.server.listen(this.port, this.host, () => {
        this._listening = true;
        
        // Update path with actual port if port was 0
        if (this.port === 0 && this.server) {
          const addr = this.server.address();
          if (addr && typeof addr === 'object') {
            (this as any).path = `http://${this.host}:${addr.port}${this.basePath}`;
          }
        }
        
        resolve();
      });
    });
  }
  
  /**
   * Handle incoming message POST requests
   */
  private async handleIncomingMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        const message = JSON.parse(data) as IPCMessage;
        
        // Find connection by ID and emit message
        const connectionId = req.headers['x-connection-id'] as string;
        for (const conn of this.connections) {
          if (conn.id === connectionId) {
            conn.emit('message', message);
            break;
          }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid message' }));
      }
    });
  }
  
  /**
   * Connect to an HTTP IPC server
   */
  async connect(): Promise<IPCConnection> {
    // For HTTP transport, we would typically use EventSource or WebSocket
    // This is a simplified implementation
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.host,
        port: this.port,
        path: this.basePath,
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream'
        }
      };
      
      const req = http.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new IPCError(
            IPCErrorCode.CONNECTION_FAILED,
            `HTTP connection failed with status ${res.statusCode}`
          ));
          return;
        }
        
        const connection = new HTTPConnection(res);
        this.trackConnection(connection);
        
        this.performHandshake(connection)
          .then(() => resolve(connection))
          .catch(reject);
      });
      
      req.on('error', (error) => {
        reject(new IPCError(
          IPCErrorCode.CONNECTION_FAILED,
          'Failed to connect via HTTP',
          error
        ));
      });
      
      req.end();
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
   * Get actual server address
   */
  getAddress(): { port: number; host: string } | null {
    if (!this.server || !this._listening) {
      return null;
    }
    
    const addr = this.server.address();
    if (addr && typeof addr === 'object') {
      return {
        port: addr.port,
        host: addr.address
      };
    }
    
    return null;
  }
}