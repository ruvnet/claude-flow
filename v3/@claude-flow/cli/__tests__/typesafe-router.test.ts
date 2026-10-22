/**
 * typesafe-router.test.ts — opt-in `@ruvector/typesafe` augmentation for hooks_route.
 *
 * Contract (mirrors ADR-150's optional-integration rules):
 *   (a) env unset          → the package is never imported; legacy result returned as-is
 *   (b) env set, no module → falls back to the legacy route, never throws
 *   (c) env set, a choice  → routedBy 'typesafe', uncalibrated confidence flagged
 *   (d) high abstain       → legacy route kept, reason names the abstain gate
 *   (e) real package       → runs only when @ruvector/typesafe resolves (hash embedder)
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

import {
  TypesafeRouter,
  applyTypesafeRouting,
  buildAgentCriteria,
  readTypesafeConfig,
  type RoutingPatternLike,
} from '../src/ruvector/typesafe-router.js';

const PATTERNS: Record<string, RoutingPatternLike> = {
  'testing-task': { keywords: ['test', 'testing', 'coverage'], agents: ['tester', 'reviewer'] },
  'security-task': { keywords: ['auth', 'security', 'cve'], agents: ['security-architect', 'reviewer'] },
  'feature-task': { keywords: ['feature', 'implement', 'build'], agents: ['architect', 'coder'] },
};

const LEGACY = Object.freeze({
  task: 'sync and review latest issues',
  routing: { method: 'keyword', backend: 'keyword matching', latencyMs: 0, throughput: 'N/A' },
  matchedPattern: 'keyword-fallback',
  primaryAgent: { type: 'tester', confidence: 0.95, reason: 'Task contains keywords matching tester specialization' },
  alternativeAgents: [{ type: 'reviewer', confidence: 0.85, reason: 'Alternative' }],
  estimatedMetrics: { successProbability: 0.95, estimatedDuration: '10-30 min', complexity: 'low' },
  swarmRecommendation: null,
});

function mockModule(answer: Record<string, unknown>) {
  const decide = vi.fn(async () => ({ agent: answer, answers: { agent: answer }, usage: {} }));
  const createTypesafe = vi.fn(() => ({ backend: 'native', decide }));
  const choice = vi.fn((criteria: unknown) => ({ type: 'choice', criteria }));
  return { mod: { createTypesafe, choice }, decide, createTypesafe, choice };
}

const ON = { CLAUDE_FLOW_ROUTER_TYPESAFE: '1' } as NodeJS.ProcessEnv;

describe('typesafe-router: opt-in gate', () => {
  it('(a) env unset → typesafe is never imported and the legacy object is returned untouched', async () => {
    const loadModule = vi.fn(async () => { throw new Error('must not load'); });
    const router = new TypesafeRouter({ env: {}, loadModule });
    const out = await applyTypesafeRouting({ task: LEGACY.task }, LEGACY, PATTERNS, router);
    expect(out).toBe(LEGACY);
    expect(loadModule).not.toHaveBeenCalled();
    expect(readTypesafeConfig({}).enabled).toBe(false);
  });

  it('(a) only the exact value "1" enables it', () => {
    expect(readTypesafeConfig({ CLAUDE_FLOW_ROUTER_TYPESAFE: 'true' }).enabled).toBe(false);
    expect(readTypesafeConfig(ON).enabled).toBe(true);
  });

  it('(a) hooks_route with the env unset carries no typesafe fields', async () => {
    delete process.env.CLAUDE_FLOW_ROUTER_TYPESAFE;
    const { hooksRoute } = await import('../src/mcp-tools/hooks-tools.js');
    const res = await hooksRoute.handler({ task: 'write unit tests for the parser', useSemanticRouter: false }) as Record<string, unknown>;
    expect(res.primaryAgent).toBeDefined();
    expect(res).not.toHaveProperty('typesafe');
    expect(res).not.toHaveProperty('routedBy');
  });

  it('validation failures from the legacy handler pass through even when enabled', async () => {
    const loadModule = vi.fn();
    const router = new TypesafeRouter({ env: ON, loadModule });
    const failed = { success: false, error: 'bad task' };
    expect(await applyTypesafeRouting({ task: '' }, failed, PATTERNS, router)).toBe(failed);
    expect(loadModule).not.toHaveBeenCalled();
  });
});

describe('typesafe-router: removable', () => {
  it('(b) env set + module missing → legacy route, reason says not installed, no throw', async () => {
    const err = Object.assign(new Error("Cannot find package '@ruvector/typesafe'"), { code: 'ERR_MODULE_NOT_FOUND' });
    const loadModule = vi.fn(async () => { throw err; });
    const router = new TypesafeRouter({ env: ON, loadModule, debug: () => {} });
    const out = await applyTypesafeRouting({ task: LEGACY.task }, LEGACY, PATTERNS, router);
    expect(out.primaryAgent).toEqual(LEGACY.primaryAgent);
    expect(out.routedBy).toBe('keyword');
    expect((out.typesafe as Record<string, unknown>).used).toBe(false);
    expect((out.typesafe as Record<string, unknown>).reason).toBe('@ruvector/typesafe not installed');
    // The failed load is cached: a second route does not retry the import.
    await applyTypesafeRouting({ task: LEGACY.task }, LEGACY, PATTERNS, router);
    expect(loadModule).toHaveBeenCalledTimes(1);
  });

  it('(b) a decide() error falls back instead of throwing', async () => {
    const decide = vi.fn(async () => { throw new Error('state too long'); });
    const router = new TypesafeRouter({ env: ON, debug: () => {}, loadModule: async () => ({ createTypesafe: () => ({ backend: 'wasm', decide }) }) });
    const out = await applyTypesafeRouting({ task: 'x' }, LEGACY, PATTERNS, router);
    expect(out.primaryAgent).toEqual(LEGACY.primaryAgent);
    expect((out.typesafe as Record<string, unknown>).reason).toMatch(/decide failed: state too long/);
  });
});

describe('typesafe-router: decisions', () => {
  it('(c) a clear choice → routedBy typesafe, uncalibrated confidence flagged, legacy kept as fallbackRoute', async () => {
    const { mod, decide, createTypesafe } = mockModule({
      choice: 'researcher', confidence: 0.41, abstain: 0.11, calibrated: false, head: 'nearest-prototype', model: 'hash-bow-256@test-double',
      probabilities: { researcher: 0.46, reviewer: 0.2, tester: 0.14, coder: 0.2 },
    });
    const router = new TypesafeRouter({ env: ON, loadModule: async () => ({ default: mod }) });
    const out = await applyTypesafeRouting({ task: LEGACY.task, context: 'github' }, LEGACY, PATTERNS, router);

    expect(createTypesafe).toHaveBeenCalledWith({ embedder: 'hash' });
    expect(decide).toHaveBeenCalledWith('sync and review latest issues github', expect.objectContaining({ agent: expect.anything() }));
    expect(out.routedBy).toBe('typesafe');
    expect((out.routing as Record<string, unknown>).method).toBe('typesafe');
    expect(out.primaryAgent).toMatchObject({ type: 'researcher', confidence: 0.41, confidenceCalibrated: false });
    expect(String((out.primaryAgent as Record<string, unknown>).reason)).toContain('UNCALIBRATED');
    expect(out.fallbackRoute).toEqual({ agent: 'tester', confidence: 0.95, method: 'keyword' });
    // Uncalibrated confidence is never promoted into successProbability.
    expect(out.estimatedMetrics).toEqual(LEGACY.estimatedMetrics);
    expect((out.alternativeAgents as Array<{ type: string }>).map(a => a.type)).toHaveLength(2);
    expect(out.typesafe).toMatchObject({ used: true, choice: 'researcher', abstain: 0.11, calibrated: false, embedder: 'hash', backend: 'native' });
  });

  it('(d) high abstain → legacy route kept and the reason names the abstain gate', async () => {
    const { mod } = mockModule({ choice: 'coder', confidence: 0.3, abstain: 0.62, calibrated: true, probabilities: { coder: 0.7, tester: 0.3 } });
    const router = new TypesafeRouter({ env: ON, loadModule: async () => mod });
    const out = await applyTypesafeRouting({ task: 'xyzzy' }, LEGACY, PATTERNS, router);
    expect(out.primaryAgent).toEqual(LEGACY.primaryAgent);
    expect(out.routedBy).toBe('keyword');
    expect(out.typesafe).toMatchObject({ used: false, choice: 'coder', abstain: 0.62 });
    expect(String((out.typesafe as Record<string, unknown>).reason)).toMatch(/abstain 0\.62 > max 0\.30/);
  });

  it('(d) a uniform distribution (chance-level) falls back on the lift gate', async () => {
    const { mod } = mockModule({ choice: 'coder', confidence: 0.2, abstain: 0.1, calibrated: false, probabilities: { coder: 0.25, tester: 0.25, reviewer: 0.25, researcher: 0.25 } });
    const router = new TypesafeRouter({ env: ON, loadModule: async () => mod });
    const out = await applyTypesafeRouting({ task: 'xyzzy plugh' }, LEGACY, PATTERNS, router);
    expect(String((out.typesafe as Record<string, unknown>).reason)).toMatch(/lift 1\.00 \(top-1 × 4 options\) < min 1\.20/);
    expect(out.primaryAgent).toEqual(LEGACY.primaryAgent);
  });

  it('(d) a tie at the top falls back on the margin gate', async () => {
    const { mod } = mockModule({ choice: 'coder', confidence: 0.36, abstain: 0.1, calibrated: false, probabilities: { coder: 0.4, tester: 0.4, reviewer: 0.1, researcher: 0.1 } });
    const router = new TypesafeRouter({ env: ON, loadModule: async () => mod });
    const out = await applyTypesafeRouting({ task: 'test or code?' }, LEGACY, PATTERNS, router);
    expect(String((out.typesafe as Record<string, unknown>).reason)).toMatch(/margin 0\.000 < min 0\.005/);
    expect(out.primaryAgent).toEqual(LEGACY.primaryAgent);
  });

  it('thresholds are env-tunable and invalid values fall back to defaults', () => {
    const cfg = readTypesafeConfig({ ...ON, CLAUDE_FLOW_ROUTER_TYPESAFE_MAX_ABSTAIN: '0.7', CLAUDE_FLOW_ROUTER_TYPESAFE_MIN_LIFT: 'nope' });
    expect(cfg.maxAbstain).toBe(0.7);
    expect(cfg.minLift).toBe(1.2);
    expect(readTypesafeConfig({ ...ON, CLAUDE_FLOW_ROUTER_TYPESAFE_MIN_LIFT: '2' }).minLift).toBe(2);
    expect(readTypesafeConfig({ ...ON, CLAUDE_FLOW_ROUTER_TYPESAFE_MAX_ABSTAIN: '1.5' }).maxAbstain).toBe(0.3);
    expect(readTypesafeConfig({ ...ON, CLAUDE_FLOW_ROUTER_TYPESAFE_MODEL_DIR: '/m', CLAUDE_FLOW_ROUTER_TYPESAFE_MANIFEST: '/m/manifest.json' }).embedder)
      .toEqual({ kind: 'onnx', modelDir: '/m', manifest: '/m/manifest.json' });
  });

  it('builds options from the pattern table with not_for hints separating tester/reviewer/researcher', () => {
    const c = buildAgentCriteria(PATTERNS);
    expect(Object.keys(c)).toEqual(expect.arrayContaining(['tester', 'security-architect', 'architect', 'researcher', 'reviewer', 'coder']));
    expect(c.tester.what).toContain('coverage');
    expect(c.tester.not_for).toMatch(/review/);
    expect(c.reviewer.not_for).toMatch(/writing tests/);
    expect(c.researcher.not_for).toMatch(/tests/);
  });
});

// (e) Real package — skipped unless @ruvector/typesafe resolves from this package.
const realModule = (() => {
  try { return createRequire(import.meta.url).resolve('@ruvector/typesafe'); } catch { return null; }
})();
describe.skipIf(!realModule)('typesafe-router: real @ruvector/typesafe (hash embedder)', () => {
  it('(e) routes through the real engine and reports calibrated:false honestly', async () => {
    const router = new TypesafeRouter({ env: ON });
    const out = await router.route('write unit tests for the parser and check coverage', PATTERNS);
    expect(out.embedder).toBe('hash');
    expect(out.answer).toBeDefined();
    expect(out.answer!.calibrated).toBe(false);
    expect(Object.keys(out.answer!.probabilities)).toEqual(expect.arrayContaining(['tester', 'reviewer', 'researcher']));
    expect(out.answer!.abstain).toBeGreaterThanOrEqual(0);
  });

  it('(e) nonsense text does not produce a confident typesafe route', async () => {
    const router = new TypesafeRouter({ env: ON });
    const out = await applyTypesafeRouting({ task: 'xyzzy plugh' }, LEGACY, PATTERNS, router);
    // The engine really ran (not a load failure) and the gate rejected it.
    expect((out.typesafe as Record<string, unknown>).choice).toEqual(expect.any(String));
    expect(out.routedBy).not.toBe('typesafe');
    expect(out.primaryAgent).toEqual(LEGACY.primaryAgent);
  });

  // Since #3402 the keyword fallback matches whole words, so it no longer
  // routes "latest" to tester; the legacy pick is whatever the local router
  // returns now. What this test guards is the typesafe override itself.
  it('(e) hooks_route end to end: typesafe routes "sync and review latest issues" to researcher, legacy kept as fallback', async () => {
    process.env.CLAUDE_FLOW_ROUTER_TYPESAFE = '1';
    try {
      const { hooksRoute } = await import('../src/mcp-tools/hooks-tools.js');
      const res = await hooksRoute.handler({ task: 'sync and review latest issues', useSemanticRouter: false }) as Record<string, unknown>;
      expect(res.routedBy).toBe('typesafe');
      expect((res.primaryAgent as Record<string, unknown>).type).toBe('researcher');
      expect((res.primaryAgent as Record<string, unknown>).confidenceCalibrated).toBe(false);
      const fallback = res.fallbackRoute as Record<string, unknown>;
      expect(typeof fallback.agent).toBe('string');
      expect(fallback.agent).not.toBe('researcher');
    } finally {
      delete process.env.CLAUDE_FLOW_ROUTER_TYPESAFE;
    }
  });
});
