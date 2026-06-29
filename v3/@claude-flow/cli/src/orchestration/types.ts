export type OrchestrationStrategy = 'parallel' | 'sequential' | 'pipeline' | 'broadcast';
export type OrchestrationStatus = 'scheduled' | 'running' | 'completed' | 'partial' | 'failed';
export type AgentResultStatus = 'completed' | 'failed' | 'skipped';

export interface AgentResult {
  agentId: string;
  status: AgentResultStatus;
  output?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationMs?: number;
}

export interface CompletionAggregate {
  completed: number;
  failed: number;
  skipped: number;
  totalAgents: number;
  totalTokens: number;
}

export interface OrchestrationRecord {
  id: string;
  task: string;
  strategy: OrchestrationStrategy;
  agents: string[];
  status: OrchestrationStatus;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  results?: AgentResult[];
  aggregate?: CompletionAggregate;
}

export interface OrchestrateInput {
  task: string;
  agents?: string[];
  strategy?: OrchestrationStrategy;
  timeout?: number;
}

export interface OrchestrateResult {
  success: boolean;
  executor: 'agent_execute';
  orchestrationId: string;
  task: string;
  strategy: OrchestrationStrategy;
  agents: string[];
  status: OrchestrationStatus;
  scheduledAt: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  results: AgentResult[];
  aggregate: CompletionAggregate;
}
