# Claude-Flow v3: Optimized Learning System Plan

## Executive Summary

This plan integrates the learning capabilities from **agentic-flow@2.0.1-alpha.50** and **agentdb@2.0.0-alpha.3.1** to create a comprehensive self-learning system optimized for speed, memory efficiency, and continuous improvement.

### Key Components

| Package | Learning Features | Performance |
|---------|------------------|-------------|
| **agentic-flow** | Intelligence Bridge, SONA, Trajectory Tracking | 50-200x faster |
| **agentdb** | 9 RL Algorithms, Reflexion Memory, Causal Discovery | FlashAttention-enabled |

---

## 1. Learning Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Claude-Flow v3 Learning System                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Pre-Task Learning Hooks                         ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 ││
│  │  │ Pattern     │  │ Skill       │  │ Causal      │                 ││
│  │  │ Retrieval   │  │ Lookup      │  │ Query       │                 ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                │                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                    During-Task Trajectory Tracking                   ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 ││
│  │  │ SONA        │  │ Experience  │  │ Real-time   │                 ││
│  │  │ Trajectory  │  │ Recording   │  │ Feedback    │                 ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                │                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Post-Task Learning Hooks                         ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 ││
│  │  │ Pattern     │  │ Skill       │  │ Causal Edge │                 ││
│  │  │ Storage     │  │ Evolution   │  │ Discovery   │                 ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                │                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                    Background Learning (Nightly)                     ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 ││
│  │  │ Nightly     │  │ A/B         │  │ Policy      │                 ││
│  │  │ Learner     │  │ Experiments │  │ Training    │                 ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Hooks Integration (agentic-flow + agentdb)

### 2.1 Combined Hook Tools (28 Total)

**From agentic-flow (19 hooks)**:

| Hook Tool | Category | Purpose |
|-----------|----------|---------|
| `hook_pre_edit` | Edit | Pre-process file edits |
| `hook_post_edit` | Edit | Post-process, store patterns |
| `hook_pre_command` | Command | Validate commands |
| `hook_post_command` | Command | Track outcomes |
| `hook_route` | Routing | Intelligent task routing |
| `hook_explain` | XAI | Explainable decisions |
| `hook_pretrain` | Learning | Pre-training preparation |
| `hook_build_agents` | Swarm | Agent construction |
| `hook_metrics` | Metrics | Performance tracking |
| `hook_transfer` | Learning | Transfer learning |
| `intelligence_route` | Intelligence | Smart task routing |
| `intelligence_trajectory_start` | Trajectory | Begin tracking |
| `intelligence_trajectory_step` | Trajectory | Record step |
| `intelligence_trajectory_end` | Trajectory | Complete with verdict |
| `intelligence_pattern_store` | Pattern | Store successful patterns |
| `intelligence_pattern_search` | Pattern | Find similar patterns |
| `intelligence_stats` | Stats | Learning statistics |
| `intelligence_learn` | Learning | Force learning cycle |
| `intelligence_attention` | Attention | Attention similarity |

**From agentdb (9 new learning hooks)**:

| Hook Tool | Category | Purpose |
|-----------|----------|---------|
| `learning_start_session` | RL | Start RL session (9 algorithms) |
| `learning_end_session` | RL | Complete session, save policy |
| `learning_predict` | RL | Get action prediction |
| `learning_feedback` | RL | Submit reward feedback |
| `learning_train` | RL | Batch policy training |
| `learning_metrics` | Metrics | Performance metrics |
| `learning_transfer` | Transfer | Cross-task learning |
| `learning_explain` | XAI | Explainable recommendations |
| `experience_record` | Experience | Record tool executions |

### 2.2 Hook Integration Architecture

