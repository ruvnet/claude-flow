/**
 * Test data generators and fixtures for Claude-Flow tests
 */

import { TestDataGenerator } from '../utils/test-utils.ts';

/**
 * Generate memory entries for testing
 */
export function generateMemoryEntries(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `memory-${i}`,
    namespace: 'test',
    key: `test-key-${i}`,
    value: {
      content: TestDataGenerator.randomString(100),
      metadata: {
        timestamp: Date.now() - i * 1000,
        source: 'test',
        tags: TestDataGenerator.randomArray(() => TestDataGenerator.randomString(5), 3),
      },
    },
    tags: ['test', `group-${i % 5}`],
    createdAt: new Date(Date.now() - i * 1000),
    updatedAt: new Date(Date.now() - i * 500),
  }));
}

/**
 * Generate coordination tasks for testing
 */
export function generateCoordinationTasks(count: number) {
  const statuses = ['pending', 'running', 'completed', 'failed'];
  const priorities = ['low', 'medium', 'high', 'critical'];
  
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`,
    type: 'test-task',
    status: statuses[i % statuses.length],
    priority: priorities[i % priorities.length],
    data: {
      command: `echo "Test task ${i}"`,
      params: { id: i, value: TestDataGenerator.randomString(20) },
    },
    dependencies: i > 0 ? [`task-${i - 1}`] : [],
    timeout: 30000,
    retries: 0,
    maxRetries: 3,
    createdAt: new Date(Date.now() - i * 1000),
    updatedAt: new Date(Date.now() - i * 500),
    startedAt: i % 2 === 0 ? new Date(Date.now() - i * 400) : undefined,
    completedAt: i % 4 === 0 ? new Date(Date.now() - i * 200) : undefined,
  }));
}

/**
 * Generate MCP messages for testing
 */
export function generateMCPMessages(count: number) {
  const methods = ['list_tools', 'call_tool', 'get_prompt', 'list_prompts'];
  
  return Array.from({ length: count }, (_, i) => ({
    jsonrpc: '2.0',
    id: i,
    method: methods[i % methods.length],
    params: {
      name: `test-${i}`,
      arguments: {
        query: TestDataGenerator.randomString(50),
        options: {
          limit: TestDataGenerator.randomNumber(1, 100),
          offset: i * 10,
        },
      },
    },
  }));
}

/**
 * Generate terminal session data for testing
 */
export function generateTerminalSessions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${i}`,
    type: 'test',
    status: i % 2 === 0 ? 'active' : 'idle',
    workingDirectory: `/tmp/test-${i}`,
    environment: {
      PATH: '/usr/bin:/bin',
      HOME: `/home/test-${i}`,
      TERM: 'xterm-256color',
    },
    history: Array.from({ length: 10 }, (_, j) => ({
      command: `echo "Command ${j} in session ${i}"`,
      timestamp: Date.now() - (10 - j) * 1000,
      exitCode: j % 10 === 9 ? 1 : 0,
      output: `Output for command ${j}`,
    })),
    createdAt: new Date(Date.now() - i * 60000),
    lastActivity: new Date(Date.now() - i * 1000),
  }));
}

/**
 * Generate event bus events for testing
 */
export function generateEventBusEvents(count: number) {
  const eventTypes = [
    'task.created',
    'task.started',
    'task.completed',
    'task.failed',
    'memory.updated',
    'terminal.session.created',
    'mcp.message.received',
  ];
  
  return Array.from({ length: count }, (_, i) => ({
    id: `event-${i}`,
    type: eventTypes[i % eventTypes.length],
    data: {
      taskId: `task-${i}`,
      sessionId: `session-${i % 3}`,
      message: TestDataGenerator.randomString(100),
      metadata: {
        source: 'test',
        timestamp: Date.now() - i * 1000,
        tags: ['test', `batch-${Math.floor(i / 10)}`],
      },
    },
    timestamp: new Date(Date.now() - i * 1000),
    processed: i % 2 === 0,
  }));
}

/**
 * Generate error scenarios for testing
 */
export function generateErrorScenarios() {
  return [
    {
      name: 'Network timeout',
      error: new Error('Connection timeout'),
      code: 'TIMEOUT',
      recoverable: true,
    },
    {
      name: 'Memory limit exceeded',
      error: new Error('Out of memory'),
      code: 'MEMORY_ERROR',
      recoverable: false,
    },
    {
      name: 'Invalid configuration',
      error: new Error('Configuration validation failed'),
      code: 'CONFIG_ERROR',
      recoverable: false,
    },
    {
      name: 'Resource conflict',
      error: new Error('Resource already in use'),
      code: 'CONFLICT',
      recoverable: true,
    },
    {
      name: 'Dependency not found',
      error: new Error('Required dependency missing'),
      code: 'DEPENDENCY_ERROR',
      recoverable: false,
    },
  ];
}

/**
 * Generate performance test data
 */
