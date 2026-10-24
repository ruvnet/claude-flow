# @claude-flow/providers

[![npm version](https://img.shields.io/npm/v/@claude-flow/providers.svg)](https://www.npmjs.com/package/@claude-flow/providers)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/providers.svg)](https://www.npmjs.com/package/@claude-flow/providers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Providers](https://img.shields.io/badge/Providers-6+-orange.svg)](https://github.com/ruvnet/claude-flow)

> Multi-LLM Provider System for Claude Flow V3 - unified interface for Anthropic, OpenAI, Google, Cohere, Ollama, and RuVector with intelligent load balancing, automatic failover, and cost optimization.

## Features

- **6+ LLM Providers** - Anthropic, OpenAI, Google, Cohere, Ollama, RuVector
- **Load Balancing** - Round-robin, latency-based, least-loaded, cost-based strategies
- **Automatic Failover** - Seamless provider switching on failures
- **Request Caching** - LRU cache with configurable TTL
- **Cost Optimization** - Up to 85%+ savings with intelligent routing
- **Streaming Support** - Full streaming for all providers
- **Tool Calling** - Unified tool/function calling interface
- **Health Monitoring** - Real-time provider health checks
- **Cost Tracking** - Per-request and aggregate cost metrics

## Supported Providers & Models

### Anthropic (Claude)
- `claude-3-5-sonnet-20241022`, `claude-3-5-sonnet-latest`
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`

### OpenAI (GPT)
- `gpt-4o`, `gpt-4o-mini`
- `gpt-4-turbo`, `gpt-4`
- `gpt-3.5-turbo`
- `o1-preview`, `o1-mini`, `o3-mini`

### Google (Gemini)
- `gemini-2.0-flash`
- `gemini-1.5-pro`, `gemini-1.5-flash`
- `gemini-pro`

### Cohere
- `command-r-plus`, `command-r`
- `command-light`, `command`

### Ollama (Local)
- `llama3.2`, `llama3.1`
- `mistral`, `mixtral`
- `codellama`, `phi-4`
- `deepseek-coder`

### RuVector
- Custom models via @ruvector/ruvllm

## Installation

```bash
npm install @claude-flow/providers
```

## Quick Start

```typescript
import { createProviderManager } from '@claude-flow/providers';

// Create provider manager with multiple providers
const manager = await createProviderManager({
  providers: [
    {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-3-5-sonnet-latest',
    },
    {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o',
    },
  ],
  loadBalancing: {
    enabled: true,
    strategy: 'cost-based',
  },
  fallback: {
    enabled: true,
    maxAttempts: 2,
  },
  cache: {
    enabled: true,
    ttl: 300000,
    maxSize: 1000,
  },
});

// Make a completion request
const response = await manager.complete({
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ],
  maxTokens: 100,
});

console.log('Response:', response.content);
console.log('Provider:', response.provider);
console.log('Cost:', response.cost?.totalCost);
```

## API Reference

### ProviderManager

```typescript
import { ProviderManager, createProviderManager } from '@claude-flow/providers';

// Create and initialize
const manager = await createProviderManager(config);

// Or manually initialize
const manager = new ProviderManager(config);
await manager.initialize();
```

#### Methods

```typescript
// Complete a request
const response = await manager.complete(request, preferredProvider?);

// Stream completion
for await (const event of manager.streamComplete(request, preferredProvider?)) {
  if (event.type === 'content') {
    process.stdout.write(event.delta?.content || '');
  }
}

// Health check all providers
const health = await manager.healthCheck();
health.forEach((result, provider) => {
  console.log(`${provider}: ${result.healthy ? 'OK' : 'FAIL'}`);
});

// Estimate costs across providers
const estimates = await manager.estimateCost(request);
estimates.forEach((estimate, provider) => {
  console.log(`${provider}: $${estimate.estimatedCost.total.toFixed(4)}`);
});

// Get aggregated usage
const usage = await manager.getUsage('day');
console.log(`Total cost: $${usage.cost.total}`);

// Get provider metrics
const metrics = manager.getMetrics();
metrics.forEach((m, provider) => {
  console.log(`${provider}: ${m.latency}ms avg, ${m.errorRate * 100}% errors`);
});

// List available providers
const providers = manager.listProviders();

// Get specific provider
const anthropic = manager.getProvider('anthropic');

// Clear cache
manager.clearCache();

// Shutdown
manager.destroy();
```

### Individual Providers

```typescript
import {
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  CohereProvider,
  OllamaProvider,
  RuVectorProvider,
} from '@claude-flow/providers';

// Create provider directly
const anthropic = new AnthropicProvider({
  config: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-3-5-sonnet-latest',
    temperature: 0.7,
    maxTokens: 1000,
  },
});