```typescript
// src/v3/hooks/learning-integration.ts
import {
  // agentic-flow hooks
  beginTaskTrajectory,
  recordTrajectoryStep,
  endTaskTrajectory,
  storePattern,
  findSimilarPatterns,
  forceLearningCycle,
  computeAttentionSimilarity
} from 'agentic-flow/mcp/fastmcp/tools/hooks';

import {
  // agentdb hooks via MCP
  LearningSystem,
  ReflexionMemory,
  SkillLibrary,
  CausalMemoryGraph,
  NightlyLearner
} from 'agentdb';

export class IntegratedLearningHooks {
  private agentic: AgenticFlowHooks;
  private agentdb: LearningSystem;
  private reflexion: ReflexionMemory;
  private skills: SkillLibrary;
  private causal: CausalMemoryGraph;
  private nightly: NightlyLearner;

  // Pre-task: Query both systems for context
  async preTask(task: Task): Promise<LearningContext> {
    const [
      patterns,           // agentic-flow patterns
      skills,             // agentdb skills
      causalEffects,      // agentdb causal predictions
      similarEpisodes     // agentdb reflexion memory
    ] = await Promise.all([
      findSimilarPatterns(task.description, { k: 5 }),
      this.skills.searchSkills(task.description, 5),
      this.causal.query({ cause: task.type }),
      this.reflexion.retrieve(task.description, 5)
    ]);

    return {
      suggestedPatterns: patterns,
      relevantSkills: skills,
      predictedEffects: causalEffects,
      pastExperiences: similarEpisodes,
      confidence: this.calculateConfidence(patterns, skills)
    };
  }

  // During-task: Dual trajectory tracking
  async trackStep(step: TaskStep): Promise<void> {
    await Promise.all([
      // agentic-flow trajectory
      recordTrajectoryStep({
        stepId: step.id,
        action: step.action,
        observation: step.observation,
        reward: step.reward
      }),
      // agentdb experience recording
      this.agentdb.recordExperience({
        sessionId: step.sessionId,
        toolName: step.tool,
        action: step.action,
        outcome: step.outcome,
        reward: step.reward,
        success: step.success,
        latencyMs: step.latency
      })
    ]);
  }

  // Post-task: Store learning in both systems
  async postTask(task: Task, result: TaskResult): Promise<void> {
    // End trajectory with verdict
    await endTaskTrajectory({
      taskId: task.id,
      success: result.success,
      verdict: result.success ? 'positive' : 'negative',
      reward: result.quality
    });

    // Store in agentdb reflexion memory
    await this.reflexion.store({
      sessionId: task.sessionId,
      task: task.description,
      input: task.input,
      output: result.output,
      critique: result.critique,
      reward: result.quality,
      success: result.success,
      latencyMs: result.latency
    });

    // Create/update skill if high quality
    if (result.success && result.quality > 0.8) {
      await Promise.all([
        // agentic-flow pattern
        storePattern({
          pattern: task.description,
          solution: result.output,
          confidence: result.quality
        }),
        // agentdb skill
        this.skills.createOrUpdate({
          name: task.skillName || task.type,
          description: task.description,
          code: result.code,
          successRate: result.quality
        })
      ]);
    }

    // Discover causal relationships
    await this.causal.observeAndLearn({
      action: task.type,
      outcome: result.outcome,
      reward: result.quality
    });
  }
}
```

---

## 3. MCP Tools Integration (Combined 45+ Tools)

### 3.1 Core Learning MCP Tools

**agentic-flow MCP Tools (Learning)**:

```typescript
// Intelligence Bridge (9 tools)
const agenticFlowLearningTools = [
  'intelligence_route',           // Smart task routing
  'intelligence_trajectory_start', // Begin trajectory
  'intelligence_trajectory_step',  // Record step
  'intelligence_trajectory_end',   // Complete trajectory
  'intelligence_pattern_store',    // Store pattern
  'intelligence_pattern_search',   // Find patterns
  'intelligence_stats',            // Learning stats
  'intelligence_learn',            // Force learning
  'intelligence_attention'         // Attention similarity
];

// SONA Tools (9 tools)
const sonaTools = [
  'sona_trajectory_begin',
  'sona_trajectory_step',
  'sona_trajectory_end',
  'sona_pattern_find',
  'sona_pattern_store',
  'sona_micro_lora_train',
  'sona_apply_micro_lora',
  'sona_learning_status',
  'sona_force_consolidation'
];
```

**agentdb MCP Tools (Learning)**:

