# Claude-Flow v3 SDK Architecture Analysis

## Deep Review: agentic-flow@alpha + ruvector Ecosystem

This document provides a comprehensive analysis of using `agentic-flow@2.0.1-alpha.50` as the SDK foundation for Claude-Flow v3, including additional capabilities from the ruvector ecosystem.

---

## 1. Executive Summary

### Key Findings

**agentic-flow@alpha provides a complete, production-ready SDK** that wraps and fixes the raw @ruvector/* alpha packages. Claude-Flow v3 should use agentic-flow as its primary SDK rather than importing @ruvector/* packages directly.

| Aspect | agentic-flow@alpha | Raw @ruvector/* |
|--------|-------------------|------------------|
| Stability | Production wrappers | Alpha APIs (broken) |
| Performance | 11-200x improvements | Variable |
| Cross-platform | Linux/macOS/Windows | NAPI failures on some |
| Integration | Unified API | Fragmented |
| Learning | 9 RL algorithms | Manual SONA only |

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude-Flow v3                               │
├─────────────────────────────────────────────────────────────────┤
│  Thin Integration Layer (~500 lines)                            │
│  - Hook event mapping                                           │
│  - Configuration bridge                                         │
│  - CLI commands                                                 │
├─────────────────────────────────────────────────────────────────┤
│               agentic-flow@alpha SDK                            │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐     │
│  │   Hooks     │  Learning   │   Swarm     │Intelligence │     │
│  │  (19 tools) │  (9 algos)  │   (QUIC)    │   (Store)   │     │
│  └─────────────┴─────────────┴─────────────┴─────────────┘     │
├─────────────────────────────────────────────────────────────────┤
│               Production Wrappers (core/)                       │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐     │
│  │ GNN Wrapper │ AgentDB Fast│ Attention   │ Embedding   │     │
│  │  (11-22x)   │  (50-200x)  │  (Native)   │  (ONNX)     │     │
│  └─────────────┴─────────────┴─────────────┴─────────────┘     │
├─────────────────────────────────────────────────────────────────┤
│                @ruvector/* Packages (underlying)                │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐     │
│  │  ruvector   │ @ruvector/  │ @ruvector/  │ @ruvector/  │     │
│  │   core      │    sona     │  attention  │     gnn     │     │
│  └─────────────┴─────────────┴─────────────┴─────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Package Ecosystem Overview

### 2.1 ruvector@0.1.95 (Core Package)

The base package providing high-performance vector operations with native Rust bindings.

**Dependencies:**
```json
{
  "@ruvector/core": "^0.1.30",      // Native Rust HNSW (150x faster)
  "@ruvector/sona": "^0.1.5",       // SONA continual learning
  "@ruvector/attention": "^0.1.3", // Attention mechanisms
  "@ruvector/gnn": "^0.1.22"       // Graph Neural Networks
}
```

**Key Exports:**
- `IntelligenceEngine` - Full-stack learning (VectorDB + SONA + AgentDB + Attention)
- `LearningEngine` - SONA + Micro-LoRA integration
- `TensorCompress` - Tiered compression (50-97% memory savings)
- `ParallelIntelligence` - Worker pool parallelization
- `OnnxEmbedder` - ONNX runtime embeddings

### 2.2 @ruvector/core@0.1.30

Native Rust bindings via NAPI with WASM fallback.

**Capabilities:**
- HNSW indexing (150x faster than brute force)
- 4 distance metrics: cosine, euclidean, manhattan, dot
- Memory-mapped storage for large datasets
- Quantization support (4-32x memory reduction)

**Platform Support:**
| Platform | Method | Status |
|----------|--------|--------|
| Linux x64 | NAPI | ✅ Primary |
| macOS x64/ARM | NAPI | ✅ Universal |
| Windows x64 | WASM | ✅ Fallback |

### 2.3 @ruvector/sona@0.1.5

SONA (Self-Organizing Neural Architecture) continual learning system.

**Performance:**
- Micro-LoRA adaptation: ~0.05ms (rank 2)
- Base LoRA updates: ~0.45ms (rank 16)
- Decision throughput: 761 decisions/second
- Memory per adaptation: ~12KB

**Features:**
- EWC++ (Elastic Weight Consolidation)
- Trajectory tracking
- Pattern clustering
- Automatic learning cycle management

### 2.4 @ruvector/attention@0.1.3

Multiple attention mechanism implementations.

**Available Mechanisms:**
| Mechanism | Latency | Use Case |
|-----------|---------|----------|
| Flash Attention | 0.7ms | Real-time, memory efficient |
| Multi-Head | 1.2ms | General purpose |
| Linear | 0.3ms | Long sequences |
| Hyperbolic | 2.1ms | Hierarchical data |
| MoE (Mixture of Experts) | 1.8ms | Expert routing |
| Graph (GraphRoPE) | 5.4ms | Topology-aware |

### 2.5 @ruvector/gnn@0.1.22

Graph Neural Network operations.

**Features:**
- Differentiable search layers
- Hierarchical forward passes
- TensorCompress integration
- Float32Array auto-conversion

---

## 3. agentic-flow@alpha SDK Structure

### 3.1 Package Organization

```
agentic-flow/dist/
├── core/                     # Production wrappers
│   ├── index.js              # Unified exports
│   ├── gnn-wrapper.js        # GNN with 11-22x speedup
│   ├── agentdb-fast.js       # 50-200x faster AgentDB
│   ├── attention-native.js   # Fixed Rust attention
│   ├── attention-fallbacks.js# JS fallbacks
│   └── embedding-service.js  # Multi-provider embeddings
│
├── mcp/                      # MCP Tools
│   └── fastmcp/tools/hooks/
│       ├── index.js          # 19 hook tools export
│       ├── pre-edit.js       # Pre-edit validation
│       ├── post-edit.js      # Post-edit learning
│       ├── route.js          # Intelligent routing
│       ├── pretrain.js       # Pattern pretraining
│       └── intelligence-*.js # RuVector integration
│
├── reasoningbank/            # Memory system
│   ├── index.js              # Hybrid backend
│   ├── HybridBackend.js      # AgentDB + SQLite
│   └── core/                 # Retrieve, judge, distill
│
├── swarm/                    # Swarm coordination
│   ├── index.js              # QUIC swarm init
│   ├── quic-coordinator.js   # QUIC transport
│   └── transport-router.js   # Protocol selection
│
├── coordination/             # Attention coordination
│   └── attention-coordinator.js
│
├── services/                 # Learning services
│   ├── sona-agentdb-integration.js  # SONA + AgentDB
│   └── sona-service.js       # SONA wrapper
│
├── workers/                  # Background workers
│   └── ruvector-integration.js  # Worker learning
│
├── intelligence/             # Persistence
│   └── IntelligenceStore.js  # SQLite storage
│
└── hooks/                    # CLI hooks
    └── swarm-learning-optimizer.js
```

### 3.2 Core Wrappers Performance

The `core/` wrappers provide production-stable alternatives to broken @ruvector/* alpha APIs:

| Wrapper | Raw Package | Speedup | Status |
|---------|-------------|---------|--------|
| `gnn-wrapper.js` | @ruvector/gnn | 11-22x | ✅ Verified |
| `agentdb-fast.js` | agentdb-cli | 50-200x | ✅ Verified |
| `attention-native.js` | @ruvector/attention | Fixed | ✅ Verified |
| `embedding-service.js` | Multiple | N/A | ✅ Verified |

**Usage Pattern:**
```typescript
// ✅ CORRECT: Use agentic-flow wrappers
import {
  differentiableSearch,
  AgentDBFast,
  MultiHeadAttention,
  createEmbeddingService
} from 'agentic-flow/core';

// ❌ WRONG: Don't use raw @ruvector/* packages directly
import { GNN } from '@ruvector/gnn'; // Broken API
```

---

## 4. Learning System Architecture

### 4.1 SONA + AgentDB Integration

The `SONAAgentDBTrainer` class provides unified learning with:

```typescript
// Configuration profiles
const profiles = {
  realtime: { microLoraRank: 2, hnswM: 8 },      // <2ms latency
  balanced: { microLoraRank: 2, hnswM: 16 },     // Speed + quality
  quality: { microLoraRank: 2, hnswM: 32 },      // Max accuracy
  largescale: { patternClusters: 200, hnswM: 16 } // Millions of patterns
};
```

**Training Flow (1.25ms total):**
1. SONA trajectory recording + LoRA adaptation (0.45ms)
2. AgentDB HNSW indexing (0.8ms)

**Query Flow:**
1. AgentDB HNSW search (125x faster)
2. SONA pattern matching (761 decisions/sec)
3. SONA LoRA adaptation (0.45ms)

### 4.2 ReasoningBank Hybrid Backend

Combines SQLite persistence with AgentDB vector search:

```typescript
// Re-exported controllers
export { ReflexionMemory } from 'agentdb/controllers/ReflexionMemory';
export { SkillLibrary } from 'agentdb/controllers/SkillLibrary';
export { CausalMemoryGraph } from 'agentdb/controllers/CausalMemoryGraph';
export { NightlyLearner } from 'agentdb/controllers/NightlyLearner';
```

**Capabilities:**
- Memory retrieval with MMR selection
- Trajectory judgment (success/partial/failure)
- Memory distillation (extract learnings)
- Automatic consolidation scheduling
- PII scrubbing

### 4.3 9 Reinforcement Learning Algorithms

Available through the hooks system:

| Algorithm | Best For |
|-----------|----------|
| Q-Learning | Simple, discrete actions |
| SARSA | Safe exploration |
| DQN | Complex state spaces |
| A2C | Continuous actions |
| PPO | Stable training |
| Actor-Critic | Balanced approach |
| Decision Transformer | Sequence modeling |
| TD3 | Continuous control |
| SAC | Maximum entropy |

---

## 5. Swarm Coordination

### 5.1 QUIC Transport

The swarm system supports QUIC protocol for low-latency coordination:

```typescript
const swarm = await initSwarm({
  swarmId: 'my-swarm',
  topology: 'mesh',      // mesh, hierarchical, ring, star
  transport: 'quic',     // quic, http2, auto
  maxAgents: 10,
  quicPort: 4433
});
```

**Transport Fallback Chain:**
1. QUIC (primary - lowest latency)
2. HTTP/2 (fallback - widely supported)
3. WebSocket (legacy fallback)

### 5.2 Attention-Based Coordination

The `AttentionCoordinator` provides intelligent agent consensus:

```typescript
// Standard consensus with Flash attention
const result = await coordinator.coordinateAgents(agentOutputs, 'flash');

// Expert routing with MoE
const experts = await coordinator.routeToExperts(task, agents, topK);

// Topology-aware coordination
const result = await coordinator.topologyAwareCoordination(
  outputs, 'mesh', graphStructure
);

// Hierarchical with hyperbolic attention
const result = await coordinator.hierarchicalCoordination(
  queenOutputs, workerOutputs, curvature
);
```

### 5.3 Swarm Learning Optimizer

Adaptive swarm configuration based on learned patterns:

```typescript
const optimizer = new SwarmLearningOptimizer(reasoningBank);

// Get optimal configuration for task
const config = await optimizer.getOptimization(
  taskDescription,
  'high',  // complexity: low, medium, high, critical
  8        // estimated agent count
);

// Returns:
// {
//   recommendedTopology: 'hierarchical',
//   recommendedBatchSize: 7,
//   recommendedAgentCount: 8,
//   expectedSpeedup: 3.5,
//   confidence: 0.85,
//   alternatives: [...]
// }
```

---

## 6. Hook System

### 6.1 Available Hooks (19 Total)

**Original Hooks (10):**
| Hook | Purpose |
|------|---------|
| `hookPreEditTool` | Validate edits before execution |
| `hookPostEditTool` | Learn from completed edits |
| `hookPreCommandTool` | Validate commands |
| `hookPostCommandTool` | Learn from command results |
| `hookRouteTool` | Intelligent agent routing |
| `hookExplainTool` | Explain routing decisions |
| `hookPretrainTool` | Pattern pretraining |
| `hookBuildAgentsTool` | Dynamic agent generation |
| `hookMetricsTool` | Performance metrics |
| `hookTransferTool` | Cross-domain transfer |

**Intelligence Bridge Hooks (9):**
| Hook | Purpose |
|------|---------|
| `intelligenceRouteTool` | RuVector-enhanced routing |
| `intelligenceTrajectoryStartTool` | Begin trajectory tracking |
| `intelligenceTrajectoryStepTool` | Record trajectory step |
| `intelligenceTrajectoryEndTool` | Complete trajectory |
| `intelligencePatternStoreTool` | Store learned pattern |
| `intelligencePatternSearchTool` | Search patterns |
| `intelligenceStatsTool` | Intelligence stats |
| `intelligenceLearnTool` | Force learning cycle |
| `intelligenceAttentionTool` | Attention similarity |

### 6.2 Hook Event Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Event                         │
│                   (PreToolUse, etc.)                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Claude-Flow Hook Dispatcher                     │
│         (Maps Claude events → agentic-flow hooks)           │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  agentic-flow   │     │  Intelligence   │
│  Original Hooks │     │  Bridge Hooks   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   RuVector Core                              │
│          (SONA, VectorDB, Attention, GNN)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Intelligence Persistence

### 7.1 IntelligenceStore (SQLite)

Cross-platform persistence using better-sqlite3:

```typescript
// Database location (auto-detected)
// Priority 1: .agentic-flow/intelligence.db (project local)
// Priority 2: ~/.agentic-flow/intelligence.db (home dir)

const store = IntelligenceStore.getInstance();
```

**Schema:**
- `trajectories` - Task execution traces
- `patterns` - Learned patterns with embeddings
- `routings` - Agent routing decisions
- `stats` - Aggregate statistics

**Performance Settings:**
```sql
PRAGMA journal_mode = WAL;      -- Better concurrent access
PRAGMA synchronous = NORMAL;    -- Speed/safety balance
```

### 7.2 RuVectorWorkerIntegration

Background worker integration with full RuVector stack:

```typescript
const integration = new RuVectorWorkerIntegration({
  enableSona: true,
  enableReasoningBank: true,
  enableHnsw: true,
  sonaProfile: 'batch',
  embeddingDim: 384,
  qualityThreshold: 0.6
});

// Start trajectory
const trajectoryId = await integration.startTrajectory(
  workerId, trigger, topic
);

// Record steps
await integration.recordStep(trajectoryId, phase, metrics);

// Complete with learning
const result = await integration.completeTrajectory(trajectoryId, results);
// {
//   qualityScore: 0.85,
//   patternsLearned: 1,
//   sonaAdaptation: true
// }
```

---

## 8. Claude-Flow v3 Integration Strategy

### 8.1 Installation Tiers

**Tier 1: Core (~2MB)**
```bash
npm install claude-flow@3 agentic-flow@alpha
# Includes: hooks, routing, basic learning
```

**Tier 2: Learning (~8MB)**
```bash
npx claude-flow enable-learning
# Adds: SONA, AgentDB, ReasoningBank
```

**Tier 3: Full (~15MB)**
```bash
npx claude-flow enable-swarm
# Adds: QUIC, attention coordination, GNN
```

### 8.2 Integration Layer

Claude-Flow v3 needs a thin integration layer (~500 lines):

```typescript
// src/integrations/agentic-flow.ts

import {
  hookTools,
  allHookTools,
  SONAAgentDBTrainer,
  initSwarm,
  SwarmLearningOptimizer
} from 'agentic-flow';

// 1. Hook event mapping
const HOOK_MAP = {
  'PreToolUse': ['hookPreEditTool', 'hookPreCommandTool'],
  'PostToolUse': ['hookPostEditTool', 'hookPostCommandTool'],
  'TaskStart': ['intelligenceTrajectoryStartTool'],
  'TaskStep': ['intelligenceTrajectoryStepTool'],
  'TaskEnd': ['intelligenceTrajectoryEndTool']
};

// 2. Learning integration
export async function initLearning(profile = 'balanced') {
  const trainer = new SONAAgentDBTrainer(
    SONAAgentDBProfiles[profile]()
  );
  await trainer.initialize();
  return trainer;
}

// 3. Swarm integration
export async function initSwarmCoordination(config) {
  return initSwarm(config);
}
```

### 8.3 CLI Commands

```bash
# Learning
npx claude-flow learn status          # Show learning stats
npx claude-flow learn force           # Force learning cycle
npx claude-flow learn export <path>   # Export learned patterns

# Hooks
npx claude-flow hooks list            # List available hooks
npx claude-flow hooks enable <hook>   # Enable specific hook
npx claude-flow hooks metrics         # Show hook performance

# Swarm
npx claude-flow swarm init <topology> # Initialize swarm
npx claude-flow swarm status          # Show swarm status
npx claude-flow swarm optimize        # Get optimization recommendations
```

---

## 9. Performance Benchmarks

### 9.1 Expected Improvements

| Operation | Before (v2) | After (v3 with agentic-flow) |
|-----------|-------------|------------------------------|
| Agent routing | 50-100ms | 1-5ms (SONA) |
| Pattern search | 100-200ms | 0.8ms (HNSW) |
| Memory retrieval | 50ms | 10-50ms (AgentDB Fast) |
| Swarm coordination | N/A | 0.7-5.4ms (attention) |
| Learning update | N/A | 0.45ms (Micro-LoRA) |

### 9.2 Memory Usage

| Component | Memory |
|-----------|--------|
| Core SDK | ~2MB |
| SONA engine | ~12KB per adaptation |
| AgentDB | ~3KB per pattern |
| HNSW index | ~1MB per 10K vectors |
| IntelligenceStore | Variable (SQLite) |

---

## 10. Recommendations

### 10.1 DO Use

1. **agentic-flow@alpha as primary SDK** - Production wrappers fix alpha issues
2. **Core wrappers** - GNN, AgentDB Fast, Attention Native
3. **SONA + AgentDB integration** - Unified learning with 1.25ms latency
4. **Hook system** - All 19 hooks for comprehensive integration
5. **Swarm learning optimizer** - Adaptive topology selection

### 10.2 DON'T Use

1. **Raw @ruvector/* packages** - Alpha APIs are broken
2. **agentdb-cli** - Use AgentDB Fast instead (50-200x faster)
3. **Custom attention implementations** - Use native wrappers
4. **Manual learning loops** - Use SONAAgentDBTrainer

### 10.3 Future Considerations

1. **HuggingFace export** - Export trained LoRA adapters
2. **Federation** - Multi-node swarm coordination
3. **Custom RL algorithms** - Extend 9-algorithm system
4. **Edge deployment** - WASM-only builds

---

## 11. Claude-Flow v3 Modular Package Constellation

### 11.1 Overview

Claude-Flow v3 will be architected as a **modular constellation of npm packages** similar to the @ruvector/* collection. Each component can operate independently or integrate seamlessly within the ecosystem.

```
                        ┌─────────────────────────┐
                        │    @claude-flow/core    │
                        │   (Central Connector)   │
                        │       ~50KB base        │
                        └───────────┬─────────────┘
                                    │
       ┌────────────┬───────────────┼───────────────┬────────────┐
       │            │               │               │            │
       ▼            ▼               ▼               ▼            ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│  @claude-  │ │  @claude-  │ │  @claude-  │ │  @claude-  │ │  @claude-  │
│   flow/    │ │   flow/    │ │   flow/    │ │   flow/    │ │   flow/    │
│   hooks    │ │  learning  │ │   swarm    │ │   memory   │ │   agents   │
└────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘
       │            │               │               │            │
       ▼            ▼               ▼               ▼            ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│  @claude-  │ │  @claude-  │ │  @claude-  │ │  @claude-  │ │  @claude-  │
│   flow/    │ │   flow/    │ │   flow/    │ │   flow/    │ │   flow/    │
│    mcp     │ │   neural   │ │ attention  │ │   vector   │ │    cli     │
└────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘
```

### 11.2 Package Specifications

#### @claude-flow/core (Central Connector)

**Purpose:** Minimal core that connects all packages, provides unified configuration, and manages inter-package communication.

```typescript
// Package: @claude-flow/core
// Size: ~50KB (no dependencies on other @claude-flow/* packages)

export interface ClaudeFlowConfig {
  enabledModules: string[];
  sharedConfig: SharedConfig;
  eventBus: EventBus;
}

export class ClaudeFlowCore {
  // Module registry
  register(module: ClaudeFlowModule): void;
  unregister(moduleId: string): void;

  // Cross-module communication
  emit(event: string, data: any): void;
  on(event: string, handler: EventHandler): void;

  // Unified configuration
  configure(config: Partial<ClaudeFlowConfig>): void;

  // Module discovery
  getModule<T>(id: string): T | undefined;
  listModules(): ModuleInfo[];
}

// Usage:
import { ClaudeFlowCore } from '@claude-flow/core';
const core = new ClaudeFlowCore();
```

**Key Features:**
- Event bus for inter-module communication
- Shared configuration management
- Module lifecycle management
- Zero dependencies on other @claude-flow/* packages
- Can run standalone for minimal setups

---

#### @claude-flow/hooks

**Purpose:** Claude Code event hooks for pre/post operations with intelligent routing.

```typescript
// Package: @claude-flow/hooks
// Dependencies: @claude-flow/core (optional peer)
// SDK: agentic-flow/hooks

export interface HookConfig {
  enabled: boolean;
  events: ClaudeCodeEvent[];
  learning?: boolean;  // Requires @claude-flow/learning
}

// Standalone usage
import { createHookDispatcher } from '@claude-flow/hooks';
const dispatcher = createHookDispatcher();
dispatcher.register('PreToolUse', preEditHook);

// With core integration
import { ClaudeFlowCore } from '@claude-flow/core';
import { HooksModule } from '@claude-flow/hooks';
core.register(new HooksModule());
```

**Available Hooks:**
| Hook | Event | Purpose |
|------|-------|---------|
| `preEdit` | PreToolUse (Edit) | Validate edits |
| `postEdit` | PostToolUse (Edit) | Learn from edits |
| `preCommand` | PreToolUse (Bash) | Validate commands |
| `postCommand` | PostToolUse (Bash) | Learn from commands |
| `route` | TaskStart | Agent routing |
| `explain` | UserRequest | Explain decisions |
| `pretrain` | SystemInit | Pattern pretraining |
| `buildAgents` | SwarmInit | Dynamic agent creation |
| `metrics` | Any | Performance tracking |
| `transfer` | Any | Cross-domain transfer |

---

#### @claude-flow/learning

**Purpose:** Self-optimizing learning system with multiple RL algorithms.

```typescript
// Package: @claude-flow/learning
// Dependencies: @claude-flow/core (optional peer)
// SDK: agentic-flow (SONA + AgentDB)

export interface LearningConfig {
  algorithm: RLAlgorithm;
  profile: 'realtime' | 'balanced' | 'quality' | 'largescale';
  autoLearn: boolean;
  memoryPath?: string;
}

// Standalone usage
import { createLearningEngine } from '@claude-flow/learning';
const engine = createLearningEngine({ algorithm: 'PPO' });
await engine.train(pattern);
const similar = await engine.query(embedding);

// With core integration
import { LearningModule } from '@claude-flow/learning';
core.register(new LearningModule({ profile: 'balanced' }));
```

**Algorithms (9 Total):**
```typescript
type RLAlgorithm =
  | 'Q-Learning'      // Simple, discrete actions
  | 'SARSA'           // Safe exploration
  | 'DQN'             // Complex state spaces
  | 'A2C'             // Continuous actions
  | 'PPO'             // Stable training
  | 'Actor-Critic'    // Balanced approach
  | 'Decision-Transformer' // Sequence modeling
  | 'TD3'             // Continuous control
  | 'SAC';            // Maximum entropy
```

**Performance Profiles:**
| Profile | LoRA Rank | HNSW M | Latency |
|---------|-----------|--------|---------|
| realtime | 2 | 8 | <2ms |
| balanced | 2 | 16 | ~5ms |
| quality | 2 | 32 | ~10ms |
| largescale | 2 | 16 | ~5ms (millions) |

---

#### @claude-flow/swarm

**Purpose:** Multi-agent swarm coordination with topology support.

```typescript
// Package: @claude-flow/swarm
// Dependencies: @claude-flow/core (optional peer)
// SDK: agentic-flow/swarm

export interface SwarmConfig {
  topology: 'mesh' | 'hierarchical' | 'ring' | 'star' | 'adaptive';
  transport: 'quic' | 'http2' | 'websocket' | 'auto';
  maxAgents: number;
  coordinationMode: 'consensus' | 'voting' | 'attention';
}

// Standalone usage
import { createSwarm } from '@claude-flow/swarm';
const swarm = await createSwarm({
  topology: 'hierarchical',
  maxAgents: 10
});
await swarm.spawnAgent({ type: 'researcher' });

// With core integration
import { SwarmModule } from '@claude-flow/swarm';
core.register(new SwarmModule({ topology: 'mesh' }));
```

**Topology Selection:**
| Topology | Agents | Coordination | Use Case |
|----------|--------|--------------|----------|
| mesh | ≤5 | O(n²) | Small teams, full visibility |
| hierarchical | 6-50 | O(log n) | Large swarms, delegation |
| ring | ≤20 | O(n) | Sequential pipelines |
| star | ≤30 | O(n) | Central coordinator |
| adaptive | any | dynamic | Auto-selects based on load |

---

#### @claude-flow/memory

**Purpose:** Persistent memory and pattern storage.

```typescript
// Package: @claude-flow/memory
// Dependencies: @claude-flow/core (optional peer)
// SDK: agentic-flow/reasoningbank

export interface MemoryConfig {
  backend: 'sqlite' | 'agentdb' | 'hybrid';
  path?: string;
  maxPatterns?: number;
  consolidationInterval?: number;
}

// Standalone usage
import { createMemoryStore } from '@claude-flow/memory';
const memory = createMemoryStore({ backend: 'hybrid' });
await memory.store('task/123', pattern);
const similar = await memory.retrieve('code review', { k: 5 });

// With core integration
import { MemoryModule } from '@claude-flow/memory';
core.register(new MemoryModule());
```

**Features:**
- Trajectory storage
- Pattern retrieval with MMR
- Automatic consolidation
- PII scrubbing
- Cross-session persistence

---

#### @claude-flow/agents

**Purpose:** Agent definitions and dynamic agent generation.

```typescript
// Package: @claude-flow/agents
// Dependencies: @claude-flow/core (optional peer)

export interface AgentDefinition {
  id: string;
  type: AgentType;
  capabilities: string[];
  systemPrompt: string;
  tools?: Tool[];
}

// Standalone usage
import { defineAgent, loadAgents } from '@claude-flow/agents';
const researcher = defineAgent({
  type: 'researcher',
  capabilities: ['web-search', 'code-analysis']
});

// With core integration
import { AgentsModule } from '@claude-flow/agents';
core.register(new AgentsModule());
```

**Built-in Agent Types (54+):**
- Core: coder, reviewer, tester, planner, researcher
- Swarm: hierarchical-coordinator, mesh-coordinator
- Consensus: byzantine, raft, gossip, quorum
- GitHub: pr-manager, issue-tracker, code-review
- SPARC: specification, pseudocode, architecture

---

#### @claude-flow/mcp

**Purpose:** MCP server and tool definitions.

```typescript
// Package: @claude-flow/mcp
// Dependencies: @claude-flow/core (optional peer)

export interface MCPConfig {
  servers: MCPServerConfig[];
  autoStart?: boolean;
  port?: number;
}

// Standalone usage
import { startMCPServer } from '@claude-flow/mcp';
const server = await startMCPServer({
  tools: ['swarm_init', 'agent_spawn', 'task_orchestrate']
});

// With core integration
import { MCPModule } from '@claude-flow/mcp';
core.register(new MCPModule());
```

**MCP Tool Categories:**
- Coordination: swarm_init, agent_spawn, task_orchestrate
- Monitoring: swarm_status, agent_metrics, task_status
- Memory: memory_store, memory_retrieve, memory_consolidate
- Neural: neural_train, neural_patterns, neural_export
- GitHub: repo_analyze, pr_enhance, issue_triage

---

#### @claude-flow/neural

**Purpose:** Neural network operations and attention mechanisms.

```typescript
// Package: @claude-flow/neural
// Dependencies: @claude-flow/core (optional peer)
// SDK: @ruvector/attention, @ruvector/gnn

export interface NeuralConfig {
  attention: AttentionMechanism;
  embeddingDim: number;
  useGPU?: boolean;
}

// Standalone usage
import { createAttentionService } from '@claude-flow/neural';
const attention = createAttentionService({ mechanism: 'flash' });
const result = await attention.compute(Q, K, V);

// With core integration
import { NeuralModule } from '@claude-flow/neural';
core.register(new NeuralModule());
```

**Attention Mechanisms:**
| Mechanism | Latency | Memory | Use Case |
|-----------|---------|--------|----------|
| flash | 0.7ms | Low | Real-time |
| multi-head | 1.2ms | Medium | General |
| linear | 0.3ms | Low | Long sequences |
| hyperbolic | 2.1ms | Medium | Hierarchical |
| moe | 1.8ms | High | Expert routing |
| graph-rope | 5.4ms | High | Topology |

---

#### @claude-flow/attention

**Purpose:** Attention-based agent coordination and consensus.

```typescript
// Package: @claude-flow/attention
// Dependencies: @claude-flow/core, @claude-flow/neural (optional peers)

export interface AttentionCoordinatorConfig {
  mechanism: AttentionMechanism;
  consensusThreshold?: number;
}

// Standalone usage
import { createAttentionCoordinator } from '@claude-flow/attention';
const coordinator = createAttentionCoordinator({ mechanism: 'flash' });
const consensus = await coordinator.coordinateAgents(outputs);

// With core integration
import { AttentionModule } from '@claude-flow/attention';
core.register(new AttentionModule());
```

---

#### @claude-flow/vector

**Purpose:** Vector database operations with HNSW indexing.

```typescript
// Package: @claude-flow/vector
// Dependencies: @claude-flow/core (optional peer)
// SDK: @ruvector/core, agentdb

export interface VectorConfig {
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot';
  hnswM?: number;
  efConstruction?: number;
}

// Standalone usage
import { createVectorStore } from '@claude-flow/vector';
const vectors = createVectorStore({ dimensions: 384 });
await vectors.add('id', embedding, metadata);
const results = await vectors.search(query, { k: 5 });

// With core integration
import { VectorModule } from '@claude-flow/vector';
core.register(new VectorModule());
```

**Performance:**
- HNSW indexing: 150x faster than brute force
- Quantization: 4-32x memory reduction
- Batch operations: 10K vectors/second

---

#### @claude-flow/cli

**Purpose:** Command-line interface for all modules.

```typescript
// Package: @claude-flow/cli
// Dependencies: All @claude-flow/* packages (optional peers)

// Commands auto-detect installed modules
```

**Commands:**
```bash
# Core
npx @claude-flow/cli init           # Initialize project
npx @claude-flow/cli status         # Show module status
npx @claude-flow/cli config         # Configure modules

# Hooks (if @claude-flow/hooks installed)
npx @claude-flow/cli hooks list
npx @claude-flow/cli hooks enable <hook>

# Learning (if @claude-flow/learning installed)
npx @claude-flow/cli learn status
npx @claude-flow/cli learn train <patterns>
npx @claude-flow/cli learn export

# Swarm (if @claude-flow/swarm installed)
npx @claude-flow/cli swarm init <topology>
npx @claude-flow/cli swarm spawn <type>
npx @claude-flow/cli swarm status

# Memory (if @claude-flow/memory installed)
npx @claude-flow/cli memory stats
npx @claude-flow/cli memory consolidate

# MCP (if @claude-flow/mcp installed)
npx @claude-flow/cli mcp start
npx @claude-flow/cli mcp list-tools
```

---

### 11.3 Package Dependency Matrix

```
                 core  hooks  learn  swarm  memory  agents  mcp  neural  attn  vector  cli
@claude-flow/
  core            -     -      -      -      -       -      -     -       -     -      -
  hooks           P     -      P      -      P       -      -     -       -     -      -
  learning        P     -      -      -      P       -      -     P       -     P      -
  swarm           P     -      P      -      -       P      -     -       P     -      -
  memory          P     -      -      -      -       -      -     -       -     P      -
  agents          P     -      -      -      -       -      -     -       -     -      -
  mcp             P     P      P      P      P       P      -     P       P     P      -
  neural          P     -      -      -      -       -      -     -       -     -      -
  attention       P     -      -      -      -       -      -     P       -     -      -
  vector          P     -      -      -      -       -      -     -       -     -      -
  cli             P     P      P      P      P       P      P     P       P     P      -

P = Optional peer dependency (enhances features when present)
- = No dependency
```

### 11.4 Installation Combinations

#### Minimal (Core Only)
```bash
npm install @claude-flow/core
# 50KB, event bus and configuration only
```

#### Hooks Only
```bash
npm install @claude-flow/hooks
# Works standalone, no core required
# 200KB, Claude Code hook integration
```

#### Learning Stack
```bash
npm install @claude-flow/core @claude-flow/learning @claude-flow/memory @claude-flow/vector
# 3MB, full learning system
```

#### Swarm Stack
```bash
npm install @claude-flow/core @claude-flow/swarm @claude-flow/agents @claude-flow/attention
# 4MB, multi-agent coordination
```

#### Full Installation
```bash
npm install claude-flow
# Meta-package that includes all @claude-flow/* packages
# 15MB, everything included
```

#### Mix and Match Examples
```bash
# Hooks + Learning (self-optimizing hooks)
npm install @claude-flow/hooks @claude-flow/learning

# Swarm + Memory (persistent swarm state)
npm install @claude-flow/swarm @claude-flow/memory

# Neural + Vector (embeddings + search)
npm install @claude-flow/neural @claude-flow/vector

# CLI with specific modules
npm install @claude-flow/cli @claude-flow/hooks @claude-flow/swarm
```

### 11.5 Module Communication Protocol

All modules communicate through the core event bus:

```typescript
// Event types
interface ModuleEvents {
  // Lifecycle
  'module:registered': { moduleId: string; version: string };
  'module:unregistered': { moduleId: string };

  // Hooks
  'hook:triggered': { hookId: string; event: string; data: any };
  'hook:completed': { hookId: string; result: any };

  // Learning
  'learning:pattern-stored': { patternId: string; quality: number };
  'learning:cycle-complete': { patterns: number; improvements: number };

  // Swarm
  'swarm:agent-spawned': { agentId: string; type: string };
  'swarm:task-assigned': { taskId: string; agentId: string };
  'swarm:consensus-reached': { result: any; confidence: number };

  // Memory
  'memory:stored': { key: string; type: string };
  'memory:retrieved': { key: string; similarity: number };
  'memory:consolidated': { patterns: number };
}

// Cross-module communication example
// @claude-flow/hooks emits, @claude-flow/learning listens
core.on('hook:completed', async (data) => {
  if (data.hookId === 'postEdit') {
    await learningModule.train({
      task: data.result.task,
      outcome: data.result.success,
      embedding: data.result.embedding
    });
  }
});
```

### 11.6 SDK Mapping to Packages

Each @claude-flow/* package maps to specific agentic-flow SDK components:

| @claude-flow/* | agentic-flow SDK |
|----------------|------------------|
| hooks | `agentic-flow/hooks`, `agentic-flow/mcp/fastmcp/tools/hooks` |
| learning | `agentic-flow/services/sona-agentdb-integration`, `agentic-flow/hooks/swarm-learning-optimizer` |
| swarm | `agentic-flow/swarm`, `agentic-flow/coordination` |
| memory | `agentic-flow/reasoningbank`, `agentic-flow/intelligence/IntelligenceStore` |
| agents | `agentic-flow/agents` |
| mcp | `agentic-flow/mcp` |
| neural | `@ruvector/attention`, `@ruvector/gnn`, `agentic-flow/core` |
| attention | `agentic-flow/coordination/attention-coordinator` |
| vector | `@ruvector/core`, `agentic-flow/core/agentdb-fast` |
| cli | `agentic-flow/cli` |

### 11.7 Version Compatibility Matrix

```
@claude-flow/*  | agentic-flow | @ruvector/* | Node.js
----------------|--------------|-------------|--------
3.0.x           | 2.0.x-alpha  | 0.1.x       | ≥18.x
3.1.x           | 2.1.x-alpha  | 0.2.x       | ≥18.x
```

### 11.8 Standalone vs Integrated Usage

**Standalone (No Core):**
```typescript
// Each package works independently
import { createHookDispatcher } from '@claude-flow/hooks';
import { createLearningEngine } from '@claude-flow/learning';
import { createSwarm } from '@claude-flow/swarm';

// Manual coordination required
const dispatcher = createHookDispatcher();
const engine = createLearningEngine();

dispatcher.on('postEdit', async (data) => {
  // Manual integration
  await engine.train(data);
});
```

**Integrated (With Core):**
```typescript
// Automatic cross-module communication
import { ClaudeFlowCore } from '@claude-flow/core';
import { HooksModule } from '@claude-flow/hooks';
import { LearningModule } from '@claude-flow/learning';
import { SwarmModule } from '@claude-flow/swarm';

const core = new ClaudeFlowCore();
core.register(new HooksModule());
core.register(new LearningModule());
core.register(new SwarmModule());

// Automatic event routing between modules
// Hooks → Learning: postEdit events trigger training
// Learning → Memory: patterns stored automatically
// Swarm → Attention: coordination uses attention mechanisms
```

### 11.9 Shared Types Package

#### @claude-flow/types

**Purpose:** Zero-runtime TypeScript definitions shared across all packages.

```typescript
// Package: @claude-flow/types
// Size: ~20KB (types only, no runtime)
// Dependencies: None

// Core interfaces
export interface ClaudeFlowModule {
  id: string;
  version: string;
  initialize(core?: ClaudeFlowCore): Promise<void>;
  shutdown(): Promise<void>;
}

export interface EventBus {
  emit<T extends keyof ModuleEvents>(event: T, data: ModuleEvents[T]): void;
  on<T extends keyof ModuleEvents>(event: T, handler: (data: ModuleEvents[T]) => void): void;
  off<T extends keyof ModuleEvents>(event: T, handler: (data: ModuleEvents[T]) => void): void;
}

// Agent types
export interface AgentDefinition {
  id: string;
  type: AgentType;
  capabilities: string[];
  systemPrompt: string;
  tools?: Tool[];
  config?: AgentConfig;
}

export type AgentType =
  | 'coder' | 'reviewer' | 'tester' | 'planner' | 'researcher'
  | 'hierarchical-coordinator' | 'mesh-coordinator'
  | 'byzantine' | 'raft' | 'gossip' | 'quorum'
  | string; // Allow custom types

// Learning types
export interface TrainingPattern {
  id?: string;
  embedding: Float32Array | number[];
  hiddenStates: Float32Array | number[];
  attention: Float32Array | number[];
  quality: number;
  context?: Record<string, string>;
  timestamp?: number;
}

export type RLAlgorithm =
  | 'Q-Learning' | 'SARSA' | 'DQN' | 'A2C' | 'PPO'
  | 'Actor-Critic' | 'Decision-Transformer' | 'TD3' | 'SAC';

// Swarm types
export type SwarmTopology = 'mesh' | 'hierarchical' | 'ring' | 'star' | 'adaptive';
export type TransportProtocol = 'quic' | 'http2' | 'websocket' | 'auto';

// Memory types
export interface MemoryPattern {
  key: string;
  value: any;
  embedding?: number[];
  metadata?: Record<string, any>;
  timestamp: number;
  quality?: number;
}

// Hook types
export type ClaudeCodeEvent =
  | 'PreToolUse' | 'PostToolUse'
  | 'TaskStart' | 'TaskEnd'
  | 'SessionStart' | 'SessionEnd'
  | 'UserRequest' | 'AgentResponse';

export interface HookResult {
  success: boolean;
  data?: any;
  error?: Error;
  metrics?: HookMetrics;
}
```

---

### 11.10 Monorepo Management

#### Tool Selection: pnpm Workspaces + Turborepo

```
claude-flow/
├── package.json              # Root workspace config
├── pnpm-workspace.yaml       # pnpm workspace definition
├── turbo.json                # Turborepo pipeline config
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── src/
│   │   └── tsconfig.json
│   ├── hooks/
│   ├── learning/
│   ├── swarm/
│   ├── memory/
│   ├── agents/
│   ├── mcp/
│   ├── neural/
│   ├── attention/
│   ├── vector/
│   ├── cli/
│   └── types/               # Shared types
└── apps/
    └── docs/                # Documentation site
```

#### pnpm-workspace.yaml
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

#### turbo.json
```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

#### Publishing Workflow
```bash
# Version all changed packages
pnpm changeset version

# Build all packages in dependency order
pnpm turbo build

# Publish to npm
pnpm changeset publish
```

#### Benefits
- **pnpm**: Fast installs, strict dependencies, disk efficient
- **Turborepo**: Parallel builds, caching, change detection
- **Changesets**: Coordinated versioning and changelogs

---

### 11.11 Testing Strategy

#### Per-Package Testing

```typescript
// packages/hooks/src/__tests__/dispatcher.test.ts
import { createHookDispatcher } from '../dispatcher';

describe('HookDispatcher', () => {
  it('should register and trigger hooks', async () => {
    const dispatcher = createHookDispatcher();
    const mockHook = jest.fn().mockResolvedValue({ success: true });

    dispatcher.register('PreToolUse', mockHook);
    await dispatcher.trigger('PreToolUse', { tool: 'Edit' });

    expect(mockHook).toHaveBeenCalledWith({ tool: 'Edit' });
  });
});
```

#### Integration Testing

```typescript
// packages/integration-tests/core-hooks.test.ts
import { ClaudeFlowCore } from '@claude-flow/core';
import { HooksModule } from '@claude-flow/hooks';
import { LearningModule } from '@claude-flow/learning';

describe('Core + Hooks + Learning Integration', () => {
  let core: ClaudeFlowCore;

  beforeEach(async () => {
    core = new ClaudeFlowCore();
    core.register(new HooksModule());
    core.register(new LearningModule({ profile: 'realtime' }));
    await core.initialize();
  });

  it('should trigger learning on hook completion', async () => {
    const learningModule = core.getModule<LearningModule>('learning');
    const trainSpy = jest.spyOn(learningModule, 'train');

    core.emit('hook:completed', {
      hookId: 'postEdit',
      result: { task: 'fix bug', success: true }
    });

    await new Promise(r => setTimeout(r, 100));
    expect(trainSpy).toHaveBeenCalled();
  });
});
```

#### Mock Implementations

```typescript
// packages/hooks/src/__mocks__/learning.ts
export const createMockLearningEngine = () => ({
  train: jest.fn().mockResolvedValue({ patternId: 'mock-123' }),
  query: jest.fn().mockResolvedValue([]),
  forceLearn: jest.fn().mockResolvedValue({ improved: true })
});
```

#### Test Configuration

```json
// turbo.json test pipeline
{
  "test": {
    "dependsOn": ["build"],
    "outputs": ["coverage/**"],
    "env": ["CI", "NODE_ENV"]
  },
  "test:unit": {
    "dependsOn": ["build"],
    "outputs": ["coverage/unit/**"]
  },
  "test:integration": {
    "dependsOn": ["^build"],
    "outputs": ["coverage/integration/**"]
  },
  "test:e2e": {
    "dependsOn": ["^build"],
    "outputs": ["coverage/e2e/**"]
  }
}
```

---

### 11.12 Error Handling & Recovery

#### Cross-Module Error Propagation

```typescript
// @claude-flow/core error types
export class ClaudeFlowError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public module: string,
    public recoverable: boolean = true,
    public cause?: Error
  ) {
    super(message);
    this.name = 'ClaudeFlowError';
  }
}

export enum ErrorCode {
  // Core errors (1xxx)
  MODULE_NOT_FOUND = 1001,
  MODULE_INIT_FAILED = 1002,
  EVENT_HANDLER_FAILED = 1003,

  // Hook errors (2xxx)
  HOOK_TIMEOUT = 2001,
  HOOK_VALIDATION_FAILED = 2002,

  // Learning errors (3xxx)
  TRAINING_FAILED = 3001,
  PATTERN_NOT_FOUND = 3002,
  ALGORITHM_UNAVAILABLE = 3003,

  // Swarm errors (4xxx)
  AGENT_SPAWN_FAILED = 4001,
  COORDINATION_TIMEOUT = 4002,
  TRANSPORT_UNAVAILABLE = 4003,

  // Memory errors (5xxx)
  STORAGE_FULL = 5001,
  RETRIEVAL_FAILED = 5002
}
```

#### Graceful Degradation

```typescript
// @claude-flow/core graceful degradation
class ClaudeFlowCore {
  async safeGetModule<T>(id: string): Promise<T | null> {
    try {
      return this.getModule<T>(id) ?? null;
    } catch (error) {
      this.emit('error:module', { id, error, degraded: true });
      return null;
    }
  }

  // Feature detection for optional modules
  hasModule(id: string): boolean {
    return this.modules.has(id);
  }

  // Run with fallback
  async withFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
    errorCodes: ErrorCode[]
  ): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      if (error instanceof ClaudeFlowError && errorCodes.includes(error.code)) {
        this.emit('error:fallback', { error, using: 'fallback' });
        return await fallback();
      }
      throw error;
    }
  }
}
```

#### Circuit Breaker Pattern

```typescript
// @claude-flow/core circuit breaker
interface CircuitBreakerConfig {
  failureThreshold: number;  // Failures before opening
  resetTimeout: number;      // Ms before half-open
  monitorWindow: number;     // Ms to track failures
}

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures: number = 0;
  private lastFailure: number = 0;

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.config.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new ClaudeFlowError('Circuit open', ErrorCode.MODULE_INIT_FAILED, 'circuit', true);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

---

### 11.13 Security Model

#### API Key Management

```typescript
// @claude-flow/core secrets
interface SecretsConfig {
  provider: 'env' | 'keychain' | 'vault';
  keyPrefix?: string;
}

class SecretsManager {
  // Never log or expose secrets
  async get(key: string): Promise<string | undefined> {
    switch (this.config.provider) {
      case 'env':
        return process.env[`${this.config.keyPrefix}${key}`];
      case 'keychain':
        return this.getFromKeychain(key);
      case 'vault':
        return this.getFromVault(key);
    }
  }

  // Validate secrets exist before operations
  async validate(required: string[]): Promise<boolean> {
    for (const key of required) {
      if (!(await this.get(key))) {
        throw new ClaudeFlowError(
          `Missing required secret: ${key}`,
          ErrorCode.MODULE_INIT_FAILED,
          'secrets',
          false
        );
      }
    }
    return true;
  }
}
```

#### Agent Sandboxing

```typescript
// @claude-flow/agents sandboxing
interface SandboxConfig {
  maxMemoryMB: number;
  maxCpuPercent: number;
  allowedPaths: string[];
  networkAccess: 'none' | 'local' | 'restricted' | 'full';
  timeout: number;
}

const DEFAULT_SANDBOX: SandboxConfig = {
  maxMemoryMB: 512,
  maxCpuPercent: 50,
  allowedPaths: [process.cwd()],
  networkAccess: 'restricted',
  timeout: 30000
};
```

#### PII Handling

```typescript
// @claude-flow/memory PII scrubbing (from agentic-flow)
import { scrubPII, containsPII } from 'agentic-flow/reasoningbank';

class SecureMemoryStore {
  async store(key: string, data: any, options?: StoreOptions): Promise<void> {
    // Always scrub PII before storage
    const scrubbed = options?.allowPII ? data : scrubPII(data);

    if (containsPII(data) && !options?.allowPII) {
      this.emit('security:pii-scrubbed', { key, fieldsRemoved: true });
    }

    await this.backend.store(key, scrubbed);
  }
}
```

#### Audit Logging

```typescript
// @claude-flow/core audit
interface AuditEvent {
  timestamp: number;
  module: string;
  action: string;
  actor: string;  // Agent ID or 'user'
  resource?: string;
  outcome: 'success' | 'failure' | 'denied';
  metadata?: Record<string, any>;
}

class AuditLogger {
  log(event: AuditEvent): void {
    // Structured logging for compliance
    console.log(JSON.stringify({
      ...event,
      _type: 'audit',
      _version: '1.0'
    }));
  }
}
```

---

### 11.14 Telemetry & Observability

#### OpenTelemetry Integration

```typescript
// @claude-flow/core telemetry
import { trace, metrics, context } from '@opentelemetry/api';

class Telemetry {
  private tracer = trace.getTracer('@claude-flow/core');
  private meter = metrics.getMeter('@claude-flow/core');

  // Counters
  private hookCounter = this.meter.createCounter('claude_flow.hooks.total');
  private learningCounter = this.meter.createCounter('claude_flow.learning.patterns');
  private swarmGauge = this.meter.createUpDownCounter('claude_flow.swarm.agents');

  // Histograms
  private latencyHistogram = this.meter.createHistogram('claude_flow.operation.latency', {
    unit: 'ms',
    description: 'Operation latency'
  });

  // Tracing
  async traceOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      try {
        const result = await operation();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

#### Claude Code Compatible Metrics

```typescript
// Export format compatible with Claude Code telemetry
interface ClaudeCodeMetrics {
  // Session metrics
  session_id: string;
  session_duration_ms: number;

  // Tool usage
  tools_invoked: Record<string, number>;
  tool_success_rate: number;

  // Learning metrics (Claude-Flow specific)
  patterns_learned: number;
  learning_cycles: number;
  avg_pattern_quality: number;

  // Swarm metrics (Claude-Flow specific)
  agents_spawned: number;
  tasks_completed: number;
  consensus_rounds: number;

  // Performance
  avg_hook_latency_ms: number;
  avg_learning_latency_ms: number;
}
```

#### Distributed Tracing

```typescript
// Cross-agent tracing
class SwarmTracer {
  // Propagate trace context to spawned agents
  async spawnWithTrace(agentConfig: AgentConfig): Promise<Agent> {
    const span = this.tracer.startSpan('swarm.spawn');

    // Inject trace context into agent
    const traceContext = {};
    propagation.inject(context.active(), traceContext);

    const agent = await this.swarm.spawn({
      ...agentConfig,
      metadata: {
        ...agentConfig.metadata,
        _trace: traceContext
      }
    });

    span.setAttribute('agent.id', agent.id);
    span.setAttribute('agent.type', agentConfig.type);
    span.end();

    return agent;
  }
}
```

---

### 11.15 Migration Path (v2 → v3)

#### Breaking Changes

| v2 API | v3 API | Migration |
|--------|--------|-----------|
| `require('claude-flow')` | `import { ClaudeFlowCore } from '@claude-flow/core'` | ESM only |
| `claudeFlow.init()` | `new ClaudeFlowCore()` | Constructor-based |
| `claudeFlow.swarm.create()` | `import { createSwarm } from '@claude-flow/swarm'` | Modular import |
| `claudeFlow.memory.store()` | `memoryModule.store()` | Module instance |
| Callbacks | Promises/async-await | All async |

#### Automatic Migration (Codemod)

```bash
# Install migration tool
npx @claude-flow/migrate

# Analyze codebase
npx @claude-flow/migrate analyze ./src

# Apply migrations
npx @claude-flow/migrate run ./src --dry-run
npx @claude-flow/migrate run ./src
```

#### Codemod Transforms

```typescript
// transforms/imports.ts
export default function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Transform: require('claude-flow') → import
  root.find(j.CallExpression, {
    callee: { name: 'require' },
    arguments: [{ value: 'claude-flow' }]
  }).replaceWith(() =>
    j.importDeclaration(
      [j.importSpecifier(j.identifier('ClaudeFlowCore'))],
      j.literal('@claude-flow/core')
    )
  );

  return root.toSource();
}
```

#### Compatibility Shim (Temporary)

```typescript
// @claude-flow/compat - Temporary v2 compatibility
import { ClaudeFlowCore } from '@claude-flow/core';
import { HooksModule } from '@claude-flow/hooks';
import { SwarmModule } from '@claude-flow/swarm';
import { MemoryModule } from '@claude-flow/memory';

// v2-style API
export function createClaudeFlow(config?: any) {
  console.warn('[@claude-flow/compat] Deprecated: Migrate to v3 modular imports');

  const core = new ClaudeFlowCore();

  return {
    init: async () => {
      core.register(new HooksModule());
      core.register(new SwarmModule());
      core.register(new MemoryModule());
      await core.initialize();
    },
    swarm: {
      create: (opts: any) => core.getModule('swarm').createSwarm(opts)
    },
    memory: {
      store: (k: string, v: any) => core.getModule('memory').store(k, v)
    }
  };
}
```

#### Deprecation Timeline

| Version | Date | Status |
|---------|------|--------|
| v2.x | Current | Maintained (security only) |
| v3.0 | Release | v2 compat shim included |
| v3.1 | +3 months | Deprecation warnings |
| v3.2 | +6 months | Compat shim removed |

---

### 11.16 Plugin & Extension System

#### Plugin Interface

```typescript
// @claude-flow/core plugin system
interface ClaudeFlowPlugin {
  name: string;
  version: string;

  // Lifecycle hooks
  onCoreInit?(core: ClaudeFlowCore): Promise<void>;
  onModuleRegister?(module: ClaudeFlowModule): void;
  onEvent?(event: string, data: any): void;
  onShutdown?(): Promise<void>;

  // Extension points
  hooks?: HookDefinition[];
  agents?: AgentDefinition[];
  tools?: ToolDefinition[];
}

// Register plugin
core.use(myPlugin);
```

#### Custom Hook Registration

```typescript
// Third-party hook example
const securityPlugin: ClaudeFlowPlugin = {
  name: 'security-scanner',
  version: '1.0.0',

  hooks: [{
    id: 'security-scan',
    event: 'PreToolUse',
    priority: 100,  // Run before other hooks
    handler: async (ctx) => {
      if (ctx.tool === 'Bash') {
        const result = await scanCommand(ctx.args.command);
        if (result.dangerous) {
          return { block: true, reason: result.reason };
        }
      }
      return { allow: true };
    }
  }]
};
```

#### Custom Agent Types

```typescript
// Third-party agent
const customAgent: AgentDefinition = {
  id: 'my-custom-agent',
  type: 'custom-analyzer',
  capabilities: ['analyze', 'report'],
  systemPrompt: `You are a specialized analyzer...`,
  tools: [customTool1, customTool2]
};

// Register via plugin
const analyzerPlugin: ClaudeFlowPlugin = {
  name: 'custom-analyzer',
  version: '1.0.0',
  agents: [customAgent]
};

core.use(analyzerPlugin);
```

#### Extension Discovery

```bash
# Install community extension
npm install @community/claude-flow-security

# Auto-discovered via naming convention
# @*/claude-flow-* or claude-flow-plugin-*
```

---

### 11.17 Configuration Cascade

#### Configuration Sources (Priority Order)

1. **Programmatic** (highest) - `core.configure({ ... })`
2. **CLI flags** - `--swarm-topology=mesh`
3. **Environment variables** - `CLAUDE_FLOW_SWARM_TOPOLOGY=mesh`
4. **Project config** - `.claude-flow.json` or `claude-flow.config.js`
5. **User config** - `~/.claude-flow/config.json`
6. **Defaults** (lowest) - Built-in defaults

#### Configuration File

```json
// .claude-flow.json
{
  "$schema": "https://claude-flow.dev/schema.json",
  "version": "3.0",

  "core": {
    "telemetry": true,
    "debug": false
  },

  "hooks": {
    "enabled": ["preEdit", "postEdit", "route"],
    "timeout": 5000
  },

  "learning": {
    "algorithm": "PPO",
    "profile": "balanced",
    "autoLearn": true
  },

  "swarm": {
    "topology": "adaptive",
    "maxAgents": 10,
    "transport": "auto"
  },

  "memory": {
    "backend": "hybrid",
    "path": ".claude-flow/memory",
    "consolidationInterval": 3600000
  }
}
```

#### Environment Variable Mapping

```bash
# Pattern: CLAUDE_FLOW_<MODULE>_<OPTION>
CLAUDE_FLOW_LEARNING_ALGORITHM=PPO
CLAUDE_FLOW_SWARM_TOPOLOGY=mesh
CLAUDE_FLOW_MEMORY_BACKEND=sqlite
CLAUDE_FLOW_HOOKS_TIMEOUT=10000
```

#### Configuration API

```typescript
// @claude-flow/core configuration
class ConfigManager {
  // Load from all sources
  async load(): Promise<ResolvedConfig> {
    const sources = await Promise.all([
      this.loadDefaults(),
      this.loadUserConfig(),
      this.loadProjectConfig(),
      this.loadEnvVars(),
      this.loadCliFlags()
    ]);

    return this.merge(sources);
  }

