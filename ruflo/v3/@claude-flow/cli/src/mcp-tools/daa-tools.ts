/**
 * DAA (Decentralized Autonomous Agents) MCP Tools for CLI
 *
 * V2 Compatibility - DAA agent management tools
 *
 * ⚠️ IMPORTANT: These tools provide LOCAL STATE MANAGEMENT.
 * - Agent coordination is tracked locally
 * - No distributed network communication
 * - Useful for workflow orchestration and state tracking
 */

import type { MCPTool } from './types.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const DAA_DIR = 'daa';
const DAA_FILE = 'store.json';

interface DAAAgent {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'idle' | 'learning' | 'terminated';
  cognitivePattern: string;
  learningRate: number;
  memory: boolean;
  capabilities: string[];
  metrics: {
    tasksCompleted: number;
    successRate: number;
    adaptations: number;
  };
  createdAt: string;
  lastActivity: string;
}

interface DAAWorkflow {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  steps: Array<{ name: string; status: string; output?: string }>;
  strategy: string;
  createdAt: string;
}

interface DAAStore {
  agents: Record<string, DAAAgent>;
  workflows: Record<string, DAAWorkflow>;
  knowledge: Record<string, { domain: string; content: unknown; sharedBy: string; timestamp: string }>;
  version: string;
}

function getDAADir(): string {
  return join(process.cwd(), STORAGE_DIR, DAA_DIR);
}

function getDAAPath(): string {
  return join(getDAADir(), DAA_FILE);
}

