/**
 * ProviderManager.createProvider regression tests
 *
 * Locks in the openrouter/litellm/custom dispatch inside createProvider so a
 * future revert cannot re-introduce a generic "Unknown provider" failure.
 *
 * Run with: npx vitest run src/__tests__/provider-manager-vessels.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import {
  createProviderManager,
  ProviderManager,
} from '../provider-manager.js';
import type {
  LLMProviderConfig,
  ProviderManagerConfig,
  ILLMProvider,
} from '../types.js';

// Minimal network stub. During initialize() both the OpenAI and Anthropic
// health checks read only response.ok, so this keeps doInitialize/doComplete
// off the wire without over-mocking.
const okResponse = {
  ok: true,
  status: 200,
  json: async () => ({ data: [] }),
  text: async () => '[]',
} as unknown as Response;

beforeAll(() => {
  vi.stubGlobal('fetch', async () => okResponse);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('ProviderManager.createProvider dispatch', () => {
  it('createProviderManager accepts openrouter provider', async () => {
    const config: ProviderManagerConfig = {
      providers: [
        {
          provider: 'openrouter',
          apiUrl: 'https://openrouter.ai/api',
          apiKey: 'k',
          model: 'anthropic/claude-sonnet-4-6',
        },
      ],
    };

    const manager = await createProviderManager(config);

    expect(manager).toBeDefined();
    expect(manager.listProviders()).toContain('openrouter');

    manager.destroy();
  });

  it('openrouter maps to OpenAIProvider adapter', async () => {
    const config: ProviderManagerConfig = {
      providers: [
        {
          provider: 'openrouter',
          apiUrl: 'https://openrouter.ai/api',
          apiKey: 'k',
          model: 'anthropic/claude-sonnet-4-6',
        },
      ],
    };

    const manager = await createProviderManager(config);

    // Exactly one provider registered, reachable under the 'openrouter' key.
    expect(manager.listProviders()).toHaveLength(1);

    const provider = manager.getProvider('openrouter');
    expect(provider).toBeDefined();
    // OpenAIProvider.name is hardcoded to 'openai' — proves the OpenAI adapter
    // was selected for the openrouter key rather than throwing.
    expect(provider!.name).toBe('openai');

    manager.destroy();
  });

  it('litellm provider does not throw', async () => {
    const config: ProviderManagerConfig = {
      providers: [
        {
          provider: 'litellm',
          apiUrl: 'http://localhost:4000',
          apiKey: 'k',
          model: 'gpt-4',
        },
      ],
    };

    const manager = await createProviderManager(config);

    expect(manager.listProviders()).toContain('litellm');

    manager.destroy();
  });

  it('custom provider throws actionable error', () => {
    // createProvider is private and initialize() swallows its throw, so the
    // dispatch's failure path is exercised directly here.
    const manager = new ProviderManager({ providers: [] });
    const createProvider = (
      manager as unknown as { createProvider(config: LLMProviderConfig): ILLMProvider }
    ).createProvider.bind(manager);

    const customConfig: LLMProviderConfig = {
      provider: 'custom',
      apiUrl: 'https://x.com',
      apiKey: 'k',
      model: 'm',
    };

    let thrown: Error | undefined;
    try {
      createProvider(customConfig);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    // Actionable message names the provider and points at the 'shape' escape.
    expect(thrown!.message).toContain('custom');
    expect(thrown!.message).toContain('shape');
  });

  it('anthropic provider still works', async () => {
    const config: ProviderManagerConfig = {
      providers: [
        {
          provider: 'anthropic',
          apiKey: 'k',
          model: 'claude-sonnet-5',
        },
      ],
    };

    const manager = await createProviderManager(config);

    expect(manager.listProviders()).toContain('anthropic');
    expect(manager.getProvider('anthropic')).toBeDefined();

    manager.destroy();
  });
});
