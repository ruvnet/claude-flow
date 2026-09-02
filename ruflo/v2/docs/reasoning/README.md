# Reasoning Agents for Claude-Flow

## Overview

This directory contains reasoning and goal-planning agents that leverage ReasoningBank's closed-loop learning to provide intelligent, adaptive task execution with continuous improvement.

## Available Agents

### 🎯 goal-planner
**Goal-Oriented Action Planning (GOAP) specialist**

Uses gaming AI techniques to dynamically create intelligent plans to achieve complex objectives. Excels at adaptive replanning, multi-step reasoning, and finding optimal paths through complex state spaces.

**Key Features:**
- Dynamic Planning: A* search algorithms for optimal paths
- Precondition Analysis: Evaluate action requirements
- Effect Prediction: Model state changes
- Adaptive Replanning: Adjust based on execution results
- Goal Decomposition: Break complex objectives into sub-goals

**Best for:**
- Complex multi-step deployments
- Tasks with many dependencies
- High-level goals needing decomposition
- Adaptive planning scenarios

**Usage:**
```bash
claude-flow init --agent reasoning
# Or directly with agentic-flow:
npx agentic-flow --agent goal-planner --task "Deploy application with prerequisites"
```

### 🎯 sublinear-goal-planner
**Sub-linear complexity goal planning**

Specialized version optimized for large-scale state spaces with sub-linear time complexity.

**Best for:**
- Large-scale systems
- Performance-critical planning
- Massive state spaces

## Integration with ReasoningBank

All reasoning agents integrate with ReasoningBank for:
- **RETRIEVE**: Pull relevant memories from past executions
- **JUDGE**: Evaluate success/failure of trajectories
- **DISTILL**: Extract learnable patterns
- **CONSOLIDATE**: Merge and optimize memory

## Performance Benefits

Based on ReasoningBank benchmarks:
- **+26% success rate** (70% → 88%)
- **-25% token usage** (cost savings)
- **3.2x learning velocity** (faster improvement)
- **0% → 95% success** over 5 iterations

## Quick Start

### 1. Initialize with Reasoning Agents
```bash
claude-flow init --agent reasoning
```

This will:
- Set up ReasoningBank memory system
- Configure reasoning agents
- Initialize learning capabilities

### 2. Use Reasoning Agents
```bash
# Via claude-flow (when integrated)
claude-flow agent run goal-planner "Complex deployment task"

# Via agentic-flow directly
npx agentic-flow --agent goal-planner --task "Multi-step task"
```

### 3. Enable Learning Mode
```bash
export REASONINGBANK_ENABLED=true
export AGENTIC_FLOW_TRAINING=true
```

## Architecture

```
User Task
    ↓
[goal-planner analyzes]
    ↓
ReasoningBank.retrieve() → Get relevant memories
    ↓
Plan generation (A* search)
    ↓
Execute with monitoring (OODA loop)
    ↓
ReasoningBank.judge() → Evaluate success
    ↓
ReasoningBank.distill() → Extract learnings
    ↓
Store for future use
```

## Configuration

### Memory Database
Default location: `.swarm/memory.db`

Configure via:
```bash
export REASONINGBANK_DB_PATH="/custom/path/memory.db"
```

### Retrieval Settings
```bash
export REASONINGBANK_K=3              # Top-k memories to retrieve
export REASONINGBANK_MIN_CONFIDENCE=0.5  # Minimum confidence threshold
```

## Advanced Usage

### 1. Multi-Step Planning
```bash
npx agentic-flow --agent goal-planner \
  --task "Deploy application" \
  --enable-memory \
  --memory-domain "deployment"
```

### 2. Learning from Failures
The system automatically learns from both successes and failures:
- Failed attempts store "what went wrong"
- Successful attempts store "what worked"
- Future tasks benefit from both

### 3. Cross-Domain Transfer
Patterns learned in one domain can transfer to similar tasks:
- Authentication patterns → Authorization patterns
- Deployment patterns → Migration patterns
- Testing strategies → Debugging strategies

## Documentation

- **REASONING-AGENTS.md**: Detailed technical documentation
- **REASONINGBANK-DEMO.md**: Live demo comparison
- **REASONINGBANK-CLI-INTEGRATION.md**: CLI integration guide
- **REASONINGBANK-BENCHMARK.md**: Performance benchmarks

## Future Agents (Coming Soon)

The following reasoning agents are planned for future releases:

- **adaptive-learner**: Learn from experience and improve over time
- **pattern-matcher**: Recognize patterns and transfer proven solutions
- **memory-optimizer**: Maintain memory system health and performance
- **context-synthesizer**: Build rich situational awareness from multiple sources
- **experience-curator**: Ensure high-quality learnings through rigorous curation
- **reasoning-optimized**: Meta-reasoning orchestrator coordinating all reasoning agents

## Support

For issues or questions:
- GitHub: https://github.com/ruvnet/claude-flow/issues
- Documentation: https://github.com/ruvnet/claude-flow

---

**Remember: Reasoning agents learn from experience and get better over time!** 🧠✨
