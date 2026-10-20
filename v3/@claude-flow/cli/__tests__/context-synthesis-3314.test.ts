import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setMemoryBridgeRegistryForTests,
  bridgeContextSynthesize,
} from '../src/memory/memory-bridge.js';

const originalDisable = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
const originalWindowsOptIn = process.env.CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS;

beforeEach(() => {
  delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  process.env.CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS = '1';
});

afterEach(() => {
  __setMemoryBridgeRegistryForTests(null);
  if (originalDisable === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = originalDisable;
  if (originalWindowsOptIn === undefined) delete process.env.CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS;
  else process.env.CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS = originalWindowsOptIn;
});

function installRegistry(recall: (...args: unknown[]) => unknown, native = false) {
  const synthesize = vi.fn((episodes: unknown[]) => ({ episodes }));
  const hierarchical = { recall, ...(native ? { promote: () => {} } : {}) };
  __setMemoryBridgeRegistryForTests({
    get: (name: string) => name === 'contextSynthesizer'
      ? { synthesize }
      : name === 'hierarchicalMemory' ? hierarchical : null,
  });
  return synthesize;
}

describe('#3314 context synthesis input contract', () => {
  it('passes only validated episodes from async tiered recall, preserving failure and zero reward', async () => {
    const recall = vi.fn(async () => [
      { key: 'success', value: JSON.stringify({ task: 'Fix auth', reward: 0.8, success: true, critique: 'Use PKCE for auth' }) },
      { key: 'failure', value: JSON.stringify({ task: 'Fix auth', reward: 0, success: false, critique: 'Use PKCE for auth' }) },
      { key: 'fact', value: 'OAuth is an authorization protocol' },
    ]);
    const synthesize = installRegistry(recall);

    const result = await bridgeContextSynthesize({ query: 'auth', maxEntries: 3 });

    expect(recall).toHaveBeenCalledWith('auth', 3);
    expect(synthesize).toHaveBeenCalledWith([
      { task: 'Fix auth', reward: 0.8, success: true, critique: 'Use PKCE for auth' },
      { task: 'Fix auth', reward: 0, success: false, critique: 'Use PKCE for auth' },
    ], { includeRecommendations: true });
    expect(result).toMatchObject({ success: true, recalled: 3, eligible: 2, skipped: 1 });
  });

  it('uses the native query-object recall contract and accepts explicitly structured metadata', async () => {
    const recall = vi.fn(async () => [
      { id: 'episode', metadata: { task: 'Repair cache', reward: 0.25, success: false, input: 'stale value', output: 'cache bypass' } },
    ]);
    const synthesize = installRegistry(recall, true);

    const result = await bridgeContextSynthesize({ query: 'cache', maxEntries: 5 });

    expect(recall).toHaveBeenCalledWith({ query: 'cache', k: 5 });
    expect(synthesize.mock.calls[0][0]).toEqual([
      { task: 'Repair cache', reward: 0.25, success: false, input: 'stale value', output: 'cache bypass' },
    ]);
    expect(result).toMatchObject({ success: true, recalled: 1, eligible: 1, skipped: 0 });
  });

  it('never treats prose, malformed JSON, inherited data, or wrong-typed outcomes as episodes', async () => {
    const inherited = Object.create({ task: 'Inherited task', reward: 1, success: true });
    inherited.key = 'inherited';
    const synthesize = installRegistry(() => [
      { key: 'fact', value: 'A plain factual memory' },
      { key: 'malformed', value: '{"task":' },
      { key: 'reward-string', value: '{"task":"t","reward":"1","success":true}' },
      { key: 'success-string', value: '{"task":"t","reward":0.5,"success":"true"}' },
      { key: 'bad-critique', value: '{"task":"t","reward":0.5,"success":true,"critique":[]}' },
      inherited,
    ]);

    const result = await bridgeContextSynthesize({ query: 'anything' });

    expect(synthesize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false, reason: 'no-eligible-episodes', recalled: 6, eligible: 0, skipped: 6,
    });
  });

  it('distinguishes no recalled memories from ineligible recalled facts', async () => {
    const synthesize = installRegistry(async () => []);

    const result = await bridgeContextSynthesize({ query: 'missing' });

    expect(synthesize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false, reason: 'no-memories', recalled: 0, eligible: 0, skipped: 0,
    });
  });

  it('reports controller failure after counting eligible and skipped rows', async () => {
    __setMemoryBridgeRegistryForTests({
      get: (name: string) => name === 'contextSynthesizer'
        ? { synthesize: () => { throw new Error('controller failed'); } }
        : name === 'hierarchicalMemory'
          ? { recall: () => [
            { value: '{"task":"t","reward":0.4,"success":false}' },
            { value: 'fact' },
          ] }
          : null,
    });

    const result = await bridgeContextSynthesize({ query: 't' });

    expect(result).toMatchObject({
      success: false, reason: 'synthesizer-failed', error: 'controller failed',
      recalled: 2, eligible: 1, skipped: 1,
    });
  });
});