```typescript
// Core Learning System (10 tools)
const agentdbLearningTools = [
  'learning_start_session',  // Start RL session
  'learning_end_session',    // End session
  'learning_predict',        // Get predictions
  'learning_feedback',       // Submit feedback
  'learning_train',          // Train policy
  'learning_metrics',        // Performance metrics
  'learning_transfer',       // Transfer learning
  'learning_explain',        // XAI explanations
  'experience_record',       // Record experiences
  'reward_signal'            // Calculate rewards
];

// Reflexion Memory (2 tools)
const reflexionTools = [
  'reflexion_store',
  'reflexion_retrieve'
];

// Skill Library (2 tools)
const skillTools = [
  'skill_create',
  'skill_search'
];

// Causal Memory (3 tools)
const causalTools = [
  'causal_add_edge',
  'causal_query',
  'learner_discover'
];

// Recall with Provenance (1 tool)
const recallTools = [
  'recall_with_certificate'
];
```

### 3.2 MCP Tool Coordination

```typescript
// src/v3/mcp/learning-coordinator.ts
export class LearningMCPCoordinator {
  private agenticFlowMcp: AgenticFlowMCPClient;
  private agentdbMcp: AgentDBMCPClient;

  async smartRoute(task: Task): Promise<RoutingDecision> {
    // Use agentic-flow for intelligent routing
    const routeResult = await this.agenticFlowMcp.call('intelligence_route', {
      task: task.description,
      context: task.context
    });

    // Enhance with agentdb causal predictions
    const causalEffects = await this.agentdbMcp.call('causal_query', {
      cause: routeResult.suggestedAction,
      min_confidence: 0.7
    });

    return {
      action: routeResult.suggestedAction,
      confidence: routeResult.confidence,
      predictedEffects: causalEffects,
      agentType: this.selectBestAgent(routeResult, causalEffects)
    };
  }

  async learnFromExecution(
    sessionId: string,
    task: Task,
    result: TaskResult
  ): Promise<void> {
    // Parallel learning updates
    await Promise.all([
      // agentic-flow pattern storage
      this.agenticFlowMcp.call('intelligence_pattern_store', {
        pattern: task.description,
        solution: result.output,
        confidence: result.quality
      }),

      // agentdb reflexion storage
      this.agentdbMcp.call('reflexion_store', {
        session_id: sessionId,
        task: task.description,
        reward: result.quality,
        success: result.success,
        critique: result.critique
      }),

      // agentdb skill evolution
      result.success && result.quality > 0.8 ?
        this.agentdbMcp.call('skill_create', {
          name: task.skillName,
          description: task.description,
          code: result.code,
          success_rate: result.quality
        }) : Promise.resolve(),

      // agentdb causal edge discovery
      this.agentdbMcp.call('causal_add_edge', {
        cause: task.type,
        effect: result.outcome,
        uplift: result.quality - 0.5,  // Centered around baseline
        confidence: result.confidence
      })
    ]);
  }
}
```

---

## 4. Reinforcement Learning Integration

### 4.1 Supported RL Algorithms (9 Total)

| Algorithm | Use Case | Config |
|-----------|----------|--------|
| **Q-Learning** | Simple tasks, tabular | `{ learningRate: 0.1, discountFactor: 0.99 }` |
| **SARSA** | On-policy, safer exploration | `{ learningRate: 0.1, discountFactor: 0.99 }` |
| **DQN** | Complex state spaces | `{ learningRate: 0.001, batchSize: 32 }` |
| **Policy Gradient** | Continuous actions | `{ learningRate: 0.001 }` |
| **Actor-Critic** | Balanced value/policy | `{ actorLR: 0.001, criticLR: 0.01 }` |
| **PPO** | Stable training | `{ clipEpsilon: 0.2, epochs: 10 }` |
| **Decision Transformer** | Offline RL | `{ contextLength: 20, targetReturn: 1.0 }` |
| **MCTS** | Planning, search | `{ simulations: 100, explorationC: 1.4 }` |
| **Model-Based** | Sample efficient | `{ modelLR: 0.001, planningSteps: 5 }` |

### 4.2 RL Session Management

