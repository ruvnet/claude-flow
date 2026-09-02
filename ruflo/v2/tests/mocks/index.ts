/**
 * Mock implementations for testing
 */

export const mockAgent = {
  id: 'mock-agent-1',
  name: 'Mock Agent',
  type: 'coordinator' as const,
  capabilities: ['task-management', 'coordination'],
  systemPrompt: 'You are a mock agent',
  maxConcurrentTasks: 5,
  priority: 10,
  environment: {},
  workingDirectory: '/tmp',
  shell: '/bin/bash',
  metadata: {},
};

export const mockTask = {
  id: 'mock-task-1',
  type: 'test',
  description: 'Mock task',
  priority: 50,
  dependencies: [],
  status: 'pending' as const,
  input: { test: true },
  createdAt: new Date(),
  metadata: {},
};

export const mockConfig = {
  orchestrator: {
    maxConcurrentAgents: 10,
    taskQueueSize: 100,
    healthCheckInterval: 30000,
    shutdownTimeout: 30000,
    maintenanceInterval: 300000,
    metricsInterval: 60000,
    persistSessions: false,
    dataDir: './tests/data',
    sessionRetentionMs: 3600000,
    taskHistoryRetentionMs: 86400000,
    taskMaxRetries: 3,
  },
  terminal: {
    type: 'native' as const,
    poolSize: 5,
    recycleAfter: 10,
    healthCheckInterval: 60000,
    commandTimeout: 300000,
  },
  memory: {
    backend: 'sqlite' as const,
    cacheSizeMB: 10,
    syncInterval: 5000,
    conflictResolution: 'last-write' as const,
    retentionDays: 1,
    sqlitePath: ':memory:',
    markdownDir: './tests/data/memory',
  },
  coordination: {
    maxRetries: 3,
    retryDelay: 100,
    deadlockDetection: true,
    resourceTimeout: 60000,
    messageTimeout: 30000,
  },
  mcp: {
    transport: 'stdio' as const,
    port: 8081,
    tlsEnabled: false,
  },
  logging: {
    level: 'error' as const,
    format: 'json' as const,
    destination: 'console' as const,
  },
};

export const mockEventBus = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  once: jest.fn(),
  removeAllListeners: jest.fn(),
};

export const mockMemoryStore = {
  store: jest.fn(),
  retrieve: jest.fn(),
  list: jest.fn(),
  delete: jest.fn(),
  clear: jest.fn(),
};

export const mockTerminalManager = {
  spawn: jest.fn(),
  execute: jest.fn(),
  kill: jest.fn(),
  list: jest.fn(),
  health: jest.fn(),
};

export const mockCoordinationSystem = {
  register: jest.fn(),
  unregister: jest.fn(),
  requestResource: jest.fn(),
  releaseResource: jest.fn(),
  broadcast: jest.fn(),
  sendMessage: jest.fn(),
};