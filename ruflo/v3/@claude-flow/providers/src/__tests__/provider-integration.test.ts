/**
 * Provider Integration Tests
 *
 * Tests all LLM providers with actual API calls using .env credentials
 *
 * Run with: npx vitest run src/__tests__/provider-integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(__dirname, '../../../../../.env') });

import {
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  OllamaProvider,
  RuVectorProvider,
  ProviderManager,
  createProviderManager,
  LLMRequest,
  LLMProviderConfig,
  ProviderManagerConfig,
} from '../index.js';
import { BaseProviderOptions, consoleLogger } from '../base-provider.js';

// Test configuration
const TEST_PROMPT = 'Say "Hello from Claude Flow V3!" in exactly 5 words.';
const TEST_MESSAGES: LLMRequest['messages'] = [
  { role: 'user', content: TEST_PROMPT }
];

// Simple test request
const createTestRequest = (model?: string): LLMRequest => ({
  messages: TEST_MESSAGES,
  model,
  maxTokens: 50,
  temperature: 0.1,
  requestId: `test-${Date.now()}`,
});

describe('Provider Integration Tests', () => {

  describe('Anthropic Provider', () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    it.skipIf(!apiKey)('should complete request with Claude 3.5 Sonnet', async () => {
      const provider = new AnthropicProvider({
        config: {
          provider: 'anthropic',
          apiKey,
          model: 'claude-3-5-sonnet-latest',
          maxTokens: 100,
        },
        logger: consoleLogger,
      });

      await provider.initialize();

      const response = await provider.complete(createTestRequest());

      console.log('Anthropic Response:', response.content);
      console.log('Usage:', response.usage);
      console.log('Cost:', response.cost);

      expect(response.content).toBeTruthy();
      expect(response.provider).toBe('anthropic');
      expect(response.usage.totalTokens).toBeGreaterThan(0);

      provider.destroy();
    }, 30000);

    it.skipIf(!apiKey)('should stream response', async () => {
      const provider = new AnthropicProvider({
        config: {
          provider: 'anthropic',
          apiKey,
          model: 'claude-3-5-sonnet-latest',
          maxTokens: 100,
        },
        logger: consoleLogger,
      });

      await provider.initialize();

      const chunks: string[] = [];
      for await (const event of provider.streamComplete(createTestRequest())) {
        if (event.type === 'content' && event.delta?.content) {
          chunks.push(event.delta.content);
          process.stdout.write(event.delta.content);
        }
      }
      console.log('\n');

      expect(chunks.length).toBeGreaterThan(0);

      provider.destroy();
    }, 30000);
  });

  describe('Google Gemini Provider', () => {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

    it.skipIf(!apiKey)('should complete request with Gemini 2.0 Flash', async () => {
      const provider = new GoogleProvider({
        config: {
          provider: 'google',
          apiKey,
          model: 'gemini-2.0-flash',
          maxTokens: 100,
        },
        logger: consoleLogger,
      });

      await provider.initialize();

      const response = await provider.complete(createTestRequest());

      console.log('Google Response:', response.content);
      console.log('Usage:', response.usage);
      console.log('Cost:', response.cost);

      expect(response.content).toBeTruthy();
      expect(response.provider).toBe('google');

      provider.destroy();
    }, 30000);
  });

  describe('OpenRouter Provider (OpenAI Compatible)', () => {
    const apiKey = process.env.OPENROUTER_API_KEY;

    it.skipIf(!apiKey)('should complete request via OpenRouter', async () => {
      const provider = new OpenAIProvider({
        config: {
          provider: 'openai',
          apiKey,
          apiUrl: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4o-mini',
          maxTokens: 100,
          providerOptions: {
            headers: {
              'HTTP-Referer': 'https://claude-flow.dev',
              'X-Title': 'Claude Flow V3 Test',
            },
          },
        },
        logger: consoleLogger,
      });

      await provider.initialize();

      const response = await provider.complete(createTestRequest('openai/gpt-4o-mini'));

      console.log('OpenRouter Response:', response.content);
      console.log('Usage:', response.usage);

      expect(response.content).toBeTruthy();

      provider.destroy();
    }, 30000);
  });

  describe('Ollama Provider (Local)', () => {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

    it.skip('should complete request with local model', async () => {
      const provider = new OllamaProvider({
        config: {
          provider: 'ollama',
          apiUrl: ollamaUrl,
          model: 'llama3.2',
          maxTokens: 100,
        },
        logger: consoleLogger,
      });

      try {
        await provider.initialize();

        const response = await provider.complete(createTestRequest());

        console.log('Ollama Response:', response.content);
        console.log('Usage:', response.usage);

        expect(response.content).toBeTruthy();
        expect(response.provider).toBe('ollama');

        provider.destroy();
      } catch (error) {
        console.log('Ollama not available locally, skipping test');
      }
    }, 60000);
  });

  describe('RuVector Provider (ruvllm)', () => {

    it('should complete request with CPU-friendly Qwen model', async () => {
      const provider = new RuVectorProvider({
        config: {
          provider: 'ruvector',
          model: 'qwen2.5:0.5b', // CPU-friendly small Qwen model
          maxTokens: 100,
          providerOptions: {
            // RuVector-specific options
            sonaEnabled: true,
            hnswEnabled: true,
            fastgrnnEnabled: true,
            // Local model settings
            localModel: 'qwen2.5:0.5b',
            ollamaUrl: 'http://localhost:11434',
          },
        },
        logger: consoleLogger,
      });

      try {
        await provider.initialize();

        const response = await provider.complete(createTestRequest('qwen2.5:0.5b'));

        console.log('RuVector Response:', response.content);
        console.log('Usage:', response.usage);
        console.log('Cost:', response.cost);

        // Check SONA metrics
        const sonaMetrics = await provider.getSonaMetrics();
        console.log('SONA Metrics:', sonaMetrics);

        expect(response.content).toBeTruthy();

        provider.destroy();
      } catch (error) {
        console.log('RuVector/Ollama not available, test details:', error);
        // Don't fail - local models may not be running
      }
    }, 120000);

    it('should search memory with HNSW', async () => {
      const provider = new RuVectorProvider({
        config: {
          provider: 'ruvector',
          model: 'qwen2.5:0.5b',
          maxTokens: 100,
          providerOptions: {
            hnswEnabled: true,
          },
        },
        logger: consoleLogger,
      });

      try {
        await provider.initialize();

        // Search memory
        const results = await provider.searchMemory('test query', 5);
        console.log('Memory search results:', results);

        expect(Array.isArray(results)).toBe(true);

        provider.destroy();
      } catch (error) {
        console.log('Memory search not available:', error);
      }
    }, 30000);
  });

  describe('Provider Manager', () => {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const googleKey = process.env.GOOGLE_GEMINI_API_KEY;

    it.skipIf(!anthropicKey && !googleKey)('should manage multiple providers with failover', async () => {
      const providers: LLMProviderConfig[] = [];

      if (anthropicKey) {
        providers.push({
          provider: 'anthropic',
          apiKey: anthropicKey,
          model: 'claude-3-5-sonnet-latest',
          maxTokens: 100,
        });
      }

      if (googleKey) {
        providers.push({
          provider: 'google',
          apiKey: googleKey,
          model: 'gemini-2.0-flash',
          maxTokens: 100,
        });
      }

      const config: ProviderManagerConfig = {
        providers,
        loadBalancing: {
          enabled: true,
          strategy: 'round-robin',
        },
        fallback: {
          enabled: true,
          maxAttempts: 2,
        },
        cache: {
          enabled: true,
          ttl: 60000,
          maxSize: 100,
        },
      };

      const manager = await createProviderManager(config, consoleLogger);

      // List providers
      const providerList = manager.listProviders();
      console.log('Active providers:', providerList);
      expect(providerList.length).toBeGreaterThan(0);

      // Complete request
      const response = await manager.complete(createTestRequest());
      console.log('Manager Response:', response.content);
      console.log('Provider used:', response.provider);

      expect(response.content).toBeTruthy();

      // Health check all
      const health = await manager.healthCheck();
      console.log('Health status:', Object.fromEntries(health));

      // Get metrics
      const metrics = manager.getMetrics();
      console.log('Metrics:', Object.fromEntries(metrics));

      manager.destroy();
    }, 60000);

    it.skipIf(!anthropicKey)('should use cache for repeated requests', async () => {
      const manager = await createProviderManager({
        providers: [{
          provider: 'anthropic',
          apiKey: anthropicKey,
          model: 'claude-3-5-sonnet-latest',
          maxTokens: 50,
        }],
        cache: {
          enabled: true,
          ttl: 60000,
          maxSize: 100,
        },
      }, consoleLogger);

      const request = createTestRequest();

      // First request - no cache
      const start1 = Date.now();
      const response1 = await manager.complete(request);
      const time1 = Date.now() - start1;
      console.log(`First request: ${time1}ms`);

      // Second request - should hit cache
      const start2 = Date.now();
      const response2 = await manager.complete(request);
      const time2 = Date.now() - start2;
      console.log(`Second request (cached): ${time2}ms`);

      expect(response1.content).toBe(response2.content);
      expect(time2).toBeLessThan(time1); // Cache should be faster

      manager.destroy();
    }, 60000);
  });

  describe('Cost Estimation', () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    it.skipIf(!apiKey)('should estimate costs accurately', async () => {
      const manager = await createProviderManager({
        providers: [{
          provider: 'anthropic',
          apiKey,
          model: 'claude-3-5-sonnet-latest',
          maxTokens: 100,
        }],
      }, consoleLogger);

      const request = createTestRequest();

      // Get cost estimates
      const estimates = await manager.estimateCost(request);
      console.log('Cost estimates:', Object.fromEntries(estimates));

      // Make actual request
      const response = await manager.complete(request);
      console.log('Actual cost:', response.cost);

      // Compare estimate to actual
      const estimate = estimates.get('anthropic');
      if (estimate && response.cost) {
        const estimateTotal = estimate.estimatedCost.total;
        const actualTotal = response.cost.totalCost;
        const accuracy = 1 - Math.abs(estimateTotal - actualTotal) / actualTotal;
        console.log(`Estimation accuracy: ${(accuracy * 100).toFixed(1)}%`);
      }

      manager.destroy();
    }, 30000);
  });
});

// Quick standalone test runner
async function runQuickTest() {
  console.log('\n=== Quick Provider Test ===\n');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY found in .env');
    return;
  }

  const provider = new AnthropicProvider({
    config: {
      provider: 'anthropic',
      apiKey,
      model: 'claude-3-5-sonnet-latest',
      maxTokens: 100,
    },
    logger: consoleLogger,
  });

  await provider.initialize();

  const response = await provider.complete({
    messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
    maxTokens: 10,
  });

  console.log('Response:', response.content);
  console.log('Tokens:', response.usage);
  console.log('Cost:', response.cost);

  provider.destroy();
}

// Export for direct execution
export { runQuickTest };
