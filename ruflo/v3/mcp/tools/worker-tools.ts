/**
 * V3 MCP Worker Tools
 *
 * MCP tools for background worker management (agentic-flow@alpha compatible):
 * - worker/dispatch - Spawn background worker
 * - worker/status - Get worker status
 * - worker/cancel - Cancel running worker
 * - worker/triggers - List available triggers
 * - worker/results - Get completed results
 * - worker/detect - Detect triggers in prompt
 * - worker/stats - Aggregated statistics
 * - worker/context - Get context for injection
 *
 * Implements ADR-005: MCP-First API Design
 * Implements ADR-001: agentic-flow@alpha compatibility
 */

import { z } from 'zod';
import { MCPTool, ToolContext } from '../types.js';
import {
  WorkerDispatchService,
  WorkerTrigger,
  WorkerInstance,
  TriggerDetectionResult,
  getWorkerDispatchService,
} from '../../@claude-flow/swarm/src/workers/worker-dispatch.js';

// ============================================================================
// Input Schemas
// ============================================================================

const dispatchWorkerSchema = z.object({
  trigger: z.enum([
    'ultralearn', 'optimize', 'consolidate', 'predict',
    'audit', 'map', 'preload', 'deepdive',
    'document', 'refactor', 'benchmark', 'testgaps'
  ] as [WorkerTrigger, ...WorkerTrigger[]])
    .describe('Worker trigger type'),
  context: z.string()
    .describe('Context for the worker (e.g., file path, topic)'),
  sessionId: z.string().optional()
    .describe('Session identifier (auto-generated if not provided)'),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal')
    .describe('Worker priority'),
  timeout: z.number().optional()
    .describe('Timeout in milliseconds'),
  metadata: z.record(z.unknown()).optional()
    .describe('Additional metadata'),
});

const workerStatusSchema = z.object({
  workerId: z.string()
    .describe('Worker ID to get status for'),
});

const cancelWorkerSchema = z.object({
  workerId: z.string()
    .describe('Worker ID to cancel'),
});

const detectTriggersSchema = z.object({
  text: z.string()
    .describe('Text to analyze for triggers'),
});

const workerResultsSchema = z.object({
  sessionId: z.string().optional()
    .describe('Filter by session ID'),
  trigger: z.enum([
    'ultralearn', 'optimize', 'consolidate', 'predict',
    'audit', 'map', 'preload', 'deepdive',
    'document', 'refactor', 'benchmark', 'testgaps'
  ] as [WorkerTrigger, ...WorkerTrigger[]]).optional()
    .describe('Filter by trigger type'),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional()
    .describe('Filter by status'),
  limit: z.number().default(10)
    .describe('Maximum results to return'),
});

const workerContextSchema = z.object({
  sessionId: z.string()
    .describe('Session ID to get context for'),
});

// ============================================================================
// Type Definitions
// ============================================================================

interface DispatchResult {
  workerId: string;
  trigger: WorkerTrigger;
  status: string;
  startedAt: string;
  estimatedDuration: string;
}

