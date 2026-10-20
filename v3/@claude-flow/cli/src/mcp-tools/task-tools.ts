/**
 * Task MCP Tools for CLI
 *
 * Tool definitions for task management with file persistence.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readRecordStore } from './record-store.js';
import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validateText } from './validate-input.js';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const TASK_DIR = 'tasks';
const TASK_FILE = 'store.json';

export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

// Spellings agents write for the same five states (seen in the wild: "complete").
const STATUS_ALIASES: Readonly<Record<string, TaskStatus>> = {
  complete: 'completed', done: 'completed', canceled: 'cancelled',
  running: 'in_progress', 'in-progress': 'in_progress', inprogress: 'in_progress',
};

/** The canonical status for a written one (trimmed, any case, known aliases), or null when it is none of the five. */
export function statusOf(value: unknown): TaskStatus | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if ((TASK_STATUSES as readonly string[]).includes(key)) return key as TaskStatus;
  return Object.hasOwn(STATUS_ALIASES, key) ? STATUS_ALIASES[key] : null;
}

interface TaskRecord {
  taskId: string;
  type: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: TaskStatus;
  progress: number;
  assignedTo: string[];
  tags: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result?: Record<string, unknown>;
}

interface TaskStore {
  tasks: Record<string, TaskRecord>;
  version: string;
}

function getTaskDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, TASK_DIR);
}

function getTaskPath(): string {
  return join(getTaskDir(), TASK_FILE);
}

function ensureTaskDir(): void {
  const dir = getTaskDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadTaskStore(): TaskStore {
  return readRecordStore(getTaskPath(), 'tasks', () => ({ tasks: {}, version: '3.0.0' }));
}

function saveTaskStore(store: TaskStore): void {
  ensureTaskDir();
  writeFileSync(getTaskPath(), JSON.stringify(store, null, 2), 'utf-8');
}

type AgentRow = Record<string, unknown>;

/**
 * Apply an agent-state change to every store that holds the agent.
 *
 * `hive-mind_spawn` keeps its workers in `.claude-flow/agents.json`, not the
 * canonical `.claude-flow/agents/store.json` (#1916). Syncing only the
 * canonical store meant assigning a task to a hive worker never marked it
 * busy, and completing one never counted it: `hive-mind status` showed the
 * worker idle with 0 completed while its task sat in the queue.
 */
function updateAgents(agentIds: string[], mutate: (agent: AgentRow) => void): void {
  if (agentIds.length === 0) return;
  const paths = [
    join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json'),
    join(getProjectCwd(), STORAGE_DIR, 'agents.json'),
  ];
  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      const store = JSON.parse(readFileSync(path, 'utf-8')) as { agents?: Record<string, AgentRow> };
      if (!store.agents) continue;
      let touched = false;
      for (const id of agentIds) {
        if (Object.prototype.hasOwnProperty.call(store.agents, id) && store.agents[id]) {
          mutate(store.agents[id]);
          touched = true;
        }
      }
      if (touched) writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8');
    } catch {
      // Best-effort agent sync: a corrupt agent store must not fail the task op.
    }
  }
}

/** Return agents still holding `taskId` to idle. */
function releaseAgents(agentIds: string[], taskId: string): void {
  updateAgents(agentIds, (agent) => {
    if (agent.currentTask === taskId) {
      agent.status = 'idle';
      agent.currentTask = null;
    }
  });
}

