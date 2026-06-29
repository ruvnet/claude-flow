import { agentRepository } from '../agent-store/agent-repository.js';
import { executeAgentTask } from '../mcp-tools/agent-execute-core.js';
import { orchestrationStore } from './orchestration-store.js';
import type { OrchestrateInput, OrchestrateResult, OrchestrationRecord, AgentResult, OrchestrationStrategy } from './types.js';

async function resolveAgents(agentsInput?: string[]): Promise<{ agentIds: string[]; errors: string[] }> {
  if (agentsInput && agentsInput.length > 0) {
    const ids = [...new Set(agentsInput)];
    const errors: string[] = [];
    const valid: string[] = [];
    const store = agentRepository.loadStore();
    for (const id of ids) {
      const agent = store.agents[id];
      if (!agent) {
        errors.push(`Agent not found: ${id}`);
      } else if (agent.status === 'terminated') {
        errors.push(`Agent terminated: ${id}`);
      } else {
        valid.push(id);
      }
    }
    return { agentIds: valid, errors };
  }

  try {
    const { loadSwarmStore } = await import('../mcp-tools/swarm-tools.js');
    const swarmStore = loadSwarmStore();
    const running = Object.values(swarmStore.swarms)
      .filter(s => s.status === 'running')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (running.length > 0) {
      const swarmAgents = running[0].agents || [];
      const valid = swarmAgents.filter(id => {
        const agent = agentRepository.getAgent(id);
        return agent && agent.status !== 'terminated';
      });
      return { agentIds: [...new Set(valid)], errors: [] };
    }
  } catch {}

  const active = agentRepository.getAllActiveAgents();
  return { agentIds: [...new Set(active.map(a => a.agentId))], errors: [] };
}

async function executeAgent(
  agentId: string,
  prompt: string,
  timeoutMs: number | undefined,
): Promise<AgentResult> {
  agentRepository.incrementActiveTask(agentId);
  try {
    const result = await executeAgentTask({ agentId, prompt, timeoutMs });
    const agentResult: AgentResult = {
      agentId,
      status: result.success ? 'completed' : 'failed',
      output: result.output,
      error: result.error,
      usage: result.usage ? {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      } : undefined,
      durationMs: result.durationMs,
    };
    agentRepository.decrementActiveTask(agentId, result.success ? (result as unknown as Record<string, unknown>) : { error: result.error, success: false });
    return agentResult;
  } catch (err) {
    const agentResult: AgentResult = {
      agentId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
    agentRepository.decrementActiveTask(agentId, { error: err instanceof Error ? err.message : String(err), success: false });
    return agentResult;
  }
}

async function executeParallel(agentIds: string[], task: string, timeoutMs?: number): Promise<AgentResult[]> {
  const promises = agentIds.map(id => executeAgent(id, task, timeoutMs));
  return Promise.all(promises);
}

async function executeSequential(agentIds: string[], task: string, timeoutMs?: number): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  for (const id of agentIds) {
    const result = await executeAgent(id, task, timeoutMs);
    results.push(result);
  }
  return results;
}

async function executePipeline(agentIds: string[], task: string, timeoutMs?: number): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  for (let i = 0; i < agentIds.length; i++) {
    const prevOutput = results.length > 0 ? results[results.length - 1].output : undefined;
    const pipelinePrompt = prevOutput
      ? `${task}\n\nPrevious stage output:\n${prevOutput}`
      : task;
    const result = await executeAgent(agentIds[i], pipelinePrompt, timeoutMs);
    results.push(result);
    if (result.status === 'failed') break;
  }
  return results;
}

function deduplicate(agentIds: string[]): string[] {
  return [...new Set(agentIds)];
}

function computeAggregate(results: AgentResult[]): { completed: number; failed: number; skipped: number; totalTokens: number } {
  let completed = 0, failed = 0, skipped = 0, totalTokens = 0;
  for (const r of results) {
    if (r.status === 'completed') completed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
    if (r.usage?.totalTokens) totalTokens += r.usage.totalTokens;
  }
  return { completed, failed, skipped, totalTokens };
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const strategy: OrchestrationStrategy = input.strategy || 'parallel';
  const resolved = await resolveAgents(input.agents);
  const agentIds = deduplicate(resolved.agentIds);
  const isBroadcastAlias = strategy === 'broadcast';

  const effectiveStrategy: OrchestrationStrategy = isBroadcastAlias ? 'parallel' : strategy;

  const scheduledAt = new Date().toISOString();
  const orchestrationId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const record: OrchestrationRecord = {
    id: orchestrationId,
    task: input.task,
    strategy: effectiveStrategy,
    agents: agentIds,
    status: 'scheduled',
    scheduledAt,
  };

  orchestrationStore.addRecord(record);

  if (agentIds.length === 0) {
    const completedAt = new Date().toISOString();
    const result: OrchestrateResult = {
      success: false,
      executor: 'agent_execute',
      orchestrationId,
      task: input.task,
      strategy: effectiveStrategy,
      agents: [],
      status: 'failed',
      scheduledAt,
      startedAt: completedAt,
      completedAt,
      durationMs: 0,
      results: [],
      aggregate: { completed: 0, failed: 0, skipped: 0, totalAgents: 0, totalTokens: 0 },
    };
    if (resolved.errors.length > 0) {
      (result as unknown as { preflightErrors: string[] }).preflightErrors = resolved.errors;
    }
    orchestrationStore.updateRecord(orchestrationId, {
      status: 'failed',
      startedAt: completedAt,
      completedAt,
      durationMs: 0,
      results: [],
      aggregate: { completed: 0, failed: 0, skipped: 0, totalAgents: 0, totalTokens: 0 },
    });
    return result;
  }

  if (resolved.errors.length > 0) {
    orchestrationStore.updateRecord(orchestrationId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  }

  const startedAt = new Date().toISOString();
  orchestrationStore.updateRecord(orchestrationId, { status: 'running', startedAt });

  const timeoutMs = input.timeout;

  let results: AgentResult[];
  const effectiveIds = isBroadcastAlias ? agentIds : agentIds;

  switch (effectiveStrategy) {
    case 'sequential':
      results = await executeSequential(effectiveIds, input.task, timeoutMs);
      break;
    case 'pipeline':
      results = await executePipeline(effectiveIds, input.task, timeoutMs);
      break;
    case 'parallel':
    default:
      results = await executeParallel(effectiveIds, input.task, timeoutMs);
      break;
  }

  const { completed, failed, skipped, totalTokens } = computeAggregate(results);
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - new Date(startedAt).getTime();

  let status: 'completed' | 'partial' | 'failed';
  if (completed > 0 && failed === 0 && skipped === 0) {
    status = 'completed';
  } else if (failed > 0 && completed === 0) {
    status = 'failed';
  } else {
    status = 'partial';
  }

  const isSuccess = failed === 0 && skipped === 0;

  orchestrationStore.updateRecord(orchestrationId, {
    status,
    completedAt,
    durationMs,
    results,
    aggregate: { completed, failed, skipped, totalAgents: agentIds.length, totalTokens },
  });

  return {
    success: isSuccess,
    executor: 'agent_execute',
    orchestrationId,
    task: input.task,
    strategy: effectiveStrategy,
    agents: agentIds,
    status,
    scheduledAt,
    startedAt,
    completedAt,
    durationMs,
    results,
    aggregate: { completed, failed, skipped, totalAgents: agentIds.length, totalTokens },
  };
}