  // Get with dot notation
  get<T>(path: string): T {
    return get(this.resolved, path);
  }

  // Watch for changes
  onChange(path: string, handler: (value: any) => void): void {
    this.watchers.set(path, handler);
  }
}
```

---

### 11.18 Build & CI/CD Pipeline

#### GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build
      - run: pnpm turbo test
      - run: pnpm turbo lint
      - run: pnpm turbo typecheck

  publish:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build

      # Changesets handles versioning and publishing
      - name: Create Release PR or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

#### Release Process

```bash
# 1. Create changeset for changes
pnpm changeset
# Select changed packages, write changelog entry

# 2. Version packages (CI does this on merge)
pnpm changeset version

# 3. Publish (CI does this automatically)
pnpm changeset publish
```

#### Canary Releases

```yaml
# .github/workflows/canary.yml
name: Canary Release

on:
  push:
    branches: [develop]

jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4

      - run: pnpm install
      - run: pnpm turbo build

      - name: Publish Canary
        run: |
          pnpm changeset version --snapshot canary
          pnpm changeset publish --tag canary
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

### 11.19 Offline & Degraded Mode

#### Feature Detection

```typescript
// @claude-flow/core feature detection
class FeatureDetector {
  async detect(): Promise<AvailableFeatures> {
    return {
      // Network features
      network: await this.checkNetwork(),
      quic: await this.checkQuic(),

      // Native features
      nativeBindings: await this.checkNative(),
      wasm: await this.checkWasm(),

      // Optional dependencies
      onnx: await this.checkOnnx(),
      sqlite: await this.checkSqlite()
    };
  }

  async checkNetwork(): Promise<boolean> {
    try {
      await fetch('https://api.anthropic.com/health', { method: 'HEAD' });
      return true;
    } catch {
      return false;
    }
  }
}
```

