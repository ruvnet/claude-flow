/**
 * #3567 — hooks_route reported its highest confidence (0.7) exactly when
 * nothing matched: blank, punctuation-only and non-English tasks all came back
 * `coder` at 70%, above a correctly routed "deploy the release to production"
 * (62%). A no-match result must rank below every real match and say so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep hooks_route on the local path: the AgentDB pre-route answers "nothing".
vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeRouteTask: vi.fn(async () => null) }));

import {
  NO_MATCH_CONFIDENCE,
  hooksExplain,
  hooksRoute,
  resetSemanticRouterForTests,
  suggestAgentsForTask,
} from '../src/mcp-tools/hooks-tools.js';
import { clearRouterEmbedderCache } from '../src/ruvector/router-embedder.js';

const DEPLOY_CONFIDENCE_OBSERVED = 0.62; // Martin's measurement for the correctly routed deploy task
const NO_MATCH_TASKS = ['   ', '...', '修复登录崩溃'];

type RouteOut = {
  matched?: boolean;
  reason?: string;
  note?: string;
  matchedPattern: string;
  primaryAgent: { type: string; confidence: number; reason: string };
  alternativeAgents: Array<{ confidence: number }>;
  estimatedMetrics: { successProbability: number | null };
};
const route = (task: string) => hooksRoute.handler({ task }) as Promise<RouteOut>;

const ENV_KEYS = ['CLAUDE_FLOW_ROUTER_EMBEDDER', 'CLAUDE_FLOW_DISABLE_NATIVE_ROUTER', 'CLAUDE_FLOW_ROUTER_TYPESAFE'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CLAUDE_FLOW_DISABLE_NATIVE_ROUTER = '1';
  process.env.CLAUDE_FLOW_ROUTER_EMBEDDER = 'hash';
  delete process.env.CLAUDE_FLOW_ROUTER_TYPESAFE;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  clearRouterEmbedderCache();
  resetSemanticRouterForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('#3567 suggestAgentsForTask no-match default', () => {
  it.each(NO_MATCH_TASKS)('%j is an explicit no-match below every real match', (task) => {
    const r = suggestAgentsForTask(task);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-match-default');
    expect(r.confidence).toBe(NO_MATCH_CONFIDENCE);
    expect(r.confidence).toBeLessThan(DEPLOY_CONFIDENCE_OBSERVED);
    expect(r.agents.length).toBeGreaterThan(0); // callers keep a default list
  });

  it('says why a non-English task did not match', () => {
    expect(suggestAgentsForTask('修复登录崩溃').note).toMatch(/English-only/);
  });

  it('says why a task with no words did not match', () => {
    expect(suggestAgentsForTask('   ').note).toMatch(/no words/);
    expect(suggestAgentsForTask('...').note).toMatch(/no words/);
  });

  it.each([
    ['deploy the release to production', 'devops', 0.85],
    ['fix the crash on startup', 'coder', 0.85],
    ['write unit tests for the parser', 'tester', 0.95],
  ])('real match %j is unchanged (%s @ %s)', (task, agent, confidence) => {
    const r = suggestAgentsForTask(task);
    expect(r.matched).toBe(true);
    expect(r.agents[0]).toBe(agent);
    expect(r.confidence).toBe(confidence);
    expect(r.confidence).toBeGreaterThan(NO_MATCH_CONFIDENCE);
  });
});

describe('#3567 hooks_route surfaces the no-match marker', () => {
  it.each(NO_MATCH_TASKS)('%j routes as no-match with a low confidence', async (task) => {
    const r = await route(task);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-match-default');
    expect(r.matchedPattern).toBe('no-match-default');
    expect(r.primaryAgent.confidence).toBeLessThan(DEPLOY_CONFIDENCE_OBSERVED);
    expect(r.primaryAgent.reason).toMatch(/Nothing matched/);
    expect(r.estimatedMetrics.successProbability).toBeNull();
    for (const alt of r.alternativeAgents) expect(alt.confidence).toBeGreaterThanOrEqual(0);
  });

  it('a real task still routes as a match above the no-match confidence', async () => {
    const r = await route('deploy the release to production');
    expect(r.matched).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.primaryAgent.confidence).toBeGreaterThan(NO_MATCH_CONFIDENCE);
    expect(r.estimatedMetrics.successProbability).not.toBeNull();
  });

  it('a blank task outranks nothing: it scores below a correctly routed task', async () => {
    const blank = await route('   ');
    const deploy = await route('deploy the release to production');
    expect(blank.primaryAgent.confidence).toBeLessThan(deploy.primaryAgent.confidence);
  });
});

describe('#3567 hooks_explain does not explain a match that did not happen', () => {
  it('reports no-match for a blank task', async () => {
    const r = (await hooksExplain.handler({ task: '   ' })) as {
      matched: boolean;
      reason?: string;
      explanation: string;
      decision: { confidence: number; reasoning: string[] };
    };
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-match-default');
    expect(r.explanation).not.toMatch(/contains keywords that match/);
    expect(r.decision.reasoning.join(' ')).not.toMatch(/threshold met/);
    expect(r.decision.confidence).toBe(NO_MATCH_CONFIDENCE);
  });
});