```typescript
// src/v3/learning/rl-session.ts
import { LearningSystem } from 'agentdb';

export class RLSessionManager {
  private learning: LearningSystem;
  private activeSessions: Map<string, RLSession> = new Map();

  async startSession(
    userId: string,
    algorithm: RLAlgorithm,
    config: RLConfig
  ): Promise<string> {
    const sessionId = await this.learning.startSession(userId, algorithm, {
      learningRate: config.learningRate || 0.01,
      discountFactor: config.discountFactor || 0.99,
      explorationRate: config.explorationRate || 0.1,
      batchSize: config.batchSize || 32
    });

    this.activeSessions.set(sessionId, {
      id: sessionId,
      algorithm,
      config,
      startTime: Date.now(),
      episodeCount: 0
    });

    return sessionId;
  }

  async predict(sessionId: string, state: string): Promise<Prediction> {
    return this.learning.predict(sessionId, state);
  }

  async feedback(
    sessionId: string,
    state: string,
    action: string,
    reward: number,
    nextState: string,
    success: boolean
  ): Promise<void> {
    await this.learning.submitFeedback({
      sessionId,
      state,
      action,
      reward,
      nextState,
      success,
      timestamp: Date.now()
    });

    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.episodeCount++;
    }
  }

  async train(
    sessionId: string,
    epochs: number = 10,
    batchSize: number = 32
  ): Promise<TrainingResult> {
    return this.learning.train(sessionId, epochs, batchSize, 0.01);
  }

  async endSession(sessionId: string): Promise<SessionSummary> {
    await this.learning.endSession(sessionId);
    const session = this.activeSessions.get(sessionId);
    this.activeSessions.delete(sessionId);

    return {
      sessionId,
      duration: Date.now() - session.startTime,
      episodeCount: session.episodeCount,
      algorithm: session.algorithm
    };
  }
}
```

---

## 5. Nightly Learning Optimization

### 5.1 NightlyLearner Configuration

```typescript
// src/v3/learning/nightly-config.ts
export const nightlyLearnerConfig = {
  // Causal discovery
  minSimilarity: 0.7,
  minSampleSize: 30,
  confidenceThreshold: 0.6,
  upliftThreshold: 0.05,

  // Edge pruning
  pruneOldEdges: true,
  edgeMaxAgeDays: 90,

  // A/B experiments
  autoExperiments: true,
  experimentBudget: 10,

  // FlashAttention (v2 feature)
  ENABLE_FLASH_CONSOLIDATION: true,
  flashConfig: {
    blockSize: 256,
    headDim: 64,
    numHeads: 8
  },

  // Schedule
  schedule: '0 2 * * *'  // 2 AM daily
};
```

### 5.2 Nightly Learning Pipeline

```typescript
// src/v3/learning/nightly-pipeline.ts
import { NightlyLearner } from 'agentdb';
import { forceLearningCycle } from 'agentic-flow/mcp/fastmcp/tools/hooks';

export class NightlyLearningPipeline {
  private learner: NightlyLearner;

  async run(): Promise<NightlyReport> {
    console.log('Nightly Learning Pipeline Starting...');

    // Phase 1: Causal edge discovery
    const edgesDiscovered = await this.learner.discoverCausalEdges();

    // Phase 2: Complete A/B experiments
    const experimentsCompleted = await this.learner.completeExperiments();

    // Phase 3: Create new experiments
    const experimentsCreated = await this.learner.createExperiments();

    // Phase 4: Prune low-confidence edges
    const edgesPruned = await this.learner.pruneEdges();

    // Phase 5: Consolidate episodes with FlashAttention
    const consolidation = await this.learner.consolidateEpisodes();

    // Phase 6: Force agentic-flow learning cycle
    await forceLearningCycle();

    // Phase 7: Transfer learning between similar tasks
    await this.runTransferLearning();

    return {
      edgesDiscovered,
      edgesPruned,
      experimentsCompleted,
      experimentsCreated,
      episodesConsolidated: consolidation.episodesProcessed,
      transfersCompleted: this.transferCount
    };
  }

  private async runTransferLearning(): Promise<void> {
    // Find similar task pairs for transfer
    const taskPairs = await this.findSimilarTaskPairs();

    for (const pair of taskPairs) {
      if (pair.similarity >= 0.8) {
        await this.learner.transferLearning({
          sourceTask: pair.source,
          targetTask: pair.target,
          minSimilarity: 0.7,
          transferType: 'all'
        });
        this.transferCount++;
      }
    }
  }
}
```

