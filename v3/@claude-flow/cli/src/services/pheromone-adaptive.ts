/**
 * ADR-330 — Adaptive Pheromone Swarm Consensus.
 *
 * This is a scheduling eligibility layer, not an agent terminator. It learns a
 * bounded EMA signal per agent, compares agents against role-local baselines,
 * and may suspend them from future dispatch. Coordinators and other protected
 * roles remain eligible, quorum is never crossed, pruning per round is capped,
 * and exploration periodically reactivates a suspended agent.
 */

export const APSC_SCHEMA = 'ruflo.apsc-state/v1';

export interface ApscConfig {
  alpha: number;
  beta: number;
  gamma: number;
  emaDecay: number;
  pruningFactor: number;
  reactivationThreshold: number;
  minActiveAgents: number;
  minSamples: number;
  maxSuspendFraction: number;
  explorationRate: number;
  dryRun: boolean;
  protectedRoles: string[];
}

export interface ApscAgentState {
  agentId: string;
  role: string;
  status: 'active' | 'suspended';
  samples: number;
  rawScore: number;
  normalizedScore: number;
  emaScore: number;
  lastUpdatedAt: string;
  lastDecision?: 'keep' | 'would-suspend' | 'suspend' | 'reactivate' | 'explore';
}

export interface ApscState {
  schemaVersion: typeof APSC_SCHEMA;
  config: ApscConfig;
  round: number;
  threshold: number;
  roleBaselines: Record<string, number>;
  agents: Record<string, ApscAgentState>;
}

export interface ApscSignal {
  agentId: string;
  role: string;
  taskSuccess: number;
  normalizedLatency: number;
  consensusAlignment: number;
}

export interface ApscDecision {
  agentId: string;
  score: number;
  normalizedScore: number;
  emaScore: number;
  threshold: number;
  action: 'keep' | 'would-suspend' | 'suspend' | 'reactivate' | 'explore';
  applied: boolean;
  reason: string;
  activeAgents: number;
  suspendedAgents: number;
}

export const DEFAULT_APSC_CONFIG: ApscConfig = {
  alpha: 0.5,
  beta: 0.2,
  gamma: 0.3,
  emaDecay: 0.85,
  pruningFactor: 0.6,
  reactivationThreshold: 0.75,
  minActiveAgents: 3,
  minSamples: 3,
  maxSuspendFraction: 0.25,
  explorationRate: 0.1,
  dryRun: true,
  protectedRoles: ['coordinator', 'queen', 'security-architect', 'security-auditor'],
};

