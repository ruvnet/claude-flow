# SONA Integration Guide

Integration of `@ruvector/sona` package (v0.1.5) into the V3 Neural Module.

## Overview

The SONA (Self-Optimizing Neural Architecture) integration provides runtime-adaptive learning capabilities with sub-millisecond performance:

- **Learning Performance**: <0.05ms per trajectory (target)
- **Adaptation Performance**: <0.1ms per context
- **Memory Efficient**: LoRA-based (1-16 rank)
- **Platform Support**: WASM + Node.js (NAPI bindings)

## Installation

The package is already installed as a dependency:

```bash
npm install @ruvector/sona@0.1.5
```

## Quick Start

```typescript
import {
  createSONALearningEngine,
  type Trajectory,
  type Context,
} from '@claude-flow/neural';
import { getModeConfig } from '@claude-flow/neural';

// Create SONA engine with balanced mode
const modeConfig = getModeConfig('balanced');
const sona = createSONALearningEngine('balanced', modeConfig);

// Learn from a trajectory
const trajectory: Trajectory = {
  trajectoryId: 'traj-001',
  context: 'Implement authentication',
  domain: 'code',
  steps: [
    {
      stepId: 'step-1',
      timestamp: Date.now(),
      action: 'analyze requirements',
      stateBefore: new Float32Array(768).fill(0.1),
      stateAfter: new Float32Array(768).fill(0.2),
      reward: 0.8,
    },
    // ... more steps
  ],
  qualityScore: 0.88,
  isComplete: true,
  startTime: Date.now(),
};

await sona.learn(trajectory);
console.log(`Learning time: ${sona.getLearningTime()}ms`);

// Adapt to new context
const context: Context = {
  domain: 'code',
  queryEmbedding: new Float32Array(768).fill(0.15),
};

const adapted = await sona.adapt(context);
console.log(`Confidence: ${adapted.confidence}`);
console.log(`Suggested route: ${adapted.suggestedRoute}`);
```

## API Reference

### `SONALearningEngine`

Main class for SONA learning operations.

#### Constructor

```typescript
new SONALearningEngine(mode: SONAMode, modeConfig: SONAModeConfig)
```

- `mode`: Learning mode ('real-time' | 'balanced' | 'research' | 'edge' | 'batch')
- `modeConfig`: Configuration for the mode (from `getModeConfig()`)

#### Methods

##### `learn(trajectory: Trajectory): Promise<void>`

Learn from a completed trajectory.

**Performance target**: <0.05ms

```typescript
await sona.learn(trajectory);
```

##### `adapt(context: Context): Promise<AdaptedBehavior>`

Adapt behavior based on current context.

**Performance target**: <0.1ms

```typescript
const adapted = await sona.adapt({
  domain: 'code',
  queryEmbedding: embedding,
});
```

Returns:
- `transformedQuery`: Query after micro-LoRA transformation
- `patterns`: Similar learned patterns
- `suggestedRoute`: Recommended model/route
- `confidence`: Confidence score (0-1)

##### `getAdaptationTime(): number`

Get the last adaptation time in milliseconds.

```typescript
const timeMs = sona.getAdaptationTime();
```

##### `getLearningTime(): number`

Get the last learning time in milliseconds.

```typescript
const timeMs = sona.getLearningTime();
```

##### `resetLearning(): void`

Reset all learning state and create a fresh engine.

```typescript
sona.resetLearning();
```

##### `forceLearning(): string`

Force an immediate background learning cycle.

```typescript
const status = sona.forceLearning();
console.log(status);
```

##### `tick(): string | null`

Tick background learning (call periodically).

```typescript
const status = sona.tick();
if (status) console.log(status);
```

##### `getStats(): SONAStats`

Get engine statistics.

```typescript
const stats = sona.getStats();
console.log(`Trajectories: ${stats.totalTrajectories}`);
console.log(`Patterns: ${stats.patternsLearned}`);
console.log(`Avg Quality: ${stats.avgQuality}`);
```

##### `setEnabled(enabled: boolean): void`

Enable or disable the engine.

```typescript
sona.setEnabled(false); // Disable learning
```

##### `isEnabled(): boolean`

Check if engine is enabled.

```typescript
if (sona.isEnabled()) {
  // Learning is active
}
```

##### `findPatterns(queryEmbedding: Float32Array, k: number): JsLearnedPattern[]`

Find k similar learned patterns.

```typescript
const patterns = sona.findPatterns(embedding, 5);
patterns.forEach(p => {
  console.log(`Quality: ${p.avgQuality}, Cluster: ${p.clusterSize}`);
});
```

## Learning Modes

### Real-Time Mode

Optimized for minimum latency:
- **LoRA Rank**: 1 (micro-LoRA only)
- **Max Latency**: 0.05ms
- **Background Interval**: 1 minute
- **Use Case**: Interactive applications, chatbots

```typescript
const sona = createSONALearningEngine('real-time', getModeConfig('real-time'));
```

### Balanced Mode (Default)

Balanced performance and quality:
- **LoRA Rank**: 4
- **Max Latency**: 1ms
- **Background Interval**: 30 minutes
- **Use Case**: General purpose, CLI tools

```typescript
const sona = createSONALearningEngine('balanced', getModeConfig('balanced'));
```

### Research Mode

Maximum quality, slower:
- **LoRA Rank**: 16
- **Max Latency**: 10ms
- **Background Interval**: 1 hour
- **Use Case**: Research, analysis, high-quality generation

