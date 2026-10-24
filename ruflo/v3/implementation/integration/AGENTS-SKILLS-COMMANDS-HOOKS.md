# Claude-Flow v3: Agent, Skills, Commands & Hooks Optimization

## Overview

This document details the optimization strategy for the four core extensibility systems in Claude-Flow v3:
- **Agents**: 76 specialized agent definitions
- **Skills**: 28 skill definitions with progressive disclosure
- **Commands**: 93 slash commands
- **Hooks**: Event-driven automation

## 1. Agent Optimization

### 1.1 Current State Analysis

**Location**: `.claude/agents/`
**Count**: 76 agents across 22 directories (scattered organization)

```
Current Structure (v2):
agents/
├── consensus/       (7 files)
├── core/            (5 files)
├── devops/          (2 files)
├── flow-nexus/      (9 files)
├── github/          (6 files)
├── hive-mind/       (5 files)
├── orchestration/   (3 files)
├── performance/     (3 files)
├── planning/        (4 files)
├── sparc/           (4 files)
├── specialized/     (5 files)
├── swarm/           (3 files)
├── templates/       (misc)
├── testing/         (2 files)
└── ... (8 more directories)
```

### 1.2 v3 Optimized Structure

**Target**: 76 agents in 7 logical categories

```
v3 Structure:
agents/
├── core/            # Essential agents (5)
│   ├── coder.md
│   ├── tester.md
│   ├── reviewer.md
│   ├── researcher.md
│   └── planner.md
│
├── orchestration/   # Coordination agents (8)
│   ├── hierarchical-coordinator.md
│   ├── mesh-coordinator.md
│   ├── adaptive-coordinator.md
│   ├── queen-coordinator.md
│   ├── collective-intelligence-coordinator.md
│   ├── swarm-memory-manager.md
│   ├── scout-explorer.md
│   └── worker-specialist.md
│
├── platform/        # External integrations (15)
│   ├── github/
│   │   ├── pr-manager.md
│   │   ├── code-review-swarm.md
│   │   ├── issue-tracker.md
│   │   ├── release-manager.md
│   │   ├── workflow-automation.md
│   │   └── repo-architect.md
│   ├── flow-nexus/
│   │   ├── neural.md
│   │   ├── swarm.md
│   │   ├── workflow.md
│   │   └── ... (6 more)
│   └── devops/
│       ├── cicd-engineer.md
│       └── sync-coordinator.md
│
├── specialized/     # Domain experts (12)
│   ├── backend-dev.md
│   ├── mobile-dev.md
│   ├── ml-developer.md
│   ├── system-architect.md
│   ├── api-docs.md
│   ├── code-analyzer.md
│   ├── base-template-generator.md
│   └── ... (5 more)
│
├── methodology/     # Process agents (10)
│   ├── sparc-coord.md
│   ├── sparc-coder.md
│   ├── specification.md
│   ├── pseudocode.md
│   ├── architecture.md
│   ├── refinement.md
│   ├── tdd-london-swarm.md
│   ├── production-validator.md
│   ├── code-goal-planner.md
│   └── goal-planner.md
│
├── consensus/       # Distributed consensus (14)
│   ├── byzantine-coordinator.md
│   ├── raft-manager.md
│   ├── gossip-coordinator.md
│   ├── crdt-synchronizer.md
│   ├── quorum-manager.md
│   ├── security-manager.md
│   └── ... (8 more)
│
└── testing/         # Quality & validation (12)
    ├── perf-analyzer.md
    ├── performance-benchmarker.md
    ├── analyst.md
    ├── task-orchestrator.md
    └── ... (8 more)
```

### 1.3 Agent Template Enhancement (v3)

```markdown
<!-- .claude/agents/core/coder.md -->
---
name: coder
version: 3.0.0
category: core
description: Implementation specialist for writing clean, efficient code

# v3: agentic-flow integration
agentic-flow:
  sona-profile: research        # +55% code quality
  attention: flash              # 2.49x-7.47x faster context
  learning: enabled             # Learn from implementations
  reflexion: enabled            # Self-improvement
  skill-library: true           # Store successful patterns

# Capabilities
capabilities:
  - code-generation
  - refactoring
  - debugging
  - testing
  - documentation

# Tool access
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob

# Triggers
triggers:
  - "implement"
  - "code"
  - "write"
  - "create function"
---

# Coder Agent

Implementation specialist leveraging agentic-flow@alpha for enhanced code generation.

## Enhanced Capabilities (v3)

### SONA Learning
- Learns from past successful implementations
- Adapts coding style to project conventions
- Remembers successful patterns

### Flash Attention
- Faster context processing for large codebases
- Better understanding of code relationships
- Improved cross-file awareness

### Reflexion
- Self-evaluates code quality
- Iteratively improves implementations
- Learns from test failures

## Usage

```
# Basic
Task("Implement feature", "Create user authentication", "coder")

