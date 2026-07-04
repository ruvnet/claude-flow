/**
 * Agent MCP Tools for CLI
 *
 * Tool definitions for agent lifecycle management with file persistence.
 * Includes model routing integration for intelligent model selection.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validateText, validateAgentSpawn } from './validate-input.js';
import { executeAgentTask } from './agent-execute-core.js';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const AGENT_DIR = 'agents';
const AGENT_FILE = 'store.json';
// #1916: hive-mind_spawn writes its workers to `.claude-flow/agents.json`
// (a *different* file from the canonical `.claude-flow/agents/store.json`
// used here). agent_status / agent_list / agent_logs merge that store so a
// hive-spawned worker is resolvable instead of returning `not_found`.
const HIVE_AGENT_FILE = 'agents.json';

// Model types matching Claude Agent SDK
type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'opus-4.7' | 'inherit';

interface AgentRecord {
  agentId: string;
  agentType: string;
  status: 'idle' | 'busy' | 'terminated';
  health: number;
  taskCount: number;
  config: Record<string, unknown>;
  createdAt: string;
  domain?: string;
  model?: ClaudeModel;  // Tier label assigned to this agent
  modelRoutedBy?: 'explicit' | 'router' | 'codemod' | 'default' | 'hybrid';  // ADR-026/143/149
  /** ADR-149 — concrete picked model id (e.g. inclusionai/ling-2.6-flash). */
  modelId?: string;
  /** ADR-148 — execution provider hint. */
  provider?: 'anthropic' | 'openrouter';
  /** ADR-148 — concrete OpenRouter slug when provider='openrouter'. */
  openrouterModel?: string;
  lastResult?: Record<string, unknown>;
  /**
   * ACOW — path to this agent's per-agent Copy-On-Write memory branch
   * (agenticow), set only when the agent was spawned with `memoryBase`. On
   * terminate the branch is promoted (merged to base) or discarded.
   */
  memoryBranch?: string;
  /** ACOW — the shared base `.rvf` this agent's branch was forked from. */
  memoryBase?: string;
}

interface AgentStore {
  agents: Record<string, AgentRecord>;
  version: string;
}

function getAgentDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, AGENT_DIR);
}

function getAgentPath(): string {
  return join(getAgentDir(), AGENT_FILE);
}