const unit = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a finite number in [0,1]`);
  }
  return value;
};

export function normalizeApscConfig(input: Partial<ApscConfig> = {}): ApscConfig {
  const alpha = unit(input.alpha ?? DEFAULT_APSC_CONFIG.alpha, 'alpha');
  const beta = unit(input.beta ?? DEFAULT_APSC_CONFIG.beta, 'beta');
  const gamma = unit(input.gamma ?? DEFAULT_APSC_CONFIG.gamma, 'gamma');
  const weight = alpha + beta + gamma;
  if (weight <= 0) throw new Error('at least one APSC score weight must be positive');
  const minActiveAgents = input.minActiveAgents ?? DEFAULT_APSC_CONFIG.minActiveAgents;
  const minSamples = input.minSamples ?? DEFAULT_APSC_CONFIG.minSamples;
  if (!Number.isInteger(minActiveAgents) || minActiveAgents < 1 || minActiveAgents > 50) {
    throw new Error('minActiveAgents must be an integer in [1,50]');
  }
  if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 1000) {
    throw new Error('minSamples must be an integer in [1,1000]');
  }
  const protectedRoles = [...new Set(
    (input.protectedRoles ?? DEFAULT_APSC_CONFIG.protectedRoles)
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean),
  )].sort();
  return {
    alpha: alpha / weight,
    beta: beta / weight,
    gamma: gamma / weight,
    emaDecay: unit(input.emaDecay ?? DEFAULT_APSC_CONFIG.emaDecay, 'emaDecay'),
    pruningFactor: unit(input.pruningFactor ?? DEFAULT_APSC_CONFIG.pruningFactor, 'pruningFactor'),
    reactivationThreshold: unit(
      input.reactivationThreshold ?? DEFAULT_APSC_CONFIG.reactivationThreshold,
      'reactivationThreshold',
    ),
    minActiveAgents,
    minSamples,
    maxSuspendFraction: unit(
      input.maxSuspendFraction ?? DEFAULT_APSC_CONFIG.maxSuspendFraction,
      'maxSuspendFraction',
    ),
    explorationRate: unit(input.explorationRate ?? DEFAULT_APSC_CONFIG.explorationRate, 'explorationRate'),
    dryRun: input.dryRun ?? DEFAULT_APSC_CONFIG.dryRun,
    protectedRoles,
  };
}

export function createApscState(config: Partial<ApscConfig> = {}): ApscState {
  return {
    schemaVersion: APSC_SCHEMA,
    config: normalizeApscConfig(config),
    round: 0,
    threshold: 0.5,
    roleBaselines: {},
    agents: {},
  };
}

function counts(state: ApscState): { activeAgents: number; suspendedAgents: number } {
  const values = Object.values(state.agents);
  return {
    activeAgents: values.filter((agent) => agent.status === 'active').length,
    suspendedAgents: values.filter((agent) => agent.status === 'suspended').length,
  };
}

function protectedRole(state: ApscState, role: string): boolean {
  return state.config.protectedRoles.includes(role.toLowerCase());
}

export function recordApscSignal(
  current: ApscState,
  signal: ApscSignal,
  now = Date.now(),
): { state: ApscState; decision: ApscDecision } {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(signal.agentId)) throw new Error('invalid APSC agentId');
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(signal.role)) throw new Error('invalid APSC role');
  const config = normalizeApscConfig(current.config);
  const state: ApscState = {
    ...current,
    config,
    round: current.round + 1,
    roleBaselines: { ...current.roleBaselines },
    agents: Object.fromEntries(Object.entries(current.agents).map(([id, agent]) => [id, { ...agent }])),
  };
  const success = unit(signal.taskSuccess, 'taskSuccess');
  const latency = unit(signal.normalizedLatency, 'normalizedLatency');
  const alignment = unit(signal.consensusAlignment, 'consensusAlignment');
  const rawScore = config.alpha * success + config.beta * (1 - latency) + config.gamma * alignment;

  const role = signal.role.toLowerCase();
  // Compare against peers in the same role, excluding the current agent.
  // Letting an agent update its own baseline before normalization caused a
  // persistently weak agent to redefine "normal" downward and reactivate
  // without any recovery.
  const rolePeers = Object.values(state.agents)
    .filter((item) => item.agentId !== signal.agentId && item.role === role && item.samples > 0);
  const peerMean = rolePeers.length
    ? rolePeers.reduce((sum, item) => sum + item.rawScore, 0) / rolePeers.length
    : undefined;
  const priorRoleBaseline = peerMean ?? state.roleBaselines[role] ?? rawScore;
  // A common absolute scale unfairly prunes coordinators/specialists whose
  // observable task signal differs by role. Center each score on its role EMA.
  const normalizedScore = Math.max(0, Math.min(1, 0.5 + rawScore - priorRoleBaseline));

  const previous = state.agents[signal.agentId];
  const agent: ApscAgentState = {
    agentId: signal.agentId,
    role,
    status: previous?.status ?? 'active',
    samples: (previous?.samples ?? 0) + 1,
    rawScore,
    normalizedScore,
    emaScore: previous
      ? config.emaDecay * previous.emaScore + (1 - config.emaDecay) * normalizedScore
      : normalizedScore,
    lastUpdatedAt: new Date(now).toISOString(),
    lastDecision: 'keep',
  };
  state.agents[signal.agentId] = agent;
  const allRoleAgents = Object.values(state.agents).filter((item) => item.role === role);
  const observedRoleMean = allRoleAgents.reduce((sum, item) => sum + item.rawScore, 0) / allRoleAgents.length;
  state.roleBaselines[role] = config.emaDecay * priorRoleBaseline + (1 - config.emaDecay) * observedRoleMean;

  const mature = Object.values(state.agents).filter((item) => item.samples >= config.minSamples);
  const observedMean = mature.length
    ? mature.reduce((sum, item) => sum + item.emaScore, 0) / mature.length
    : state.threshold;
  state.threshold = config.emaDecay * state.threshold + (1 - config.emaDecay) * observedMean;

  let action: ApscDecision['action'] = 'keep';
  let applied = false;
  let reason = agent.samples < config.minSamples
    ? `warm-up ${agent.samples}/${config.minSamples}`
    : 'within adaptive envelope';

  if (agent.status === 'suspended' && agent.emaScore >= state.threshold * config.reactivationThreshold) {
    action = 'reactivate';
    reason = 'score recovered above reactivation threshold';
    if (!config.dryRun) {
      agent.status = 'active';
      applied = true;
    }
  } else if (
    agent.status === 'active'
    && agent.samples >= config.minSamples
    && !protectedRole(state, agent.role)
    && agent.emaScore < state.threshold * config.pruningFactor
  ) {
    const before = counts(state);
    const maxThisRound = Math.floor(before.activeAgents * config.maxSuspendFraction);
    const quorumCapacity = Math.max(0, before.activeAgents - config.minActiveAgents);
    if (maxThisRound < 1 || quorumCapacity < 1) {
      reason = 'safety floor prevents suspension';
    } else {
      action = config.dryRun ? 'would-suspend' : 'suspend';
      reason = 'score below adaptive pruning threshold';
      if (!config.dryRun) {
        agent.status = 'suspended';
        applied = true;
      }
    }
  } else if (protectedRole(state, agent.role)) {
    reason = 'protected role remains eligible';
  }

  // Deterministic exploration: at a bounded cadence, reactivate the stalest
  // suspended agent so a transient failure cannot permanently exclude it.
  if (!config.dryRun && config.explorationRate > 0) {
    const cadence = Math.max(1, Math.round(1 / config.explorationRate));
    if (state.round % cadence === 0) {
      const explorer = Object.values(state.agents)
        .filter((item) => item.status === 'suspended')
        .sort((a, b) => a.lastUpdatedAt.localeCompare(b.lastUpdatedAt) || a.agentId.localeCompare(b.agentId))[0];
      if (explorer) {
        explorer.status = 'active';
        explorer.lastDecision = 'explore';
        if (explorer.agentId === agent.agentId) {
          action = 'explore';
          applied = true;
          reason = 'bounded exploration reactivation';
        }
      }
    }
  }

  agent.lastDecision = action;
  const after = counts(state);
  return {
    state,
    decision: {
      agentId: agent.agentId,
      score: rawScore,
      normalizedScore,
      emaScore: agent.emaScore,
      threshold: state.threshold,
      action,
      applied,
      reason,
      ...after,
    },
  };
}

export function isApscAgentEligible(state: ApscState | undefined, agentId: string): boolean {
  if (!state || state.config.dryRun) return true;
  return state.agents[agentId]?.status !== 'suspended';
}
