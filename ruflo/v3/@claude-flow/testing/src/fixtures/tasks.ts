/**
 * V3 Claude-Flow Task Fixtures
 *
 * Test data for task-related testing
 * Following London School principle of explicit test data
 */

/**
 * Task definition interface
 */
export interface TaskDefinition {
  name: string;
  type: string;
  payload: unknown;
  priority?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Task instance interface
 */
export interface TaskInstance {
  id: string;
  name: string;
  type: string;
  status: TaskStatus;
  payload: unknown;
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Task result interface
 */
export interface TaskResult {
  taskId: string;
  success: boolean;
  output?: unknown;
  error?: Error;
  duration: number;
  metrics?: TaskMetrics;
}

/**
 * Task metrics interface
 */
export interface TaskMetrics {
  cpuTime: number;
  memoryUsage: number;
  ioOperations: number;
}

/**
 * Pre-defined task definitions for testing
 */
export const taskDefinitions: Record<string, TaskDefinition> = {
  securityScan: {
    name: 'Security Scan',
    type: 'security',
    payload: {
      target: './src',
      scanType: 'full',
      severity: 'high',
    },
    priority: 100,
    metadata: { cve: ['CVE-1', 'CVE-2', 'CVE-3'] },
  },

  codeReview: {
    name: 'Code Review',
    type: 'review',
    payload: {
      files: ['src/main.ts', 'src/utils.ts'],
      rules: ['security', 'performance', 'style'],
    },
    priority: 80,
  },

  memoryOptimization: {
    name: 'Memory Optimization',
    type: 'optimization',
    payload: {
      targetReduction: 0.50,
      backend: 'agentdb',
    },
    priority: 70,
  },

  swarmCoordination: {
    name: 'Swarm Coordination',
    type: 'coordination',
    payload: {
      topology: 'hierarchical-mesh',
      agents: 15,
      task: 'implementation',
    },
    priority: 90,
  },

  unitTesting: {
    name: 'Unit Testing',
    type: 'testing',
    payload: {
      framework: 'vitest',
      coverage: 0.90,
      patterns: ['**/*.test.ts'],
    },
    priority: 75,
  },

  implementation: {
    name: 'Implementation Task',
    type: 'coding',
    payload: {
      module: 'security',
      feature: 'path-validation',
    },
    priority: 60,
  },
};

/**
 * Pre-defined task instances for testing
 */
export const taskInstances: Record<string, TaskInstance> = {
  pendingSecurityScan: {
    id: 'task-security-001',
    name: 'Security Scan',
    type: 'security',
    status: 'pending',
    payload: taskDefinitions.securityScan.payload,
    priority: 100,
    createdAt: new Date('2024-01-15T10:00:00Z'),
  },

  runningCodeReview: {
    id: 'task-review-001',
    name: 'Code Review',
    type: 'review',
    status: 'running',
    payload: taskDefinitions.codeReview.payload,
    priority: 80,
    createdAt: new Date('2024-01-15T09:00:00Z'),
    startedAt: new Date('2024-01-15T09:05:00Z'),
  },

  completedUnitTesting: {
    id: 'task-testing-001',
    name: 'Unit Testing',
    type: 'testing',
    status: 'completed',
    payload: taskDefinitions.unitTesting.payload,
    priority: 75,
    createdAt: new Date('2024-01-15T08:00:00Z'),
    startedAt: new Date('2024-01-15T08:05:00Z'),
    completedAt: new Date('2024-01-15T08:30:00Z'),
  },

  failedImplementation: {
    id: 'task-impl-001',
    name: 'Implementation Task',
    type: 'coding',
    status: 'failed',
    payload: taskDefinitions.implementation.payload,
    priority: 60,
    createdAt: new Date('2024-01-15T07:00:00Z'),
    startedAt: new Date('2024-01-15T07:05:00Z'),
    completedAt: new Date('2024-01-15T07:20:00Z'),
    error: 'Compilation error: missing dependency',
  },

  cancelledSwarmCoordination: {
    id: 'task-swarm-001',
    name: 'Swarm Coordination',
    type: 'coordination',
    status: 'cancelled',
    payload: taskDefinitions.swarmCoordination.payload,
    priority: 90,
    createdAt: new Date('2024-01-15T06:00:00Z'),
    startedAt: new Date('2024-01-15T06:05:00Z'),
  },
};

/**
 * Pre-defined task results for testing
 */
export const taskResults: Record<string, TaskResult> = {
  successfulSecurityScan: {
    taskId: 'task-security-001',
    success: true,
    output: {
      vulnerabilities: 0,
      scannedFiles: 150,
      duration: 5000,
    },
    duration: 5000,
    metrics: {
      cpuTime: 4500,
      memoryUsage: 128 * 1024 * 1024,
      ioOperations: 300,
    },
  },

  failedSecurityScan: {
    taskId: 'task-security-002',
    success: false,
    error: new Error('Critical vulnerability found: CVE-2024-001'),
    duration: 2500,
  },

  successfulCodeReview: {
    taskId: 'task-review-001',
    success: true,
    output: {
      issues: 3,
      suggestions: 10,
      approved: true,
    },
    duration: 15000,
  },
};

/**
 * Factory function to create task definition with overrides
 */
export function createTaskDefinition(
  base: keyof typeof taskDefinitions,
  overrides?: Partial<TaskDefinition>
): TaskDefinition {
  return {
    ...taskDefinitions[base],
    ...overrides,
  };
}

/**
 * Factory function to create task instance with overrides
 */
export function createTaskInstance(
  base: keyof typeof taskInstances,
  overrides?: Partial<TaskInstance>
): TaskInstance {
  return {
    ...taskInstances[base],
    ...overrides,
    id: overrides?.id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: overrides?.createdAt ?? new Date(),
  };
}

/**
 * Factory function to create task result with overrides
 */
export function createTaskResult(
  base: keyof typeof taskResults,
  overrides?: Partial<TaskResult>
): TaskResult {
  return {
    ...taskResults[base],
    ...overrides,
  };
}

/**
 * Invalid task definitions for error testing
 */
export const invalidTaskDefinitions = {
  emptyName: {
    name: '',
    type: 'coding',
    payload: {},
  },

  emptyType: {
    name: 'Valid Name',
    type: '',
    payload: {},
  },

  nullPayload: {
    name: 'Valid Name',
    type: 'coding',
    payload: null,
  },

  invalidPriority: {
    name: 'Valid Name',
    type: 'coding',
    payload: {},
    priority: -100,
  },
};

/**
 * Task batch for swarm testing
 */
export function createTaskBatch(count: number, type: string = 'coding'): TaskDefinition[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Batch Task ${i + 1}`,
    type,
    payload: { index: i },
    priority: Math.floor(Math.random() * 100),
  }));
}
