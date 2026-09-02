/**
 * MCP Tools for Worker System
 *
 * Exposes worker functionality via Model Context Protocol tools.
 */

import type { WorkerManager, WorkerResult, StatuslineData, WorkerAlert, HistoricalMetric } from './index.js';

// ============================================================================
// Input Validation
// ============================================================================

const ALLOWED_WORKERS = new Set([
  'performance', 'health', 'security', 'adr', 'ddd',
  'patterns', 'learning', 'cache', 'git', 'swarm'
]);

const ALLOWED_SEVERITIES = new Set(['info', 'warning', 'critical']);
const ALLOWED_FORMATS = new Set(['json', 'string']);

function validateWorkerName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  if (!ALLOWED_WORKERS.has(name)) return null;
  return name;
}

function validateNumber(value: unknown, min = 0, max = 10000): number | null {
  if (typeof value !== 'number') return null;
  if (value < min || value > max) return null;
  return value;
}

function validateString(value: unknown, allowedSet?: Set<string>): string | null {
  if (typeof value !== 'string') return null;
  if (allowedSet && !allowedSet.has(value)) return null;
  return value;
}

function sanitizeErrorMessage(error: unknown): string {
  // Return generic message to avoid information disclosure
  if (error instanceof Error) {
    // Only expose safe error types
    if (error.message.includes('not found') || error.message.includes('Invalid')) {
      return error.message;
    }
  }
  return 'An internal error occurred';
}

// ============================================================================
// MCP Tool Types
// ============================================================================

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>, manager: WorkerManager) => Promise<MCPToolResult>;
}

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ============================================================================
// Worker MCP Tools
// ============================================================================

export const workerRunTool: MCPToolDefinition = {
  name: 'worker/run',
  description: 'Run a specific background worker immediately. Available workers: performance, health, security, adr, ddd, patterns, learning, cache, git, swarm',
  inputSchema: {
    type: 'object',
    properties: {
      worker: {
        type: 'string',
        description: 'Name of the worker to run',
        enum: ['performance', 'health', 'security', 'adr', 'ddd', 'patterns', 'learning', 'cache', 'git', 'swarm'],
      },
    },
    required: ['worker'],
  },
  handler: async (input, manager): Promise<MCPToolResult> => {
    // Validate input
    const workerName = validateWorkerName(input.worker);
    if (!workerName) {
      return {
        content: [{ type: 'text', text: 'Invalid worker name' }],
        isError: true,
      };
    }

    try {
      const result = await manager.runWorker(workerName);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            worker: result.worker,
            duration: result.duration,
            data: result.data,
            alerts: result.alerts,
            error: result.error,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error running worker: ${sanitizeErrorMessage(error)}`,
        }],
        isError: true,
      };
    }
  },
};

export const workerStatusTool: MCPToolDefinition = {
  name: 'worker/status',
  description: 'Get status of all background workers including run counts, errors, and last results',
  inputSchema: {
    type: 'object',
    properties: {
      worker: {
        type: 'string',
        description: 'Optional: Get status for a specific worker',
      },
    },
  },
  handler: async (input, manager): Promise<MCPToolResult> => {
    const status = manager.getStatus();

    // Validate optional worker name
    if (input.worker !== undefined) {
      const workerName = validateWorkerName(input.worker);
      if (!workerName) {
        return {
          content: [{ type: 'text', text: 'Invalid worker name' }],
          isError: true,
        };
      }
      const worker = status.workers.find(w => w.name === workerName);
      if (!worker) {
        return {
          content: [{ type: 'text', text: `Worker '${workerName}' not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(worker, null, 2) }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          running: status.running,
          platform: status.platform,
          uptime: Math.round(status.uptime / 1000) + 's',
          totalRuns: status.totalRuns,
          workers: status.workers.map(w => ({
            name: w.name,
            status: w.status,
            runCount: w.runCount,
            errorCount: w.errorCount,
            avgDuration: Math.round(w.avgDuration) + 'ms',
            lastRun: w.lastRun?.toISOString(),
          })),
        }, null, 2),
      }],
    };
  },
};

export const workerAlertsTool: MCPToolDefinition = {
  name: 'worker/alerts',
  description: 'Get recent alerts from worker runs (threshold violations)',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of alerts to return (default: 20)',
      },
      severity: {
        type: 'string',
        description: 'Filter by severity level',
        enum: ['info', 'warning', 'critical'],
      },
    },
  },
  handler: async (input, manager): Promise<MCPToolResult> => {
    // Validate inputs
    const limit = validateNumber(input.limit, 1, 100) ?? 20;
    const severity = input.severity !== undefined
      ? validateString(input.severity, ALLOWED_SEVERITIES)
      : undefined;

    if (input.severity !== undefined && !severity) {
      return {
        content: [{ type: 'text', text: 'Invalid severity level' }],
        isError: true,
      };
    }

    let alerts = manager.getAlerts(limit);

    if (severity) {
      alerts = alerts.filter(a => a.severity === severity);
    }

    return {
      content: [{
        type: 'text',
        text: alerts.length > 0
          ? JSON.stringify(alerts.map(a => ({
              worker: a.worker,
              severity: a.severity,
              message: a.message,
              metric: a.metric,
              value: a.value,
              threshold: a.threshold,
              timestamp: a.timestamp.toISOString(),
            })), null, 2)
          : 'No alerts',
      }],
    };
  },
};