# With learning
Task("Implement feature", "Create user authentication", "coder", {
  learning: true,
  reflexion: true
})
```

## Best Practices

1. Always read existing code before implementing
2. Follow project conventions
3. Write tests alongside implementation
4. Document complex logic
```

### 1.4 Migration Script

```bash
#!/bin/bash
# migrate-agents.sh

# Create new structure
mkdir -p .claude/agents/{core,orchestration,platform/github,platform/flow-nexus,platform/devops,specialized,methodology,consensus,testing}

# Move core agents
mv .claude/agents/core/*.md .claude/agents/core/ 2>/dev/null

# Consolidate orchestration
mv .claude/agents/swarm/*.md .claude/agents/orchestration/
mv .claude/agents/hive-mind/*.md .claude/agents/orchestration/

# Consolidate platform
mv .claude/agents/github/*.md .claude/agents/platform/github/
mv .claude/agents/flow-nexus/*.md .claude/agents/platform/flow-nexus/
mv .claude/agents/devops/*.md .claude/agents/platform/devops/

# ... continue for other categories

# Remove empty directories
find .claude/agents -type d -empty -delete

echo "Agent migration complete"
```

---

## 2. Skills Optimization

### 2.1 Current State

**Location**: `.claude/skills/`
**Count**: 28 skills (flat structure)

```
Current (v2):
skills/
├── agentdb-advanced/
├── agentdb-learning/
├── agentdb-memory-patterns/
├── agentdb-optimization/
├── agentdb-vector-search/
├── agentic-jujutsu/
├── flow-nexus-neural/
├── flow-nexus-platform/
├── flow-nexus-swarm/
├── github-code-review/
├── github-multi-repo/
├── github-project-management/
├── github-release-management/
├── github-workflow-automation/
├── hive-mind-advanced/
├── hooks-automation/
├── pair-programming/
├── performance-analysis/
├── reasoningbank-agentdb/
├── reasoningbank-intelligence/
├── skill-builder/
├── sparc-methodology/
├── stream-chain/
├── swarm-advanced/
├── swarm-orchestration/
├── verification-quality/
└── session-start-hook/
```

### 2.2 v3 Optimized Structure

**Target**: 28 skills in 5 domain groups

```
v3 Structure:
skills/
├── ai-coordination/              # Multi-agent coordination
│   ├── swarm-orchestration/
│   ├── swarm-advanced/
│   ├── hive-mind-advanced/
│   └── hooks-automation/
│
├── data-processing/              # Data & memory systems
│   ├── agentdb-vector-search/
│   ├── agentdb-memory-patterns/
│   ├── agentdb-learning/
│   ├── agentdb-optimization/
│   ├── agentdb-advanced/
│   ├── reasoningbank-intelligence/
│   ├── reasoningbank-agentdb/
│   └── stream-chain/
│
├── development/                  # Dev workflows
│   ├── pair-programming/
│   ├── sparc-methodology/
│   ├── skill-builder/
│   ├── agentic-jujutsu/
│   └── session-start-hook/
│
├── platform/                     # External platforms
│   ├── github-code-review/
│   ├── github-multi-repo/
│   ├── github-project-management/
│   ├── github-release-management/
│   ├── github-workflow-automation/
│   ├── flow-nexus-neural/
│   ├── flow-nexus-platform/
│   └── flow-nexus-swarm/
│
└── optimization/                 # Performance & quality
    ├── performance-analysis/
    └── verification-quality/
```

### 2.3 Skill Template Enhancement (v3)

