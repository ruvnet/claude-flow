/**
 * IPC (Inter-Process Communication) Types and Interfaces
 * Cross-platform communication layer for Claude-Flow
 */

import { EventEmitter } from 'events';

/**
 * IPC Connection interface for bidirectional communication
 */
export interface IPCConnection extends EventEmitter {
  id: string;
  connected: boolean;
  remoteInfo?: ConnectionInfo;
  
  send(message: IPCMessage): Promise<void>;
  close(): Promise<void>;
  
  // Events
  on(event: 'message', listener: (message: IPCMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

/**
 * IPC Transport interface for platform-specific implementations
 */
export interface IPCTransport {
  readonly type: TransportType;
  readonly path: string;
  
  listen(callback: (connection: IPCConnection) => void): Promise<void>;
  connect(): Promise<IPCConnection>;
  close(): Promise<void>;
  isListening(): boolean;
}

/**
 * Transport types supported by the IPC layer
 */
export enum TransportType {
  UNIX_SOCKET = 'unix-socket',
  NAMED_PIPE = 'named-pipe',
  HTTP = 'http',
  WEBSOCKET = 'websocket'
}

/**
 * IPC Message structure for all communication
 */
export interface IPCMessage {
  id: string;
  type: MessageType;
  command?: string;
  payload?: any;
  timestamp: Date;
  source?: string;
  target?: string;
  headers?: Record<string, string>;
}

/**
 * Message types for IPC protocol
 */
export enum MessageType {
  // Control messages
  HANDSHAKE = 'handshake',
  HEARTBEAT = 'heartbeat',
  ACKNOWLEDGE = 'acknowledge',
  ERROR = 'error',
  
  // Command messages
  COMMAND_REQUEST = 'command_request',
  COMMAND_RESPONSE = 'command_response',
  COMMAND_EVENT = 'command_event',
  
  // Process management
  PROCESS_REGISTER = 'process_register',
  PROCESS_UNREGISTER = 'process_unregister',
  PROCESS_STATUS = 'process_status',
  PROCESS_HEARTBEAT = 'process_heartbeat',
  
  // Data transfer
  DATA_CHUNK = 'data_chunk',
  DATA_COMPLETE = 'data_complete',
  DATA_ERROR = 'data_error'
}

/**
 * Connection information
 */
export interface ConnectionInfo {
  id: string;
  pid?: number;
  processName?: string;
  version?: string;
  capabilities?: string[];
}

/**
 * IPC Server interface
 */
export interface IPCServer extends EventEmitter {
  readonly transport: IPCTransport;
  readonly connections: Map<string, IPCConnection>;
  
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(message: IPCMessage, excludeConnection?: string): Promise<void>;
  registerHandler(command: string, handler: MessageHandler): void;
  unregisterHandler(command: string): void;
  
  // Events
  on(event: 'connection', listener: (connection: IPCConnection) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'listening', listener: () => void): this;
}

/**
 * IPC Client interface
 */
export interface IPCClient extends EventEmitter {
  readonly transport: IPCTransport;
  readonly connection?: IPCConnection;
  
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: IPCMessage): Promise<void>;
  request(command: string, payload?: any, timeout?: number): Promise<any>;
  
  // Events
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'message', listener: (message: IPCMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

/**
 * Security options for IPC communication
 */
export interface IPCSecurityOptions {
  enableEncryption?: boolean;
  enableAuthentication?: boolean;
  authToken?: string;
  allowedProcesses?: string[];
  maxMessageSize?: number;
  rateLimitPerSecond?: number;
}

/**
 * IPC Configuration
 */
export interface IPCConfig {
  transport: TransportType;
  path?: string;
  port?: number;
  host?: string;
  security?: IPCSecurityOptions;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
  requestTimeout?: number;
}

/**
 * Error types for IPC operations
 */
export enum IPCErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_LOST = 'CONNECTION_LOST',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  TIMEOUT = 'TIMEOUT',
  PROTOCOL_ERROR = 'PROTOCOL_ERROR',
  TRANSPORT_ERROR = 'TRANSPORT_ERROR'
}

/**
 * IPC Error class
 */
export class IPCError extends Error {
  constructor(
    public code: IPCErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'IPCError';
  }
}

/**
 * Message handler type
 */
export type MessageHandler = (
  payload: any,
  connection: IPCConnection,
  message: IPCMessage
) => Promise<any>;