#### Offline Fallbacks

| Feature | Online | Offline Fallback |
|---------|--------|------------------|
| Embeddings | OpenAI API | ONNX local model |
| Vector search | Remote DB | Local SQLite |
| Learning | Cloud training | Local SONA |
| Swarm | QUIC transport | Local process |
| Agent routing | API-based | Pattern cache |

#### Degraded Mode Configuration

```typescript
// @claude-flow/core degraded mode
interface DegradedModeConfig {
  // What to do when network unavailable
  offline: {
    allowLocalOnly: boolean;
    cachePatterns: boolean;
    queueRemoteOps: boolean;
  };

  // What to do when native bindings fail
  nativeFailure: {
    fallbackToWasm: boolean;
    fallbackToJs: boolean;
  };

  // What to do when optional modules missing
  missingModules: {
    continueWithoutLearning: boolean;
    continueWithoutSwarm: boolean;
  };
}

const DEFAULT_DEGRADED: DegradedModeConfig = {
  offline: {
    allowLocalOnly: true,
    cachePatterns: true,
    queueRemoteOps: true
  },
  nativeFailure: {
    fallbackToWasm: true,
    fallbackToJs: true
  },
  missingModules: {
    continueWithoutLearning: true,
    continueWithoutSwarm: true
  }
};
```