```yaml
# .claude/skills/ai-coordination/swarm-orchestration/SKILL.md
---
name: swarm-orchestration
version: 3.0.0
domain: ai-coordination
description: Orchestrate multi-agent swarms for parallel task execution

# v3: agentic-flow requirements
agentic-flow:
  required: true
  minimum-version: "2.0.0"
  features:
    - flash-attention           # Faster coordination
    - consensus-coordination    # Better decisions
    - sona-learning            # Adaptive strategies

# Triggers
triggers:
  - "orchestrate swarm"
  - "multi-agent"
  - "parallel agents"
  - "spawn swarm"
  - "coordinate agents"

# Dependencies
dependencies:
  - swarm-advanced
  - hive-mind-advanced

# Tools required
tools:
  - Task
  - TodoWrite
  - Bash
  - mcp__claude-flow__swarm_init
  - mcp__claude-flow__agent_spawn
  - mcp__claude-flow__task_orchestrate
---

# Swarm Orchestration Skill

## Overview

Orchestrate multi-agent swarms with agentic-flow for parallel task execution, dynamic topology, and intelligent coordination.

## Quick Start

```typescript
// Initialize swarm with agentic-flow
const adapter = new AgenticFlowAdapter({
  attention: 'flash',
  sona: 'balanced'
});

await adapter.initializeSwarm({
  topology: 'mesh',
  maxAgents: 6
});
```

## Detailed Usage

[Progressive disclosure content...]
```

---

## 3. Commands Optimization

### 3.1 Current State

**Location**: `.claude/commands/`
**Count**: 93 commands across 16 categories

```
Current (v2):
commands/
├── analysis/       (3 files)
├── automation/     (2 files)
├── coordination/   (5 files)
├── github/         (5 files)
├── hive-mind/      (6 files)
├── hooks/          (8 files)
├── memory/         (6 files)
├── monitoring/     (4 files)
├── optimization/   (3 files)
├── sparc/          (6 files)
├── swarm/          (6 files)
├── testing/        (4 files)
├── training/       (3 files)
├── utilities/      (5 files)
├── verification/   (3 files)
└── workflow/       (4 files)
```

### 3.2 v3 Optimized Structure

**Target**: 93 commands in 5 logical groups

```
v3 Structure:
commands/
├── core/                   # Essential operations (18)
│   ├── agent-spawn.md
│   ├── agent-list.md
│   ├── agent-status.md
│   ├── swarm-init.md
│   ├── swarm-status.md
│   ├── swarm-stop.md
│   ├── sparc-run.md
│   ├── sparc-tdd.md
│   ├── sparc-batch.md
│   └── ... (9 more)
│
├── platform/               # External integrations (22)
│   ├── github/
│   │   ├── pr-create.md
│   │   ├── pr-review.md
│   │   ├── issue-create.md
│   │   └── ... (5 more)
│   ├── hive-mind/
│   │   ├── hive-init.md
│   │   ├── hive-spawn.md
│   │   ├── hive-status.md
│   │   └── ... (3 more)
│   └── flow-nexus/
│       ├── nexus-deploy.md
│       └── ... (5 more)
│
├── operations/             # Runtime operations (25)
│   ├── memory/
│   │   ├── memory-store.md
│   │   ├── memory-query.md
│   │   ├── memory-export.md
│   │   └── ... (3 more)
│   ├── training/
│   │   ├── train-start.md
│   │   ├── train-validate.md
│   │   └── train-export.md
│   └── monitoring/
│       ├── monitor-start.md
│       ├── monitor-metrics.md
│       └── ... (4 more)
│
├── automation/             # Automation & workflows (18)
│   ├── hooks/
│   │   ├── hook-pre-task.md
│   │   ├── hook-post-task.md
│   │   ├── hook-session-start.md
│   │   └── ... (5 more)
│   ├── workflow/
│   │   ├── workflow-create.md
│   │   ├── workflow-run.md
│   │   └── ... (2 more)
│   └── coordination/
│       ├── coord-consensus.md
│       └── ... (4 more)
│
└── utilities/              # Helper utilities (10)
    ├── analysis/
    │   ├── analyze-code.md
    │   ├── analyze-performance.md
    │   └── analyze-security.md
    ├── optimization/
    │   ├── optimize-config.md
    │   └── optimize-memory.md
    └── verification/
        ├── verify-setup.md
        ├── verify-config.md
        └── ... (3 more)
```

### 3.3 Command Template Enhancement (v3)