---

## 6. Performance Optimization

### 6.1 Speed Optimizations

| Component | Optimization | Speedup |
|-----------|-------------|---------|
| **AgentDB** | EnhancedAgentDBWrapper | 50-200x |
| **Pattern Search** | GNN-enhanced | +12.4% recall |
| **Consolidation** | FlashAttention | 4x faster, 75% less memory |
| **Batch Operations** | Transaction batching | 10-50x |
| **Embeddings** | HNSW index | 150x faster search |

### 6.2 Memory Optimizations

```typescript
// src/v3/learning/memory-config.ts
export const memoryOptimizations = {
  // Query caching
  queryCache: {
    maxSize: 1000,
    ttlMs: 60000
  },

  // Embedding cache
  embeddingCache: {
    maxSize: 10000,
    ttlMs: 3600000
  },

  // Episode buffer
  episodeBuffer: {
    maxSize: 1000,
    flushThreshold: 100
  },

  // FlashAttention
  flashAttention: {
    blockSize: 256,  // Optimal for memory efficiency
    causalMask: true,
    dropout: 0.0
  },

  // Quantization
  quantization: {
    enabled: true,
    bits: 8,  // 4x memory reduction
    method: 'scalar'
  }
};
```

---

## 7. Implementation Checklist

### Phase 1: Core Integration (Week 1)
- [ ] Install `agentdb@2.0.0-alpha.3.1`
- [ ] Update `agentic-flow@2.0.1-alpha.0`
- [ ] Create `IntegratedLearningHooks` class
- [ ] Connect MCP tools from both packages

### Phase 2: Hook System (Week 2)
- [ ] Implement pre-task hooks with dual lookup
- [ ] Implement during-task trajectory tracking
- [ ] Implement post-task dual storage
- [ ] Add FlashAttention consolidation

### Phase 3: RL System (Week 3)
- [ ] Implement `RLSessionManager`
- [ ] Connect 9 RL algorithms
- [ ] Add prediction and feedback pipeline
- [ ] Implement batch training

### Phase 4: Nightly Learning (Week 4)
- [ ] Configure `NightlyLearner`
- [ ] Enable FlashAttention consolidation
- [ ] Set up A/B experiments
- [ ] Implement transfer learning pipeline

---

## 8. Expected Outcomes

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Pattern retrieval | 500ms | 20ms | **25x faster** |
| Learning cycle | Manual | Automatic | **Continuous** |
| RL algorithms | 0 | 9 | **Full suite** |
| Causal discovery | Manual | Automated | **Nightly** |
| Transfer learning | None | Automatic | **Cross-task** |
| Memory efficiency | 100% | 25% | **75% reduction** |

---

## 9. Modular Learning Installation

### 9.1 Learning Component Tiers

```bash
# Tier 1: Basic Learning (Minimal)
npx claude-flow install learning:basic
# Includes: Pattern storage, skill lookup, basic RL (Q-Learning, SARSA)
# Size: ~1MB | Platforms: All

# Tier 2: Standard Learning (Recommended)
npx claude-flow install learning
# Includes: Tier 1 + 5 more RL algorithms, reflexion memory, trajectory tracking
# Size: ~2MB | Platforms: All

# Tier 3: Advanced Learning (Full)
npx claude-flow install learning:advanced
# Includes: Tier 2 + causal graphs, nightly learner, FlashAttention
# Size: ~4MB | Platforms: All (NAPI for FlashAttention speedup)
```

### 9.2 Learning Feature Matrix

| Feature | Basic | Standard | Advanced |
|---------|-------|----------|----------|
| Pattern Storage | ✓ | ✓ | ✓ |
| Skill Library | ✓ | ✓ | ✓ |
| Q-Learning | ✓ | ✓ | ✓ |
| SARSA | ✓ | ✓ | ✓ |
| DQN | - | ✓ | ✓ |
| PPO | - | ✓ | ✓ |
| Actor-Critic | - | ✓ | ✓ |
| Decision Transformer | - | ✓ | ✓ |
| MCTS | - | ✓ | ✓ |
| Reflexion Memory | - | ✓ | ✓ |
| Trajectory Tracking | - | ✓ | ✓ |
| Causal Memory Graph | - | - | ✓ |
| Nightly Learner | - | - | ✓ |
| FlashAttention | - | - | ✓ |
| A/B Experiments | - | - | ✓ |
| Transfer Learning | - | - | ✓ |