interface StatusResult {
  found: boolean;
  workerId: string;
  trigger?: WorkerTrigger;
  status?: string;
  progress?: number;
  phase?: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

interface CancelResult {
  cancelled: boolean;
  workerId: string;
  reason?: string;
}

interface TriggersResult {
  triggers: Array<{
    name: WorkerTrigger;
    description: string;
    priority: string;
    estimatedDuration: string;
    capabilities: string[];
  }>;
}

interface ResultsResult {
  results: Array<{
    workerId: string;
    trigger: WorkerTrigger;
    status: string;
    progress: number;
    startedAt: string;
    completedAt?: string;
    summary?: string;
  }>;
  total: number;
}

interface StatsResult {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  byTrigger: Record<WorkerTrigger, number>;
}

interface ContextResult {
  context: string;
  workerCount: number;
  hasResults: boolean;
}

// ============================================================================
// Global Dispatcher Instance
// ============================================================================

let dispatcherInstance: WorkerDispatchService | null = null;

function getDispatcher(): WorkerDispatchService {
  if (!dispatcherInstance) {
    dispatcherInstance = getWorkerDispatchService();
  }
  return dispatcherInstance;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Dispatch a background worker
 */
async function handleDispatchWorker(
  input: z.infer<typeof dispatchWorkerSchema>,
  context?: ToolContext
): Promise<DispatchResult> {
  const dispatcher = getDispatcher();
  const sessionId = input.sessionId || `session_${Date.now()}`;

  const workerId = await dispatcher.dispatch(
    input.trigger,
    input.context,
    sessionId,
    {
      priority: input.priority,
      timeout: input.timeout,
      context: input.metadata,
    }
  );

  const triggers = dispatcher.getTriggers();
  const triggerConfig = triggers[input.trigger];

  return {
    workerId,
    trigger: input.trigger,
    status: 'pending',
    startedAt: new Date().toISOString(),
    estimatedDuration: `${triggerConfig.estimatedDuration / 1000}s`,
  };
}

/**
 * Get worker status
 */
async function handleWorkerStatus(
  input: z.infer<typeof workerStatusSchema>,
  context?: ToolContext
): Promise<StatusResult> {
  const dispatcher = getDispatcher();
  const worker = dispatcher.getWorker(input.workerId);

  if (!worker) {
    return {
      found: false,
      workerId: input.workerId,
    };
  }

  return {
    found: true,
    workerId: worker.id,
    trigger: worker.trigger,
    status: worker.status,
    progress: worker.progress,
    phase: worker.phase,
    startedAt: worker.startedAt.toISOString(),
    completedAt: worker.completedAt?.toISOString(),
    result: worker.result,
    error: worker.error?.message,
  };
}

/**
 * Cancel a worker
 */
async function handleCancelWorker(
  input: z.infer<typeof cancelWorkerSchema>,
  context?: ToolContext
): Promise<CancelResult> {
  const dispatcher = getDispatcher();
  const cancelled = await dispatcher.cancel(input.workerId);

  return {
    cancelled,
    workerId: input.workerId,
    reason: cancelled ? 'Cancelled by user' : 'Worker not found or not cancellable',
  };
}

/**
 * List available triggers
 */
async function handleTriggers(
  input: Record<string, never>,
  context?: ToolContext
): Promise<TriggersResult> {
  const dispatcher = getDispatcher();
  const triggers = dispatcher.getTriggers();

  const triggerList = Object.entries(triggers).map(([name, config]) => ({
    name: name as WorkerTrigger,
    description: config.description,
    priority: config.priority,
    estimatedDuration: `${config.estimatedDuration / 1000}s`,
    capabilities: config.capabilities,
  }));

  return { triggers: triggerList };
}

/**
 * Detect triggers in text
 */
async function handleDetectTriggers(
  input: z.infer<typeof detectTriggersSchema>,
  context?: ToolContext
): Promise<TriggerDetectionResult> {
  const dispatcher = getDispatcher();
  return dispatcher.detectTriggers(input.text);
}

/**
 * Get worker results
 */
async function handleWorkerResults(
  input: z.infer<typeof workerResultsSchema>,
  context?: ToolContext
): Promise<ResultsResult> {
  const dispatcher = getDispatcher();

  let workers: WorkerInstance[] = [];

  if (input.sessionId) {
    workers = dispatcher.getSessionWorkers(input.sessionId);
  } else {
    // Get all workers by checking stats
    const stats = dispatcher.getStats();
    // Note: We'd need to track all workers globally for this
    // For now, return based on session filtering
    workers = [];
  }

  // Filter by trigger
  if (input.trigger) {
    workers = workers.filter(w => w.trigger === input.trigger);
  }

  // Filter by status
  if (input.status) {
    workers = workers.filter(w => w.status === input.status);
  }

  // Limit results
  workers = workers.slice(0, input.limit);

  return {
    results: workers.map(w => ({
      workerId: w.id,
      trigger: w.trigger,
      status: w.status,
      progress: w.progress,
      startedAt: w.startedAt.toISOString(),
      completedAt: w.completedAt?.toISOString(),
      summary: w.result?.summary,
    })),
    total: workers.length,
  };
}

/**
 * Get worker statistics
 */
async function handleWorkerStats(
  input: Record<string, never>,
  context?: ToolContext
): Promise<StatsResult> {
  const dispatcher = getDispatcher();
  const stats = dispatcher.getStats();

  // Count by trigger would need additional tracking
  const byTrigger: Record<WorkerTrigger, number> = {
    ultralearn: 0,
    optimize: 0,
    consolidate: 0,
    predict: 0,
    audit: 0,
    map: 0,
    preload: 0,
    deepdive: 0,
    document: 0,
    refactor: 0,
    benchmark: 0,
    testgaps: 0,
  };

  return {
    ...stats,
    byTrigger,
  };
}

/**
 * Get context for prompt injection
 */
async function handleWorkerContext(
  input: z.infer<typeof workerContextSchema>,
  context?: ToolContext
): Promise<ContextResult> {
  const dispatcher = getDispatcher();
  const injectionContext = dispatcher.getContextForInjection(input.sessionId);
  const workers = dispatcher.getSessionWorkers(input.sessionId);

  return {
    context: injectionContext,
    workerCount: workers.length,
    hasResults: injectionContext.length > 0,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const dispatchWorkerTool: MCPTool = {
  name: 'worker/dispatch',
  description: 'Dispatch a background worker for analysis or optimization tasks',
  inputSchema: {
    type: 'object',
    properties: {
      trigger: {
        type: 'string',
        enum: [
          'ultralearn', 'optimize', 'consolidate', 'predict',
          'audit', 'map', 'preload', 'deepdive',
          'document', 'refactor', 'benchmark', 'testgaps'
        ],
        description: 'Worker trigger type',
      },
      context: {
        type: 'string',
        description: 'Context for the worker (e.g., file path, topic)',
      },
      sessionId: {
        type: 'string',
        description: 'Session identifier',
      },
      priority: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'critical'],
        description: 'Worker priority',
        default: 'normal',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds',
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata',
        additionalProperties: true,
      },
    },
    required: ['trigger', 'context'],
  },
  handler: async (input, context) => {
    const validated = dispatchWorkerSchema.parse(input);
    return handleDispatchWorker(validated, context);
  },
  category: 'worker',
  tags: ['worker', 'dispatch', 'background', 'analysis'],
  version: '1.0.0',
};

export const workerStatusTool: MCPTool = {
  name: 'worker/status',
  description: 'Get the status of a background worker',
  inputSchema: {
    type: 'object',
    properties: {
      workerId: {
        type: 'string',
        description: 'Worker ID to get status for',
      },
    },
    required: ['workerId'],
  },
  handler: async (input, context) => {
    const validated = workerStatusSchema.parse(input);
    return handleWorkerStatus(validated, context);
  },
  category: 'worker',
  tags: ['worker', 'status', 'monitoring'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 1000,
};

export const cancelWorkerTool: MCPTool = {
  name: 'worker/cancel',
  description: 'Cancel a running background worker',
  inputSchema: {
    type: 'object',
    properties: {
      workerId: {
        type: 'string',
        description: 'Worker ID to cancel',
      },
    },
    required: ['workerId'],
  },
  handler: async (input, context) => {
    const validated = cancelWorkerSchema.parse(input);
    return handleCancelWorker(validated, context);
  },
  category: 'worker',
  tags: ['worker', 'cancel', 'control'],
  version: '1.0.0',
};

export const triggersTool: MCPTool = {
  name: 'worker/triggers',
  description: 'List all available worker trigger types',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (input, context) => {
    return handleTriggers({}, context);
  },
  category: 'worker',
  tags: ['worker', 'triggers', 'list'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 60000,
};

export const detectTriggersTool: MCPTool = {
  name: 'worker/detect',
  description: 'Detect trigger keywords in text for auto-dispatching workers',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to analyze for triggers',
      },
    },
    required: ['text'],
  },
  handler: async (input, context) => {
    const validated = detectTriggersSchema.parse(input);
    return handleDetectTriggers(validated, context);
  },
  category: 'worker',
  tags: ['worker', 'detect', 'triggers', 'auto'],
  version: '1.0.0',
};

export const workerResultsTool: MCPTool = {
  name: 'worker/results',
  description: 'Get results from completed workers',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Filter by session ID',
      },
      trigger: {
        type: 'string',
        enum: [
          'ultralearn', 'optimize', 'consolidate', 'predict',
          'audit', 'map', 'preload', 'deepdive',
          'document', 'refactor', 'benchmark', 'testgaps'
        ],
        description: 'Filter by trigger type',
      },
      status: {
        type: 'string',
        enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
        description: 'Filter by status',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return',
        default: 10,
      },
    },
  },
  handler: async (input, context) => {
    const validated = workerResultsSchema.parse(input);
    return handleWorkerResults(validated, context);
  },
  category: 'worker',
  tags: ['worker', 'results', 'completed'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 2000,
};

export const workerStatsTool: MCPTool = {
  name: 'worker/stats',
  description: 'Get aggregated worker statistics',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (input, context) => {
    return handleWorkerStats({}, context);
  },
  category: 'worker',
  tags: ['worker', 'stats', 'metrics'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

export const workerContextTool: MCPTool = {
  name: 'worker/context',
  description: 'Get worker results formatted for prompt injection',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID to get context for',
      },
    },
    required: ['sessionId'],
  },
  handler: async (input, context) => {
    const validated = workerContextSchema.parse(input);
    return handleWorkerContext(validated, context);
  },
  category: 'worker',
  tags: ['worker', 'context', 'injection'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 3000,
};

// ============================================================================
// Exports
// ============================================================================

export const workerTools: MCPTool[] = [
  dispatchWorkerTool,
  workerStatusTool,
  cancelWorkerTool,
  triggersTool,
  detectTriggersTool,
  workerResultsTool,
  workerStatsTool,
  workerContextTool,
];

export default workerTools;