```markdown
<!-- .claude/commands/core/swarm-init.md -->
---
name: swarm-init
version: 3.0.0
category: core
description: Initialize a multi-agent swarm with configurable topology

# Arguments
arguments:
  - name: topology
    type: string
    required: false
    default: auto
    options: [centralized, hierarchical, mesh, auto]
    description: Swarm topology pattern

  - name: max-agents
    type: number
    required: false
    default: 6
    description: Maximum number of agents

  - name: learning
    type: boolean
    required: false
    default: true
    description: Enable SONA learning

# v3 enhancements
agentic-flow:
  uses-flash-attention: true
  uses-consensus: true
---

# /swarm-init

Initialize a multi-agent swarm with intelligent topology selection.

## Usage

```bash
/swarm-init                           # Auto topology
/swarm-init --topology mesh           # Mesh network
/swarm-init --max-agents 10           # Custom agent limit
/swarm-init --learning true           # Enable SONA learning
```

## v3 Enhancements

- **Auto Topology**: Automatically selects best topology based on task complexity
- **Flash Attention**: 2.49x-7.47x faster agent coordination
- **SONA Learning**: Learns optimal swarm configurations over time

## Examples

### Basic Initialization
```bash
/swarm-init
# Output: Swarm initialized with auto topology (mesh), 6 agents max
```

### Research Swarm
```bash
/swarm-init --topology hierarchical --max-agents 10 --learning true
# Output: Research swarm ready with SONA learning enabled
```
```

---

## 4. Hooks Optimization

### 4.1 Current State (Problem)

Hooks are defined in **3 different locations**:
1. `.claude/settings-enhanced.json` (lines 78-257)
2. `.claude/settings-complete.json` (similar hooks)
3. `.claude-plugin/hooks/hooks.json` (plugin hooks)

This causes:
- Inconsistent behavior
- Maintenance nightmare
- Potential sync issues

### 4.2 v3 Solution: Single Source of Truth

All hooks defined in `.claude/config.json`:

```json
{
  "version": "3.0.0",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "commands": [
          "npx claude-flow hooks pre-tool --tool=$TOOL_NAME --command=\"$BASH_COMMAND\""
        ],
        "timeout": 5000,
        "failOnError": false
      },
      {
        "matcher": "Write|Edit",
        "commands": [
          "npx claude-flow hooks pre-edit --file=$FILE_PATH"
        ]
      }
    ],

    "PostToolUse": [
      {
        "matcher": "*",
        "commands": [
          "npx claude-flow hooks post-tool --tool=$TOOL_NAME --success=$SUCCESS"
        ]
      },
      {
        "matcher": "Write|Edit",
        "commands": [
          "npx claude-flow hooks post-edit --file=$FILE_PATH --memory-key=\"edits/$FILE_PATH\""
        ]
      }
    ],

    "PreCompact": [
      {
        "commands": [
          "npx claude-flow hooks pre-compact --session=$SESSION_ID"
        ]
      }
    ],

    "Stop": [
      {
        "commands": [
          "npx claude-flow hooks session-end --export-metrics true"
        ]
      }
    ]
  }
}
```

### 4.3 v3 Learning Hooks

```typescript
// src/v3/hooks/learning-hooks.ts
import { AgenticFlowAdapter } from '../integrations';

export interface HookContext {
  tool: string;
  file?: string;
  command?: string;
  result?: any;
  success: boolean;
  agentId?: string;
  sessionId: string;
}

export const learningHooks = {
  /**
   * Pre-tool hook: Query patterns before execution
   */
  async preToolUse(context: HookContext): Promise<void> {
    const adapter = await AgenticFlowAdapter.getInstance();

    // Query similar past operations (300x faster with HNSW)
    const patterns = await adapter.searchPatterns(
      `${context.tool}:${context.file || context.command}`,
      { k: 3 }
    );

    if (patterns.length > 0) {
      // Inject suggestions into context
      context.suggestions = patterns.map(p => ({
        pattern: p.pattern,
        recommendation: p.recommendation,
        confidence: p.score
      }));
    }
  },

  /**
   * Post-tool hook: Store for learning
   */
  async postToolUse(context: HookContext): Promise<void> {
    const adapter = await AgenticFlowAdapter.getInstance();

    // Calculate reward based on success
    const reward = context.success ? 1.0 : 0.0;

    // Store pattern for future learning
    await adapter.storePattern(
      `${context.tool}:${context.file || context.command}`,
      context.result,
      reward,
      { algorithm: 'ppo' }  // Use PPO RL algorithm
    );
  },

  /**
   * Post-edit hook: Auto-format and learn
   */
  async postEdit(context: HookContext): Promise<void> {
    const adapter = await AgenticFlowAdapter.getInstance();

    if (context.success && context.file) {
      // Store edit pattern
      await adapter.storePattern(
        `edit:${context.file}`,
        context.result,
        1.0
      );

      // If quality is high, add to skill library
      const quality = await evaluateCodeQuality(context.file);
      if (quality > 0.8) {
        await adapter.addToSkillLibrary(
          context.agentId || 'default',
          'code-edit',
          context.result
        );
      }
    }
  },

  /**
   * Session end hook: Export metrics and train
   */
  async sessionEnd(context: HookContext): Promise<void> {
    const adapter = await AgenticFlowAdapter.getInstance();

    // Export session metrics
    const metrics = await adapter.getSessionMetrics(context.sessionId);

    // Train on session patterns if quality was high
    if (metrics.overallSuccess > 0.7) {
      await adapter.trainOnSession(context.sessionId, {
        algorithm: 'decision-transformer',
        epochs: 3
      });
    }

    // Save session summary
    await adapter.saveSessionSummary(context.sessionId, metrics);
  }
};
```