### 9.3 Platform-Optimized Learning

```bash
# Linux: Maximum performance
npx claude-flow install learning:advanced --native
# Uses NAPI for FlashAttention (4x faster, 75% less memory)

# macOS: Universal binary
npx claude-flow install learning:advanced
# Auto-detects ARM vs Intel, uses native when possible

# Windows: WASM-optimized
npx claude-flow install learning:advanced --wasm
# Full features via WebAssembly, no build tools required
```

### 9.4 Lazy Loading Configuration

```typescript
// .claude-flow/config.json
{
  "learning": {
    "tier": "standard",              // basic | standard | advanced
    "lazyLoad": {
      "algorithms": true,            // Load RL algorithms on first use
      "causal": true,                // Load causal graph when queried
      "nightly": true                // Load nightly learner at scheduled time
    },
    "preload": [
      "pattern_storage",             // Always preload for fast pattern lookup
      "skill_library"                // Always preload for skill suggestions
    ]
  }
}
```

### 9.5 Memory-Constrained Environments

```typescript
// Lightweight mode for constrained environments
{
  "learning": {
    "tier": "basic",
    "memoryLimit": "128MB",
    "episodeBuffer": 100,           // Smaller buffer
    "maxPatterns": 1000,            // Limit stored patterns
    "pruneOnLimit": true,           // Auto-prune old patterns
    "disableEmbeddings": false      // Keep embeddings for search
  }
}
```

---

## 10. Quick Start Recipes

### 10.1 Minimal Learning Setup

```bash
# Install core + basic learning
npm install claude-flow@3
npx claude-flow install learning:basic

# Start using immediately
npx claude-flow learning start --algorithm q-learning
```

### 10.2 Recommended Learning Setup

```bash
# Install with persistent memory
npm install claude-flow@3
npx claude-flow install memory learning

# Initialize with sensible defaults
npx claude-flow init --learning
```

### 10.3 Production Learning Setup

```bash
# Full installation with native bindings
npm install claude-flow@3
npx claude-flow install --all --native

# Configure for production
cat > .claude-flow/config.json << 'EOF'
{
  "learning": {
    "tier": "advanced",
    "nightly": {
      "enabled": true,
      "schedule": "0 2 * * *"
    }
  },
  "monitoring": {
    "enabled": true,
    "exportMetrics": true
  }
}
EOF
```

### 10.4 CI/CD Learning Setup

```bash
# Minimal for CI (no native deps)
npm install claude-flow@3
npx claude-flow install learning:basic --wasm

# Run tests with learning
npx claude-flow test --with-learning
```

---

## 11. Upgrade Paths

### 11.1 Tier Upgrades

```bash
# Upgrade from basic to standard
npx claude-flow install learning --upgrade

# Upgrade from standard to advanced
npx claude-flow install learning:advanced --upgrade

# Downgrade (preserves data)
npx claude-flow install learning:basic --downgrade
```

### 11.2 Data Migration

```bash
# Export learning data before major upgrade
npx claude-flow learning export --output learning-backup.json

# Import after upgrade
npx claude-flow learning import --input learning-backup.json

# Verify data integrity
npx claude-flow learning verify
```

---

## 12. Troubleshooting

### 12.1 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Slow startup | Too many preloaded features | Enable lazy loading |
| High memory | Large episode buffer | Reduce `episodeBuffer` |
| NAPI errors | Missing build tools | Use `--wasm` flag |
| Windows failures | Native dep issues | Use `--wasm` explicitly |

### 12.2 Diagnostic Commands

```bash
# Check learning system status
npx claude-flow learning status

# View component load times
npx claude-flow learning diagnostics

# Test RL algorithms
npx claude-flow learning test --algorithm ppo

# Verify installation
npx claude-flow verify --component learning
```

---

*Optimized Learning Plan - v3.0*
*Packages: agentic-flow@2.0.1-alpha.50, agentdb@2.0.0-alpha.3.1*
*Generated: 2026-01-03*
