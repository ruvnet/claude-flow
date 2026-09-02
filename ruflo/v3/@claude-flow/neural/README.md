# @claude-flow/neural

[![npm version](https://img.shields.io/npm/v/@claude-flow/neural.svg)](https://www.npmjs.com/package/@claude-flow/neural)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/neural.svg)](https://www.npmjs.com/package/@claude-flow/neural)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![AI Learning](https://img.shields.io/badge/AI-Self--Learning-purple.svg)](https://github.com/ruvnet/claude-flow)

> Self-Optimizing Neural Architecture (SONA) module for Claude Flow V3 - adaptive learning, trajectory tracking, and pattern-based optimization.

## Features

- **SONA Learning** - Self-Optimizing Neural Architecture with <0.05ms adaptation time
- **5 Learning Modes** - Real-time, Balanced, Research, Edge, and Batch modes
- **9 RL Algorithms** - PPO, A2C, DQN, Q-Learning, SARSA, Decision Transformer, and more
- **LoRA Integration** - Low-Rank Adaptation for efficient fine-tuning
- **EWC++ Memory** - Elastic Weight Consolidation for continual learning without forgetting
- **Trajectory Tracking** - Record and learn from agent execution paths
- **Pattern Recognition** - Automatic pattern extraction and reuse

## Installation

```bash
npm install @claude-flow/neural
```

## Quick Start

```typescript
import { SONAManager, createSONAManager } from '@claude-flow/neural';

// Create SONA manager
const sona = createSONAManager('balanced');
await sona.initialize();

// Begin trajectory tracking
const trajectoryId = sona.beginTrajectory('code-review-task', 'development');

// Record steps
sona.recordStep(trajectoryId, 'analyze-code', 0.8, stateEmbedding, {
  filesAnalyzed: 5,
  issuesFound: 2
});

sona.recordStep(trajectoryId, 'generate-feedback', 0.9, newStateEmbedding);

// Complete trajectory
const trajectory = sona.completeTrajectory(trajectoryId);

// Find similar patterns for guidance
const patterns = await sona.findSimilarPatterns(contextEmbedding, 3);
```

## Learning Modes

| Mode | Adaptation | Quality | Memory | Use Case |
|------|------------|---------|--------|----------|
| **real-time** | <0.5ms | 70%+ | 25MB | Production, low-latency |
| **balanced** | <18ms | 75%+ | 50MB | General purpose |
| **research** | <100ms | 95%+ | 100MB | Deep exploration |
| **edge** | <1ms | 80%+ | 5MB | Resource-constrained |
| **batch** | <50ms | 85%+ | 75MB | High-throughput |

```typescript
// Switch modes dynamically
await sona.setMode('research');

// Get current configuration
const { mode, config, optimizations } = sona.getConfig();
```

## API Reference

### SONA Manager

```typescript
import { SONAManager } from '@claude-flow/neural';

const sona = new SONAManager('balanced');
await sona.initialize();

// Trajectory Management
const trajectoryId = sona.beginTrajectory(context, domain);
sona.recordStep(trajectoryId, action, reward, stateEmbedding, metadata);
const trajectory = sona.completeTrajectory(trajectoryId, finalQuality);

// Pattern Matching
const patterns = await sona.findSimilarPatterns(embedding, k);
const pattern = sona.storePattern({ name, strategy, embedding, domain });
sona.updatePatternUsage(patternId, quality);

// Learning
await sona.triggerLearning('manual');
const output = await sona.applyAdaptations(input, domain);

// Statistics
const stats = sona.getStats();
```

### RL Algorithms

```typescript
import { PPO, A2C, DQN, QLearning, SARSA, DecisionTransformer } from '@claude-flow/neural';

// Proximal Policy Optimization
const ppo = new PPO({
  learningRate: 0.0003,
  epsilon: 0.2,
  valueCoef: 0.5
});

// Advantage Actor-Critic
const a2c = new A2C({
  learningRate: 0.001,
  gamma: 0.99,
  entropyCoef: 0.01
});

// Deep Q-Network
const dqn = new DQN({
  learningRate: 0.001,
  gamma: 0.99,
  epsilon: 0.1,
  targetUpdateFreq: 100
});

// Decision Transformer
const dt = new DecisionTransformer({
  contextLength: 20,
  embeddingDim: 256,
  numHeads: 4
});
```

### LoRA Configuration

```typescript
// Get LoRA config for current mode
const loraConfig = sona.getLoRAConfig();
// {
//   rank: 4,
//   alpha: 8,
//   dropout: 0.05,
//   targetModules: ['q_proj', 'v_proj', 'k_proj', 'o_proj'],
//   microLoRA: false
// }

// Initialize LoRA weights for a domain
const weights = sona.initializeLoRAWeights('code-generation');
```

### EWC++ (Elastic Weight Consolidation)

```typescript
// Get EWC config
const ewcConfig = sona.getEWCConfig();
// {
//   lambda: 2000,
//   decay: 0.9,
//   fisherSamples: 100,
//   minFisher: 1e-8,
//   online: true
// }

// Consolidate after learning a new task
sona.consolidateEWC();
```

### Event System

```typescript
// Subscribe to neural events
sona.addEventListener((event) => {
  switch (event.type) {
    case 'trajectory_started':
      console.log(`Started: ${event.trajectoryId}`);
      break;
    case 'trajectory_completed':
      console.log(`Completed with quality: ${event.qualityScore}`);
      break;
    case 'pattern_matched':
      console.log(`Pattern ${event.patternId} matched`);
      break;
    case 'learning_triggered':
      console.log(`Learning: ${event.reason}`);
      break;
    case 'mode_changed':
      console.log(`Mode: ${event.fromMode} -> ${event.toMode}`);
      break;
  }
});
```

## Mode Configurations

```typescript
// Real-time mode (ultra-fast)
{
  loraRank: 2,
  learningRate: 0.001,
  batchSize: 32,
  trajectoryCapacity: 1000,
  qualityThreshold: 0.7,
  maxLatencyMs: 0.5
}

// Research mode (high quality)
{
  loraRank: 16,
  learningRate: 0.002,
  batchSize: 64,
  trajectoryCapacity: 10000,
  qualityThreshold: 0.2,
  maxLatencyMs: 100
}
```

## Performance Targets

| Metric | Target | Typical |
|--------|--------|---------|
| Adaptation latency | <0.05ms | 0.02ms |
| Pattern retrieval | <1ms | 0.5ms |
| Learning step | <10ms | 5ms |
| Quality improvement | +55% | +40-60% |
| Memory overhead | <50MB | 25-75MB |

## TypeScript Types

```typescript
import type {
  SONAMode,
  SONAModeConfig,
  Trajectory,
  TrajectoryStep,
  Pattern,
  PatternMatch,
  NeuralStats,
  NeuralEvent,
  LoRAConfig,
  LoRAWeights,
  EWCConfig,
  RLAlgorithm
} from '@claude-flow/neural';
```

## Dependencies

- [@claude-flow/memory](../memory) - Memory integration
- `@ruvector/sona` - SONA learning engine

## Related Packages

- [@claude-flow/memory](../memory) - Vector memory for patterns
- [@claude-flow/integration](../integration) - agentic-flow integration
- [@claude-flow/performance](../performance) - Benchmarking

## License

MIT