function ensureAgentDir(): void {
  const dir = getAgentDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadAgentStore(): AgentStore {
  try {
    const path = getAgentPath();
    if (existsSync(path)) {
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return empty store on error
  }
  return { agents: {}, version: '3.0.0' };
}

function saveAgentStore(store: AgentStore): void {
  ensureAgentDir();
  writeFileSync(getAgentPath(), JSON.stringify(store, null, 2), 'utf-8');
}

// #1916: read hive-mind-spawned workers from `.claude-flow/agents.json`.
function getHiveAgentPath(): string {
  return join(getProjectCwd(), STORAGE_DIR, HIVE_AGENT_FILE);
}

function loadHiveAgents(): Record<string, AgentRecord> {
  try {
    const path = getHiveAgentPath();
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      if (data && typeof data.agents === 'object' && data.agents) {
        return data.agents as Record<string, AgentRecord>;
      }
    }
  } catch {
    // Ignore — hive store is optional/best-effort.
  }
  return {};
}

/**
 * #1916: merged view of every tracked agent — the canonical agent store
 * plus hive-mind-spawned workers. On an id collision the canonical record
 * wins (it carries model-routing + lastResult that the hive store omits).
 */
function loadAllAgents(): Record<string, AgentRecord> {
  return { ...loadHiveAgents(), ...loadAgentStore().agents };
}

// Default model mappings for agent types (can be overridden)
const AGENT_TYPE_MODEL_DEFAULTS: Record<string, ClaudeModel> = {
  // Complex agents → opus
  'architect': 'opus',
  'security-architect': 'opus',
  'system-architect': 'opus',
  'core-architect': 'opus',
  // Medium complexity → sonnet
  'coder': 'sonnet',
  'reviewer': 'sonnet',
  'researcher': 'sonnet',
  'tester': 'sonnet',
  'analyst': 'sonnet',
  // Simple/fast agents → haiku
  'formatter': 'haiku',
  'linter': 'haiku',
  'documenter': 'haiku',
};

// Lazy-loaded model router
let modelRouterInstance: Awaited<ReturnType<typeof import('../ruvector/model-router.js').getModelRouter>> | null = null;

async function getModelRouter() {
  if (!modelRouterInstance) {
    try {
      const { getModelRouter } = await import('../ruvector/model-router.js');
      modelRouterInstance = getModelRouter();
    } catch (e) {
      // Log but don't fail - model router is optional
      console.error('[agent-tools] Model router load failed:', (e as Error).message);
    }
  }
  return modelRouterInstance;
}

// ADR-149 — the cost-optimal neural router fires only when
// `routeToModelFull(task, embedding)` is called with a real embedding. We
// delegate to the shared task-embedder module (ADR-149 iter 9) so the
// @xenova/transformers MiniLM pipeline + LRU cache are shared across
// agent-tools and the agent-execute-core fallback path.
async function embedTaskSafe(task: string): Promise<number[] | undefined> {
  const { embedTaskWithCache } = await import('../ruvector/task-embedder.js');
  return embedTaskWithCache(task);
}

/**
 * Determine model for agent based on (ADR-026 3-tier routing):
 * 1. Explicit model in config
 * 2. Enhanced task-based routing with deterministic Tier-1 codemods (if task provided)
 * 3. Agent type defaults
 * 4. Fallback to sonnet
 */
async function determineAgentModel(
  agentType: string,
  config: Record<string, unknown>,
  task?: string
): Promise<{
  model: ClaudeModel;
  routedBy: 'explicit' | 'router' | 'codemod' | 'default' | 'hybrid';
  canSkipLLM?: boolean;
  codemodIntent?: string;
  tier?: 1 | 2 | 3;
  /** ADR-149 — concrete picked model id when the neural backend fired. */
  modelId?: string;
  /** ADR-148 — execution provider hint. */
  provider?: 'anthropic' | 'openrouter';
  /** ADR-148 — concrete OpenRouter slug when provider='openrouter'. */
  openrouterModel?: string;
}> {
  // 1. Explicit model in config
  if (config.model && ['haiku', 'sonnet', 'opus', 'opus-4.7', 'inherit'].includes(config.model as string)) {
    return { model: config.model as ClaudeModel, routedBy: 'explicit' };
  }

  // 2. Enhanced task-based routing with deterministic Tier-1 codemods
  if (task) {
    try {
      // Try enhanced router first (includes codemod-intent detection)
      const { getEnhancedModelRouter } = await import('../ruvector/enhanced-model-router.js');
      const enhancedRouter = getEnhancedModelRouter();
      // ADR-149 — embed the task so the cost-optimal neural backend fires.
      // We probe the embedder lazily; if it can't load (no @xenova/transformers
      // available), the enhanced router falls back to heuristic+bandit and
      // the existing behaviour is preserved.
      const embedding = await embedTaskSafe(task);
      const routeResult = await enhancedRouter.route(task, { filePath: config.filePath as string, embedding });

      if (routeResult.tier === 1 && routeResult.canSkipLLM) {
        // Deterministic codemod can apply this edit ($0, no LLM)
        return {
          model: 'haiku', // fallback model if the codemod can't apply
          routedBy: 'codemod',
          canSkipLLM: true,
          codemodIntent: (routeResult.codemodIntent ?? routeResult.agentBoosterIntent)?.type,
          tier: 1,
        };
      }

      // ADR-149 — forward the per-model fields. When the neural backend
      // fired, modelId carries the cost-optimal pick (e.g. Ling); when
      // it didn't, these are undefined and downstream behaviour is unchanged.
      const routedBy: 'router' | 'hybrid' =
        routeResult.routedBy === 'hybrid' ? 'hybrid' : 'router';
      return {
        model: routeResult.model!,
        routedBy,
        tier: routeResult.tier,
        modelId: routeResult.modelId,
        provider: routeResult.provider,
        openrouterModel: routeResult.openrouterModel,
      };
    } catch {
      // Enhanced router not available, try basic router
      const router = await getModelRouter();
      if (router) {
        try {
          // ADR-149 — embed the task so the cost-optimal neural backend
          // fires (it's gated on `embedding && embedding.length > 0`).
          // Without the embedding, route() falls back to heuristic+bandit
          // and every per-model Pareto win the v2 measurement landed is
          // invisible. embedTaskSafe returns undefined on any failure;
          // route(task, undefined) behaves exactly as the prior code.
          const embedding = await embedTaskSafe(task);
          const result = await router.route(task, embedding);
          // Map the routing mechanism to the broader agent-record taxonomy.
          // 'hybrid' = neural prior + bandit blended (ADR-149); fold the rest
          // into 'router' for back-compat with consumers reading modelRoutedBy.
          const routedBy: 'router' | 'hybrid' =
            result.routedBy === 'hybrid' ? 'hybrid' : 'router';
          return {
            model: result.model,
            routedBy,
            modelId: result.modelId,
            provider: result.provider,
            openrouterModel: result.openrouterModel,
          };
        } catch {
          // Fall through to defaults on router error
        }
      }
    }
  }

  // 3. Agent type defaults
  const defaultModel = AGENT_TYPE_MODEL_DEFAULTS[agentType];
  if (defaultModel) {
    return { model: defaultModel, routedBy: 'default' };
  }

  // 4. Fallback to sonnet (balanced)
  return { model: 'sonnet', routedBy: 'default' };
}

export const agentTools: MCPTool[] = [
  {
    name: 'agent_spawn',
    description: 'Spawn a Ruflo-tracked agent with cost attribution + memory persistence + swarm coordination. Use when native Task tool is wrong because you need (a) cost tracking per agent in the cost-tracking namespace, (b) cross-session learning via the patterns namespace, or (c) coordination with other agents in a swarm topology (hierarchical / mesh / consensus). For one-shot subtasks with no learning loop, native Task is fine. Pair with hooks_route to pick the right model first.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentType: { type: 'string', description: 'Type of agent to spawn' },
        agentId: { type: 'string', description: 'Optional custom agent ID' },
        // #2085 — accept swarmId so spawned agents register in the
        // swarm.agents array that swarm_status reports. Omit to register
        // with the most-recently-created swarm.
        swarmId: { type: 'string', description: 'Optional swarm to register the agent with (defaults to most-recent swarm)' },
        config: { type: 'object', description: 'Agent configuration' },
        domain: { type: 'string', description: 'Agent domain' },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus', 'opus-4.7', 'inherit'],
          description: 'Claude model alias (haiku=fast/cheap, sonnet=balanced, opus=current Opus 4.8, opus-4.7=prior Opus pin)'
        },
        task: { type: 'string', description: 'Task description for intelligent model routing' },
        memoryBase: { type: 'string', description: 'Opt-in: base .rvf memory file to fork a per-agent Copy-On-Write branch from (agenticow). When set, the agent gets an isolated ~162-byte COW branch instead of a full copy — promote on success, discard on terminate. Requires the optional `agenticow` dep; degrades to a no-op when absent or when CLAUDE_FLOW_NO_COW_MEMORY=1.' },
        memoryDimension: { type: 'integer', description: 'Vector dimension for the COW base (required only when memoryBase does not exist yet)' },
      },
      required: ['agentType'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425: wire security validators to runtime)
      const validation = await validateAgentSpawn(input);
      if (!validation.valid) {
        return { success: false, error: `Input validation failed: ${validation.errors.join('; ')}` };
      }

      const store = loadAgentStore();
      const agentId = (input.agentId as string) || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const agentType = input.agentType as string;
      const config = (input.config as Record<string, unknown>) || {};

      // Add explicit model to config if provided
      if (input.model) {
        config.model = input.model;
      }

      // Get task from either top-level or config (CLI passes it in config.task)
      const task = (input.task as string) || (config.task as string) || undefined;

      // Determine model using ADR-026 3-tier routing logic
      const routingResult = await determineAgentModel(
        agentType,
        config,
        task
      );

      const agent: AgentRecord = {
        agentId,
        agentType,
        status: 'idle',
        health: 1.0,
        taskCount: 0,
        config,
        createdAt: new Date().toISOString(),
        domain: input.domain as string,
        model: routingResult.model,
        modelRoutedBy: routingResult.routedBy,
        ...(routingResult.modelId ? { modelId: routingResult.modelId } : {}),
        ...(routingResult.provider ? { provider: routingResult.provider } : {}),
        ...(routingResult.openrouterModel ? { openrouterModel: routingResult.openrouterModel } : {}),
      };

      store.agents[agentId] = agent;
      saveAgentStore(store);

      // #2085 — also push to the swarm store's agents array so that
      // swarm_status reports the new agent. Without this, agent_spawn
      // and swarm_status read/write separate stores and agents added
      // post-init never show up in swarm_status.agents — confirmed for
      // all topologies (hierarchical, mesh, etc.).
      try {
        const { loadSwarmStore: _loadSwarmStore, saveSwarmStore: _saveSwarmStore } =
          await import('./swarm-tools.js');
        const swarmStore = _loadSwarmStore();
        let targetSwarmId = (input.swarmId as string) || '';
        if (!targetSwarmId) {
          // Default to the most-recently-created swarm.
          const all = Object.values(swarmStore.swarms);
          const latest = all.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];
          targetSwarmId = latest?.swarmId || '';
        }
        if (targetSwarmId && swarmStore.swarms[targetSwarmId]) {
          const swarm = swarmStore.swarms[targetSwarmId];
          if (!Array.isArray(swarm.agents)) swarm.agents = [];
          // Idempotent — don't duplicate if agent_spawn is retried.
          if (!swarm.agents.includes(agentId)) {
            swarm.agents.push(agentId);
            _saveSwarmStore(swarmStore);
          }
        }
      } catch { /* swarm store unavailable — agent still registered globally */ }

      // Record agent in graph database (ADR-087, best-effort)
      try {
        const { addNode } = await import('../ruvector/graph-backend.js');
        await addNode({ id: agentId, type: 'agent', name: agentType });
      } catch { /* graph-node not available */ }

      // ACOW — opt-in per-agent COW memory branch. Only when the caller
      // supplies `memoryBase` does the agent get an isolated 162-byte branch
      // (vs a full .rvf copy). Lazy-imported so agenticow stays off the
      // startup path. Non-fatal: a branch failure never blocks the spawn —
      // the agent is already registered above.
      let memoryBranch: string | undefined;
      if (input.memoryBase) {
        try {
          const { SwarmMemoryBranches } = await import('../services/swarm-memory-branches.js');
          const svc = new SwarmMemoryBranches();
          const br = await svc.branchForAgent(String(input.memoryBase), agentId, {
            dimension: typeof input.memoryDimension === 'number' ? input.memoryDimension : undefined,
          });
          if (br.branchPath) {
            memoryBranch = br.branchPath;
            agent.memoryBranch = br.branchPath;
            agent.memoryBase = br.basePath;
            store.agents[agentId] = agent;
            saveAgentStore(store);
          }
          // else: degraded (agenticow missing / kill-switched) — agent stands
          // without an isolated branch; callers see no memoryBranch field.
        } catch { /* COW branch is best-effort; agent already registered */ }
      }

      // Include deterministic codemod routing info if applicable
      const response: Record<string, unknown> = {
        success: true,
        agentId,
        agentType: agent.agentType,
        model: agent.model,
        modelRoutedBy: routingResult.routedBy,
        ...(routingResult.modelId ? { modelId: routingResult.modelId } : {}),
        ...(routingResult.provider ? { provider: routingResult.provider } : {}),
        ...(routingResult.openrouterModel ? { openrouterModel: routingResult.openrouterModel } : {}),
        status: 'registered',
        createdAt: agent.createdAt,
        ...(memoryBranch ? { memoryBranch, memoryBase: agent.memoryBase } : {}),
        note: 'Agent registered for coordination. Three execution paths: ' +
          '(1) call agent_execute(agentId, prompt) — direct LLM call via Anthropic Messages API (requires ANTHROPIC_API_KEY); ' +
          '(2) Claude Code Task tool — spawns a real subagent; ' +
          '(3) claude -p — headless background instance.',
      };

      // Add codemod info if task can skip LLM (deterministic Tier-1, ADR-143)
      if (routingResult.canSkipLLM) {
        response.canSkipLLM = true;
        response.codemodIntent = routingResult.codemodIntent;
        response.tier = routingResult.tier;
        response.note = `Deterministic codemod can apply "${routingResult.codemodIntent}" — call the hooks_codemod MCP tool (intent="${routingResult.codemodIntent}"), $0, no LLM`;
      } else if (routingResult.tier) {
        response.tier = routingResult.tier;
      }

      return response;
    },
  },
  {
    // ADR-095 G1: real LLM execution via the agent registry. Previously
    // agent_spawn registered metadata but nothing dispatched work to a
    // provider — the wire between AnthropicProvider and the agent
    // registry was missing, as the April audit (@roman-rr) called out.
    // agent_execute closes that wire by reading the agent's configured
    // model, calling the Anthropic Messages API directly via fetch, and
    // updating the agent record with lastResult / taskCount / status.
    // No mock — actual HTTP request to api.anthropic.com.
    name: 'agent_execute',
    description: 'Run a task on a previously-spawned agent_spawn record via the Anthropic Messages API with that agent\'s configured model. Use when native Task tool is wrong because (a) you need the spawned agent\'s persistent config (model, instructions, cost-tracking attribution) to apply to this turn, (b) the result needs to feed back into the agent\'s lifecycle (taskCount, lastResult, swarm-coordinated state), or (c) you want explicit model routing via the spawn record\'s `model` field instead of inheriting. For one-shot Claude prompts without a tracked agent, native Task is fine. Requires ANTHROPIC_API_KEY in env.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of the spawned agent' },
        prompt: { type: 'string', description: 'Task / prompt for the agent to execute' },
        systemPrompt: { type: 'string', description: 'Optional system prompt (overrides agent default)' },
        maxTokens: { type: 'number', description: 'Max output tokens (default 1024)' },
        temperature: { type: 'number', description: 'Sampling temperature 0..1 (default 0.7)' },
      },
      required: ['agentId', 'prompt'],
    },
    handler: async (input) => {
      const vId = validateIdentifier(input.agentId, 'agentId');
      if (!vId.valid) return { success: false, error: `Input validation failed: ${vId.error}` };
      const vP = validateText(input.prompt as string, 'prompt');
      if (!vP.valid) return { success: false, error: `Input validation failed: ${vP.error}` };

      // Delegate to the shared core (also used by the workflow runtime).
      return executeAgentTask({
        agentId: input.agentId as string,
        prompt: input.prompt as string,
        systemPrompt: input.systemPrompt as string | undefined,
        maxTokens: input.maxTokens as number | undefined,
        temperature: input.temperature as number | undefined,
        timeoutMs: input.timeoutMs as number | undefined,
      });
    },
  },
  {
    name: 'agent_terminate',
    description: 'Remove a Ruflo-tracked agent from the registry and free its swarm slot. Use when you need to (a) clean up a spawned agent so its cost-tracking row finalizes, (b) reclaim a swarm-topology slot for another agent, or (c) end a stuck agent without restarting the whole swarm. For one-shot Task tool invocations that already self-terminate, this tool is not needed. Pair with agent_list first to confirm the agentId.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent to terminate' },
        force: { type: 'boolean', description: 'Force immediate termination' },
        promoteMemory: { type: 'boolean', description: 'When the agent has a per-agent COW memory branch (spawned with memoryBase), promote (merge) its edits into the shared base on terminate. Default false → discard the branch (throw its edits away). No-op when the agent has no branch.' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const v = validateIdentifier(input.agentId, 'agentId');
      if (!v.valid) return { success: false, error: `Input validation failed: ${v.error}` };

      const store = loadAgentStore();
      const agentId = input.agentId as string;

      if (store.agents[agentId]) {
        const rec = store.agents[agentId];
        rec.status = 'terminated';
        saveAgentStore(store);

        // ACOW — resolve the agent's COW memory branch on teardown: promote
        // (merge into base) when asked, else discard. Non-fatal — a failure
        // here never blocks termination. Discard needs no agenticow (pure fs),
        // so cleanup still works in the degraded path.
        let memory: Record<string, unknown> | undefined;
        if (rec.memoryBranch) {
          try {
            const { SwarmMemoryBranches } = await import('../services/swarm-memory-branches.js');
            const svc = new SwarmMemoryBranches();
            memory = input.promoteMemory
              ? (await svc.promoteAgent(agentId)) as unknown as Record<string, unknown>
              : (await svc.discardAgent(agentId)) as unknown as Record<string, unknown>;
          } catch { /* best-effort teardown */ }
        }

        return {
          success: true,
          agentId,
          terminated: true,
          terminatedAt: new Date().toISOString(),
          ...(memory ? { memory } : {}),
        };
      }

      return {
        success: false,
        agentId,
        error: 'Agent not found',
      };
    },
  },
  {
    name: 'agent_status',
    description: 'Read the lifecycle state of a single tracked agent: idle/running/stopped, current taskCount, lastResult, model, health score. Use when native Task tool is wrong because you need agent-level state (status across turns, accumulated taskCount, last error, swarm coordination) rather than a one-shot response. For inspecting a Task you just ran, native Task output is fine. Pair with agent_list to find the agentId first.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const v = validateIdentifier(input.agentId, 'agentId');
      if (!v.valid) return { agentId: input.agentId, status: 'not_found', error: `Input validation failed: ${v.error}` };

      const agentId = input.agentId as string;
      const agent = loadAllAgents()[agentId]; // #1916: includes hive-mind-spawned workers

      if (agent) {
        return {
          agentId: agent.agentId,
          agentType: agent.agentType,
          status: agent.status,
          health: agent.health,
          taskCount: agent.taskCount,
          createdAt: agent.createdAt,
          domain: agent.domain,
          lastResult: agent.lastResult || null,
        };
      }

      return {
        agentId,
        status: 'not_found',
        error: 'Agent not found',
      };
    },
  },
  {
    name: 'agent_list',
    description: 'List every Ruflo-tracked agent in the registry with its type, model, status, and taskCount. Use when native Task tool is wrong because you need to see the swarm-wide agent inventory across turns (which agents exist, their roles, their cost-tracking handles) rather than spawn a new one-shot Task. Filter by status/domain/agentType if needed. For starting a fresh single-shot subagent, native Task is fine.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        domain: { type: 'string', description: 'Filter by domain' },
        includeTerminated: { type: 'boolean', description: 'Include terminated agents' },
      },
    },
    handler: async (input) => {
      if (input.status) {
        const v = validateIdentifier(input.status, 'status');
        if (!v.valid) return { agents: [], total: 0, error: `Input validation failed: ${v.error}` };
      }
      if (input.domain) {
        const v = validateIdentifier(input.domain, 'domain');
        if (!v.valid) return { agents: [], total: 0, error: `Input validation failed: ${v.error}` };
      }

      let agents = Object.values(loadAllAgents()); // #1916: includes hive-mind-spawned workers

      // Filter by status
      if (input.status) {
        agents = agents.filter(a => a.status === input.status);
      } else if (!input.includeTerminated) {
        agents = agents.filter(a => a.status !== 'terminated');
      }

      // Filter by domain
      if (input.domain) {
        agents = agents.filter(a => a.domain === input.domain);
      }

      return {
        agents: agents.map(a => ({
          agentId: a.agentId,
          agentType: a.agentType,
          status: a.status,
          health: a.health,
          taskCount: a.taskCount,
          createdAt: a.createdAt,
          domain: a.domain,
        })),
        total: agents.length,
        filters: {
          status: input.status,
          domain: input.domain,
          includeTerminated: input.includeTerminated,
        },
      };
    },
  },
  {
    name: 'agent_pool',
    description: 'Manage a fixed-size warm pool of pre-spawned agents to skip cold-start cost on bursty workloads. Use when native Task is wrong because (a) you have a queue of similar tasks and want to amortize spawn latency, (b) cost-tracking wants stable agentIds across requests, or (c) swarm topology requires a known agent count at all times. For one-shot work, just call agent_spawn or native Task. Pool sizes and warm/idle thresholds are set per-pool.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'scale', 'drain', 'fill'], description: 'Pool action' },
        targetSize: { type: 'number', description: 'Target pool size (for scale action)' },
        agentType: { type: 'string', description: 'Agent type filter' },
      },
      required: ['action'],
    },
    handler: async (input) => {
      if (input.agentType) {
        const v = validateIdentifier(input.agentType, 'agentType');
        if (!v.valid) return { action: input.action, error: `Input validation failed: ${v.error}` };
      }

      const store = loadAgentStore();
      const agents = Object.values(store.agents).filter(a => a.status !== 'terminated');
      const action = (input.action as string) || 'status';  // Default to status

      if (action === 'status') {
        const byType: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        for (const agent of agents) {
          byType[agent.agentType] = (byType[agent.agentType] || 0) + 1;
          byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
        }
        const idleAgents = agents.filter(a => a.status === 'idle').length;
        const busyAgents = agents.filter(a => a.status === 'busy').length;
        const utilization = agents.length > 0 ? busyAgents / agents.length : 0;
        return {
          action,
          // CLI expected fields
          poolId: 'agent-pool-default',
          currentSize: agents.length,
          minSize: (input.min as number) || 0,
          maxSize: (input.max as number) || 100,
          autoScale: (input.autoScale as boolean) ?? false,
          utilization,
          agents: agents.map(a => ({
            id: a.agentId,
            type: a.agentType,
            status: a.status,
          })),
          // Additional fields
          id: 'agent-pool-default',
          size: agents.length,
          totalAgents: agents.length,
          byType,
          byStatus,
          avgHealth: agents.length > 0 ? agents.reduce((sum, a) => sum + a.health, 0) / agents.length : 0,
        };
      }

      if (action === 'scale') {
        const targetSize = (input.targetSize as number) || 5;
        const agentType = (input.agentType as string) || 'worker';
        const currentSize = agents.filter(a => a.agentType === agentType).length;
        const delta = targetSize - currentSize;
        const added: string[] = [];
        const removed: string[] = [];

        if (delta > 0) {
          for (let i = 0; i < delta; i++) {
            const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            store.agents[agentId] = {
              agentId,
              agentType,
              status: 'idle',
              health: 1.0,
              taskCount: 0,
              config: {},
              createdAt: new Date().toISOString(),
            };
            added.push(agentId);
          }
        } else if (delta < 0) {
          const toRemove = agents.filter(a => a.agentType === agentType && a.status === 'idle').slice(0, -delta);
          for (const agent of toRemove) {
            store.agents[agent.agentId].status = 'terminated';
            removed.push(agent.agentId);
          }
        }

        saveAgentStore(store);
        return {
          action,
          agentType,
          previousSize: currentSize,
          targetSize,
          newSize: currentSize + delta,
          added,
          removed,
        };
      }

      if (action === 'drain') {
        const agentType = input.agentType as string;
        let drained = 0;
        for (const agent of agents) {
          if (!agentType || agent.agentType === agentType) {
            if (agent.status === 'idle') {
              store.agents[agent.agentId].status = 'terminated';
              drained++;
            }
          }
        }
        saveAgentStore(store);
        return {
          action,
          agentType: agentType || 'all',
          drained,
          remaining: agents.length - drained,
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
  {
    name: 'agent_health',
    description: 'Compute an agent\'s rolling health score (0-1) from recent task success ratio + response-latency p50/p95 + error rate. Use when native Task tool is wrong because you\'re running a long-lived agent (autonomous loop / hive-mind worker / federation peer) and need to detect degradation before the breaker trips it. For one-shot Task invocations there is no history to score. Pair with hooks_post-task so the scores stay current.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Specific agent ID (optional)' },
        threshold: { type: 'number', description: 'Health threshold (0-1)' },
      },
    },
    handler: async (input) => {
      if (input.agentId) {
        const v = validateIdentifier(input.agentId, 'agentId');
        if (!v.valid) return { agentId: input.agentId, error: `Input validation failed: ${v.error}` };
      }

      const store = loadAgentStore();
      const agents = Object.values(store.agents).filter(a => a.status !== 'terminated');
      const threshold = (input.threshold as number) || 0.5;

      if (input.agentId) {
        const agent = store.agents[input.agentId as string];
        if (agent) {
          return {
            agentId: agent.agentId,
            health: agent.health,
            status: agent.status,
            healthy: agent.health >= threshold,
            taskCount: agent.taskCount,
            uptime: Date.now() - new Date(agent.createdAt).getTime(),
          };
        }
        return { agentId: input.agentId, error: 'Agent not found' };
      }

      const healthyAgents = agents.filter(a => a.health >= threshold);
      const degradedAgents = agents.filter(a => a.health >= 0.3 && a.health < threshold);
      const unhealthyAgents = agents.filter(a => a.health < 0.3);
      const avgHealth = agents.length > 0 ? agents.reduce((sum, a) => sum + a.health, 0) / agents.length : 1;

      return {
        // CLI expected fields
        agents: agents.map(a => {
          const uptime = Date.now() - new Date(a.createdAt).getTime();
          return {
            id: a.agentId,
            type: a.agentType,
            health: a.health >= threshold ? 'healthy' : (a.health >= 0.3 ? 'degraded' : 'unhealthy'),
            uptime,
            tasks: { active: a.taskCount > 0 ? 1 : 0, queued: 0, completed: a.taskCount, failed: 0 },
            _note: 'Per-agent OS metrics not available — use system_metrics for real CPU/memory',
          };
        }),
        overall: {
          healthy: healthyAgents.length,
          degraded: degradedAgents.length,
          unhealthy: unhealthyAgents.length,
          cpu: null,
          memory: null,
          _note: 'Per-agent CPU/memory not available — use system_metrics for real OS-level stats',
          score: Math.round(avgHealth * 100),
          issues: unhealthyAgents.length,
        },
        // Additional fields
        total: agents.length,
        healthyCount: healthyAgents.length,
        unhealthyCount: unhealthyAgents.length,
        threshold,
        avgHealth,
        unhealthyAgents: unhealthyAgents.map(a => ({
          agentId: a.agentId,
          health: a.health,
          status: a.status,
        })),
      };
    },
  },
  {
    name: 'agent_update',
    description: 'Mutate a tracked agent\'s config (model, instructions, status, health) without re-spawning. Use when native Task tool is wrong because the agent already has accumulated state (taskCount, swarm membership, cost-tracking attribution) and you only need to tweak one field — for example, promoting an idle agent to running on a new task, or rotating its model from haiku to sonnet mid-loop. For a brand-new subagent, agent_spawn (or native Task) is the right call.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent' },
        status: { type: 'string', description: 'New status' },
        health: { type: 'number', description: 'Health value (0-1)' },
        taskCount: { type: 'number', description: 'Task count' },
        config: { type: 'object', description: 'Config updates' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const v = validateIdentifier(input.agentId, 'agentId');
      if (!v.valid) return { success: false, agentId: input.agentId, error: `Input validation failed: ${v.error}` };
      if (input.status) {
        const vs = validateIdentifier(input.status, 'status');
        if (!vs.valid) return { success: false, agentId: input.agentId, error: `Input validation failed: ${vs.error}` };
      }

      const store = loadAgentStore();
      const agentId = input.agentId as string;
      const agent = store.agents[agentId];

      if (agent) {
        if (input.status) agent.status = input.status as AgentRecord['status'];
        if (typeof input.health === 'number') agent.health = input.health as number;
        if (typeof input.taskCount === 'number') agent.taskCount = input.taskCount as number;
        if (input.config) {
          agent.config = { ...agent.config, ...(input.config as Record<string, unknown>) };
        }
        saveAgentStore(store);

        return {
          success: true,
          agentId,
          updated: true,
          agent: {
            agentId: agent.agentId,
            status: agent.status,
            health: agent.health,
            taskCount: agent.taskCount,
          },
        };
      }

      return {
        success: false,
        agentId,
        error: 'Agent not found',
      };
    },
  },
  {
    // #1916 — the `ruflo agent logs <id>` CLI subcommand and the guidance
    // surface both reference an `agent_logs` MCP tool that was never
    // registered, so it errored with `MCP tool not found: agent_logs`.
    // This is the registered handler. Note: agents don't yet keep a
    // structured per-agent activity log (that lands with hive worker
    // execution wiring — see #1916), so for now we surface the agent's
    // last task result as a single synthetic entry, or an explicit empty
    // response. The shape matches what the CLI `logs` subcommand expects:
    // `{ agentId, entries: [{timestamp,level,message,context?}], total }`.
    name: 'agent_logs',
    description: 'Return recorded activity-log entries for a tracked agent (idle/running history, last task result). Use when native Task tool is wrong because you need the agent\'s log across turns (what it did, last error/result, swarm context) rather than a one-shot Task transcript. For a Task you just ran, native Task output is fine. Pair with agent_list to find the agentId. (Hive-mind-spawned workers are resolved here too.) Today this returns the last task result as a synthetic entry — full per-agent activity logs land with hive worker execution wiring (ruvnet/ruflo#1916).',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent' },
        tail: { type: 'number', description: 'Max recent entries to return (default 50)' },
        level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'Minimum log level (currently advisory — entries are synthetic)' },
        since: { type: 'string', description: 'Show logs since, e.g. "1h" / "30m" (currently advisory)' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const v = validateIdentifier(input.agentId, 'agentId');
      if (!v.valid) return { agentId: input.agentId, entries: [], total: 0, error: `Input validation failed: ${v.error}` };

      const agentId = input.agentId as string;
      const agent = loadAllAgents()[agentId]; // #1916: includes hive-mind-spawned workers
      if (!agent) {
        return { agentId, entries: [], total: 0, error: 'Agent not found' };
      }

      const entries: Array<{ timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string; context?: Record<string, unknown> }> = [];
      entries.push({ timestamp: agent.createdAt, level: 'info', message: `agent created (type=${agent.agentType}, status=${agent.status})` });
      if (agent.lastResult) {
        entries.push({ timestamp: agent.createdAt, level: 'info', message: 'last task result', context: agent.lastResult });
      }

      const tail = typeof input.tail === 'number' && input.tail > 0 ? Math.floor(input.tail) : 50;
      const sliced = entries.slice(-tail);
      return {
        agentId: agent.agentId,
        entries: sliced,
        total: entries.length,
        note: 'per-agent activity logging is not yet wired; entries are synthetic (ruvnet/ruflo#1916)',
      };
    },
  },
];
