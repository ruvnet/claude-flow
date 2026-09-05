#!/usr/bin/env node
/**
 * Reproducible ADR-330 benchmark.
 *
 * This does not repeat the external paper's claims. It measures Ruflo's local
 * implementation on a declared synthetic convergence workload and fails when
 * safety or latency bounds regress.
 */
import { performance } from 'node:perf_hooks';
import {
  createApscState,
  recordApscSignal,
} from '../dist/src/services/pheromone-adaptive.js';

const config = {
  dryRun: false,
  emaDecay: 0.5,
  pruningFactor: 0.8,
  minActiveAgents: 6,
  minSamples: 3,
  maxSuspendFraction: 0.25,
  explorationRate: 0,
};
const agents = Array.from({ length: 12 }, (_, index) => ({
  id: index === 0 ? 'lead' : `agent-${index}`,
  role: index === 0 ? 'coordinator' : 'coder',
  strong: index < 8,
}));
const signalFor = (agent) => ({
  agentId: agent.id,
  role: agent.role,
  taskSuccess: agent.strong ? 0.95 : 0.1,
  normalizedLatency: agent.strong ? 0.15 : 0.9,
  consensusAlignment: agent.strong ? 0.9 : 0.2,
});

let state = createApscState(config);
const durations = [];
for (let round = 0; round < 6; round++) {
  for (const agent of agents) {
    const started = performance.now();
    state = recordApscSignal(state, signalFor(agent), 1_800_000_000_000 + round).state;
    durations.push(performance.now() - started);
  }
}

// Throughput pass over an already-mature state.
for (let iteration = 0; iteration < 20_000; iteration++) {
  const agent = agents[iteration % agents.length];
  const started = performance.now();
  state = recordApscSignal(state, signalFor(agent), 1_800_000_100_000 + iteration).state;
  durations.push(performance.now() - started);
}

durations.sort((a, b) => a - b);
const p95Ms = durations[Math.floor(durations.length * 0.95)] ?? 0;
const active = Object.values(state.agents).filter((agent) => agent.status === 'active');
const suspended = Object.values(state.agents).filter((agent) => agent.status === 'suspended');
const rawMean = (rows) => rows.reduce((sum, row) => sum + row.rawScore, 0) / Math.max(1, rows.length);
const baselineMean = rawMean(Object.values(state.agents));
const activeMean = rawMean(active);
const report = {
  schemaVersion: 'ruflo.apsc-benchmark/v1',
  workload: {
    agents: agents.length,
    strongAgents: agents.filter((agent) => agent.strong).length,
    weakAgents: agents.filter((agent) => !agent.strong).length,
    warmupRounds: 6,
    measuredUpdates: 20_000,
  },
  config: state.config,
  result: {
    activeAgents: active.length,
    suspendedAgents: suspended.length,
    activeReduction: suspended.length / agents.length,
    baselineMeanScore: baselineMean,
    admittedMeanScore: activeMean,
    admittedScoreLift: activeMean - baselineMean,
    protectedLeadActive: state.agents.lead?.status === 'active',
    quorumPreserved: active.length >= state.config.minActiveAgents,
    updateP95Ms: p95Ms,
  },
  claimBoundary: 'Synthetic Ruflo implementation benchmark; external TPSC percentages are not claimed.',
};

console.log(JSON.stringify(report, null, 2));

if (!report.result.protectedLeadActive) throw new Error('protected role was suspended');
if (!report.result.quorumPreserved) throw new Error('active-agent floor was crossed');
if (report.result.activeReduction < 0.25) throw new Error('synthetic pruning target was not reached');
if (report.result.admittedScoreLift <= 0) throw new Error('admitted-agent quality did not improve');
if (report.result.updateP95Ms >= 5) throw new Error(`APSC update p95 ${report.result.updateP95Ms}ms exceeds 5ms`);
