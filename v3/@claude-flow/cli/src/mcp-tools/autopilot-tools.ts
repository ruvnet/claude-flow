/**
 * Autopilot MCP Tools
 *
 * 10 MCP tools for persistent swarm completion management.
 * Allows programmatic control of the autopilot loop via MCP.
 *
 * ADR-072: Autopilot Integration
 * @module @claude-flow/cli/mcp-tools/autopilot
 */

import type { MCPTool } from './types.js';
import { validateText } from './validate-input.js';
import {
  loadState, saveState, appendLog, loadLog, discoverTasks,
  isTerminal, tryLoadLearning,
  validateNumber, validateConfiguredTaskSources,
  VALID_TASK_SOURCES,
} from '../autopilot-state.js';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

// ── MCP Tool Definitions ──────────────────────────────────────

const autopilotStatus: MCPTool = {
  name: 'autopilot_status',
  description: 'Get autopilot state including enabled status, iteration count, task progress, and learning metrics. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const state = loadState();
    const tasks = discoverTasks(state.taskSources);
    const completed = tasks.filter(t => isTerminal(t.status)).length;
    return ok({
      enabled: state.enabled,
      sessionId: state.sessionId,
      iterations: state.iterations,
      maxIterations: state.maxIterations,
      timeoutMinutes: state.timeoutMinutes,
      elapsedMs: state.enabled ? Date.now() - state.startTime : 0,
      tasks: { completed, total: tasks.length, percent: tasks.length === 0 ? 100 : Math.round((completed / tasks.length) * 100) },
      taskSources: state.taskSources,
    });
  },
};

const autopilotEnable: MCPTool = {
  name: 'autopilot_enable',
  description: 'Enable autopilot persistent completion. Agents will be re-engaged when tasks remain incomplete. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const state = loadState();
    state.enabled = true;
    state.startTime = Date.now();
    state.iterations = 0;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'enabled', sessionId: state.sessionId });
    return ok({ enabled: true, maxIterations: state.maxIterations, timeoutMinutes: state.timeoutMinutes });
  },
};

const autopilotDisable: MCPTool = {
  name: 'autopilot_disable',
  description: 'Disable autopilot. Agents will be allowed to stop even if tasks remain. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const state = loadState();
    state.enabled = false;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'disabled', iterations: state.iterations });
    return ok({ enabled: false });
  },
};

const autopilotConfig: MCPTool = {
  name: 'autopilot_config',
  description: 'Configure autopilot limits: max iterations (1-1000), timeout in minutes (1-1440), and task sources. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: {
    type: 'object',
    properties: {
      maxIterations: { type: 'number', description: 'Max re-engagement iterations (1-1000)' },
      timeoutMinutes: { type: 'number', description: 'Timeout in minutes (1-1440)' },
      taskSources: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', enum: [...VALID_TASK_SOURCES] },
        description: `Task sources: ${[...VALID_TASK_SOURCES].join(', ')}`,
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const state = loadState();
    if (params.maxIterations !== undefined) {
      state.maxIterations = validateNumber(params.maxIterations, 1, 1000, state.maxIterations);
    }
    if (params.timeoutMinutes !== undefined) {
      state.timeoutMinutes = validateNumber(params.timeoutMinutes, 1, 1440, state.timeoutMinutes);
    }
    if (params.taskSources !== undefined) {
      const validation = validateConfiguredTaskSources(params.taskSources);
      if (!validation.valid) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: validation.reason,
            validSources: [...VALID_TASK_SOURCES],
          }) }],
          isError: true,
        };
      }
      state.taskSources = validation.sources;
    }
    saveState(state);
    return ok({ maxIterations: state.maxIterations, timeoutMinutes: state.timeoutMinutes, taskSources: state.taskSources });
  },
};

const autopilotReset: MCPTool = {
  name: 'autopilot_reset',
  description: 'Reset autopilot iteration counter and restart the timer. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const state = loadState();
    state.iterations = 0;
    state.startTime = Date.now();
    state.history = [];
    state.lastCheck = null;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'reset' });
    return ok({ reset: true, iterations: 0 });
  },
};