```typescript
const sona = createSONALearningEngine('research', getModeConfig('research'));
```

### Edge Mode

Optimized for resource-constrained devices:
- **LoRA Rank**: 1
- **Hidden Dim**: 384 (vs 768)
- **Memory Budget**: 50MB
- **Use Case**: Mobile, embedded systems

```typescript
const sona = createSONALearningEngine('edge', getModeConfig('edge'));
```

### Batch Mode

Optimized for batch processing:
- **LoRA Rank**: 8
- **Background Interval**: 2 hours
- **Batch Size**: 128
- **Use Case**: Offline training, batch jobs

```typescript
const sona = createSONALearningEngine('batch', getModeConfig('batch'));
```

## Types

### `Context`

```typescript
interface Context {
  domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general';
  queryEmbedding: Float32Array;
  metadata?: Record<string, unknown>;
}
```

### `AdaptedBehavior`

```typescript
interface AdaptedBehavior {
  transformedQuery: Float32Array;
  patterns: JsLearnedPattern[];
  suggestedRoute?: string;
  confidence: number;
}
```

### `SONAStats`

```typescript
interface SONAStats {
  totalTrajectories: number;
  patternsLearned: number;
  avgQuality: number;
  lastLearningMs: number;
  enabled: boolean;
}
```

### `JsLearnedPattern`

```typescript
interface JsLearnedPattern {
  id: string;
  centroid: number[];
  clusterSize: number;
  totalWeight: number;
  avgQuality: number;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
  patternType: string;
}
```

## Performance Characteristics

### Learning Performance

| Mode       | Avg Time | Target  | Memory  |
|------------|----------|---------|---------|
| Real-time  | ~0.03ms  | <0.05ms | 100MB   |
| Balanced   | ~0.04ms  | <0.05ms | 200MB   |
| Research   | ~0.08ms  | <0.10ms | 500MB   |
| Edge       | ~0.02ms  | <0.05ms | 50MB    |
| Batch      | ~0.05ms  | <0.10ms | 1GB     |

### Adaptation Performance

| Operation           | Time     |
|---------------------|----------|
| Micro-LoRA Apply    | ~0.01ms  |
| Pattern Search (k=5)| ~0.05ms  |
| Total Adaptation    | ~0.06ms  |

## Examples

See `/examples/sona-usage.ts` for comprehensive examples:

1. **Basic Learning**: Learn from trajectories
2. **Context Adaptation**: Adapt behavior to new contexts
3. **Pattern Discovery**: Discover and cluster patterns
4. **Performance Monitoring**: Benchmark learning performance

Run examples:

```bash
cd v3/@claude-flow/neural
npx tsx examples/sona-usage.ts
```

## Integration with V3 Neural Module

The SONA integration works seamlessly with other V3 neural components:

```typescript
import { createNeuralLearningSystem } from '@claude-flow/neural';

const system = createNeuralLearningSystem('balanced');
await system.initialize();

// SONA is used internally by the neural system
const taskId = system.beginTask('Implement feature X', 'code');

// Record steps...
system.recordStep(
  taskId,
  'analyze requirements',
  0.8,
  queryEmbedding
);

// Complete and trigger SONA learning
await system.completeTask(taskId, 0.9);
```

## Platform Support

SONA uses native bindings for optimal performance:

- **Linux**: x64, ARM64 (GNU, MUSL)
- **macOS**: x64, ARM64 (Universal binary)
- **Windows**: x64, ARM64 (MSVC)

Runtime selection is automatic based on platform.

## Advanced Usage

### Custom Configuration

```typescript
import { SonaEngine, type JsSonaConfig } from '@ruvector/sona';

const customConfig: JsSonaConfig = {
  hiddenDim: 512,
  embeddingDim: 512,
  microLoraRank: 2,
  baseLoraRank: 8,
  microLoraLr: 0.002,
  baseLoraLr: 0.0002,
  ewcLambda: 1000.0,
  patternClusters: 100,
  trajectoryCapacity: 20000,
  backgroundIntervalMs: 1800000,
  qualityThreshold: 0.6,
  enableSimd: true,
};

const engine = SonaEngine.withConfig(customConfig);
```

### Background Learning

SONA automatically runs background learning cycles:

```typescript
// Tick periodically (e.g., every second)
setInterval(() => {
  const status = sona.tick();
  if (status) {
    console.log('Background learning:', status);
  }
}, 1000);
```

Or force immediate learning:

```typescript
const status = sona.forceLearning();
console.log(status);
```

## Troubleshooting

### Learning is too slow

- Use `'real-time'` or `'edge'` mode
- Reduce `baseLoraRank` in config
- Enable SIMD optimizations (`enableSimd: true`)

### Memory usage too high

- Use `'edge'` mode
- Reduce `trajectoryCapacity`
- Reduce `patternClusters`
- Lower `hiddenDim` and `embeddingDim`

### Patterns not forming

- Increase `trajectoryCapacity`
- Lower `qualityThreshold`
- Increase `backgroundIntervalMs`
- Call `forceLearning()` manually

## References

- [SONA Package](https://www.npmjs.com/package/@ruvector/sona)
- [LoRA Paper](https://arxiv.org/abs/2106.09685)
- [EWC Paper](https://arxiv.org/abs/1612.00796)
- [V3 Neural Module](../README.md)

## License

SONA integration follows the same license as the V3 neural module.
