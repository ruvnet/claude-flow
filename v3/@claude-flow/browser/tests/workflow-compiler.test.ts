/**
 * @claude-flow/browser - Workflow Compiler + Production-Aware UCT Tests (ADR-122 Phase 7)
 *
 * Acceptance criteria covered:
 *  - Compile a successful trajectory → CompiledWorkflow with selector fallback per step
 *  - Detect highest-risk action in trajectory; gate requirements + guards accordingly
 *  - Origins extracted from `open` steps populate requirements.origins
 *  - YAML serialisation is deterministic + parseable
 *  - Production-aware UCT formula respects penalties (low Q + high risk < high Q + low risk)
 *  - Unvisited branches still return Infinity (parity with Phase 4 UCB1)
 *  - Cost penalty dominates exploitation when cost is high
 */

import { describe, it, expect } from 'vitest';
import { WorkflowCompiler } from '../src/application/workflow-compiler.js';
import { productionUct, blendQ } from '../src/application/production-uct.js';
import { sealTrajectory } from '../src/application/signed-trajectory-service.js';
import { generateWitnessKey } from '../src/infrastructure/witness-signer.js';
import type { BrowserTrajectory, Snapshot } from '../src/domain/types.js';
import { DEFAULT_PRODUCTION_UCT_WEIGHTS } from '../src/domain/workflow.js';

const sharedKey = generateWitnessKey();

function buildLoginTrajectory(): BrowserTrajectory {
  const snapshot: Snapshot = {
    tree: { role: 'main', children: [] },
    refs: {
      '@e1': { role: 'textbox', name: 'Email' },
      '@e2': { role: 'textbox', name: 'Password' },
      '@e3': { role: 'button', name: 'Sign in' },
    },
    url: 'https://example.com/login',
    title: 'Login',
    timestamp: '2026-05-18T20:00:00Z',
  };
  return {
    id: 'wf-traj-1',
    sessionId: 's',
    goal: 'Sign in to example.com',
    startedAt: '2026-05-18T20:00:00Z',
    completedAt: '2026-05-18T20:00:05Z',
    success: true,
    verdict: 'ok',
    steps: [
      { action: 'open', input: { url: 'https://example.com/login' }, result: { success: true }, timestamp: '2026-05-18T20:00:00Z' },
      { action: 'snapshot', input: {}, result: { success: true }, snapshot, timestamp: '2026-05-18T20:00:01Z' },
      { action: 'fill', input: { target: '@e1', value: 'user@example.com' }, result: { success: true }, snapshot, timestamp: '2026-05-18T20:00:02Z' },
      { action: 'fill', input: { target: '@e2', value: 'hunter2' }, result: { success: true }, snapshot, timestamp: '2026-05-18T20:00:03Z' },
      { action: 'click', input: { target: '@e3' }, result: { success: true }, snapshot, timestamp: '2026-05-18T20:00:04Z' },
    ],
  };
}

describe('WorkflowCompiler', () => {
  it('compiles a successful trajectory into a typed workflow', () => {
    const compiler = new WorkflowCompiler();
    const { envelope } = sealTrajectory({ trajectory: buildLoginTrajectory(), witnessKey: sharedKey });
    const wf = compiler.compile({
      id: 'example-login',
      goal: 'Sign in to example.com',
      trajectoryEnvelope: envelope,
    });
    expect(wf.workflow).toBe('example-login');
    expect(wf.steps).toHaveLength(5);
    expect(wf.requirements.origins).toContain('https://example.com');
  });

  it('detects draft-write as the highest risk in a login trajectory', () => {
    const compiler = new WorkflowCompiler();
    const { envelope } = sealTrajectory({ trajectory: buildLoginTrajectory(), witnessKey: sharedKey });
    const wf = compiler.compile({
      id: 'login-flow', goal: 'login flow', trajectoryEnvelope: envelope,
    });
    expect(wf.requirements.taskClass).toBe('draft-write');
    expect(wf.guards.requiresUserConfirmation).toBe(false);
    expect(wf.guards.irreversibleAction).toBe(false);
    expect(wf.requirements.sessionCapsule).toBe(true);
  });

  it('escalates guards when trajectory contains a payment action', () => {
    const compiler = new WorkflowCompiler();
    const traj = buildLoginTrajectory();
    traj.steps.push({
      action: 'click',
      input: { target: '@e9' },
      result: { success: true },
      timestamp: '2026-05-18T20:01:00Z',
    });
    traj.goal = 'Pay invoice';
    const { envelope } = sealTrajectory({ trajectory: traj, witnessKey: sharedKey });
    const wf = compiler.compile({ id: 'pay-invoice', goal: traj.goal, trajectoryEnvelope: envelope });
    expect(wf.requirements.taskClass).toBe('financial');
    expect(wf.guards.irreversibleAction).toBe(true);
    expect(wf.guards.requiresUserConfirmation).toBe(true);
  });

  it('produces selector fallback chain from snapshot metadata', () => {
    const compiler = new WorkflowCompiler();
    const { envelope } = sealTrajectory({ trajectory: buildLoginTrajectory(), witnessKey: sharedKey });
    const wf = compiler.compile({ id: 'login', goal: 'login', trajectoryEnvelope: envelope });

    const clickStep = wf.steps.find(s => s.action === 'click')!;
    // Primary is @e3 ref; fallback should include role:button name:Sign in
    expect(clickStep.target).toMatchObject({ strategy: 'ref', value: '@e3' });
    expect(clickStep.fallback.some(f => f.strategy === 'role' && f.value === 'button' && f.name === 'Sign in')).toBe(true);
    expect(clickStep.fallback.some(f => f.strategy === 'text' && f.value === 'Sign in')).toBe(true);
  });

  it('renders deterministic YAML', () => {
    const compiler = new WorkflowCompiler();
    const { envelope } = sealTrajectory({ trajectory: buildLoginTrajectory(), witnessKey: sharedKey });
    const wf = compiler.compile({
      id: 'login', goal: 'login', trajectoryEnvelope: envelope, compiledAt: '2026-05-18T21:00:00Z',
    });
    const yaml = compiler.toYaml(wf);
    expect(yaml).toContain('workflow: login');
    expect(yaml).toContain('version: 1');
    expect(yaml).toContain('compiledAt: 2026-05-18T21:00:00Z');
    expect(yaml).toContain('  - action: click');
    expect(yaml).toContain('    target:');
    expect(yaml).toContain('      strategy: ref');
    expect(yaml).toContain('    fallback:');
    expect(yaml).toContain('      - strategy: role');
  });
});