await anthropic.initialize();

const response = await anthropic.complete({
  messages: [{ role: 'user', content: 'Hello!' }],
});

// Stream response
for await (const event of anthropic.streamComplete({
  messages: [{ role: 'user', content: 'Tell me a story' }],
})) {
  if (event.type === 'content') {
    process.stdout.write(event.delta?.content || '');
  }
}
```

### Load Balancing Strategies

```typescript
const manager = await createProviderManager({
  providers: [...],
  loadBalancing: {
    enabled: true,
    strategy: 'round-robin', // or 'least-loaded', 'latency-based', 'cost-based'
  },
});
```

| Strategy | Description | Best For |
|----------|-------------|----------|
| `round-robin` | Rotate through providers | Even distribution |
| `least-loaded` | Use provider with lowest load | High throughput |
| `latency-based` | Use fastest provider | Low latency |
| `cost-based` | Use cheapest provider | Cost optimization |

### Automatic Failover

```typescript
const manager = await createProviderManager({
  providers: [...],
  fallback: {
    enabled: true,
    maxAttempts: 3,  // Try up to 3 providers
  },
});

// Events for monitoring
manager.on('fallback_success', ({ originalProvider, fallbackProvider, attempts }) => {
  console.log(`Fallback from ${originalProvider} to ${fallbackProvider}`);
});

manager.on('fallback_exhausted', ({ originalProvider, attempts }) => {
  console.error(`All ${attempts} fallback attempts failed`);
});
```

### Request Caching

```typescript
const manager = await createProviderManager({
  providers: [...],
  cache: {
    enabled: true,
    ttl: 300000,     // 5 minutes
    maxSize: 1000,   // Max cached responses
  },
});

// Cache is keyed by: messages + model + temperature + maxTokens
// Identical requests return cached responses

// Clear cache when needed
manager.clearCache();
```

### Cost Optimization

```typescript
const manager = await createProviderManager({
  providers: [...],
  costOptimization: {
    enabled: true,
    maxCostPerRequest: 0.10,  // Max $0.10 per request
  },
});

// Request with cost constraints
const response = await manager.complete({
  messages: [...],
  costConstraints: {
    maxCost: 0.05,
    preferredModels: ['gpt-4o-mini', 'claude-3-haiku-20240307'],
  },
});

// Get cost breakdown
console.log('Cost:', {
  prompt: response.cost?.promptCost,
  completion: response.cost?.completionCost,
  total: response.cost?.totalCost,
  currency: response.cost?.currency,
});
```

### Tool Calling

```typescript
const response = await manager.complete({
  messages: [
    { role: 'user', content: 'What is the weather in San Francisco?' }
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['location'],
        },
      },
    },
  ],
  toolChoice: 'auto',
});