---

## 12. Conclusion

### 12.1 SDK Foundation

**agentic-flow@alpha provides everything Claude-Flow v3 needs:**

- ✅ 19 hook tools for comprehensive integration
- ✅ 9 RL algorithms for adaptive learning
- ✅ Production wrappers fixing alpha issues
- ✅ SONA + AgentDB with 1.25ms training latency
- ✅ QUIC swarm coordination with attention mechanisms
- ✅ Cross-platform SQLite persistence
- ✅ Modular installation tiers

### 12.2 Modular Package Architecture

**Claude-Flow v3 will be a modular constellation of 10 npm packages:**

| Package | Purpose | Size | Standalone |
|---------|---------|------|------------|
| `@claude-flow/core` | Central connector | ~50KB | ✅ |
| `@claude-flow/hooks` | Claude Code events | ~200KB | ✅ |
| `@claude-flow/learning` | Self-optimization | ~2MB | ✅ |
| `@claude-flow/swarm` | Multi-agent coordination | ~1MB | ✅ |
| `@claude-flow/memory` | Persistent storage | ~500KB | ✅ |
| `@claude-flow/agents` | Agent definitions | ~300KB | ✅ |
| `@claude-flow/mcp` | MCP server/tools | ~400KB | ✅ |
| `@claude-flow/neural` | Neural operations | ~1MB | ✅ |
| `@claude-flow/attention` | Agent consensus | ~200KB | ✅ |
| `@claude-flow/vector` | HNSW search | ~800KB | ✅ |
| `@claude-flow/cli` | CLI interface | ~100KB | ❌ |