describe('productionUct', () => {
  const visited = (visits: number, parentVisits: number) => ({ visits, parentVisits });

  it('returns Infinity for unvisited branches', () => {
    const score = productionUct({
      ...visited(0, 10),
      signals: { qValue: 0, replayability: 0, risk: 0, costUsd: 0, authFragility: 0 },
    });
    expect(score).toBe(Infinity);
  });

  it('prefers high-Q low-risk branches over high-Q high-risk', () => {
    const safe = productionUct({
      ...visited(5, 20),
      signals: { qValue: 0.8, replayability: 0.5, risk: 0.0, costUsd: 0.01, authFragility: 0.1 },
    });
    const risky = productionUct({
      ...visited(5, 20),
      signals: { qValue: 0.8, replayability: 0.5, risk: 0.9, costUsd: 0.01, authFragility: 0.1 },
    });
    expect(safe).toBeGreaterThan(risky);
  });

  it('penalizes high cost', () => {
    const cheap = productionUct({
      ...visited(5, 20),
      signals: { qValue: 0.6, replayability: 0.3, risk: 0.1, costUsd: 0.01, authFragility: 0.1 },
    });
    const expensive = productionUct({
      ...visited(5, 20),
      signals: { qValue: 0.6, replayability: 0.3, risk: 0.1, costUsd: 0.5, authFragility: 0.1 },
    });
    expect(cheap).toBeGreaterThan(expensive);
    expect(cheap - expensive).toBeCloseTo(
      DEFAULT_PRODUCTION_UCT_WEIGHTS.costPenalty * (0.5 - 0.01),
      4,
    );
  });

  it('rewards high replayability', () => {
    const replayable = productionUct({
      ...visited(5, 20),
      signals: { qValue: 0.5, replayability: 1.0, risk: 0.1, costUsd: 0.01, authFragility: 0.1 },
    });
    const oneShot = productionUct({
      ...visited(5, 20),
      signals: { qValue: 0.5, replayability: 0.0, risk: 0.1, costUsd: 0.01, authFragility: 0.1 },
    });
    expect(replayable).toBeGreaterThan(oneShot);
  });

  it('honours custom weights', () => {
    const weights = { ...DEFAULT_PRODUCTION_UCT_WEIGHTS, riskPenalty: 0 };
    const risky = productionUct({
      ...visited(5, 20),
      signals: { qValue: 0.5, replayability: 0.5, risk: 1.0, costUsd: 0.01, authFragility: 0.0 },
    }, weights);
    const safe = productionUct({
      ...visited(5, 20),
      signals: { qValue: 0.5, replayability: 0.5, risk: 0.0, costUsd: 0.01, authFragility: 0.0 },
    }, weights);
    // With riskPenalty=0 the two should now tie
    expect(risky).toBeCloseTo(safe, 6);
  });
});

describe('blendQ', () => {
  it('returns raw scorer value when replaySuccessRate is undefined', () => {
    expect(blendQ(0.7)).toBe(0.7);
  });

  it('linearly blends scorer + replay-success', () => {
    expect(blendQ(0.8, 0.6)).toBeCloseTo(0.7 * 0.8 + 0.3 * 0.6, 6);
  });
});