### 4.4 Hook Migration Guide

```bash
#!/bin/bash
# migrate-hooks.sh

echo "Migrating hooks to single config.json..."

# 1. Backup existing files
cp .claude/settings-enhanced.json .claude/settings-enhanced.json.backup
cp .claude-plugin/hooks/hooks.json .claude-plugin/hooks/hooks.json.backup

# 2. Extract hooks from settings-enhanced.json
# (Manual step - copy hooks section to config.json)

# 3. Update .claude-plugin/hooks/hooks.json to reference config.json
cat > .claude-plugin/hooks/hooks.json << 'EOF'
{
  "$ref": "../../config.json#/hooks",
  "comment": "Hooks are defined in .claude/config.json for single source of truth"
}
EOF

# 4. Remove hooks from settings files
# (Manual step - edit settings files to remove hooks section)

echo "Hook migration complete. Review changes in config.json"
```

---

## 5. Cross-System Integration

### 5.1 Agent + Skill Linking

```yaml
# .claude/agents/core/coder.md
---
name: coder
skills:
  - pair-programming
  - sparc-methodology
  - verification-quality
---
```

### 5.2 Command + Hook Linking

```yaml
# .claude/commands/core/swarm-init.md
---
name: swarm-init
hooks:
  pre: [hook-pre-swarm]
  post: [hook-post-swarm, hook-metrics-collect]
---
```

### 5.3 Skill + Agent Requirements

```yaml
# .claude/skills/ai-coordination/swarm-orchestration/SKILL.md
---
name: swarm-orchestration
required-agents:
  - hierarchical-coordinator
  - queen-coordinator
  - worker-specialist
---
```

---

## 6. Implementation Checklist

### Phase 1: Structure Migration
- [ ] Create v3 agent directory structure
- [ ] Move agents to new categories
- [ ] Update agent templates with agentic-flow config
- [ ] Create v3 skill directory structure
- [ ] Move skills to domain groups
- [ ] Create v3 command directory structure
- [ ] Reorganize commands into 5 groups

### Phase 2: Hook Consolidation
- [ ] Create unified hooks in config.json
- [ ] Remove hooks from settings files
- [ ] Update .claude-plugin reference
- [ ] Implement learning hooks
- [ ] Test hook execution

### Phase 3: Enhancement
- [ ] Add agentic-flow config to all agents
- [ ] Add v3 features to skills
- [ ] Update command templates
- [ ] Implement cross-system linking

### Phase 4: Validation
- [ ] Test all agents load correctly
- [ ] Verify skills trigger properly
- [ ] Confirm commands execute
- [ ] Validate hooks fire in sequence

---

## 7. Summary

| System | v2 State | v3 Target | Improvement |
|--------|----------|-----------|-------------|
| Agents | 22 scattered dirs | 7 logical categories | 68% reduction in categories |
| Skills | Flat structure | 5 domain groups | Better discoverability |
| Commands | 16 categories | 5 groups | 69% reduction in categories |
| Hooks | 3 locations | 1 config.json | Single source of truth |

**Total files affected**: ~197 (76 agents + 28 skills + 93 commands)
**Estimated effort**: 8-12 hours for full migration
**Risk level**: Low (backward compatible)

---

*Document Version: 1.0.0*
*Last Updated: 2026-01-03*