### 12.3 Key Architectural Decisions

1. **Use agentic-flow@alpha as underlying SDK** - Don't reinvent, wrap
2. **Optional peer dependencies** - Packages work alone or together
3. **Event-driven communication** - Core provides event bus
4. **Progressive enhancement** - More packages = more features
5. **NOT directly import @ruvector/*** - Use agentic-flow wrappers

### 12.4 Implementation Roadmap

**Phase 1: Core Packages**
- `@claude-flow/core` - Event bus, configuration, module registry
- `@claude-flow/hooks` - Claude Code event mapping
- `@claude-flow/cli` - Basic CLI with init/status

**Phase 2: Learning Stack**
- `@claude-flow/learning` - SONA + AgentDB integration
- `@claude-flow/memory` - ReasoningBank wrapper
- `@claude-flow/vector` - HNSW indexing

**Phase 3: Swarm Stack**
- `@claude-flow/swarm` - QUIC coordination
- `@claude-flow/agents` - Agent definitions
- `@claude-flow/attention` - Consensus mechanisms

**Phase 4: Neural Stack**
- `@claude-flow/neural` - Attention mechanisms
- `@claude-flow/mcp` - Full MCP server

### 12.5 Final Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         claude-flow (meta-package)                       │
│                      npm install claude-flow@3                           │
├─────────────────────────────────────────────────────────────────────────┤
│  @claude-flow/*                                                          │
│  ┌───────┬─────────┬───────┬────────┬────────┬──────┬──────┬─────────┐ │
│  │ core  │  hooks  │ learn │ swarm  │ memory │agents│ mcp  │ neural  │ │
│  └───────┴─────────┴───────┴────────┴────────┴──────┴──────┴─────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│                    agentic-flow@2.0.1-alpha (SDK)                        │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ hooks │ swarm │ reasoningbank │ coordination │ services │ workers │ │
│  └────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│                       @ruvector/* (underlying)                           │
│  ┌───────────────┬────────────────┬─────────────────┬─────────────────┐ │
│  │ @ruvector/core│ @ruvector/sona │ @ruvector/attn  │ @ruvector/gnn   │ │
│  │   (HNSW)      │   (LoRA)       │   (Attention)   │   (GNN)         │ │
│  └───────────────┴────────────────┴─────────────────┴─────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

This modular architecture enables:
- **Mix and match** - Use only what you need
- **Independent operation** - Each package works alone
- **Seamless integration** - Core connects everything
- **Progressive enhancement** - Add capabilities incrementally
- **Lightweight installs** - From 50KB (core) to 15MB (full)

---

## 13. Background Worker System

### 13.1 Overview

The agentic-flow worker system provides **non-blocking background workers** triggered by keywords in prompts. Workers run silently, depositing results into memory for later retrieval.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Prompt                                  │
│           "ultralearn the authentication system"                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    TriggerDetector (<5ms)                            │
│                    - Regex keyword matching                          │
│                    - Topic extraction                                │
│                    - Cooldown management                             │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   WorkerDispatchService                              │
│  ┌─────────────┬─────────────┬─────────────┬─────────────────────┐ │
│  │  Registry   │  Governor   │  RuVector   │  Worker Factory     │ │
│  │  (CRUD)     │  (Limits)   │ (Learning)  │  (Custom Workers)   │ │
│  └─────────────┴─────────────┴─────────────┴─────────────────────┘ │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Consolidated Phase System                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ file-discovery → pattern-extraction → embedding → vector-store  ││
│  │ security-analysis → complexity-analysis → dependency-discovery  ││
│  │ api-discovery → todo-extraction → summarization                 ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Memory Deposits                                   │
│                    ultralearn/{topic}/{phase} → ReasoningBank        │
└─────────────────────────────────────────────────────────────────────┘
```

### 13.2 Built-in Workers (12 Types)

| Worker | Keyword | Priority | Timeout | Description |
|--------|---------|----------|---------|-------------|
| `ultralearn` | ultralearn | high | 5min | Deep research swarm for codebase learning |
| `optimize` | optimize | medium | 3min | Performance analyzer and cache optimizer |
| `consolidate` | consolidate | low | 2min | Memory compaction and pattern extraction |
| `predict` | predict | medium | 1min | Pre-fetch likely files based on patterns |
| `audit` | audit | high | 5min | Security and code quality scan |
| `map` | map | medium | 4min | Build full dependency graph |
| `preload` | preload | low | 30s | Pre-fetch context for faster access |
| `deepdive` | deepdive | high | 10min | Traces call paths 5+ levels deep |
| `document` | document | low | 3min | Generate documentation for patterns |
| `refactor` | refactor | medium | 3min | Identify refactoring opportunities |
| `benchmark` | benchmark | medium | 5min | Run performance benchmarks silently |
| `testgaps` | testgaps | medium | 3min | Find untested code paths |

### 13.3 Core Components

#### TriggerDetector

Fast keyword detection with <5ms target latency:

```typescript
import { TriggerDetector, getTriggerDetector } from 'agentic-flow/workers';

const detector = getTriggerDetector();

// Detect triggers in prompt
const triggers = detector.detect('ultralearn the auth system');
// [{ keyword: 'ultralearn', topic: 'auth system', config: {...} }]

// Fast boolean check
if (detector.hasTriggers(prompt)) {
  // Contains worker triggers
}

// Cooldown management
detector.isOnCooldown('ultralearn');  // Check cooldown
detector.clearCooldown('ultralearn'); // Clear for testing
```

#### WorkerDispatchService

Main dispatcher with RuVector integration:

```typescript
import { getWorkerDispatchService } from 'agentic-flow/workers';

const dispatcher = getWorkerDispatchService();

// Dispatch single worker
const workerId = await dispatcher.dispatch('ultralearn', 'auth', sessionId);

// Dispatch from prompt (parallel by default)
const { triggers, workerIds } = await dispatcher.dispatchFromPrompt(
  'ultralearn auth and audit security',
  sessionId,
  { parallel: true }
);

// Monitor worker
dispatcher.on('worker:progress', ({ workerId, progress, phase }) => {
  console.log(`${workerId}: ${phase} (${progress}%)`);
});

dispatcher.on('worker:complete', ({ workerId, results, duration }) => {
  console.log(`Completed in ${duration}ms`);
});

// Get status
const status = dispatcher.getStatus(workerId);
const active = dispatcher.getActiveWorkers(sessionId);

// Cancel worker
dispatcher.cancel(workerId);

// Wait for completion
const result = await dispatcher.awaitCompletion(workerId, 60000);
```

#### Consolidated Phase System

Unified phase execution with SIMD-accelerated operations:

```typescript
// Available phases
const PHASES = [
  'file-discovery',      // Glob file search
  'pattern-extraction',  // Extract functions, classes, imports
  'embedding-generation',// ONNX SIMD-accelerated embeddings
  'vector-storage',      // Store in HNSW index
  'security-analysis',   // Scan for secrets, XSS, injection
  'complexity-analysis', // Cyclomatic complexity
  'dependency-discovery',// Import/require analysis
  'api-discovery',       // REST/GraphQL endpoint detection
  'todo-extraction',     // TODO/FIXME/HACK extraction
  'summarization'        // Aggregate results
];

// Run unified pipeline
import { runUnifiedPipeline } from 'agentic-flow/workers';

const result = await runUnifiedPipeline(
  workerContext,
  ['file-discovery', 'pattern-extraction', 'security-analysis'],
  { patterns: ['**/*.ts'], maxFiles: 100 }
);
```

#### Worker-Agent Integration

Links workers to optimal agents based on performance:

```typescript
import { workerAgentIntegration } from 'agentic-flow/workers';

