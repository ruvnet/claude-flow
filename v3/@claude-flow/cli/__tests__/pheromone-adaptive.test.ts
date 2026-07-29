import { describe, expect, it } from 'vitest';
import {
  createApscState,
  isApscAgentEligible,
  recordApscSignal,
} from '../src/services/pheromone-adaptive.js';

function signal(agentId: string, role: string, taskSuccess: number) {
  return { agentId, role, taskSuccess, normalizedLatency: taskSuccess ? 0.1 : 1, consensusAlignment: taskSuccess };
}

describe('Adaptive Pheromone Swarm Consensus', () => {
  it('is dry-run by default and never changes eligibility', () => {
    let state = createApscState({ minSamples: 1, minActiveAgents: 1, pruningFactor: 1 });
    for (const id of ['a', 'b', 'c', 'd']) {
      state = recordApscSignal(state, signal(id, 'coder', id === 'd' ? 0 : 1)).state;
    }
    const result = recordApscSignal(state, signal('d', 'coder', 0));
    expect(['would-suspend', 'keep']).toContain(result.decision.action);
    expect(result.state.agents.d.status).toBe('active');
    expect(isApscAgentEligible(result.state, 'd')).toBe(true);
  });

  it('suspends a mature low performer without crossing the quorum floor', () => {
    let state = createApscState({
      dryRun: false,
      minSamples: 1,
      minActiveAgents: 3,
      maxSuspendFraction: 0.5,
      pruningFactor: 0.95,
      emaDecay: 0,
      explorationRate: 0,
    });
    let last;
    for (const id of ['a', 'b', 'c', 'd']) {
      last = recordApscSignal(state, signal(id, 'coder', id === 'd' ? 0 : 1));
      state = last.state;
    }
    expect(last!.decision.action).toBe('suspend');
    expect(last!.decision.activeAgents).toBe(3);
    expect(isApscAgentEligible(state, 'd')).toBe(false);
  });

  it('never suspends protected coordination roles', () => {
    let state = createApscState({
      dryRun: false,
      minSamples: 1,
      minActiveAgents: 1,
      maxSuspendFraction: 1,
      pruningFactor: 1,
      emaDecay: 0,
      explorationRate: 0,
    });
    for (const id of ['lead', 'a', 'b']) {
      state = recordApscSignal(state, signal(id, id === 'lead' ? 'coordinator' : 'coder', id === 'lead' ? 0 : 1)).state;
    }
    const result = recordApscSignal(state, signal('lead', 'coordinator', 0));
    expect(result.decision.reason).toMatch(/protected role/);
    expect(result.state.agents.lead.status).toBe('active');
  });

  it('reactivates recovered agents', () => {
    let state = createApscState({
      dryRun: false,
      minSamples: 1,
      minActiveAgents: 1,
      maxSuspendFraction: 1,
      pruningFactor: 1,
      reactivationThreshold: 0.75,
      emaDecay: 0,
      explorationRate: 0,
    });
    for (const id of ['a', 'b', 'c']) state = recordApscSignal(state, signal(id, 'coder', id === 'c' ? 0 : 1)).state;
    expect(state.agents.c.status).toBe('suspended');
    const recovered = recordApscSignal(state, signal('c', 'coder', 1));
    expect(recovered.decision.action).toBe('reactivate');
    expect(recovered.state.agents.c.status).toBe('active');
  });
});
