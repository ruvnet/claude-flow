/**
 * Workflow MCP Tools for CLI
 *
 * Tool definitions for workflow automation and orchestration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validatePath, validateText } from './validate-input.js';
import { executeAgentTask } from './agent-execute-core.js';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const WORKFLOW_DIR = 'workflows';
const WORKFLOW_FILE = 'store.json';

interface WorkflowStep {
  stepId: string;
  name: string;
  type: 'task' | 'condition' | 'parallel' | 'loop' | 'wait';
  config: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  startedAt?: string;
  completedAt?: string;
}

interface WorkflowRecord {
  workflowId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  status: 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'failed';
  currentStep: number;
  variables: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface WorkflowStore {
  workflows: Record<string, WorkflowRecord>;
  templates: Record<string, WorkflowRecord>;
  version: string;
}

function getWorkflowDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, WORKFLOW_DIR);
}

function getWorkflowPath(): string {
  return join(getWorkflowDir(), WORKFLOW_FILE);
}

function ensureWorkflowDir(): void {
  const dir = getWorkflowDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadWorkflowStore(): WorkflowStore {
  try {
    const path = getWorkflowPath();
    if (existsSync(path)) {
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return default store on error
  }
  return { workflows: {}, templates: {}, version: '3.0.0' };
}

function saveWorkflowStore(store: WorkflowStore): void {
  ensureWorkflowDir();
  writeFileSync(getWorkflowPath(), JSON.stringify(store, null, 2), 'utf-8');
}

// A paused in-flight step still owns its executor. Resume joins that execution
// instead of dispatching the same side effect again (within this process).
const workflowExecutions = new Map<string, Promise<unknown>>();
const workflowExecutionKey = (workflowId: unknown): string =>
  JSON.stringify([getWorkflowPath(), workflowId]);

function withWorkflowExecution<T>(workflowId: unknown, execute: () => Promise<T>) {
  const key = workflowExecutionKey(workflowId);
  if (workflowExecutions.has(key)) {
    return Promise.resolve({ workflowId, error: 'Workflow already executing' });
  }
  const execution = execute();
  workflowExecutions.set(key, execution);
  return execution.finally(() => {
    if (workflowExecutions.get(key) === execution) workflowExecutions.delete(key);
  });
}

export const workflowTools: MCPTool[] = [
  {
    name: 'workflow_run',
    description: 'Run a workflow from a template or file Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template name to run' },
        file: { type: 'string', description: 'Workflow file path' },
        task: { type: 'string', description: 'Task description' },
        options: {
          type: 'object',
          description: 'Workflow options',
          properties: {
            parallel: { type: 'boolean', description: 'Run stages in parallel' },
            maxAgents: { type: 'number', description: 'Maximum agents to use' },
            timeout: { type: 'number', description: 'Timeout in seconds' },
            dryRun: { type: 'boolean', description: 'Validate without executing' },
          },
        },
      },
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      if (input.template) {
        const v = validateIdentifier(input.template, 'template');
        if (!v.valid) return { success: false, error: v.error };
      }
      if (input.file) {
        const v = validatePath(input.file, 'file');
        if (!v.valid) return { success: false, error: v.error };
      }
      if (input.task) {
        const v = validateText(input.task, 'task');
        if (!v.valid) return { success: false, error: v.error };
      }

      const store = loadWorkflowStore();
      const template = input.template as string | undefined;
      const task = input.task as string | undefined;
      const options = (input.options as Record<string, unknown>) || {};
      const dryRun = options.dryRun as boolean | undefined;

      // Build workflow from template or inline
      const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const stages: Array<{ name: string; status: string; agents: string[]; duration?: number }> = [];

      // Generate stages based on template
      const templateName = template || 'custom';
      const stageNames: string[] = (() => {
        switch (templateName) {
          case 'feature':
            return ['Research', 'Design', 'Implement', 'Test', 'Review'];
          case 'bugfix':
            return ['Investigate', 'Fix', 'Test', 'Review'];
          case 'refactor':
            return ['Analyze', 'Refactor', 'Test', 'Review'];
          case 'security':
            return ['Scan', 'Analyze', 'Report'];
          default:
            return ['Execute'];
        }
      })();

      for (const name of stageNames) {
        stages.push({
          name,
          status: dryRun ? 'validated' : 'pending',
          agents: [],
        });
      }

      if (!dryRun) {
        // Create and save the workflow
        const steps: WorkflowStep[] = stageNames.map((name, i) => ({
          stepId: `step-${i + 1}`,
          name,
          type: 'task' as const,
          config: { task: task || name },
          status: 'pending' as const,
        }));

        const workflow: WorkflowRecord = {
          workflowId,
          name: task || `${templateName} workflow`,
          description: task,
          steps,
          status: 'running',
          currentStep: 0,
          variables: { template: templateName, ...options },
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
        };

        store.workflows[workflowId] = workflow;
        saveWorkflowStore(store);
      }

      return {
        workflowId,
        template: templateName,
        status: dryRun ? 'validated' : 'running',
        stages,
        metrics: {
          totalStages: stages.length,
          completedStages: 0,
          agentsSpawned: 0,
          estimatedDuration: `${stages.length * 30}s`,
        },
      };
    },
  },
  {
    name: 'workflow_create',
    description: 'Create a new workflow Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        description: { type: 'string', description: 'Workflow description' },
        steps: {
          type: 'array',
          description: 'Workflow steps',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['task', 'condition', 'parallel', 'loop', 'wait'] },
              config: { type: 'object' },
            },
          },
        },
        variables: { type: 'object', description: 'Initial variables' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vName = validateText(input.name, 'name', 256);
      if (!vName.valid) return { success: false, error: vName.error };
      if (input.description) {
        const v = validateText(input.description, 'description');
        if (!v.valid) return { success: false, error: v.error };
      }

      const store = loadWorkflowStore();
      const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const steps: WorkflowStep[] = ((input.steps as Array<{name?: string; type?: string; config?: Record<string, unknown>}>) || []).map((s, i) => ({
        stepId: `step-${i + 1}`,
        name: s.name || `Step ${i + 1}`,
        type: (s.type as WorkflowStep['type']) || 'task',
        config: s.config || {} as Record<string, unknown>,
        status: 'pending' as const,
      }));

      const workflow: WorkflowRecord = {
        workflowId,
        name: input.name as string,
        description: input.description as string,
        steps,
        status: steps.length > 0 ? 'ready' : 'draft',
        currentStep: 0,
        variables: (input.variables as Record<string, unknown>) || {},
        createdAt: new Date().toISOString(),
      };

      store.workflows[workflowId] = workflow;
      saveWorkflowStore(store);

      return {
        workflowId,
        name: workflow.name,
        status: workflow.status,
        stepCount: steps.length,
        createdAt: workflow.createdAt,
      };
    },
  },
  {
    name: 'workflow_execute',
    description: 'Execute a workflow Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID to execute' },
        variables: { type: 'object', description: 'Runtime variables to inject' },
        startFromStep: { type: 'number', description: 'Step to start from (0-indexed)' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => withWorkflowExecution(input.workflowId, async () => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.workflowId, 'workflowId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadWorkflowStore();
      const workflowId = input.workflowId as string;
      const workflow = store.workflows[workflowId];

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }
      if (workflow.status === 'running') {
        return { workflowId, error: 'Workflow already running' };
      }

      // Indices may name a step or the end boundary (used when resuming
      // after the final step). Reject invalid control flow before any writes.
      const validIndex = (value: unknown): value is number =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= workflow.steps.length;
      const startFromStep = input.startFromStep === undefined ? 0 : input.startFromStep;
      if (!validIndex(startFromStep)) {
        return { workflowId, error: `startFromStep must be an integer between 0 and ${workflow.steps.length}` };
      }
      for (const step of workflow.steps) {
        if (step.type !== 'condition') continue;
        for (const target of ['thenStep', 'elseStep']) {
          if (step.config[target] !== undefined && !validIndex(step.config[target])) {
            return { workflowId, error: `${step.stepId}.${target} must be an integer between 0 and ${workflow.steps.length}` };
          }
        }
      }

      const persistProgress = (): void => {
        // An awaited step may overlap pause/stop/delete or a sibling workflow
        // mutation. Merge only this workflow into the latest store snapshot.
        const latest = loadWorkflowStore();
        const current = latest.workflows[workflowId];
        if (!current) {
          workflow.status = 'failed';
          workflow.error = 'Workflow was deleted during execution';
          return;
        }
        if (current.status === 'failed') {
          Object.assign(workflow, current);
          return;
        }
        if (current.status === 'paused' && workflow.status !== 'failed') workflow.status = 'paused';
        latest.workflows[workflowId] = workflow;
        saveWorkflowStore(latest);
      };

      // Inject runtime variables
      if (input.variables) {
        workflow.variables = { ...workflow.variables, ...(input.variables as Record<string, unknown>) };
      }

      workflow.status = 'running';
      workflow.startedAt = new Date().toISOString();
      delete workflow.error;
      delete workflow.completedAt;
      workflow.currentStep = startFromStep;
      saveWorkflowStore(store);

      // ADR-095 G3: real workflow runtime. Walk the steps in order;
      // dispatch each by type. Persist progress after each step so a
      // crash or pause can resume cleanly. No mock — task steps make
      // real LLM calls via agent_execute (G1's wire).
      const stepResults: Array<{ stepId: string; type: string; status: string; durationMs?: number; output?: string; error?: string }> = [];

      // Variable substitution: {{name}} → workflow.variables[name] OR steps[stepId].output
      const interp = (text: string): string => {
        return text.replace(/\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g, (_, key) => {
          // Direct variable
          if (key in workflow.variables) return String(workflow.variables[key]);
          // Step-output reference: stepId.output
          const dot = key.indexOf('.');
          if (dot > 0) {
            const stepId = key.slice(0, dot);
            const field = key.slice(dot + 1);
            const prior = stepResults.find(s => s.stepId === stepId);
            if (prior && field === 'output' && typeof prior.output === 'string') return prior.output;
          }
          return '';
        });
      };

      const startedAt = Date.now();
      let i = workflow.currentStep;
      while (i < workflow.steps.length) {
        // Honor pause/cancel signals between steps.
        const live = loadWorkflowStore().workflows[workflowId];
        if (!live) {
          workflow.status = 'failed';
          workflow.error = 'Workflow was deleted during execution';
          break;
        }
        if (live.status === 'paused') {
          workflow.status = 'paused';
          workflow.currentStep = i;
          persistProgress();
          break;
        }
        if (live.status === 'failed') {
          Object.assign(workflow, live);
          break;
        }

        const step = workflow.steps[i];
        step.status = 'running';
        step.startedAt = new Date().toISOString();
        const stepStart = Date.now();
        persistProgress();

        let stepEntry: typeof stepResults[number] = { stepId: step.stepId, type: step.type, status: 'running' };

        try {
          if (step.type === 'task') {
            const cfg = step.config as Record<string, unknown>;
            const agentId = (cfg.agentId as string) || (workflow.variables.defaultAgentId as string);
            const promptTpl = (cfg.prompt as string) || step.name;
            if (!agentId) throw new Error(`task step ${step.stepId} requires config.agentId or workflow.variables.defaultAgentId`);
            const prompt = interp(promptTpl);
            const result = await executeAgentTask({
              agentId,
              prompt,
              systemPrompt: cfg.systemPrompt ? interp(String(cfg.systemPrompt)) : undefined,
              maxTokens: cfg.maxTokens as number | undefined,
              temperature: cfg.temperature as number | undefined,
              timeoutMs: cfg.timeoutMs as number | undefined,
            });
            if (!result.success) throw new Error(result.error || 'agent_execute failed');
            step.result = result;
            workflow.variables[`${step.stepId}.output`] = result.output;
            workflow.variables.lastStepOutput = result.output;
            stepEntry = { stepId: step.stepId, type: 'task', status: 'completed', durationMs: result.durationMs, output: result.output };
          } else if (step.type === 'wait') {
            const cfg = step.config as Record<string, unknown>;
            const ms = Math.min(Math.max(0, (cfg.ms as number) || 0), 60000);
            await new Promise(r => setTimeout(r, ms));
            step.result = { waitedMs: ms };
            stepEntry = { stepId: step.stepId, type: 'wait', status: 'completed', durationMs: ms };
          } else if (step.type === 'condition') {
            // Simple condition: config.when is a JS expression evaluated against workflow.variables.
            // For safety, we only support `var === 'value'` or `var === number`.
            const cfg = step.config as Record<string, unknown>;
            const expr = String(cfg.when || 'true').trim();
            const m = expr.match(/^([a-zA-Z_][\w]*)\s*===?\s*(['\"])?([^'\"]*)\2?$/);
            let truthy = false;
            if (m) {
              const v = workflow.variables[m[1]];
              const expected = m[2] ? m[3] : Number(m[3]);
              truthy = v === expected;
            } else if (expr === 'true') truthy = true;
            step.result = { conditionExpr: expr, truthy };
            // condition can declare a target step index to jump to via cfg.thenStep / cfg.elseStep
            if (typeof cfg.thenStep === 'number' && truthy) i = (cfg.thenStep as number) - 1;
            if (typeof cfg.elseStep === 'number' && !truthy) i = (cfg.elseStep as number) - 1;
            stepEntry = { stepId: step.stepId, type: 'condition', status: 'completed' };
          } else {
            // parallel/loop are deferred — mark skipped honestly rather than mock-completing.
            step.result = { _note: `step type '${step.type}' not yet implemented in runtime` };
            stepEntry = { stepId: step.stepId, type: step.type, status: 'skipped' };
          }
          step.status = stepEntry.status === 'skipped' ? 'skipped' : 'completed';
          step.completedAt = new Date().toISOString();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          step.status = 'failed';
          step.result = { error: msg };
          step.completedAt = new Date().toISOString();
          stepEntry = { stepId: step.stepId, type: step.type, status: 'failed', durationMs: Date.now() - stepStart, error: msg };
          stepResults.push(stepEntry);
          workflow.status = 'failed';
          workflow.error = msg;
          workflow.completedAt = new Date().toISOString();
          persistProgress();
          return {
            workflowId,
            status: 'failed',
            error: msg,
            failedStep: step.stepId,
            stepsCompleted: stepResults.filter(s => s.status === 'completed').length,
            results: stepResults,
            durationMs: Date.now() - startedAt,
          };
        }

        if (typeof stepEntry.durationMs !== 'number') stepEntry.durationMs = Date.now() - stepStart;
        stepResults.push(stepEntry);
        workflow.currentStep = i + 1;
        persistProgress();
        i++;
      }

      if (workflow.status === 'running') {
        workflow.status = 'completed';
        workflow.completedAt = new Date().toISOString();
        persistProgress();
      }

      return {
        workflowId,
        status: workflow.status,
        ...(workflow.error ? { error: workflow.error } : {}),
        totalSteps: workflow.steps.length,
        stepsCompleted: stepResults.filter(s => s.status === 'completed').length,
        stepsSkipped: stepResults.filter(s => s.status === 'skipped').length,
        stepsFailed: stepResults.filter(s => s.status === 'failed').length,
        results: stepResults,
        startedAt: workflow.startedAt,
        completedAt: workflow.completedAt,
        durationMs: Date.now() - startedAt,
      };
    }),
  },
  {
    name: 'workflow_status',
    description: 'Get workflow status Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        verbose: { type: 'boolean', description: 'Include step details' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.workflowId, 'workflowId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadWorkflowStore();
      const workflowId = input.workflowId as string;
      const workflow = store.workflows[workflowId];

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      const completedSteps = workflow.steps.filter(s => s.status === 'completed').length;
      const progress = workflow.steps.length > 0 ? (completedSteps / workflow.steps.length) * 100 : 0;

      const status = {
        workflowId: workflow.workflowId,
        name: workflow.name,
        status: workflow.status,
        progress,
        currentStep: workflow.currentStep,
        totalSteps: workflow.steps.length,
        completedSteps,
        createdAt: workflow.createdAt,
        startedAt: workflow.startedAt,
        completedAt: workflow.completedAt,
      };

      if (input.verbose) {
        return {
          ...status,
          description: workflow.description,
          variables: workflow.variables,
          steps: workflow.steps.map(s => ({
            stepId: s.stepId,
            name: s.name,
            type: s.type,
            status: s.status,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
          })),
          error: workflow.error,
        };
      }

      return status;
    },
  },
  {
    name: 'workflow_list',
    description: 'List all workflows Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        limit: { type: 'number', description: 'Max workflows to return' },
      },
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      if (input.status) {
        const v = validateIdentifier(input.status, 'status');
        if (!v.valid) return { success: false, error: v.error };
      }

      const store = loadWorkflowStore();
      let workflows = Object.values(store.workflows);

      // Apply filters
      if (input.status) {
        workflows = workflows.filter(w => w.status === input.status);
      }

      // Sort by creation date (newest first)
      workflows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Apply limit
      const limit = (input.limit as number) || 20;
      workflows = workflows.slice(0, limit);

      return {
        workflows: workflows.map(w => ({
          workflowId: w.workflowId,
          name: w.name,
          status: w.status,
          stepCount: w.steps.length,
          createdAt: w.createdAt,
          completedAt: w.completedAt,
        })),
        total: workflows.length,
        filters: { status: input.status },
      };
    },
  },
  {
    name: 'workflow_pause',
    description: 'Pause a running workflow Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.workflowId, 'workflowId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadWorkflowStore();
      const workflowId = input.workflowId as string;
      const workflow = store.workflows[workflowId];

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      if (workflow.status !== 'running') {
        return { workflowId, error: 'Workflow not running' };
      }

      workflow.status = 'paused';
      saveWorkflowStore(store);

      return {
        workflowId,
        status: workflow.status,
        pausedAt: new Date().toISOString(),
        currentStep: workflow.currentStep,
      };
    },
  },
  {
    name: 'workflow_resume',
    description: 'Resume a paused workflow Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.workflowId, 'workflowId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadWorkflowStore();
      const workflowId = input.workflowId as string;
      const workflow = store.workflows[workflowId];

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      if (workflow.status !== 'paused') {
        return { workflowId, error: 'Workflow not paused' };
      }

      const active = workflowExecutions.get(workflowExecutionKey(workflowId));
      if (active) {
        workflow.status = 'running';
        saveWorkflowStore(store);
        return { ...((await active) as Record<string, unknown>), resumed: true };
      }

      const execute = workflowTools.find(tool => tool.name === 'workflow_execute')!;
      const result = await execute.handler({ workflowId, startFromStep: workflow.currentStep });
      return { ...(result as Record<string, unknown>), resumed: true };
    },
  },
  {
    name: 'workflow_cancel',
    description: 'Cancel a workflow Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        reason: { type: 'string', description: 'Cancellation reason' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.workflowId, 'workflowId');
      if (!vId.valid) return { success: false, error: vId.error };
      if (input.reason) {
        const v = validateText(input.reason, 'reason');
        if (!v.valid) return { success: false, error: v.error };
      }

      const store = loadWorkflowStore();
      const workflowId = input.workflowId as string;
      const workflow = store.workflows[workflowId];

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      if (workflow.status === 'completed' || workflow.status === 'failed') {
        return { workflowId, error: 'Workflow already finished' };
      }

      workflow.status = 'failed';
      workflow.error = (input.reason as string) || 'Cancelled by user';
      workflow.completedAt = new Date().toISOString();

      // Mark remaining steps as skipped
      for (let i = workflow.currentStep; i < workflow.steps.length; i++) {
        workflow.steps[i].status = 'skipped';
      }

      saveWorkflowStore(store);

      return {
        workflowId,
        status: workflow.status,
        cancelledAt: workflow.completedAt,
        reason: workflow.error,
        skippedSteps: workflow.steps.length - workflow.currentStep,
      };
    },
  },
  {
    name: 'workflow_delete',
    description: 'Delete a workflow Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.workflowId, 'workflowId');
      if (!vId.valid) return { success: false, error: vId.error };

      const store = loadWorkflowStore();
      const workflowId = input.workflowId as string;

      if (!store.workflows[workflowId]) {
        return { workflowId, error: 'Workflow not found' };
      }

      const workflow = store.workflows[workflowId];
      if (workflow.status === 'running') {
        return { workflowId, error: 'Cannot delete running workflow' };
      }

      delete store.workflows[workflowId];
      saveWorkflowStore(store);

      return {
        workflowId,
        deleted: true,
        deletedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'workflow_template',
    description: 'Save workflow as template or create from template Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, retry policy, pause/resume, and step-output binding across LLM-driven steps. For a single linear todo list, native TodoWrite is fine.',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'create', 'list'], description: 'Template action' },
        workflowId: { type: 'string', description: 'Workflow ID (for save)' },
        templateId: { type: 'string', description: 'Template ID (for create)' },
        templateName: { type: 'string', description: 'Template name (for save)' },
        newName: { type: 'string', description: 'New workflow name (for create)' },
      },
      required: ['action'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      if (input.workflowId) {
        const v = validateIdentifier(input.workflowId, 'workflowId');
        if (!v.valid) return { success: false, error: v.error };
      }
      if (input.templateId) {
        const v = validateIdentifier(input.templateId, 'templateId');
        if (!v.valid) return { success: false, error: v.error };
      }
      if (input.templateName) {
        const v = validateText(input.templateName, 'templateName', 256);
        if (!v.valid) return { success: false, error: v.error };
      }
      if (input.newName) {
        const v = validateText(input.newName, 'newName', 256);
        if (!v.valid) return { success: false, error: v.error };
      }

      const store = loadWorkflowStore();
      const action = input.action as string;

      if (action === 'save') {
        const workflow = store.workflows[input.workflowId as string];
        if (!workflow) {
          return { action, error: 'Workflow not found' };
        }

        const templateId = `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const template: WorkflowRecord = {
          ...workflow,
          workflowId: templateId,
          name: (input.templateName as string) || `${workflow.name} Template`,
          status: 'draft',
          currentStep: 0,
          createdAt: new Date().toISOString(),
          startedAt: undefined,
          completedAt: undefined,
        };

        // Reset step statuses
        template.steps = template.steps.map(s => ({
          ...s,
          status: 'pending',
          result: undefined,
          startedAt: undefined,
          completedAt: undefined,
        }));

        store.templates[templateId] = template;
        saveWorkflowStore(store);

        return {
          action,
          templateId,
          name: template.name,
          savedAt: new Date().toISOString(),
        };
      }

      if (action === 'create') {
        const template = store.templates[input.templateId as string];
        if (!template) {
          return { action, error: 'Template not found' };
        }

        const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const workflow: WorkflowRecord = {
          ...template,
          workflowId,
          name: (input.newName as string) || template.name.replace(' Template', ''),
          status: 'ready',
          createdAt: new Date().toISOString(),
        };

        store.workflows[workflowId] = workflow;
        saveWorkflowStore(store);

        return {
          action,
          workflowId,
          name: workflow.name,
          fromTemplate: input.templateId,
          createdAt: workflow.createdAt,
        };
      }

      if (action === 'list') {
        return {
          action,
          templates: Object.values(store.templates).map(t => ({
            templateId: t.workflowId,
            name: t.name,
            stepCount: t.steps.length,
            createdAt: t.createdAt,
          })),
          total: Object.keys(store.templates).length,
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
  {
    // #1916: `ruflo workflow stop <id>` referenced an unregistered
    // `workflow_stop` tool. Equivalent to workflow_cancel but returns the
    // shape the CLI expects (`{ workflowId, stopped, stoppedAt }`).
    name: 'workflow_stop',
    description: 'Stop a running/paused workflow and skip its remaining steps. Use when native TodoWrite + sequential Bash is wrong because the work has a real dependency graph that needs persistence, pause/resume, and step-output binding — and you need to halt it cleanly mid-run. For a single linear todo list, native TodoWrite is fine. (Same effect as workflow_cancel; this name is what the CLI `workflow stop` subcommand calls.)',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        graceful: { type: 'boolean', description: 'Let the current step finish (advisory)' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const vId = validateIdentifier(input.workflowId, 'workflowId');
      if (!vId.valid) return { success: false, error: vId.error };
      const store = loadWorkflowStore();
      const workflowId = input.workflowId as string;
      const workflow = store.workflows[workflowId];
      if (!workflow) return { workflowId, error: 'Workflow not found' };
      if (workflow.status === 'completed' || workflow.status === 'failed') {
        return { workflowId, error: 'Workflow already finished' };
      }
      workflow.status = 'failed';
      workflow.error = 'Stopped by user';
      workflow.completedAt = new Date().toISOString();
      for (let i = workflow.currentStep; i < workflow.steps.length; i++) {
        workflow.steps[i].status = 'skipped';
      }
      saveWorkflowStore(store);
      return { workflowId, stopped: true, stoppedAt: workflow.completedAt };
    },
  },
  {
    // #1916: `ruflo workflow validate -f <file>` referenced an unregistered
    // `workflow_validate` tool. Structural sanity check (JSON workflow files);
    // a full schema validator is a follow-up.
    name: 'workflow_validate',
    description: 'Structurally validate a workflow definition file (JSON) — checks it has a steps/stages/tasks array and that task steps resolve an agent. Use when native Read is wrong because you want a parsed, structured pass/fail with error/warning lists and step/agent counts rather than eyeballing the file. For just reading the file, native Read is fine. (Basic checks today — a full workflow-schema validator is a tracked follow-up.)',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to the workflow definition file' },
        strict: { type: 'boolean', description: 'Treat warnings as errors' },
      },
      required: ['file'],
    },
    handler: async (input) => {
      const file = String(input.file ?? '');
      const errors: Array<{ line: number; message: string; severity: string }> = [];
      const warnings: Array<{ line: number; message: string }> = [];
      let stages = 0;
      let agents = 0;
      try {
        if (!file || !existsSync(file)) {
          errors.push({ line: 0, message: `File not found: ${file || '(empty)'}`, severity: 'error' });
        } else {
          const raw = readFileSync(file, 'utf-8');
          let doc: unknown = null;
          if (/\.ya?ml$/i.test(file)) {
            warnings.push({ line: 0, message: 'YAML workflow files are not schema-validated yet — only JSON is fully checked (#1916 follow-up)' });
            try { doc = JSON.parse(raw); } catch { /* not JSON; leave doc null */ }
          } else {
            doc = JSON.parse(raw);
          }
          const d = (doc ?? {}) as Record<string, unknown>;
          const steps = (d.steps ?? d.stages ?? d.tasks) as unknown;
          if (!Array.isArray(steps)) {
            errors.push({ line: 0, message: 'Workflow has no `steps` / `stages` / `tasks` array', severity: 'error' });
          } else {
            stages = steps.length;
            const agentSet = new Set<string>();
            steps.forEach((s, i) => {
              const step = (s ?? {}) as Record<string, unknown>;
              // Match workflow_execute: control steps do not dispatch agents,
              // and task steps use config.agentId or the workflow default.
              const config = step.config as Record<string, unknown> | undefined;
              const variables = d.variables as Record<string, unknown> | undefined;
              const a = config?.agentId || variables?.defaultAgentId
                || step.agent || step.agentType || step.agent_type;
              const needsAgent = !['wait', 'condition', 'parallel', 'loop'].includes(String(step.type));
              if (needsAgent && a) agentSet.add(String(a));
              else if (needsAgent) warnings.push({ line: i + 1, message: `step ${i + 1} ("${step.name ?? step.id ?? i + 1}") names no agent` });
            });
            agents = agentSet.size;
          }
        }
      } catch (e) {
        errors.push({ line: 0, message: `Parse error: ${(e as Error).message}`, severity: 'error' });
      }
      const valid = errors.length === 0 && (!input.strict || warnings.length === 0);
      return {
        valid,
        file,
        errors,
        warnings,
        stats: { stages, agents, estimatedDuration: stages > 0 ? `~${stages * 30}s` : 'unknown' },
      };
    },
  },
];
