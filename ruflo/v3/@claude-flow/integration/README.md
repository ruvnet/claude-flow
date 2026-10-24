# @claude-flow/integration

[![npm version](https://img.shields.io/npm/v/@claude-flow/integration.svg)](https://www.npmjs.com/package/@claude-flow/integration)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/integration.svg)](https://www.npmjs.com/package/@claude-flow/integration)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![ADR-001](https://img.shields.io/badge/ADR--001-Compliant-green.svg)](https://github.com/ruvnet/claude-flow)

> Deep agentic-flow@alpha integration module for Claude Flow V3 - ADR-001 compliance, code deduplication, SONA adapter, and Flash Attention coordinator.

## Features

- **ADR-001 Compliance** - Eliminates 10,000+ duplicate lines by building on agentic-flow
- **SONA Adapter** - Seamless integration with SONA learning systems
- **Flash Attention** - 2.49x-7.47x speedup with attention coordination
- **SDK Bridge** - Version negotiation and API compatibility layer
- **Feature Flags** - Dynamic feature enabling/disabling
- **Runtime Detection** - Auto-select optimal runtime (NAPI, WASM, JS)
- **Graceful Fallback** - Works with or without agentic-flow installed

## Installation

```bash
npm install @claude-flow/integration

# Optional: Install agentic-flow for optimal performance
npm install agentic-flow@alpha
```

## Quick Start

```typescript
import { AgenticFlowBridge, createAgenticFlowBridge } from '@claude-flow/integration';

// Create and initialize bridge
const bridge = await createAgenticFlowBridge({
  features: {
    enableSONA: true,
    enableFlashAttention: true,
    enableAgentDB: true
  }
});

// Check if agentic-flow is connected
if (bridge.isAgenticFlowConnected()) {
  console.log('Using optimized agentic-flow implementation');
} else {
  console.log('Using local fallback implementation');
}

// Get SONA adapter
const sona = await bridge.getSONAAdapter();
await sona.setMode('balanced');

// Get Attention coordinator
const attention = await bridge.getAttentionCoordinator();
const result = await attention.compute({ query, key, value });
```

## API Reference

### AgenticFlowBridge

```typescript
import { AgenticFlowBridge } from '@claude-flow/integration';

const bridge = new AgenticFlowBridge({
  sona: {
    mode: 'balanced',
    learningRate: 0.001,
    similarityThreshold: 0.7
  },
  attention: {
    mechanism: 'flash',
    numHeads: 8,
    flashOptLevel: 2
  },
  agentdb: {
    dimension: 1536,
    indexType: 'hnsw',
    metric: 'cosine'
  },
  features: {
    enableSONA: true,
    enableFlashAttention: true,
    enableAgentDB: true
  },
  runtimePreference: ['napi', 'wasm', 'js'],
  lazyLoad: true,
  debug: false
});

await bridge.initialize();

// Component access
const sona = await bridge.getSONAAdapter();
const attention = await bridge.getAttentionCoordinator();
const sdk = await bridge.getSDKBridge();

// Feature management
bridge.isFeatureEnabled('enableSONA');
await bridge.enableFeature('enableFlashAttention');
await bridge.disableFeature('enableAgentDB');

// Health & status
const status = bridge.getStatus();
const health = await bridge.healthCheck();
const flags = bridge.getFeatureFlags();

// Direct agentic-flow access (when available)
const core = bridge.getAgenticFlowCore();
if (core) {
  const patterns = await core.sona.findPatterns(query);
}

// Cleanup
await bridge.shutdown();
```

### SONA Adapter

```typescript
const sona = await bridge.getSONAAdapter();

// Mode management
await sona.setMode('real-time');  // 'real-time' | 'balanced' | 'research' | 'edge' | 'batch'

// Pattern operations
const patternId = await sona.storePattern({
  context: 'code-review',
  strategy: 'analyze-then-comment',
  embedding: vector
});

const patterns = await sona.findPatterns(queryEmbedding, {
  limit: 5,
  threshold: 0.7
});

// Statistics
const stats = await sona.getStats();
```

### Attention Coordinator

```typescript
const attention = await bridge.getAttentionCoordinator();

// Set attention mechanism
await attention.setMechanism('flash');  // 'flash' | 'standard' | 'linear'

// Compute attention
const result = await attention.compute({
  query: queryTensor,
  key: keyTensor,
  value: valueTensor,
  mask: optionalMask
});

// Get metrics
const metrics = await attention.getMetrics();
// { avgLatencyMs, speedupRatio, memoryUsage }
```

### SDK Bridge

```typescript
const sdk = await bridge.getSDKBridge();

// Version negotiation
const version = sdk.getVersion();
const isCompatible = sdk.isCompatible('0.1.0');

// Health check
await sdk.ping();
```

## Feature Flags

```typescript
const flags = bridge.getFeatureFlags();

{
  enableSONA: true,              // SONA learning integration
  enableFlashAttention: true,    // Flash Attention optimization
  enableAgentDB: true,           // AgentDB vector storage
  enableTrajectoryTracking: true,// Trajectory recording
  enableGNN: true,               // Graph Neural Network
  enableIntelligenceBridge: true,// Intelligence bridge
  enableQUICTransport: false,    // QUIC transport (experimental)
  enableNightlyLearning: false,  // Background learning
  enableAutoConsolidation: true  // Auto memory consolidation
}
```

## Runtime Detection

The bridge automatically selects the best runtime:

| Runtime | Performance | Requirements |
|---------|-------------|--------------|
| **NAPI** | Optimal | Native bindings, non-Windows or x64 |
| **WASM** | Good | WebAssembly support |
| **JS** | Fallback | Always available |

```typescript
const status = bridge.getStatus();
console.log(status.runtime);
// { runtime: 'napi', platform: 'linux', arch: 'x64', performanceTier: 'optimal' }
```

## Event System

```typescript
bridge.on('initialized', ({ duration, components, agenticFlowConnected }) => {
  console.log(`Initialized in ${duration}ms`);
});

bridge.on('agentic-flow:connected', ({ version, features }) => {
  console.log(`Connected to agentic-flow ${version}`);
});

bridge.on('agentic-flow:fallback', ({ reason }) => {
  console.log(`Using fallback: ${reason}`);
});

bridge.on('feature-enabled', ({ feature }) => {
  console.log(`Enabled: ${feature}`);
});

bridge.on('health-check', ({ results }) => {
  console.log(`Health: ${JSON.stringify(results)}`);
});
```

## Performance Targets

| Metric | Target |
|--------|--------|
| Flash Attention speedup | 2.49x-7.47x |
| AgentDB search | 150x-12,500x faster |
| SONA adaptation | <0.05ms |
| Memory reduction | 50-75% |

## TypeScript Types

```typescript
import type {
  IntegrationConfig,
  IntegrationStatus,
  RuntimeInfo,
  ComponentHealth,
  FeatureFlags,
  AgenticFlowCore
} from '@claude-flow/integration';
```

## Peer Dependencies

- `agentic-flow@^0.1.0` (optional, for optimal performance)

## Related Packages

- [@claude-flow/neural](../neural) - SONA learning module
- [@claude-flow/memory](../memory) - AgentDB memory
- [@claude-flow/performance](../performance) - Benchmarking

## License

MIT