// Check for tool calls
if (response.toolCalls) {
  for (const call of response.toolCalls) {
    console.log('Tool:', call.function.name);
    console.log('Args:', JSON.parse(call.function.arguments));
  }
}
```

### Streaming

```typescript
// Async iterator streaming
for await (const event of manager.streamComplete(request)) {
  switch (event.type) {
    case 'content':
      process.stdout.write(event.delta?.content || '');
      break;
    case 'tool_call':
      console.log('Tool call:', event.delta?.toolCall);
      break;
    case 'error':
      console.error('Error:', event.error);
      break;
    case 'done':
      console.log('\nUsage:', event.usage);
      console.log('Cost:', event.cost);
      break;
  }
}
```

### Multimodal (Vision/Audio)

```typescript
// Image input (OpenAI, Anthropic, Google)
const response = await manager.complete({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', imageUrl: 'https://example.com/image.jpg' },
        // or imageBase64: 'base64-encoded-image'
      ],
    },
  ],
});
```

## TypeScript Types

```typescript
import type {
  // Provider types
  LLMProvider,
  LLMModel,
  LLMProviderConfig,
  ILLMProvider,
  ProviderCapabilities,

  // Message types
  LLMMessage,
  LLMContentPart,
  LLMToolCall,
  LLMTool,

  // Request/Response
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,

  // Manager types
  ProviderManagerConfig,
  LoadBalancingStrategy,

  // Status types
  HealthCheckResult,
  ProviderStatus,
  CostEstimate,
  UsageStats,

  // Error types
  LLMProviderError,
  RateLimitError,
  AuthenticationError,
  ModelNotFoundError,
  ProviderUnavailableError,
} from '@claude-flow/providers';
```

## Error Handling

```typescript
import {
  LLMProviderError,
  RateLimitError,
  AuthenticationError,
  isLLMProviderError,
  isRateLimitError,
} from '@claude-flow/providers';

try {
  const response = await manager.complete(request);
} catch (error) {
  if (isRateLimitError(error)) {
    console.log(`Rate limited. Retry after: ${error.retryAfter}ms`);
  } else if (isLLMProviderError(error)) {
    console.log(`Provider error: ${error.code}`);
    console.log(`Retryable: ${error.retryable}`);
  }
}
```

### Error Types

| Error | Code | HTTP | Retryable |
|-------|------|------|-----------|
| `RateLimitError` | `RATE_LIMIT` | 429 | Yes |
| `AuthenticationError` | `AUTHENTICATION` | 401 | No |
| `ModelNotFoundError` | `MODEL_NOT_FOUND` | 404 | No |
| `ProviderUnavailableError` | `PROVIDER_UNAVAILABLE` | 503 | Yes |

## Environment Variables

```bash
# API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
COHERE_API_KEY=...

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434

# Optional overrides
ANTHROPIC_BASE_URL=https://api.anthropic.com
OPENAI_BASE_URL=https://api.openai.com/v1
```

## Provider Configuration

### Anthropic

```typescript
{
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-5-sonnet-latest',
  temperature: 0.7,
  maxTokens: 4096,
  timeout: 60000,
  retryAttempts: 3,
}
```

### OpenAI

```typescript
{
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 4096,
  frequencyPenalty: 0,
  presencePenalty: 0,
}
```

### Google

```typescript
{
  provider: 'google',
  apiKey: process.env.GOOGLE_API_KEY!,
  model: 'gemini-1.5-pro',
  temperature: 0.7,
  maxTokens: 8192,
  topK: 40,
}
```

### Cohere

```typescript
{
  provider: 'cohere',
  apiKey: process.env.COHERE_API_KEY!,
  model: 'command-r-plus',
  temperature: 0.7,
  maxTokens: 4000,
}
```

### Ollama (Local)

```typescript
{
  provider: 'ollama',
  apiUrl: 'http://localhost:11434',
  model: 'llama3.2',
  temperature: 0.7,
  maxTokens: 4096,
}
```

## Performance

| Metric | Target |
|--------|--------|
| Provider initialization | <500ms |
| Request routing | <5ms |
| Cache lookup | <1ms |
| Health check | <2s |

## Integration with Claude Flow

```typescript
import { createProviderManager } from '@claude-flow/providers';
import { createUnifiedSwarmCoordinator } from '@claude-flow/swarm';

// Create provider manager
const providers = await createProviderManager({
  providers: [
    { provider: 'anthropic', apiKey: '...', model: 'claude-3-5-sonnet-latest' },
    { provider: 'openai', apiKey: '...', model: 'gpt-4o' },
  ],
  loadBalancing: { enabled: true, strategy: 'cost-based' },
});

// Use with swarm coordinator
const coordinator = createUnifiedSwarmCoordinator({
  // Agents can use provider manager for LLM calls
  extensions: {
    providers,
  },
});
```

## Related Packages

- [@claude-flow/embeddings](../embeddings) - Embedding generation
- [@claude-flow/memory](../memory) - Vector storage and retrieval
- [@claude-flow/swarm](../swarm) - Multi-agent coordination
- [@claude-flow/neural](../neural) - SONA learning integration

## License

MIT
