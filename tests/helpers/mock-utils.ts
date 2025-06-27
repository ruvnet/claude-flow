/**
 * Mock Utilities
 * Helpers for creating mocks of external dependencies and services
 */

import { EventEmitter } from 'events';
import type { Server } from 'http';
import type { WebSocket } from 'ws';

/**
 * Creates a mock Express app
 */
export function createMockExpressApp() {
  const app: any = {
    use: jest.fn().mockReturnThis(),
    get: jest.fn().mockReturnThis(),
    post: jest.fn().mockReturnThis(),
    put: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    patch: jest.fn().mockReturnThis(),
    listen: jest.fn((port, callback) => {
      if (callback) callback();
      return mockServer;
    }),
    set: jest.fn().mockReturnThis(),
    engine: jest.fn().mockReturnThis(),
  };
  
  const mockServer = {
    close: jest.fn((callback) => {
      if (callback) callback();
    }),
    on: jest.fn(),
    address: jest.fn(() => ({ port: 3000 })),
  };
  
  return { app, server: mockServer };
}

/**
 * Creates a mock WebSocket
 */
export function createMockWebSocket(): jest.Mocked<WebSocket> {
  const ws = new EventEmitter() as any;
  
  ws.send = jest.fn();
  ws.close = jest.fn();
  ws.ping = jest.fn();
  ws.pong = jest.fn();
  ws.terminate = jest.fn();
  ws.readyState = 1; // OPEN
  ws.CONNECTING = 0;
  ws.OPEN = 1;
  ws.CLOSING = 2;
  ws.CLOSED = 3;
  
  return ws;
}

/**
 * Creates a mock MCP client
 */
export function createMockMCPClient() {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    call: jest.fn().mockResolvedValue({ result: 'mock-result' }),
    request: jest.fn().mockResolvedValue({ result: 'mock-result' }),
    notify: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockReturnValue(() => {}),
    on: jest.fn(),
    off: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
  };
}

/**
 * Creates a mock child process
 */
export function createMockChildProcess() {
  const proc = new EventEmitter() as any;
  
  proc.stdin = {
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  };
  
  proc.stdout = new EventEmitter() as any;
  proc.stdout.on = jest.fn();
  proc.stdout.pipe = jest.fn();
  
  proc.stderr = new EventEmitter() as any;
  proc.stderr.on = jest.fn();
  proc.stderr.pipe = jest.fn();
  
  proc.kill = jest.fn();
  proc.pid = 12345;
  proc.exitCode = null;
  proc.signalCode = null;
  
  return proc;
}

/**
 * Creates a mock file system watcher
 */
export function createMockWatcher() {
  const watcher = new EventEmitter() as any;
  
  watcher.add = jest.fn();
  watcher.unwatch = jest.fn();
  watcher.close = jest.fn().mockResolvedValue(undefined);
  watcher.getWatched = jest.fn().mockReturnValue({});
  
  return watcher;
}

/**
 * Creates a mock Redis client
 */
export function createMockRedisClient() {
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    keys: jest.fn().mockResolvedValue([]),
    mget: jest.fn().mockResolvedValue([]),
    mset: jest.fn().mockResolvedValue('OK'),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
    lpush: jest.fn().mockResolvedValue(1),
    rpush: jest.fn().mockResolvedValue(1),
    lpop: jest.fn().mockResolvedValue(null),
    rpop: jest.fn().mockResolvedValue(null),
    llen: jest.fn().mockResolvedValue(0),
    lrange: jest.fn().mockResolvedValue([]),
    publish: jest.fn().mockResolvedValue(0),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
  };
  
  return client;
}

/**
 * Creates a mock HTTP request
 */
export function createMockRequest(options: any = {}) {
  return {
    method: options.method || 'GET',
    url: options.url || '/',
    path: options.path || '/',
    headers: options.headers || {},
    params: options.params || {},
    query: options.query || {},
    body: options.body || {},
    cookies: options.cookies || {},
    session: options.session || {},
    user: options.user || null,
    get: jest.fn((header) => options.headers?.[header]),
    accepts: jest.fn(),
    is: jest.fn(),
  };
}

/**
 * Creates a mock HTTP response
 */
export function createMockResponse() {
  const res: any = {
    statusCode: 200,
    headers: {},
    locals: {},
  };
  
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  
  res.json = jest.fn((data) => {
    res.body = data;
    return res;
  });
  
  res.send = jest.fn((data) => {
    res.body = data;
    return res;
  });
  
  res.set = jest.fn((header, value) => {
    res.headers[header] = value;
    return res;
  });
  
  res.header = res.set;
  res.setHeader = res.set;
  
  res.cookie = jest.fn();
  res.clearCookie = jest.fn();
  res.redirect = jest.fn();
  res.render = jest.fn();
  res.end = jest.fn();
  
  return res;
}

/**
 * Creates a mock event bus
 */
export function createMockEventBus() {
  const emitter = new EventEmitter();
  return {
    emit: jest.fn((...args) => emitter.emit(...args)),
    on: jest.fn((...args) => emitter.on(...args)),
    off: jest.fn((...args) => emitter.off(...args)),
    once: jest.fn((...args) => emitter.once(...args)),
    removeAllListeners: jest.fn((...args) => emitter.removeAllListeners(...args)),
    listenerCount: jest.fn((...args) => emitter.listenerCount(...args)),
  };
}

/**
 * Mock timers utilities
 */
export const mockTimers = {
  /**
   * Advances timers and flushes promises
   */
  async advance(ms: number) {
    jest.advanceTimersByTime(ms);
    await new Promise(resolve => setImmediate(resolve));
  },
  
  /**
   * Runs all timers and flushes promises
   */
  async runAll() {
    jest.runAllTimers();
    await new Promise(resolve => setImmediate(resolve));
  },
  
  /**
   * Runs pending timers and flushes promises
   */
  async runPending() {
    jest.runOnlyPendingTimers();
    await new Promise(resolve => setImmediate(resolve));
  },
};
