# Claude-Flow v3: Hooks & Learning Integration

## Executive Summary

**Key Finding**: `agentic-flow@alpha` provides nearly everything needed for a self-optimizing learning system. Combined with Claude Code's hooks API, we have a complete solution.

### What agentic-flow@alpha Already Provides

| Capability | Status | Details |
|------------|--------|---------|
| 9 RL Algorithms | ✓ Ready | Double-Q, SARSA, Actor-Critic, PPO, etc. |
| Trajectory Tracking | ✓ Ready | SQLite-backed, cross-session |
| Pattern Storage | ✓ Ready | TensorCompress tiered storage |
| Parallel Learning | ✓ Ready | 7 workers, batch processing |
| Attention Mechanisms | ✓ Ready | MoE, Flash, Graph, Hyperbolic |
| Memory Compression | ✓ Ready | 50-97% memory savings |

### What Claude Code Provides

| Capability | Status | Details |
|------------|--------|---------|
| 10 Hook Events | ✓ Ready | PreToolUse, PostToolUse, Session*, etc. |
| OpenTelemetry | ✓ Ready | Prometheus export, custom metrics |
| Extended Thinking | ✓ Ready | Up to 31,999 tokens for reasoning |
| MCP Integration | ✓ Ready | 50+ coordination tools |

---

## 1. agentic-flow@alpha Hook Inventory

### 1.1 Original Hook Tools (10)

```typescript
// MCP Tool Names
hook_pre_edit      // Before file edits
hook_post_edit     // After file edits (pattern extraction)
hook_pre_command   // Before bash commands (safety check)
hook_post_command  // After commands (outcome learning)
hook_route         // Intelligent task routing
hook_explain       // XAI explanations
hook_pretrain      // Pattern pre-training
hook_build_agents  // Agent construction
hook_metrics       // Performance tracking
hook_transfer      // Cross-task learning
```

### 1.2 Intelligence Bridge Tools (9)

```typescript
// High-performance learning tools
intelligence_route               // SONA + MoE routing (~0.05ms)
intelligence_trajectory_start    // Begin trajectory tracking
intelligence_trajectory_step     // Record step with reward
intelligence_trajectory_end      // Complete with verdict
intelligence_pattern_store       // Store successful patterns
intelligence_pattern_search      // Find similar patterns (HNSW)
intelligence_stats               // Learning statistics
intelligence_learn               // Force learning cycle
intelligence_attention           // Attention similarity compute
```

### 1.3 Parallel Learning Functions (12)

```typescript
// From intelligence-bridge.js
queueEpisode()              // Batch Q-learning (3-4x faster)
flushEpisodeBatch()         // Process with 7 workers
matchPatternsParallel()     // Parallel pattern matching
indexMemoriesBackground()   // Non-blocking memory indexing
searchParallel()            // Sharded similarity search
analyzeFilesParallel()      // Multi-file analysis
analyzeCommitsParallel()    // Git history learning
speculativeEmbed()          // Pre-embed likely files
analyzeAST()                // Parallel AST extraction
analyzeComplexity()         // Code quality metrics
buildDependencyGraph()      // Import graph building
securityScan()              // Parallel SAST
```

---

## 2. Multi-Algorithm Learning Engine

agentic-flow@alpha includes 9 specialized RL algorithms automatically selected by task type:

| Task Type | Algorithm | Reason |
|-----------|-----------|--------|
| `agent-routing` | Double-Q | Reduces overestimation bias |
| `error-avoidance` | SARSA | Conservative on-policy learning |
| `confidence-scoring` | Actor-Critic | Continuous 0-1 scores |
| `context-ranking` | PPO | Stable preference learning |
| `trajectory-learning` | Decision Transformer | Sequence patterns |
| `memory-recall` | TD-Lambda | Long-term credit assignment |
| `pattern-matching` | Q-Learning | Fast value-based matching |
| `exploration` | REINFORCE | Policy gradient for novel tasks |
| `multi-agent` | A2C | Advantage for coordination |

### Usage

```typescript
import { learnFromEpisode, getAlgorithmForTask } from 'agentic-flow/hooks';

// Automatic algorithm selection
const { algorithm, reason } = getAlgorithmForTask('agent-routing');
// → { algorithm: 'double-q', reason: 'Reduces overestimation bias' }

// Learn from execution
await learnFromEpisode(
  'agent-routing',      // Task type
  stateEmbedding,       // Current state
  'select-coder',       // Action taken
  0.85,                 // Reward (success)
  nextStateEmbedding,   // Result state
  true                  // Episode done
);
```

---

## 3. Claude Code Hook Integration

### 3.1 Hook Event Mapping

| Claude Code Event | agentic-flow Tool | Purpose |
|-------------------|-------------------|---------|
| `PreToolUse` | `hook_pre_command`, `hook_pre_edit` | Predict & prevent errors |
| `PostToolUse` | `hook_post_command`, `hook_post_edit` | Learn from outcomes |
| `SessionStart` | `intelligence_trajectory_start` | Begin session trajectory |
| `SessionEnd` | `intelligence_trajectory_end` | Complete with verdict |
| `UserPromptSubmit` | `hook_route` | Intelligent task routing |
| `Stop` | `intelligence_pattern_store` | Store successful patterns |