export const taskTools: MCPTool[] = [
  {
    name: 'task_create',
    description: 'Create a new task Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Task type (feature, bugfix, research, refactor)' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Task priority (low, normal, high, critical)' },
        assignTo: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Task tags' },
      },
      required: ['type', 'description'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vType = validateIdentifier(input.type, 'type');
      if (!vType.valid) return { success: false, error: vType.error };
      const vDesc = validateText(input.description, 'description');
      if (!vDesc.valid) return { success: false, error: vDesc.error };

      const store = loadTaskStore();
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const task: TaskRecord = {
        taskId,
        type: input.type as string,
        description: input.description as string,
        priority: (input.priority as TaskRecord['priority']) || 'normal',
        status: 'pending',
        progress: 0,
        assignedTo: (input.assignTo as string[]) || [],
        tags: (input.tags as string[]) || [],
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      };

      store.tasks[taskId] = task;
      saveTaskStore(store);

      return {
        taskId,
        type: task.type,
        description: task.description,
        priority: task.priority,
        status: task.status,
        createdAt: task.createdAt,
        assignedTo: task.assignedTo,
        tags: task.tags,
      };
    },
  },
  {
    name: 'task_status',
    description: 'Get task status Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (task) {
        return {
          taskId: task.taskId,
          type: task.type,
          description: task.description,
          status: task.status,
          progress: task.progress,
          priority: task.priority,
          assignedTo: task.assignedTo,
          tags: task.tags,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          result: task.result || null,
        };
      }

      return {
        taskId,
        status: 'not_found',
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_list',
    description: 'List all tasks Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        type: { type: 'string', description: 'Filter by type' },
        assignedTo: { type: 'string', description: 'Filter by assigned agent' },
        priority: { type: 'string', description: 'Filter by priority' },
        limit: { type: 'number', description: 'Max tasks to return' },
      },
    },
    handler: async (input) => {
      const store = loadTaskStore();
      let tasks = Object.values(store.tasks);

      // Apply filters
      if (input.status) {
        // Support comma-separated status values
        const statuses = (input.status as string).split(',').map(s => s.trim());
        tasks = tasks.filter(t => statuses.includes(t.status));
      }
      if (input.type) {
        tasks = tasks.filter(t => t.type === input.type);
      }
      if (input.assignedTo) {
        tasks = tasks.filter(t => t.assignedTo.includes(input.assignedTo as string));
      }
      if (input.priority) {
        tasks = tasks.filter(t => t.priority === input.priority);
      }

      // Sort by creation date (newest first)
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Apply limit
      const limit = (input.limit as number) || 50;
      tasks = tasks.slice(0, limit);

      return {
        tasks: tasks.map(t => ({
          taskId: t.taskId,
          type: t.type,
          description: t.description,
          status: t.status,
          progress: t.progress,
          priority: t.priority,
          assignedTo: t.assignedTo,
          createdAt: t.createdAt,
        })),
        total: tasks.length,
        filters: {
          status: input.status,
          type: input.type,
          assignedTo: input.assignedTo,
          priority: input.priority,
        },
      };
    },
  },
  {
    name: 'task_complete',
    description: 'Mark task as complete Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        result: { type: 'object', description: 'Task result data' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (task) {
        if (task.status === 'completed') {
          return { taskId: task.taskId, status: task.status, completedAt: task.completedAt, result: task.result };
        }
        task.status = 'completed';
        task.progress = 100;
        task.completedAt = new Date().toISOString();
        task.result = (input.result as Record<string, unknown>) || {};
        saveTaskStore(store);

        // Sync assigned agents back to idle and increment taskCount
        updateAgents(task.assignedTo, (agent) => {
          if (agent.currentTask === taskId) {
            agent.status = 'idle';
            agent.currentTask = null;
          }
          agent.taskCount = ((agent.taskCount as number) || 0) + 1;
        });

        return {
          taskId: task.taskId,
          status: task.status,
          completedAt: task.completedAt,
          result: task.result,
        };
      }

      return {
        taskId,
        status: 'not_found',
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_update',
    description: 'Update task status or progress Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        // No schema enum: the HTTP/WebSocket registry validates enums before the handler, which would refuse the aliases there
        // while stdio accepted them. The handler is the one place that normalises and refuses, for every transport.
        status: { type: 'string', description: 'New status: pending, in_progress, completed, failed or cancelled' },
        progress: { type: 'number', description: 'Progress percentage (0-100)' },
        assignTo: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign' },
        result: { type: 'object', description: 'Result data (e.g. the failure of a failed task)' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };
      // A status outside the five is stored as written otherwise, and every reader that buckets
      // by status (task_list filters, the console kanban) then miscounts it: "complete" read as pending.
      const status = input.status === undefined ? undefined : statusOf(input.status);
      if (status === null) {
        return { success: false, error: `status must be one of ${TASK_STATUSES.join(', ')}` };
      }

      if (input.assignTo !== undefined && (!Array.isArray(input.assignTo)
        || !input.assignTo.every(id => validateIdentifier(id, 'assignTo').valid))) {
        return { success: false, error: 'assignTo must be an array of agent ids' };
      }

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (task) {
        // Worker effects run AFTER the task store is saved, as task_complete does: a failed save must not leave
        // workers freed and counted against a task that still reads unfinished.
        let afterSave: (() => void) | undefined;
        const previouslyAssigned = Array.isArray(task.assignedTo) ? [...task.assignedTo] : [];
        if (status !== undefined) {
          const newStatus = status;
          const wasCompleted = task.status === 'completed';
          task.status = newStatus;
          if (newStatus === 'in_progress' && !task.startedAt) {
            task.startedAt = new Date().toISOString();
          }
          // A finished task frees its workers, as task_complete and task_cancel do; otherwise a worker
          // whose task was finished through task_update stays `busy` forever, and a later task_complete
          // returns early because the status already reads completed.
          if (newStatus === 'failed' || newStatus === 'cancelled') {
            task.completedAt = new Date().toISOString();
            afterSave = () => releaseAgents(previouslyAssigned, taskId);
          }
          if (newStatus === 'completed' && !wasCompleted) {
            task.completedAt = new Date().toISOString();
            // Credited only to a worker still holding this task, so complete -> pending -> complete
            // (no reassignment in between) never counts the same work twice.
            afterSave = () => updateAgents(previouslyAssigned, (agent) => {
              if (agent.currentTask === taskId) {
                agent.status = 'idle';
                agent.currentTask = null;
                agent.taskCount = ((agent.taskCount as number) || 0) + 1;
              }
            });
          }
        }
        if (typeof input.progress === 'number') {
          task.progress = Math.min(100, Math.max(0, input.progress as number));
        }
        // Completing is 100% whatever progress the same call carried.
        if (task.status === 'completed') task.progress = 100;
        if (input.assignTo) {
          task.assignedTo = input.assignTo as string[];
          // Reassignment must update the same worker stores as task_assign.
          // Terminal transitions release/credit the workers that held the task
          // before this update; replacement assignees did not perform that work.
          if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
            afterSave = () => {
              releaseAgents(previouslyAssigned.filter(id => !task.assignedTo.includes(id)), taskId);
              // Echoing retained assignees must not take them from another task or re-credit completed work.
              updateAgents(task.assignedTo.filter(id => !previouslyAssigned.includes(id)), agent => {
                agent.status = 'busy';
                agent.currentTask = taskId;
              });
            };
          } else if (!afterSave) {
            afterSave = () => releaseAgents(previouslyAssigned, taskId);
          }
        }
        if (input.result && typeof input.result === 'object') {
          task.result = input.result as Record<string, unknown>;
        }
        saveTaskStore(store);
        afterSave?.();

        return {
          success: true,
          taskId: task.taskId,
          status: task.status,
          progress: task.progress,
          assignedTo: task.assignedTo,
        };
      }

      return {
        success: false,
        taskId,
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_assign',
    description: 'Assign a task to one or more agents Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to assign' },
        agentIds: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign' },
        unassign: { type: 'boolean', description: 'Unassign all agents from task' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (!task) {
        return { taskId, error: 'Task not found' };
      }

      const previouslyAssigned = [...task.assignedTo];

      // Load agent store to sync worker state
      const agentStorePath = join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json');
      readRecordStore<{ agents: Record<string, Record<string, unknown>> }>(
        agentStorePath, 'agents', () => ({ agents: {} }),
      );
      if (input.unassign) {
        // Revert previously assigned agents to idle
        releaseAgents(previouslyAssigned, taskId);
        task.assignedTo = [];
      } else {
        const agentIds = (input.agentIds as string[]) || [];
        // Revert old agents to idle
        releaseAgents(previouslyAssigned.filter((id) => !agentIds.includes(id)), taskId);
        // Set new agents to active
        updateAgents(agentIds, (agent) => {
          agent.status = 'busy';
          agent.currentTask = taskId;
        });
        task.assignedTo = agentIds;
        // Auto-transition task to in_progress if pending
        if (task.status === 'pending' && agentIds.length > 0) {
          task.status = 'in_progress';
          if (!task.startedAt) {
            task.startedAt = new Date().toISOString();
          }
        }
      }

      saveTaskStore(store);

      return {
        taskId: task.taskId,
        assignedTo: task.assignedTo,
        previouslyAssigned,
        status: task.status,
      };
    },
  },
  {
    name: 'task_cancel',
    description: 'Cancel a task Use when native TodoWrite is wrong because you need cross-session task persistence, agent assignment, dependency tracking, or completion analytics in the .swarm/memory.db. For in-session checklists native TodoWrite is simpler and faster.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        reason: { type: 'string', description: 'Cancellation reason' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.taskId, 'taskId');
      if (!vId.valid) return { success: false, error: vId.error };
      if (input.reason) {
        const v = validateText(input.reason, 'reason');
        if (!v.valid) return { success: false, error: v.error };
      }

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const task = store.tasks[taskId];

      if (task) {
        task.status = 'cancelled';
        task.completedAt = new Date().toISOString();
        task.result = { cancelReason: input.reason || 'Cancelled by user' };
        saveTaskStore(store);
        releaseAgents(task.assignedTo, taskId);

        return {
          success: true,
          taskId: task.taskId,
          status: task.status,
          cancelledAt: task.completedAt,
        };
      }

      return {
        success: false,
        taskId,
        error: 'Task not found',
      };
    },
  },
  {
    // #1916: the `ruflo task retry <id>` CLI subcommand referenced an
    // unregistered `task_retry` tool. Re-queues a finished/cancelled task by
    // cloning its spec into a fresh pending task (the original is left intact
    // as history).
    name: 'task_retry',
    description: 'Re-queue a failed/cancelled/completed task by cloning its spec into a fresh pending task (the original record is kept as history). Use when native TodoWrite is wrong because you need the original task\'s persisted spec (type, priority, assignees, tags) and a stable taskId chain across runs rather than hand-retyping a checklist item. For ad-hoc re-runs, native TodoWrite is fine.',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID of the task to retry' },
        resetState: { type: 'boolean', description: 'Reset progress/result on the new task (default true)' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      const v = validateIdentifier(input.taskId, 'taskId');
      if (!v.valid) return { success: false, error: v.error };

      const store = loadTaskStore();
      const taskId = input.taskId as string;
      const original = store.tasks[taskId];
      if (!original) return { success: false, taskId, error: 'Task not found' };

      const newTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      store.tasks[newTaskId] = {
        taskId: newTaskId,
        type: original.type,
        description: original.description,
        priority: original.priority,
        status: 'pending',
        progress: 0,
        assignedTo: [...original.assignedTo],
        tags: [...original.tags, 'retry-of:' + taskId],
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      };
      saveTaskStore(store);

      return {
        taskId,
        newTaskId,
        previousStatus: original.status,
        status: 'pending',
      };
    },
  },
];