const autopilotLog: MCPTool = {
  name: 'autopilot_log',
  description: 'Retrieve the autopilot event log. Shows enable/disable events, re-engagements, completions. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: {
    type: 'object',
    properties: {
      last: { type: 'number', description: 'Return only the last N entries' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const log = loadLog();
    const last = validateNumber(params.last, 1, 10000, 0);
    return ok(last > 0 ? log.slice(-last) : log);
  },
};

const autopilotProgress: MCPTool = {
  name: 'autopilot_progress',
  description: 'Detailed task progress broken down by source (team-tasks, swarm-tasks, file-checklist). Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const state = loadState();
    const tasks = discoverTasks(state.taskSources);
    const bySource: Record<string, { completed: number; total: number; tasks: unknown[] }> = {};

    for (const t of tasks) {
      if (!bySource[t.source]) bySource[t.source] = { completed: 0, total: 0, tasks: [] };
      bySource[t.source].total++;
      if (isTerminal(t.status)) {
        bySource[t.source].completed++;
      }
      bySource[t.source].tasks.push(t);
    }

    const completed = tasks.filter(t => isTerminal(t.status)).length;
    return ok({
      overall: { completed, total: tasks.length, percent: tasks.length === 0 ? 100 : Math.round((completed / tasks.length) * 100) },
      bySource,
    });
  },
};

const autopilotLearn: MCPTool = {
  name: 'autopilot_learn',
  description: 'Discover success patterns from past task completions. Requires AgentDB for full functionality. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const learning = await tryLoadLearning();
    if (learning) {
      const [metrics, patterns] = await Promise.all([
        (learning as any).getMetrics(),
        (learning as any).discoverSuccessPatterns(),
      ]);
      return ok({ metrics, patterns });
    }
    return ok({ available: false, reason: 'AgentDB/AutopilotLearning not initialized', patterns: [] });
  },
};

const autopilotHistory: MCPTool = {
  name: 'autopilot_history',
  description: 'Search past completion episodes by keyword. Requires AgentDB. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default 10)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    const vQuery = validateText(params.query, 'query');
    if (!vQuery.valid) return ok({ query: '', results: [], error: vQuery.error });
    const query = String(params.query || '');
    const limit = validateNumber(params.limit, 1, 100, 10);
    const learning = await tryLoadLearning();
    if (learning) {
      const results = await (learning as any).recallSimilarTasks(query, limit);
      return ok({ query, results });
    }
    return ok({ query, results: [], available: false });
  },
};

const autopilotPredict: MCPTool = {
  name: 'autopilot_predict',
  description: 'Predict the optimal next action based on current state and learned patterns. Use when running long-horizon goals that should resume automatically across sessions — Claude Code has no native autonomous-loop scheduler. Pair with autopilot_enable + a goal description, then let cron fires advance the work. For interactive single-task sessions, native Task is fine.',
  category: 'autopilot',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const state = loadState();
    const learning = await tryLoadLearning();
    if (learning) {
      const prediction = await (learning as any).predictNextAction(state);
      return ok(prediction);
    }

    // Heuristic fallback
    const tasks = discoverTasks(state.taskSources);
    const incomplete = tasks.filter(t => !isTerminal(t.status));
    if (incomplete.length === 0) {
      return ok({ action: 'none', confidence: 1.0, reason: 'All tasks complete' });
    }
    return ok({
      action: `Work on: ${incomplete[0].subject}`,
      confidence: 0.5,
      reason: 'Heuristic (learning not available)',
      remaining: incomplete.length,
    });
  },
};

// ── Export ─────────────────────────────────────────────────────

export const autopilotTools: MCPTool[] = [
  autopilotStatus,
  autopilotEnable,
  autopilotDisable,
  autopilotConfig,
  autopilotReset,
  autopilotLog,
  autopilotProgress,
  autopilotLearn,
  autopilotHistory,
  autopilotPredict,
];