### 3.2 Complete Hook Configuration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "npx agentic-flow@alpha hooks pre-command --validate --predict --cache"
        }]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "npx agentic-flow@alpha hooks pre-edit --analyze-impact --check-patterns"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "npx agentic-flow@alpha hooks post-command --learn --store-pattern --batch"
        }]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "npx agentic-flow@alpha hooks post-edit --extract-patterns --train-neural"
        }]
      }
    ],
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "npx agentic-flow@alpha hooks session-start --restore-memory --warm-cache"
        }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{
          "type": "command",
          "command": "npx agentic-flow@alpha hooks session-end --consolidate --export-metrics"
        }]
      }
    ]
  }
}
```

---

## 4. TensorCompress Tiered Storage

agentic-flow@alpha includes automatic memory optimization:

| Access Frequency | Compression Tier | Memory Savings |
|------------------|------------------|----------------|
| Hot (>0.8) | none | 0% |
| Warm (>0.4) | half | 50% |
| Cool (>0.1) | pq8 | 87.5% |
| Cold (>0.01) | pq4 | 93.75% |
| Archive (≤0.01) | binary | 96.9% |

**Automatic recompression** every 5 minutes based on access patterns.

---

## 5. Self-Optimizing Learning Loop

### 5.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Hook Events                       │
│  PreToolUse → SessionStart → UserPrompt → PostToolUse → Stop    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│              agentic-flow@alpha Intelligence Bridge              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ 9 RL Algos  │  │ Trajectory  │  │ Pattern     │             │
│  │ Auto-Select │  │ Tracking    │  │ Storage     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ 7 Workers   │  │ HNSW Index  │  │ Tensor      │             │
│  │ Parallel    │  │ 150x faster │  │ Compress    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                    SQLite Persistence                            │
│  Patterns │ Trajectories │ Episodes │ Metrics │ Compressions    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Learning Flow

```typescript
// SessionStart: Restore context
SessionStart → {
  restoreMemory()           // Load relevant patterns
  warmCache()               // Pre-embed likely files
  beginTrajectory()         // Start session tracking
}

// PreToolUse: Predict & Prevent
PreToolUse → {
  findSimilarPatterns()     // Query past successes
  predictOutcome()          // RL prediction
  blockIfRisky()            // Safety gate (0.85 threshold)
}

// PostToolUse: Learn
PostToolUse → {
  recordTrajectoryStep()    // Track action/reward
  learnFromEpisode()        // Update RL policy
  queueEpisode()            // Batch for parallel learning
}

// SessionEnd: Consolidate
SessionEnd → {
  endTrajectory()           // Complete with verdict
  storePattern()            // Save successful patterns
  flushEpisodeBatch()       // Process queued episodes
  consolidateMemory()       // Compress cold patterns
}
```

---

## 6. Telemetry Integration

### 6.1 OpenTelemetry Metrics

```bash
# Enable export
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Metrics available:
cf_learning_episodes_total      # Total episodes processed
cf_learning_success_rate        # Success percentage
cf_pattern_storage_bytes        # Pattern storage size
cf_compression_ratio            # Memory savings
cf_trajectory_duration_ms       # Learning latency
cf_rl_algorithm_usage           # Algorithm selection frequency
```

### 6.2 Built-in Dashboard

```bash
npx agentic-flow@alpha metrics --format prometheus
npx agentic-flow@alpha stats --learning
```

---

## 7. Installation & Setup

### 7.1 Minimal Setup (Learning Only)

```bash
npm install agentic-flow@alpha
npx agentic-flow@alpha hooks install --learning
```

### 7.2 Full Setup (All Features)

```bash
npm install agentic-flow@alpha
npx agentic-flow@alpha hooks install --all --parallel

# Configure Claude Code hooks
cat >> ~/.claude/settings.json << 'EOF'
{
  "hooks": {
    "PreToolUse": [{"matcher": "Bash|Edit", "hooks": [{"type": "command", "command": "npx agentic-flow@alpha hooks pre-task"}]}],
    "PostToolUse": [{"matcher": "Bash|Edit", "hooks": [{"type": "command", "command": "npx agentic-flow@alpha hooks post-task --learn"}]}]
  }
}
EOF
```

---

## 8. What agentic-flow@alpha Provides (Summary)

### Already Implemented:
- [x] 19 hook tools (10 original + 9 intelligence)
- [x] 9 RL algorithms with auto-selection
- [x] Trajectory tracking with SQLite persistence
- [x] Pattern storage with tiered compression (50-97% savings)
- [x] Parallel learning with 7 workers (3-4x faster)
- [x] HNSW index for 150x faster pattern search
- [x] Attention mechanisms (MoE, Flash, Graph, Hyperbolic)
- [x] Extended worker pool for parallel operations
- [x] Speculative embedding for related files
- [x] AST analysis, complexity metrics, security scanning

### Claude-Flow v3 Needs to Add:
- [ ] Claude Code hook configuration adapter
- [ ] OpenTelemetry metric export wrapper
- [ ] Cross-session learning persistence
- [ ] Swarm coordination integration
- [ ] User-configurable learning parameters

---

## 9. Recommendation

**Use agentic-flow@alpha as the learning backbone for Claude-Flow v3.**

The package already provides:
- Complete RL learning system (9 algorithms)
- Efficient pattern storage (tiered compression)
- Fast retrieval (HNSW 150x faster)
- Parallel processing (7 workers)
- SQLite persistence (cross-session)

Claude-Flow v3 should focus on:
1. **Thin integration layer** - Connect Claude Code hooks to agentic-flow hooks
2. **Configuration UI** - Let users customize learning parameters
3. **Swarm coordination** - Use learning to optimize swarm topology selection
4. **Metrics dashboard** - Visualize learning progress

---

*Document created: 2026-01-03*
*agentic-flow version: 2.0.1-alpha.50*
