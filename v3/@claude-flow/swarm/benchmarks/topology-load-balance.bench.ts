#!/usr/bin/env -S npx tsx
/**
 * Dream Cycle 2026-08-14 (swarm) benchmark corpus.
 *
 * Hypothesis: power-of-two-choices peer selection in TopologyManager.rebalanceMesh /
 * rebalanceHybrid reduces per-node connection-count load imbalance vs the prior
 * uniform-random selection, without regressing average connectivity or reachability.
 *
 * Zero-LLM, deterministic (seeded) benchmark — no metaharness evolve/bench corpus
 * fits this candidate (that pipeline scores LLM input/output task pairs; this
 * candidate is a pure in-process algorithm change). Run twice against the same
 * seeds: once against baseline topology-manager.ts, once against the patched one.
 *
 * Usage: npx tsx topology-load-balance.bench.ts <label> <out.json>
 */
import { writeFileSync } from 'node:fs';
import { TopologyManager } from '../src/topology-manager.js';

function mulberry32(seed: number) {
  let s = seed;
  return function rng() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type TopoType = 'mesh' | 'hybrid';

interface Scenario {
  id: string;
  topology: TopoType;
  agents: number;
  churn: number;
}

const SCENARIOS: Scenario[] = [
  { id: 'mesh-small', topology: 'mesh', agents: 12, churn: 0 },
  { id: 'mesh-medium-churn', topology: 'mesh', agents: 30, churn: 6 },
  { id: 'mesh-large-churn', topology: 'mesh', agents: 60, churn: 12 },
  { id: 'hybrid-small', topology: 'hybrid', agents: 12, churn: 0 },
  { id: 'hybrid-medium-churn', topology: 'hybrid', agents: 30, churn: 6 },
  { id: 'hybrid-large-churn', topology: 'hybrid', agents: 60, churn: 12 },
];

const TRIALS_PER_SCENARIO = 40;

async function runTrial(scenario: Scenario, seed: number) {
  const rng = mulberry32(seed);
  const originalRandom = Math.random;
  Math.random = rng;
  const start = performance.now();
  try {
    const tm = new TopologyManager({
      type: scenario.topology,
      maxAgents: 500,
      autoRebalance: true,
    });

    for (let i = 0; i < scenario.agents; i++) {
      const role: 'peer' | 'worker' | 'coordinator' =
        scenario.topology === 'hybrid' ? (i < 2 ? 'coordinator' : 'worker') : 'peer';
      await tm.addNode(`agent-${i}`, role);
    }

    // Churn: retire early nodes, admit replacements, to exercise rebalance under change.
    for (let i = 0; i < scenario.churn; i++) {
      await tm.removeNode(`agent-${i}`);
      const role: 'peer' | 'worker' = scenario.topology === 'hybrid' ? 'worker' : 'peer';
      await tm.addNode(`agent-r${i}`, role);
    }

    // TopologyManager.rebalance() gates on a 5000ms cooldown from construction time
    // (`lastRebalance`), which a fast synchronous benchmark burst never clears —
    // so without this reset, rebalanceMesh/rebalanceHybrid never run at all and
    // baseline vs candidate would be indistinguishable regardless of which peer-
    // selection policy is patched in. This is a pre-existing quirk of the class,
    // applied identically to both benchmark runs, not a change to what's evaluated.
    (tm as unknown as { lastRebalance: Date }).lastRebalance = new Date(0);
    await tm.rebalance();

    const state = tm.getState();
    const counts = state.nodes.map(n => n.connections.length);
    const max = counts.length ? Math.max(...counts) : 0;
    const mean = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
    const variance =
      counts.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, counts.length);
    const stddev = Math.sqrt(variance);
    const cov = mean > 0 ? stddev / mean : 0;

    // Reachability sample: 24 random pairs, count unreachable pairs.
    let failures = 0;
    const pairs = 24;
    for (let p = 0; p < pairs; p++) {
      const a = state.nodes[Math.floor(rng() * state.nodes.length)];
      const b = state.nodes[Math.floor(rng() * state.nodes.length)];
      if (!a || !b || a.agentId === b.agentId) continue;
      const path = tm.findOptimalPath(a.agentId, b.agentId);
      if (path.length === 0) failures++;
    }

    const durationMs = performance.now() - start;
    return {
      scenario: scenario.id,
      seed,
      nodeCount: counts.length,
      edgeCount: tm.getConnectionCount(),
      maxLoad: max,
      meanLoad: mean,
      stddevLoad: stddev,
      covLoad: cov,
      reachabilityFailures: failures,
      reachabilitySamples: pairs,
      durationMs,
    };
  } finally {
    Math.random = originalRandom;
  }
}

async function main() {
  const label = process.argv[2] ?? 'unlabeled';
  const outPath = process.argv[3];

  const results: Awaited<ReturnType<typeof runTrial>>[] = [];
  for (const scenario of SCENARIOS) {
    for (let trial = 0; trial < TRIALS_PER_SCENARIO; trial++) {
      // Seed is a pure function of (scenario, trial) so baseline and candidate runs
      // see byte-identical random sequences — this is what makes the comparison paired.
      const seed = hashSeed(scenario.id, trial);
      results.push(await runTrial(scenario, seed));
    }
  }

  const receipt = {
    label,
    generatedAt: 'DREAM_CYCLE_RUNTIME', // stamped by caller to keep this file deterministic
    scenarioCount: SCENARIOS.length,
    trialsPerScenario: TRIALS_PER_SCENARIO,
    totalTrials: results.length,
    results,
  };

  const json = JSON.stringify(receipt, null, 2);
  if (outPath) {
    writeFileSync(outPath, json);
  } else {
    console.log(json);
  }
}

function hashSeed(scenarioId: string, trial: number): number {
  let h = 2166136261;
  const s = `${scenarioId}:${trial}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