// Get recommended agents for trigger
const { primary, fallback, phases } =
  workerAgentIntegration.getRecommendedAgents('ultralearn');
// primary: ['researcher', 'coder']
// fallback: ['planner']

// Select best agent based on performance history
const { agent, confidence, reasoning } =
  workerAgentIntegration.selectBestAgent('audit');
// agent: 'security-analyst'
// confidence: 0.85
// reasoning: 'Selected based on 42 executions with 95% success'

// Record feedback for learning
workerAgentIntegration.recordFeedback(
  'audit', 'security-analyst',
  true,  // success
  250,   // latencyMs
  0.92   // qualityScore
);

// Agent capability mapping
const AGENT_CAPABILITIES = {
  'researcher': ['ultralearn', 'deepdive', 'map'],
  'coder': ['optimize', 'refactor'],
  'tester': ['testgaps', 'audit'],
  'security-analyst': ['audit', 'deepdive'],
  'performance-analyzer': ['benchmark', 'optimize'],
  'documenter': ['document']
};
```

### 13.4 Custom Workers

Define custom workers via YAML config:

```yaml
# workers.yaml or .agentic-flow/workers.yaml
version: '1.0'

workers:
  - name: my-scanner
    description: Custom code scanner
    triggers: ['scan-my', 'myscan']
    priority: medium
    timeout: 120000
    phases:
      - type: file-discovery
        options:
          patterns: ['**/*.ts', '**/*.tsx']
          maxFiles: 200
      - type: pattern-extraction
      - type: security-analysis
      - type: summarization
    capabilities:
      onnxEmbeddings: true
      vectorDb: true
      sonaLearning: true
    output:
      format: detailed
      includeSamples: true
      maxSamples: 20