export const workerHistoryTool: MCPToolDefinition = {
  name: 'worker/history',
  description: 'Get historical metrics from worker runs for trend analysis',
  inputSchema: {
    type: 'object',
    properties: {
      worker: {
        type: 'string',
        description: 'Filter by worker name',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of history entries (default: 50)',
      },
    },
  },
  handler: async (input, manager): Promise<MCPToolResult> => {
    // Validate inputs
    const workerName = input.worker !== undefined
      ? validateWorkerName(input.worker)
      : undefined;

    if (input.worker !== undefined && !workerName) {
      return {
        content: [{ type: 'text', text: 'Invalid worker name' }],
        isError: true,
      };
    }

    const limit = validateNumber(input.limit, 1, 1000) ?? 50;
    const history = manager.getHistory(workerName ?? undefined, limit);

    return {
      content: [{
        type: 'text',
        text: history.length > 0
          ? JSON.stringify(history, null, 2)
          : 'No history available',
      }],
    };
  },
};

export const workerStatuslineTool: MCPToolDefinition = {
  name: 'worker/statusline',
  description: 'Get formatted statusline data for display',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Output format: json or string',
        enum: ['json', 'string'],
      },
    },
  },
  handler: async (input, manager): Promise<MCPToolResult> => {
    // Validate format
    const format = validateString(input.format, ALLOWED_FORMATS) ?? 'json';

    if (format === 'string') {
      return {
        content: [{ type: 'text', text: manager.getStatuslineString() }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(manager.getStatuslineData(), null, 2),
      }],
    };
  },
};

export const workerRunAllTool: MCPToolDefinition = {
  name: 'worker/run-all',
  description: 'Run all enabled workers immediately',
  inputSchema: {
    type: 'object',
    properties: {
      concurrency: {
        type: 'number',
        description: 'Maximum concurrent workers (default: 5)',
      },
    },
  },
  handler: async (input, manager): Promise<MCPToolResult> => {
    // Validate concurrency (1-10 range)
    const concurrency = validateNumber(input.concurrency, 1, 10) ?? 5;

    try {
      const results = await manager.runAll(concurrency);
      const summary = {
        total: results.length,
        success: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
        alerts: results.flatMap(r => r.alerts || []),
        results: results.map(r => ({
          worker: r.worker,
          success: r.success,
          duration: r.duration,
          error: r.error,
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error running workers: ${sanitizeErrorMessage(error)}`,
        }],
        isError: true,
      };
    }
  },
};

export const workerStartTool: MCPToolDefinition = {
  name: 'worker/start',
  description: 'Start the worker manager with automatic scheduling',
  inputSchema: {
    type: 'object',
    properties: {
      autoSave: {
        type: 'boolean',
        description: 'Enable automatic state saving (default: true)',
      },
      statuslineUpdate: {
        type: 'boolean',
        description: 'Enable statusline file updates (default: true)',
      },
    },
  },
  handler: async (input, manager): Promise<MCPToolResult> => {
    // Validate boolean inputs
    const autoSave = typeof input.autoSave === 'boolean' ? input.autoSave : true;
    const statuslineUpdate = typeof input.statuslineUpdate === 'boolean' ? input.statuslineUpdate : true;

    try {
      await manager.start({ autoSave, statuslineUpdate });

      return {
        content: [{
          type: 'text',
          text: 'Worker manager started with scheduling enabled',
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error starting worker manager: ${sanitizeErrorMessage(error)}`,
        }],
        isError: true,
      };
    }
  },
};

export const workerStopTool: MCPToolDefinition = {
  name: 'worker/stop',
  description: 'Stop the worker manager and save state',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input, manager): Promise<MCPToolResult> => {
    try {
      await manager.stop();

      return {
        content: [{
          type: 'text',
          text: 'Worker manager stopped and state saved',
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error stopping worker manager: ${sanitizeErrorMessage(error)}`,
        }],
        isError: true,
      };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

export const workerMCPTools: MCPToolDefinition[] = [
  workerRunTool,
  workerStatusTool,
  workerAlertsTool,
  workerHistoryTool,
  workerStatuslineTool,
  workerRunAllTool,
  workerStartTool,
  workerStopTool,
];

/**
 * Create a tool handler function for MCP server integration
 */
export function createWorkerToolHandler(manager: WorkerManager) {
  return async (toolName: string, input: Record<string, unknown>): Promise<MCPToolResult> => {
    const tool = workerMCPTools.find(t => t.name === toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    return tool.handler(input, manager);
  };
}