export function generatePerformanceTestData() {
  return {
    smallDataset: TestDataGenerator.largeDataset(100),
    mediumDataset: TestDataGenerator.largeDataset(1000),
    largeDataset: TestDataGenerator.largeDataset(10000),
    hugeDataset: TestDataGenerator.largeDataset(100000),
    
    // Memory-intensive data
    memoryIntensiveData: Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      largeString: TestDataGenerator.randomString(10000), // 10KB strings
      buffer: new Uint8Array(1024 * 10), // 10KB buffers
      nestedData: {
        level1: {
          level2: {
            level3: {
              data: TestDataGenerator.randomArray(() => TestDataGenerator.randomString(100), 100),
            },
          },
        },
      },
    })),
    
    // CPU-intensive operations
    cpuIntensiveOperations: [
      () => {
        // Fibonacci calculation
        const fib = (n: number): number => n <= 1 ? n : fib(n - 1) + fib(n - 2);
        return fib(30);
      },
      () => {
        // Prime number calculation
        const isPrime = (n: number): boolean => {
          for (let i = 2; i <= Math.sqrt(n); i++) {
            if (n % i === 0) return false;
          }
          return n > 1;
        };
        return Array.from({ length: 1000 }, (_, i) => i).filter(isPrime);
      },
      () => {
        // Array sorting
        const arr = TestDataGenerator.randomArray(() => TestDataGenerator.randomNumber(1, 10000), 10000);
        return arr.sort((a, b) => a - b);
      },
    ],
  };
}

/**
 * Generate CLI test scenarios
 */
export function generateCLITestScenarios() {
  return [
    {
      command: ['start'],
      expectedOutput: 'Claude-Flow orchestrator started',
      expectedExitCode: 0,
    },
    {
      command: ['agent', 'create', '--name', 'test-agent'],
      expectedOutput: 'Agent "test-agent" created successfully',
      expectedExitCode: 0,
    },
    {
      command: ['task', 'run', '--command', 'echo "Hello World"'],
      expectedOutput: 'Hello World',
      expectedExitCode: 0,
    },
    {
      command: ['memory', 'set', '--key', 'test', '--value', 'test-value'],
      expectedOutput: 'Memory entry stored',
      expectedExitCode: 0,
    },
    {
      command: ['memory', 'get', '--key', 'test'],
      expectedOutput: 'test-value',
      expectedExitCode: 0,
    },
    {
      command: ['invalid-command'],
      expectedOutput: 'Unknown command',
      expectedExitCode: 1,
    },
    {
      command: ['task', 'run'],
      expectedOutput: 'Missing required argument: command',
      expectedExitCode: 1,
    },
  ];
}

/**
 * Generate edge case test data
 */
export function generateEdgeCaseData() {
  return {
    // Empty/null/undefined values
    emptyValues: {
      emptyString: '',
      nullValue: null,
      undefinedValue: undefined,
      emptyArray: [],
      emptyObject: {},
    },
    
    // Boundary values
    boundaryValues: {
      maxNumber: Number.MAX_SAFE_INTEGER,
      minNumber: Number.MIN_SAFE_INTEGER,
      maxArrayLength: new Array(1000000),
      longString: 'x'.repeat(1000000),
      deepObject: (() => {
        let obj: any = {};
        let current = obj;
        for (let i = 0; i < 1000; i++) {
          current.nested = {};
          current = current.nested;
        }
        return obj;
      })(),
    },
    
    // Invalid/malformed data
    invalidData: {
      malformedJSON: '{"invalid": json}',
      invalidUTF8: new Uint8Array([0xFF, 0xFE, 0xFD]),
      circularReference: (() => {
        const obj: any = { name: 'circular' };
        obj.self = obj;
        return obj;
      })(),
      invalidDate: new Date('invalid-date'),
      invalidURL: 'not-a-url',
    },
    
    // Special characters
    specialCharacters: {
      unicode: '🚀🔥💻🌟⚡️🎯🚀',
      controlCharacters: '\x00\x01\x02\x03\x04\x05',
      newlines: 'line1\nline2\r\nline3\rline4',
      tabs: 'col1\tcol2\tcol3',
      quotes: '"double" \'single\' `backtick`',
      backslashes: '\\path\\to\\file\\with\\backslashes',
    },
  };
}

/**
 * Get all test fixtures
 */
export function getAllTestFixtures() {
  return {
    memory: {
      small: generateMemoryEntries(10),
      medium: generateMemoryEntries(100),
      large: generateMemoryEntries(1000),
    },
    tasks: {
      simple: generateCoordinationTasks(5),
      complex: generateCoordinationTasks(50),
      stress: generateCoordinationTasks(500),
    },
    messages: {
      basic: generateMCPMessages(10),
      bulk: generateMCPMessages(100),
    },
    sessions: {
      single: generateTerminalSessions(1),
      multiple: generateTerminalSessions(10),
    },
    events: {
      few: generateEventBusEvents(20),
      many: generateEventBusEvents(200),
    },
    errors: generateErrorScenarios(),
    performance: generatePerformanceTestData(),
    cli: generateCLITestScenarios(),
    edgeCases: generateEdgeCaseData(),
  };
}
