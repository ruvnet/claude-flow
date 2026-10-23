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

import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validateText } from './validate-input.js';
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
  return join(getProjectCwd(), STORAGE_DIR, DAA_DIR);
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
    name: 'daa_agent_create',
    description: 'Create a decentralized autonomous agent Use when native Task is wrong because you need agents that adapt their cognitive pattern (convergent / divergent / lateral / systems / critical) per-task and share knowledge across the swarm. For static one-shot agents, native Task is fine.',
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
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Agent capabilities' },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const vId = validateIdentifier(input.id, 'id');
      if (!vId.valid) return { success: false, error: vId.error };
      if (input.name) { const vName = validateText(input.name, 'name'); if (!vName.valid) return { success: false, error: vName.error }; }
      if (input.type) { const vType = validateIdentifier(input.type, 'type'); if (!vType.valid) return { success: false, error: vType.error }; }
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

      // Store agent in AgentDB for searchable agent registry
      try {
        const bridge = await import('../memory/memory-bridge.js');
        await bridge.bridgeStoreEntry({
          key: `daa-agent-${id}`,
          value: JSON.stringify({ id: agent.id, name: agent.name, type: agent.type, cognitivePattern: agent.cognitivePattern }),
          namespace: 'daa-agents',
          tags: [agent.type, agent.cognitivePattern],
        });
      } catch { /* AgentDB not available */ }

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
    name: 'daa_agent_adapt',
    description: 'Trigger agent adaptation based on feedback Use when native Task is wrong because you need agents that adapt their cognitive pattern (convergent / divergent / lateral / systems / critical) per-task and share knowledge across the swarm. For static one-shot agents, native Task is fine.',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        feedback: { type: 'string', description: 'Feedback message' },
        performanceScore: { type: 'number', description: 'Performance score (0-1)' },
        suggestions: { type: 'array', items: { type: 'string' }, description: 'Improvement suggestions' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const vAgentId = validateIdentifier(input.agentId, 'agentId');
      if (!vAgentId.valid) return { success: false, error: vAgentId.error };
      if (input.feedback) { const vFeedback = validateText(input.feedback, 'feedback'); if (!vFeedback.valid) return { success: false, error: vFeedback.error }; }
      const store = loadDAAStore();
      const agentId = input.agentId as string;
      const agent = store.agents[agentId];

      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      // #4426: `|| 0.8` turned a failing 0 (and a missing score) into a 0.8
      // success. A given score must be in [0, 1]; a missing one records none.
      const performanceScore = input.performanceScore === undefined ? null : input.performanceScore;
      if (performanceScore !== null && (typeof performanceScore !== 'number' || !Number.isFinite(performanceScore) || performanceScore < 0 || performanceScore > 1)) {
        return { success: false, error: 'performanceScore must be a number between 0 and 1' };
      }

      // Update agent metrics
      agent.metrics.adaptations++;
      if (performanceScore !== null) agent.metrics.successRate = (agent.metrics.successRate + performanceScore) / 2;
      agent.lastActivity = new Date().toISOString();
      agent.status = 'active';
      saveDAAStore(store);

      // Store adaptation feedback in AgentDB for pattern learning (backward compat: JSON store above)
      let _storedIn: 'agentdb' | 'json-store' = 'json-store';
      if (performanceScore !== null) {
        try {
          const bridge = await import('../memory/memory-bridge.js');
          await bridge.bridgeRecordFeedback({
            taskId: `adapt-${agentId}-${agent.metrics.adaptations}`,
            success: performanceScore >= 0.5,
            quality: performanceScore,
            agent: agentId,
          });
          _storedIn = 'agentdb';
        } catch { /* AgentDB not available */ }
      }

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
        _storedIn,
      };
    },
  },
  {
    name: 'daa_workflow_create',
    description: 'Create an autonomous workflow Use when native Task is wrong because you need agents that adapt their cognitive pattern (convergent / divergent / lateral / systems / critical) per-task and share knowledge across the swarm. For static one-shot agents, native Task is fine.',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow ID' },
        name: { type: 'string', description: 'Workflow name' },
        steps: { type: 'array', items: { type: 'object' }, description: 'Workflow steps' },
        strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive'], description: 'Execution strategy' },
        dependencies: { type: 'object', description: 'Step dependencies' },
      },
      required: ['id', 'name'],
    },
    handler: async (input) => {
      const vId = validateIdentifier(input.id, 'id');
      if (!vId.valid) return { success: false, error: vId.error };
      const vName = validateText(input.name, 'name');
      if (!vName.valid) return { success: false, error: vName.error };
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
    name: 'daa_workflow_execute',
    description: 'Execute a DAA workflow Use when native Task is wrong because you need agents that adapt their cognitive pattern (convergent / divergent / lateral / systems / critical) per-task and share knowledge across the swarm. For static one-shot agents, native Task is fine.',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        agentIds: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to use' },
        parallelExecution: { type: 'boolean', description: 'Enable parallel execution' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const vWorkflowId = validateIdentifier(input.workflowId, 'workflowId');
      if (!vWorkflowId.valid) return { success: false, error: vWorkflowId.error };
      const store = loadDAAStore();
      const workflowId = input.workflowId as string;
      const workflow = store.workflows[workflowId];

      if (!workflow) {
        return { success: false, error: 'Workflow not found' };
      }

      workflow.status = 'running';
      saveDAAStore(store);

      // Store workflow state in AgentDB for tracking
      try {
        const bridge = await import('../memory/memory-bridge.js');
        await bridge.bridgeStoreEntry({
          key: `workflow-${workflowId}`,
          value: JSON.stringify({
            id: workflowId, status: 'running',
            steps: workflow.steps.length, strategy: workflow.strategy,
            startedAt: new Date().toISOString(),
          }),
          namespace: 'daa-workflows',
        });
      } catch { /* AgentDB not available */ }

      return {
        success: true,
        workflowId,
        status: workflow.status,
        steps: workflow.steps,
        startedAt: new Date().toISOString(),
        _note: 'Steps are tracked but not auto-executed. Use agent tools to execute each step.',
      };
    },
  },
  {
    name: 'daa_knowledge_share',
    description: 'Share knowledge between agents Use when native Task is wrong because you need agents that adapt their cognitive pattern (convergent / divergent / lateral / systems / critical) per-task and share knowledge across the swarm. For static one-shot agents, native Task is fine.',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        sourceAgentId: { type: 'string', description: 'Source agent ID' },
        targetAgentIds: { type: 'array', items: { type: 'string' }, description: 'Target agent IDs' },
        knowledgeDomain: { type: 'string', description: 'Knowledge domain' },
        knowledgeContent: { type: 'object', description: 'Knowledge to share' },
      },
      required: ['sourceAgentId', 'targetAgentIds'],
    },
    handler: async (input) => {
      const vSourceId = validateIdentifier(input.sourceAgentId, 'sourceAgentId');
      if (!vSourceId.valid) return { success: false, error: vSourceId.error };
      if (input.targetAgentIds && Array.isArray(input.targetAgentIds)) {
        for (const t of input.targetAgentIds as string[]) { const vT = validateIdentifier(t, 'targetAgentIds[]'); if (!vT.valid) return { success: false, error: vT.error }; }
      }
      if (input.knowledgeDomain) { const vDomain = validateIdentifier(input.knowledgeDomain, 'knowledgeDomain'); if (!vDomain.valid) return { success: false, error: vDomain.error }; }
      const store = loadDAAStore();
      const sourceId = input.sourceAgentId as string;
      const targetIds = input.targetAgentIds as string[];
      const domain = (input.knowledgeDomain as string) || 'general';

      const knowledgeId = `knowledge-${Date.now()}`;
      const knowledgeEntry = {
        domain,
        content: input.knowledgeContent || {},
        sharedBy: sourceId,
        targetAgents: targetIds,
        timestamp: new Date().toISOString(),
      };

      // Primary: store in AgentDB for vector-searchable knowledge
      let _storedIn: 'agentdb' | 'json-store' = 'json-store';
      try {
        const bridge = await import('../memory/memory-bridge.js');
        await bridge.bridgeStoreEntry({
          key: knowledgeId,
          value: JSON.stringify(knowledgeEntry),
          namespace: 'daa-knowledge',
          tags: [domain, sourceId, ...targetIds],
        });
        _storedIn = 'agentdb';
      } catch { /* AgentDB not available */ }

      // Backward compat: always persist in JSON store
      store.knowledge[knowledgeId] = knowledgeEntry;
      saveDAAStore(store);

      return {
        success: true,
        knowledgeId,
        sourceAgent: sourceId,
        targetAgents: targetIds,
        domain,
        sharedAt: knowledgeEntry.timestamp,
        _storedIn,
        _note: _storedIn === 'agentdb'
          ? 'Knowledge stored in AgentDB (vector-searchable) and JSON store. Target agents can retrieve via daa_learning_status or memory search.'
          : 'Knowledge stored in shared JSON registry. Target agents can retrieve via daa_learning_status. No cross-agent memory transfer occurs.',
      };
    },
  },
  {
    name: 'daa_learning_status',
    description: 'Get learning status for DAA agents Use when native Task is wrong because you need agents that adapt their cognitive pattern (convergent / divergent / lateral / systems / critical) per-task and share knowledge across the swarm. For static one-shot agents, native Task is fine.',
    category: 'daa',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Specific agent ID' },
        detailed: { type: 'boolean', description: 'Include detailed metrics' },
      },
    },
    handler: async (input) => {
      if (input.agentId) { const vAgentId = validateIdentifier(input.agentId, 'agentId'); if (!vAgentId.valid) return { success: false, error: vAgentId.error }; }
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
    name: 'daa_cognitive_pattern',
    description: 'Analyze or change cognitive patterns Use when native Task is wrong because you need agents that adapt their cognitive pattern (convergent / divergent / lateral / systems / critical) per-task and share knowledge across the swarm. For static one-shot agents, native Task is fine.',
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
      if (input.agentId) { const vAgentId = validateIdentifier(input.agentId, 'agentId'); if (!vAgentId.valid) return { success: false, error: vAgentId.error }; }
      if (input.pattern) { const vPattern = validateIdentifier(input.pattern, 'pattern'); if (!vPattern.valid) return { success: false, error: vPattern.error }; }
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
            learningRate: agent.learningRate,
            metrics: agent.metrics,
            _note: 'Pattern analysis requires real cognitive modeling. Current pattern and metrics shown.',
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
    name: 'daa_performance_metrics',
    description: 'Get DAA performance metrics Use when native Task is wrong because you need agents that adapt their cognitive pattern (convergent / divergent / lateral / systems / critical) per-task and share knowledge across the swarm. For static one-shot agents, native Task is fine.',
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