settings:
  defaultCapabilities:
    progressEvents: true
  maxConcurrent: 3
```

#### Custom Worker Factory

```typescript
import { createCustomWorker, createFromPreset } from 'agentic-flow/workers';

// From definition
const worker = createCustomWorker({
  name: 'my-worker',
  phases: [
    { type: 'file-discovery' },
    { type: 'security-analysis' }
  ]
});

// From preset
const preset = createFromPreset('security-scanner', {
  name: 'enhanced-scanner',
  timeout: 180000
});

// Register with manager
import { customWorkerManager } from 'agentic-flow/workers';

customWorkerManager.register(worker);
customWorkerManager.registerPreset('code-analyzer');
await customWorkerManager.loadFromConfig('./workers.yaml');

// Execute
const result = await customWorkerManager.execute('my-scanner', context);
```

### 13.5 Benchmark System

Performance testing for worker operations:

```typescript
import { workerBenchmarks, runBenchmarks } from 'agentic-flow/workers';

// Run full suite
const suite = await runBenchmarks();

// Individual benchmarks
await workerBenchmarks.benchmarkTriggerDetection(1000);  // Target: p95 <5ms
await workerBenchmarks.benchmarkRegistryOperations(500); // Target: p95 <10ms
await workerBenchmarks.benchmarkAgentSelection(1000);    // Target: p95 <1ms
await workerBenchmarks.benchmarkModelCache(100);         // Target: p95 <0.5ms
await workerBenchmarks.benchmarkConcurrentWorkers(10);   // Target: <1s total
await workerBenchmarks.benchmarkMemoryKeyGeneration(5000); // Target: p95 <0.1ms

