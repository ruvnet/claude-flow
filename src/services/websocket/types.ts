/**
 * WebSocket Service Types and Interfaces
 */

export enum WebSocketState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  DISCONNECTING = 'DISCONNECTING',
  ERROR = 'ERROR'
}

export interface WebSocketConfig {
  url: string;
  protocols?: string | string[];
  authToken?: string;
  reconnect?: boolean;
  reconnectOptions?: ReconnectOptions;
  heartbeatOptions?: HeartbeatOptions;
  messageQueueOptions?: MessageQueueOptions;
  connectionTimeout?: number;
  requestTimeout?: number;
}

export interface ReconnectOptions {
  enabled: boolean;
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  exponentialFactor: number;
  jitter: boolean;
}

export interface HeartbeatOptions {
  enabled: boolean;
  interval: number;
  timeout: number;
  pingMessage?: any;
  pongMessage?: any;
  isCustomPingPong?: boolean;
}

export interface MessageQueueOptions {
  enabled: boolean;
  maxSize: number;
  persistQueue: boolean;
}

export interface WebSocketMessage {
  id?: string | number;
  type?: string;
  method?: string;
  params?: any;
  data?: any;
  timestamp?: number;
}

export interface WebSocketRequest extends WebSocketMessage {
  id: string | number;
  method: string;
  params?: any;
}

export interface WebSocketResponse extends WebSocketMessage {
  id: string | number;
  result?: any;
  error?: WebSocketError;
}

export interface WebSocketError {
  code: number;
  message: string;
  data?: any;
}

export interface ConnectionMetrics {
  connectedAt?: number;
  disconnectedAt?: number;
  reconnectAttempts: number;
  totalReconnects: number;
  messagesSent: number;
  messagesReceived: number;
  errorsCount: number;
  lastError?: Error;
  averageLatency: number;
  latencySamples: number[];
}

export type WebSocketEventHandler<T = any> = (data: T) => void | Promise<void>;

export interface WebSocketEvents {
  open: WebSocketEventHandler<Event>;
  close: WebSocketEventHandler<CloseEvent>;
  error: WebSocketEventHandler<Event | Error>;
  message: WebSocketEventHandler<MessageEvent>;
  connecting: WebSocketEventHandler<void>;
  connected: WebSocketEventHandler<void>;
  disconnected: WebSocketEventHandler<{ code: number; reason: string }>;
  reconnecting: WebSocketEventHandler<{ attempt: number; delay: number }>;
  reconnected: WebSocketEventHandler<void>;
  reconnectFailed: WebSocketEventHandler<{ attempts: number; error: Error }>;
  stateChange: WebSocketEventHandler<{ from: WebSocketState; to: WebSocketState }>;
  heartbeatTimeout: WebSocketEventHandler<void>;
  queueFull: WebSocketEventHandler<{ size: number }>;
}

export interface PendingRequest {
  id: string | number;
  method: string;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  timestamp: number;
}