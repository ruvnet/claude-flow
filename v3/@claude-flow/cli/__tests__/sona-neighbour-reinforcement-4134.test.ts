import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SONAOptimizer, SONA_ROUTING_GATE, routingGateStatus } from '../src/memory/sona-optimizer.js';

const TASK_A = 'Verify a ruflo plugin end-to-end: read docs+tool source, probe live MCP behaviour, root-cause anomalies in node_modules, file upstream issues';
const TASK_B = 'Verify the ruflo-intelligence plugin end-to-end: read docs+tool source, probe live MCP behaviour, root-cause anomalies in node_modules, file upstream issues';
const TASK_C = 'Verify the ruflo-ruvector plugin end-to-end: read docs and tool source, probe live MCP behaviour, root-cause anomalies, file upstream issues';

let dir: string;
let cwd: string;
beforeEach(() => { cwd = process.cwd(); dir = mkdtempSync(join(tmpdir(), 'sona-4134-')); process.chdir(dir); });
afterEach(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });

const outcome = (task: string, success = true, agent = 'researcher') => ({ trajectoryId: 't', task, agent, success, steps: [], duration: 1 });

describe('SONA near-identical tasks reinforce one pattern (#4134)', () => {
  it('the two near-identical tasks from the report share a pattern instead of creating two', () => {
    const sona = new SONAOptimizer({ persistencePath: '.swarm/sona-test.json' });
    const a = sona.processTrajectoryOutcome(outcome(TASK_A));
    const b = sona.processTrajectoryOutcome(outcome(TASK_B));
    expect(b.patternKey).toBe(a.patternKey);
    expect(b.reinforcedNeighbour).toBe(true);
    expect(b.confidence).toBeGreaterThan(a.confidence); // 0.55 -> 0.595, not a new pattern at 0.55
    expect(sona.getStats().totalPatterns).toBe(1);
  });

  it('routing eventually fires for a near-identical task: before the fix it never did (#4134)', async () => {
    const sona = new SONAOptimizer({ persistencePath: '.swarm/sona-test.json' });
    let fired = 0;
    for (let i = 1; i <= 14 && !fired; i++) {
      sona.processTrajectoryOutcome(outcome(i % 2 ? TASK_A : TASK_B));
      const s = await sona.getRoutingSuggestion(TASK_C);
      if (s.agent === 'researcher' && s.confidence >= SONA_ROUTING_GATE) fired = i;
    }
    expect(fired, 'learned routing never fired within 14 trajectories').toBeGreaterThan(0);
    expect(sona.getStats().totalPatterns).toBe(1);
  });

  it('routing fires for the identical task once confidence reaches the gate (3 successes)', async () => {
    const sona = new SONAOptimizer({ persistencePath: '.swarm/sona-test.json' });
    for (let i = 0; i < 3; i++) sona.processTrajectoryOutcome(outcome(TASK_A));
    const s = await sona.getRoutingSuggestion(TASK_A);
    expect(s.agent).toBe('researcher');
    expect(s.confidence).toBeGreaterThanOrEqual(SONA_ROUTING_GATE);
  });

  it('does not merge different agents or genuinely different tasks', () => {
    const sona = new SONAOptimizer({ persistencePath: '.swarm/sona-test.json' });
    const a = sona.processTrajectoryOutcome(outcome(TASK_A, true, 'researcher'));
    const other = sona.processTrajectoryOutcome(outcome(TASK_A, true, 'coder'));
    expect(other.patternKey).not.toBe(a.patternKey);
    const unrelated = sona.processTrajectoryOutcome(outcome('Refactor the billing invoice rounding logic and add currency tests', true, 'researcher'));
    expect(unrelated.patternKey).not.toBe(a.patternKey);
    expect(unrelated.reinforcedNeighbour).toBe(false);
  });

  it('a failure reduces the shared pattern instead of spawning a fresh 0.5 one', () => {
    const sona = new SONAOptimizer({ persistencePath: '.swarm/sona-test.json' });
    sona.processTrajectoryOutcome(outcome(TASK_A));
    const first = sona.processTrajectoryOutcome(outcome(TASK_B));
    const failed = sona.processTrajectoryOutcome(outcome(TASK_B, false));
    expect(failed.patternKey).toBe(first.patternKey);
    expect(failed.confidence).toBeLessThan(first.confidence);
  });

  it('reports how far the pattern is from the routing gate', () => {
    const sona = new SONAOptimizer({ persistencePath: '.swarm/sona-test.json' });
    const r = sona.processTrajectoryOutcome(outcome(TASK_A));
    expect(r.routingGate).toEqual({ threshold: SONA_ROUTING_GATE, confidence: r.confidence, reached: false, successesNeeded: 2 });
    expect(routingGateStatus(0.7)).toMatchObject({ reached: true, successesNeeded: 0 });
    expect(routingGateStatus(0.5).successesNeeded).toBe(3);
  });
});