// Results
console.log(suite.summary);
// {
//   totalTests: 6,
//   passed: 6,
//   failed: 0,
//   avgLatencyMs: 0.42,
//   totalDurationMs: 1250,
//   peakMemoryMB: 12.5
// }
```

### 13.6 RuVector Integration

Workers integrate with RuVector for learning:

```typescript
import { getRuVectorWorkerIntegration } from 'agentic-flow/workers';

const ruvector = getRuVectorWorkerIntegration();
await ruvector.initialize();

// During worker execution:
// 1. Start trajectory tracking
const trajectoryId = await ruvector.startTrajectory(
  workerId, trigger, topic
);

// 2. Record phase steps
await ruvector.recordStep(trajectoryId, 'file-discovery', {
  duration: 150,
  memoryDeposits: 5,
  successRate: 1.0
});

// 3. Complete with learning
const learningResult = await ruvector.completeTrajectory(
  trajectoryId,
  workerResults
);
// {
//   qualityScore: 0.85,
//   patternsLearned: 3,
//   sonaAdaptation: true
// }

// 4. Find patterns for future runs
const patterns = await ruvector.findPatterns(topic, 5);
```

### 13.7 @claude-flow/workers Package

Claude-Flow v3 workers package specification:

```typescript
// @claude-flow/workers
// Dependencies: @claude-flow/core (optional peer)
// SDK: agentic-flow/workers

export interface WorkersConfig {
  enabled: string[];           // Which workers to enable
  customConfig?: string;       // Path to workers.yaml
  maxConcurrent?: number;      // Max parallel workers
  defaultTimeout?: number;     // Default timeout
}

// Exports
export {
  // Core
  WorkerDispatchService,
  getWorkerDispatchService,

  // Detection
  TriggerDetector,
  getTriggerDetector,
  TRIGGER_CONFIGS,

  // Registry
  WorkerRegistry,
  getWorkerRegistry,

  // Resource Management
  ResourceGovernor,
  getResourceGovernor,

  // Custom Workers
  CustomWorkerManager,
  customWorkerManager,
  createCustomWorker,
  createFromPreset,

  // Agent Integration
  WorkerAgentIntegration,
  workerAgentIntegration,
  getAgentForTrigger,
  recordAgentPerformance,

  // Phases
  runUnifiedPipeline,
  listUnifiedPhases,
  registerUnifiedPhase,

  // Benchmarks
  WorkerBenchmarks,
  workerBenchmarks,
  runBenchmarks,

  // RuVector
  RuVectorWorkerIntegration,
  getRuVectorWorkerIntegration
};
```

### 13.8 Integration with v3 Hooks

Workers can be triggered from Claude Code hooks:

```typescript
import { HooksModule } from '@claude-flow/hooks';
import { WorkersModule } from '@claude-flow/workers';

const core = new ClaudeFlowCore();
core.register(new HooksModule());
core.register(new WorkersModule());

// Hook triggers worker on keyword detection
core.on('hook:triggered', async ({ hookId, event, data }) => {
  if (hookId === 'route' && data.prompt) {
    const workersModule = core.getModule<WorkersModule>('workers');
    await workersModule.dispatchFromPrompt(data.prompt, data.sessionId);
  }
});

// Worker results available to learning
core.on('worker:complete', async ({ workerId, results }) => {
  const learningModule = core.getModule<LearningModule>('learning');
  await learningModule.train({
    type: 'worker-result',
    data: results,
    quality: results.success ? 0.9 : 0.3
  });
});
```

---

*Document Version: 1.1.0*
*Last Updated: 2026-01-03*
*Based on: agentic-flow@2.0.1-alpha.50, ruvector@0.1.95*