function ensureDAADir(): void {
  const dir = getDAADir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadDAAStore(): DAAStore {
  try {
    const path = getDAAPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Return empty store
  }
  return { agents: {}, workflows: {}, knowledge: {}, version: '3.0.0' };
}

function saveDAAStore(store: DAAStore): void {
  ensureDAADir();
  writeFileSync(getDAAPath(), JSON.stringify(store, null, 2), 'utf-8');
}

export const daaTools: MCPTool[] = [
  {
    name: 'daa/agent_create',
    description: 'Create a decentralized autonomous agent',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        name: { type: 'string', description: 'Agent name' },
        type: { type: 'string', description: 'Agent type' },
        cognitivePattern: { type: 'string', enum: ['convergent', 'divergent', 'lateral', 'systems', 'critical', 'adaptive'], description: 'Cognitive pattern' },
        learningRate: { type: 'number', description: 'Learning rate (0-1)' },
        enableMemory: { type: 'boolean', description: 'Enable persistent memory' },
        capabilities: { type: 'array', description: 'Agent capabilities' },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const store = loadDAAStore();
      const id = input.id as string;

      const agent: DAAAgent = {
        id,
        name: (input.name as string) || `DAA-${id}`,
        type: (input.type as string) || 'autonomous',
        status: 'active',
        cognitivePattern: (input.cognitivePattern as string) || 'adaptive',
        learningRate: (input.learningRate as number) || 0.01,
        memory: (input.enableMemory as boolean) ?? true,
        capabilities: (input.capabilities as string[]) || ['reasoning', 'learning'],
        metrics: {
          tasksCompleted: 0,
          successRate: 1.0,
          adaptations: 0,
        },
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };

      store.agents[id] = agent;
      saveDAAStore(store);

      return {
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          type: agent.type,
          status: agent.status,
          cognitivePattern: agent.cognitivePattern,
          capabilities: agent.capabilities,
        },
        createdAt: agent.createdAt,
      };
    },
  },
  {
    name: 'daa/agent_adapt',
    description: 'Trigger agent adaptation based on feedback',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        feedback: { type: 'string', description: 'Feedback message' },
        performanceScore: { type: 'number', description: 'Performance score (0-1)' },
        suggestions: { type: 'array', description: 'Improvement suggestions' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const store = loadDAAStore();
      const agentId = input.agentId as string;
      const agent = store.agents[agentId];

      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      const performanceScore = (input.performanceScore as number) || 0.8;

      // Update agent metrics
      agent.metrics.adaptations++;
      agent.metrics.successRate = (agent.metrics.successRate + performanceScore) / 2;
      agent.lastActivity = new Date().toISOString();
      agent.status = 'learning';

      // Simulate adaptation delay
      await new Promise(resolve => setTimeout(resolve, 50));

      agent.status = 'active';
      saveDAAStore(store);

      return {
        success: true,
        agentId,
        adaptation: {
          feedback: input.feedback,
          performanceScore,
          adaptations: agent.metrics.adaptations,
          newSuccessRate: agent.metrics.successRate,
        },
        status: agent.status,
      };
    },
  },
  {
    name: 'daa/workflow_create',
    description: 'Create an autonomous workflow',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow ID' },
        name: { type: 'string', description: 'Workflow name' },
        steps: { type: 'array', description: 'Workflow steps' },
        strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive'], description: 'Execution strategy' },
        dependencies: { type: 'object', description: 'Step dependencies' },
      },
      required: ['id', 'name'],
    },
    handler: async (input) => {
      const store = loadDAAStore();
      const id = input.id as string;

      const workflow: DAAWorkflow = {
        id,
        name: input.name as string,
        status: 'pending',
        steps: ((input.steps as unknown[]) || []).map((s, i) => ({
          name: typeof s === 'string' ? s : `Step ${i + 1}`,
          status: 'pending',
        })),
        strategy: (input.strategy as string) || 'adaptive',
        createdAt: new Date().toISOString(),
      };

      store.workflows[id] = workflow;
      saveDAAStore(store);

      return {
        success: true,
        workflowId: id,
        name: workflow.name,
        steps: workflow.steps.length,
        strategy: workflow.strategy,
        createdAt: workflow.createdAt,
      };
    },
  },
  {
    name: 'daa/workflow_execute',
    description: 'Execute a DAA workflow',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        agentIds: { type: 'array', description: 'Agent IDs to use' },
        parallelExecution: { type: 'boolean', description: 'Enable parallel execution' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const store = loadDAAStore();
      const workflowId = input.workflowId as string;
      const workflow = store.workflows[workflowId];

      if (!workflow) {
        return { success: false, error: 'Workflow not found' };
      }

      workflow.status = 'running';
      saveDAAStore(store);

      // Simulate execution
      for (const step of workflow.steps) {
        step.status = 'running';
        await new Promise(resolve => setTimeout(resolve, 10));
        step.status = 'completed';
        step.output = `Completed: ${step.name}`;
      }

      workflow.status = 'completed';
      saveDAAStore(store);

      return {
        success: true,
        workflowId,
        status: workflow.status,
        steps: workflow.steps,
        completedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'daa/knowledge_share',
    description: 'Share knowledge between agents',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        sourceAgentId: { type: 'string', description: 'Source agent ID' },
        targetAgentIds: { type: 'array', description: 'Target agent IDs' },
        knowledgeDomain: { type: 'string', description: 'Knowledge domain' },
        knowledgeContent: { type: 'object', description: 'Knowledge to share' },
      },
      required: ['sourceAgentId', 'targetAgentIds'],
    },
    handler: async (input) => {
      const store = loadDAAStore();
      const sourceId = input.sourceAgentId as string;
      const targetIds = input.targetAgentIds as string[];
      const domain = (input.knowledgeDomain as string) || 'general';

      const knowledgeId = `knowledge-${Date.now()}`;
      store.knowledge[knowledgeId] = {
        domain,
        content: input.knowledgeContent || {},
        sharedBy: sourceId,
        timestamp: new Date().toISOString(),
      };

      saveDAAStore(store);

      return {
        success: true,
        knowledgeId,
        sourceAgent: sourceId,
        targetAgents: targetIds,
        domain,
        sharedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'daa/learning_status',
    description: 'Get learning status for DAA agents',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Specific agent ID' },
        detailed: { type: 'boolean', description: 'Include detailed metrics' },
      },
    },
    handler: async (input) => {
      const store = loadDAAStore();
      const agentId = input.agentId as string;

      if (agentId) {
        const agent = store.agents[agentId];
        if (!agent) {
          return { success: false, error: 'Agent not found' };
        }

        return {
          success: true,
          agent: {
            id: agent.id,
            status: agent.status,
            cognitivePattern: agent.cognitivePattern,
            learningRate: agent.learningRate,
            metrics: agent.metrics,
          },
        };
      }

      const agents = Object.values(store.agents);

      return {
        success: true,
        summary: {
          total: agents.length,
          active: agents.filter(a => a.status === 'active').length,
          learning: agents.filter(a => a.status === 'learning').length,
          avgSuccessRate: agents.length > 0
            ? agents.reduce((sum, a) => sum + a.metrics.successRate, 0) / agents.length
            : 0,
          totalAdaptations: agents.reduce((sum, a) => sum + a.metrics.adaptations, 0),
        },
        agents: agents.map(a => ({
          id: a.id,
          status: a.status,
          successRate: a.metrics.successRate,
          adaptations: a.metrics.adaptations,
        })),
      };
    },
  },
  {
    name: 'daa/cognitive_pattern',
    description: 'Analyze or change cognitive patterns',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        action: { type: 'string', enum: ['analyze', 'change'], description: 'Action' },
        pattern: { type: 'string', enum: ['convergent', 'divergent', 'lateral', 'systems', 'critical', 'adaptive'], description: 'New pattern' },
      },
    },
    handler: async (input) => {
      const store = loadDAAStore();
      const agentId = input.agentId as string;
      const action = (input.action as string) || 'analyze';

      if (agentId) {
        const agent = store.agents[agentId];
        if (!agent) {
          return { success: false, error: 'Agent not found' };
        }

        if (action === 'analyze') {
          return {
            success: true,
            agentId,
            currentPattern: agent.cognitivePattern,
            analysis: {
              strengths: ['Pattern recognition', 'Adaptive learning'],
              weaknesses: ['May be slow for simple tasks'],
              recommendations: ['Consider convergent for focused tasks'],
            },
          };
        }

        if (action === 'change' && input.pattern) {
          const oldPattern = agent.cognitivePattern;
          agent.cognitivePattern = input.pattern as string;
          saveDAAStore(store);

          return {
            success: true,
            agentId,
            previousPattern: oldPattern,
            newPattern: agent.cognitivePattern,
            changedAt: new Date().toISOString(),
          };
        }
      }

      // Return general pattern info
      const patternDescriptions = {
        convergent: 'Focused, analytical thinking for well-defined problems',
        divergent: 'Creative, exploratory thinking for open-ended problems',
        lateral: 'Indirect, creative approach to problem solving',
        systems: 'Holistic thinking considering interconnections',
        critical: 'Analytical evaluation and logical assessment',
        adaptive: 'Dynamic switching between patterns as needed',
      };

      return {
        success: true,
        patterns: patternDescriptions,
        recommendation: 'Use "adaptive" for general-purpose agents',
      };
    },
  },
  {
    name: 'daa/performance_metrics',
    description: 'Get DAA performance metrics',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['all', 'agents', 'workflows', 'learning'], description: 'Metrics category' },
        timeRange: { type: 'string', description: 'Time range' },
      },
    },
    handler: async (input) => {
      const store = loadDAAStore();
      const category = (input.category as string) || 'all';

      const agents = Object.values(store.agents);
      const workflows = Object.values(store.workflows);

      const metrics = {
        agents: {
          total: agents.length,
          active: agents.filter(a => a.status === 'active').length,
          avgSuccessRate: agents.length > 0
            ? agents.reduce((sum, a) => sum + a.metrics.successRate, 0) / agents.length
            : 0,
          totalTasks: agents.reduce((sum, a) => sum + a.metrics.tasksCompleted, 0),
        },
        workflows: {
          total: workflows.length,
          completed: workflows.filter(w => w.status === 'completed').length,
          running: workflows.filter(w => w.status === 'running').length,
          successRate: workflows.length > 0
            ? workflows.filter(w => w.status === 'completed').length / workflows.length
            : 0,
        },
        learning: {
          totalAdaptations: agents.reduce((sum, a) => sum + a.metrics.adaptations, 0),
          knowledgeItems: Object.keys(store.knowledge).length,
          avgLearningRate: agents.length > 0
            ? agents.reduce((sum, a) => sum + a.learningRate, 0) / agents.length
            : 0,
        },
      };

      if (category === 'all') {
        return { success: true, metrics };
      }

      return {
        success: true,
        category,
        metrics: metrics[category as keyof typeof metrics],
      };
    },
  },
];
