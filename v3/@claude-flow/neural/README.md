# @claude-flow/neural

[![npm version](https://img.shields.io/npm/v/@claude-flow/neural.svg)](https://www.npmjs.com/package/@claude-flow/neural)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/neural.svg)](https://www.npmjs.com/package/@claude-flow/neural)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

> Self-Optimizing Neural Architecture (SONA) for Claude Flow V3 — adaptive learning, trajectory tracking, pattern reuse, and 7 RL algorithms in a single package.

## What this is

A self-contained learning module that records agent execution trajectories, distills them into reusable patterns, retrieves matches for new tasks, and adapts via SONA + LoRA + EWC++. Designed to be the substrate that the Claude Flow CLI's intelligence layer composes onto — the package owns the algorithms, the CLI owns the orchestration.

## Install

```bash
npm install @claude-flow/neural
```

> **Note (2026-05-16):** `@claude-flow/neural@3.0.0-alpha.9+` pins
> `@ruvector/sona` to the exact known-good `0.1.5` because
> `@ruvector/sona@0.1.6` shipped as an empty publish (README +
> `package.json` only — no `index.js`, no native bins). Prior alpha.8
> used `"latest"` and broke on every fresh install. The pin will
> stay until `@ruvector/sona@0.1.7+` ships with content.

## Standalone use (without the Ruflo CLI)

```typescript
// route a task across 8 specialized experts (MoE) — no other deps
import { getMoERouter } from '@claude-flow/neural';

const router = getMoERouter();
await router.initialize();

const decision = await router.route(
  new Float32Array(384).fill(0.1),   // task embedding
  { task: 'optimize-query', complexity: 0.7 },
);
console.log(decision.expert, decision.confidence);
// → 'performance', 0.83  (or whichever expert wins)
```

## Quick start (recommended)

`NeuralLearningSystem` is the high-level entry point — it wires `SONAManager`, `ReasoningBank`, and `PatternLearner` together so callers don't have to:

```typescript
import { createNeuralLearningSystem } from '@claude-flow/neural';

const sys = createNeuralLearningSystem('balanced');
await sys.initialize();

// Track a task
const id = sys.beginTask('Refactor auth middleware', 'code');

// Record steps as the agent works (Float32Array embeddings)
sys.recordStep(id, 'analyzed-imports', 0.8, embedding1);
sys.recordStep(id, 'extracted-helpers',  0.9, embedding2);

// Complete — fires distillation + pattern extraction automatically
await sys.completeTask(id, /* qualityScore */ 0.85);

// Retrieve relevant memories for the next similar task
const memories = await sys.retrieveMemories(queryEmbedding, /* k */ 3);
const patterns = await sys.findPatterns(queryEmbedding, 3);

// Periodic learning sweep (consolidation + EWC)
await sys.triggerLearning();

console.log(sys.getStats());
// → { sona: NeuralStats, reasoningBank: { ... }, patternLearner: { ... } }
```

## Lower-level API: SONA Manager

For callers that want to manage trajectories and patterns directly:

```typescript
import { createSONAManager, type Trajectory } from '@claude-flow/neural';

const sona = createSONAManager('balanced');
await sona.initialize();

// domain ∈ 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general'
const trajectoryId = sona.beginTrajectory('code-review-task', 'code');

sona.recordStep(trajectoryId, 'analyze-code',     0.8, stateEmbedding);
sona.recordStep(trajectoryId, 'generate-feedback', 0.9, nextStateEmbedding);

const trajectory: Trajectory = sona.completeTrajectory(trajectoryId, 0.85);

// Query patterns
const matches = await sona.findSimilarPatterns(contextEmbedding, /* k */ 3);

// Trigger consolidation manually
await sona.triggerLearning('manual');
sona.consolidateEWC();
```

## Learning modes

| Mode | Adaptation | Quality | Memory | Use case |
|------|-----------:|--------:|-------:|----------|
| **real-time** | <0.5ms | 70%+ | 25 MB | Production, low-latency |
| **balanced** (default) | <18ms | 75%+ | 50 MB | General purpose |
| **research** | <100ms | 95%+ | 100 MB | Deep exploration |
| **edge** | <1ms | 80%+ | 5 MB | Resource-constrained |
| **batch** | <50ms | 85%+ | 75 MB | High-throughput |

```typescript
await sys.setMode('research'); // or directly: await sona.setMode('research')
```

## ReasoningBank + PatternLearner (separately accessible)

`NeuralLearningSystem` composes them; you can also use them standalone:

```typescript
import {
  createReasoningBank,
  createPatternLearner,
  createSONALearningEngine,
} from '@claude-flow/neural';

const bank = createReasoningBank();
await bank.storeTrajectory(trajectory);
await bank.judge(trajectory);
const distilled = await bank.distill(trajectory);

const learner = createPatternLearner();
learner.extractPattern(trajectory, distilled);
const matches = await learner.findMatches(queryEmbedding, 5);

const engine = createSONALearningEngine();
const adapted = await engine.adapt(input, /* domain */ 'code');
```

## RL algorithms (7 included)

Imports use the `Algorithm` suffix where applicable:

```typescript
import {
  PPOAlgorithm,         createPPO,         DEFAULT_PPO_CONFIG,
  A2CAlgorithm,         createA2C,         DEFAULT_A2C_CONFIG,
  DQNAlgorithm,         createDQN,         DEFAULT_DQN_CONFIG,
  QLearning,            createQLearning,   DEFAULT_QLEARNING_CONFIG,
  SARSAAlgorithm,       createSARSA,       DEFAULT_SARSA_CONFIG,
  DecisionTransformer,  createDecisionTransformer, DEFAULT_DT_CONFIG,
  CuriosityModule,      createCuriosity,   DEFAULT_CURIOSITY_CONFIG,
} from '@claude-flow/neural';

const ppo = createPPO({ learningRate: 0.0003, epsilon: 0.2, valueCoef: 0.5 });
const dqn = createDQN({ learningRate: 0.001, gamma: 0.99, epsilon: 0.1, targetUpdateFreq: 100 });

// Generic factory — pick algorithm by name
import { createAlgorithm, getDefaultConfig } from '@claude-flow/neural';
const algo = createAlgorithm('ppo', getDefaultConfig('ppo'));
```

## LoRA configuration

```typescript
const config = sona.getLoRAConfig();
// { rank: 4, alpha: 8, dropout: 0.05, targetModules: ['q_proj','v_proj','k_proj','o_proj'], microLoRA: false }

const weights = sona.initializeLoRAWeights('code-generation');
```

## EWC++ (Elastic Weight Consolidation)

Prevents catastrophic forgetting when adapting to new domains:

```typescript
const config = sona.getEWCConfig();
// { lambda: 2000, decay: 0.9, fisherSamples: 100, minFisher: 1e-8, online: true }

// After learning a new task, consolidate before moving on
sona.consolidateEWC();
```

## Event system

```typescript
sys.addEventListener((event) => {
  switch (event.type) {
    case 'trajectory_started':  console.log(`Started: ${event.trajectoryId}`); break;
    case 'trajectory_completed': console.log(`Quality: ${event.qualityScore}`); break;
    case 'pattern_matched':     console.log(`Pattern ${event.patternId} matched`); break;
    case 'learning_triggered':  console.log(`Learning: ${event.reason}`); break;
    case 'mode_changed':        console.log(`${event.fromMode} → ${event.toMode}`); break;
  }
});
```

## Performance targets

| Metric | Target | Typical |
|--------|--------|---------|
| Adaptation latency | <0.05 ms | 0.02 ms |
| Pattern retrieval | <1 ms | 0.5 ms |
| Learning step | <10 ms | 5 ms |
| Quality improvement | +55% | +40–60% |
| Memory overhead | <50 MB | 25–75 MB |

## TypeScript types

```typescript
import type {
  // Core
  SONAMode, SONAModeConfig, ModeOptimizations,
  Trajectory, TrajectoryStep, TrajectoryVerdict, DistilledMemory,
  Pattern, PatternMatch, PatternEvolution,

  // RL
  RLAlgorithm, RLConfig,
  PPOConfig, DQNConfig, A2CConfig, QLearningConfig, SARSAConfig,
  DecisionTransformerConfig, CuriosityConfig,

  // Neural
  LoRAConfig, LoRAWeights, EWCConfig, EWCState,
  NeuralStats, NeuralEvent, NeuralEventListener,
} from '@claude-flow/neural';
```

## Integration with `@claude-flow/cli`

The CLI's intelligence layer (`hooks_intelligence_*`, `neural_*` MCP tools, `/intelligence` dashboard) is the primary consumer. Phase 1 of the convergence (#1773) adds a thin bridge in `cli/src/memory/neural-package-bridge.ts` that lazy-loads `NeuralLearningSystem` so cli's intelligence handlers can call into the package surface alongside the existing local implementation. Future phases migrate cli's `LocalSonaCoordinator` and `LocalReasoningBank` to wrap this package's `SONALearningEngine` and `ReasoningBankAdapter`.

If you're building a Ruflo plugin that wants neural learning, depend on `@claude-flow/neural` directly rather than reaching into cli internals.

## Dependencies

- [`@claude-flow/memory`](../memory) — vector memory for patterns
- `@ruvector/sona` — SONA learning engine

## Related packages

- [`@claude-flow/memory`](../memory) — memory backend
- [`@claude-flow/cli`](../cli) — primary consumer + MCP tool surface
- [`@claude-flow/cli-core`](../cli-core) — lite path (no neural; for plugin scripts)

## License

MIT
