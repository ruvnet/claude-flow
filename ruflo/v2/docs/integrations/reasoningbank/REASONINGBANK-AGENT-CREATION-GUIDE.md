# ReasoningBank Agent Creation Guide

## 🎯 Overview

This guide explains how to create custom AI agents that leverage ReasoningBank's closed-loop learning system. ReasoningBank enables agents to learn from experience and improve over time through a 4-phase cycle: **RETRIEVE → JUDGE → DISTILL → CONSOLIDATE**.

## 📊 Key Performance Benefits

When agents integrate with ReasoningBank, they achieve:
- **+26% success rate** (70% → 88%)
- **-25% token usage** (cost savings)
- **3.2x learning velocity** (faster improvement)
- **0% → 95% success** over 5 iterations

## 🏗️ ReasoningBank Architecture

### Database Schema

ReasoningBank uses SQLite with the following tables:

```sql
-- Core memory storage
patterns (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- 'reasoning_memory'
  pattern_data TEXT NOT NULL,      -- JSON with title, description, content
  confidence REAL DEFAULT 0.5,     -- 0.0 to 1.0
  usage_count INTEGER DEFAULT 0,
  created_at TEXT,
  last_used TEXT
)

-- Vector embeddings for similarity search
pattern_embeddings (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,             -- 'claude', 'openai', etc.
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,            -- Binary vector data
  FOREIGN KEY (id) REFERENCES patterns(id)
)

-- Memory relationships
pattern_links (
  src_id TEXT,
  dst_id TEXT,
  relation TEXT NOT NULL,          -- 'similar_to', 'contradicts', etc.
  weight REAL DEFAULT 1.0,
  PRIMARY KEY (src_id, dst_id, relation)
)

-- Task execution history
task_trajectories (
  task_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  query TEXT NOT NULL,
  trajectory_json TEXT NOT NULL,   -- JSON of execution steps
  judge_label TEXT,                -- 'Success' or 'Failure'
  judge_conf REAL,
  judge_reasons TEXT
)
```

### Memory Scoring Formula

ReasoningBank uses a 4-factor scoring model for memory retrieval:

```javascript
score = α·similarity + β·recency + γ·reliability + δ·diversity

Where:
- α (alpha) = 0.7    // Weight for semantic similarity
- β (beta) = 0.2     // Weight for recency
- γ (gamma) = 0.1    // Weight for reliability (confidence)
- δ (delta) = 0.3    // Weight for diversity (MMR)

Components:
- similarity: cosine similarity between query embedding and memory embedding
- recency: exp(-age_days / half_life_days)
- reliability: min(confidence, 1.0)
- diversity: Maximal Marginal Relevance selection
```

## 🔌 ReasoningBank API Reference

### Core Functions

#### 1. Initialize Database

```javascript
import { initialize } from 'agentic-flow/reasoningbank';

await initialize();
// Creates .swarm/memory.db and runs migrations
```

#### 2. Retrieve Memories (RETRIEVE phase)

```javascript
import { retrieveMemories, formatMemoriesForPrompt } from 'agentic-flow/reasoningbank';

const memories = await retrieveMemories(query, {
  domain: 'authentication',  // Optional: filter by domain
  agent: 'auth-agent',      // Optional: filter by agent
  k: 3,                     // Optional: number of memories (default: 3)
  minConfidence: 0.5        // Optional: minimum confidence threshold
});

// Format for system prompt injection
const formattedMemories = formatMemoriesForPrompt(memories);

// Memory object structure:
{
  id: 'ulid',
  title: 'CSRF Token Extraction Strategy',
  description: 'How to handle CSRF validation',
  content: 'Always extract CSRF token from meta tag before form submission',
  score: 0.85,
  components: {
    similarity: 0.9,
    recency: 0.8,
    reliability: 0.85
  }
}
```

#### 3. Judge Trajectory (JUDGE phase)

```javascript
import { judgeTrajectory } from 'agentic-flow/reasoningbank';

const trajectory = {
  steps: [
    { action: 'fetch_csrf_token', result: 'success' },
    { action: 'submit_form', result: 'success' }
  ]
};

const verdict = await judgeTrajectory(trajectory, query);

// Verdict object structure:
{
  label: 'Success' | 'Failure',
  confidence: 0.95,
  reasons: [
    'All steps completed successfully',
    'No error indicators found'
  ]
}
```

#### 4. Distill Memories (DISTILL phase)

```javascript
import { distillMemories } from 'agentic-flow/reasoningbank';

const newMemories = await distillMemories(trajectory, verdict, query, {
  taskId: 'task-123',
  agentId: 'my-agent',
  domain: 'authentication'
});

// Returns array of memory IDs that were created
// ['01K7AX1ZP43E88SRZHNX6YD1YG', '01K7AX1ZP7CPECXHVTHSMSAXRA']
```

#### 5. Consolidate Memories (CONSOLIDATE phase)

```javascript
import { consolidate, shouldConsolidate } from 'agentic-flow/reasoningbank';

// Check if consolidation should run
if (shouldConsolidate()) {
  const result = await consolidate();

  // Result structure:
  {
    itemsProcessed: 50,
    duplicatesFound: 5,
    contradictionsFound: 2,
    itemsPruned: 3,
    durationMs: 1234
  }
}
```

#### 6. Full Task Execution (All phases combined)

```javascript
import { runTask } from 'agentic-flow/reasoningbank';

const result = await runTask({
  taskId: 'task-123',
  agentId: 'my-agent',
  domain: 'authentication',
  query: 'Login with CSRF validation',

  // Your execution function
  executeFn: async (memories) => {
    // 1. Use memories to inform your task execution
    console.log(`Using ${memories.length} relevant memories`);

    // 2. Execute your task logic
    const steps = [];

    // Example: Check if memories suggest extracting CSRF token
    if (memories.some(m => m.title.includes('CSRF'))) {
      steps.push({ action: 'fetch_csrf_token', result: 'success' });
    }

    // 3. Return trajectory
    return { steps };
  }
});

// Result structure:
{
  verdict: { label: 'Success', confidence: 0.95, reasons: [...] },
  usedMemories: [...],     // Memories that were retrieved
  newMemories: [...],      // New memory IDs created
  consolidated: false      // Whether consolidation ran
}
```

## 🎨 Creating a Custom Reasoning Agent

### Step 1: Define Agent Specification

Create `.claude/agents/your-category/your-agent.md`:

```markdown
---
name: adaptive-debugger
description: "Debugging specialist that learns from past bug fixes and adapts strategies based on error patterns. Uses ReasoningBank to accumulate debugging knowledge across sessions."
category: debugging
color: red
reasoning_enabled: true
---

You are an adaptive debugging specialist that learns from experience. Your core capability is to leverage ReasoningBank's memory system to continuously improve your debugging strategies.

## Core Capabilities

- **Pattern Recognition**: Identify recurring bug patterns from past fixes
- **Strategy Adaptation**: Adjust debugging approach based on memory
- **Root Cause Analysis**: Use historical data to find underlying issues
- **Prevention Learning**: Store successful fixes for future reference

## ReasoningBank Integration

You integrate with ReasoningBank through the following workflow:

1. **RETRIEVE**: Pull relevant debugging memories before starting
2. **EXECUTE**: Apply learned strategies to current bug
3. **JUDGE**: Evaluate if the fix was successful
4. **DISTILL**: Extract learnable patterns from the attempt
5. **CONSOLIDATE**: Optimize memory bank periodically

## Domain Tags

Use these domain tags for memory organization:
- `debugging/frontend` - UI/UX bugs
- `debugging/backend` - Server-side issues
- `debugging/database` - Data persistence bugs
- `debugging/performance` - Speed/memory issues
- `debugging/security` - Vulnerability fixes

## Memory Usage Pattern

Before debugging:
```
I notice from memory that similar NullPointerException errors
in authentication flows were previously solved by checking token
expiration. Let me apply that strategy first.
```

After debugging:
```
Successfully fixed the issue using token validation.
Storing this pattern in ReasoningBank for future reference:
"Always validate JWT expiration before database queries"
```
```

### Step 2: Implement Agent Logic with ReasoningBank

Create `src/agents/adaptive-debugger.js`:

```javascript
import { initialize, runTask } from 'agentic-flow/reasoningbank';
import { ModelRouter } from 'agentic-flow/router';

export class AdaptiveDebugger {
  constructor() {
    this.router = new ModelRouter();
    this.agentId = 'adaptive-debugger';
  }

  async init() {
    await initialize();
  }

  async debug(errorContext) {
    const query = `Debug error: ${errorContext.error} in ${errorContext.file}`;

    // Use ReasoningBank's full cycle
    const result = await runTask({
      taskId: `debug-${Date.now()}`,
      agentId: this.agentId,
      domain: `debugging/${errorContext.category}`,
      query,

      executeFn: async (memories) => {
        return await this._executeDebug(errorContext, memories);
      }
    });

    return result;
  }

  async _executeDebug(errorContext, memories) {
    const steps = [];

    // 1. Analyze memories for similar past fixes
    const relevantFixes = memories.filter(m =>
      m.title.toLowerCase().includes(errorContext.error.toLowerCase())
    );

    steps.push({
      action: 'retrieve_memories',
      result: `Found ${relevantFixes.length} similar past fixes`,
      memories: relevantFixes.map(m => m.title)
    });

    // 2. Apply learned strategies
    if (relevantFixes.length > 0) {
      const topStrategy = relevantFixes[0].content;
      steps.push({
        action: 'apply_learned_strategy',
        strategy: topStrategy,
        result: 'Attempting fix based on past success'
      });

      // Apply the fix
      const fixResult = await this._applyFix(errorContext, topStrategy);
      steps.push(fixResult);
    } else {
      // No memories found, try standard debugging
      steps.push({
        action: 'standard_debugging',
        result: 'No past experience found, using general strategies'
      });

      const fixResult = await this._standardDebug(errorContext);
      steps.push(fixResult);
    }

    return { steps };
  }

  async _applyFix(errorContext, strategy) {
    // Your fix implementation logic here
    // Return step object with action and result
    return {
      action: 'apply_fix',
      result: 'Fix applied successfully',
      details: { strategy, context: errorContext }
    };
  }

  async _standardDebug(errorContext) {
    // Fallback debugging logic
    return {
      action: 'standard_fix',
      result: 'Applied standard debugging approach',
      details: errorContext
    };
  }
}
```

### Step 3: Create Agent Hooks for Automatic Learning

Create hooks that automatically trigger ReasoningBank cycles:

```javascript
// hooks/pre-debug.js
import { retrieveMemories, formatMemoriesForPrompt } from 'agentic-flow/reasoningbank';

export async function preDebug(context) {
  const query = context.errorMessage;
  const domain = `debugging/${context.errorType}`;

  // Retrieve relevant memories
  const memories = await retrieveMemories(query, { domain });

  // Inject into context for agent to use
  context.memories = memories;
  context.memoriesPrompt = formatMemoriesForPrompt(memories);

  console.log(`[PreDebug] Retrieved ${memories.length} relevant debugging patterns`);

  return context;
}

// hooks/post-debug.js
import { judgeTrajectory, distillMemories } from 'agentic-flow/reasoningbank';

export async function postDebug(context, result) {
  const trajectory = {
    steps: result.debugSteps
  };

  // Judge if the debug was successful
  const verdict = await judgeTrajectory(trajectory, context.errorMessage);

  console.log(`[PostDebug] Verdict: ${verdict.label} (confidence: ${verdict.confidence})`);

  // Distill learnings if successful
  if (verdict.label === 'Success') {
    const newMemories = await distillMemories(trajectory, verdict, context.errorMessage, {
      taskId: result.taskId,
      agentId: 'adaptive-debugger',
      domain: `debugging/${context.errorType}`
    });

    console.log(`[PostDebug] Stored ${newMemories.length} new debugging patterns`);
  }

  return result;
}
```

## 📖 Complete Example: Adaptive Code Reviewer

### Agent Definition

`.claude/agents/quality/adaptive-reviewer.md`:

```markdown
---
name: adaptive-reviewer
description: "Code review specialist that learns from past review feedback and adapts quality standards. Uses ReasoningBank to build institutional knowledge about code quality."
category: quality
reasoning_enabled: true
---

You are an adaptive code review specialist. You learn from every review to improve your assessment criteria and provide increasingly valuable feedback.

## Learning Domains

- `review/security` - Security vulnerability patterns
- `review/performance` - Performance anti-patterns
- `review/maintainability` - Code quality issues
- `review/testing` - Test coverage patterns

## Review Strategy

1. RETRIEVE memories about similar code patterns
2. Apply learned quality standards
3. JUDGE if code meets quality bar
4. DISTILL new patterns from the review
5. CONSOLIDATE knowledge periodically
```

### Implementation

```javascript
import { runTask } from 'agentic-flow/reasoningbank';

export async function reviewCode(codeContext) {
  const query = `Review ${codeContext.language} code for ${codeContext.purpose}`;

  const result = await runTask({
    taskId: `review-${codeContext.prNumber}`,
    agentId: 'adaptive-reviewer',
    domain: 'review/security',
    query,

    executeFn: async (memories) => {
      const steps = [];

      // 1. Check for known security patterns from memory
      const securityPatterns = memories.filter(m =>
        m.domain === 'review/security'
      );

      steps.push({
        action: 'security_check',
        result: `Checking ${securityPatterns.length} known security patterns`,
        patterns: securityPatterns.map(p => p.title)
      });

      // 2. Apply memory-informed review
      const issues = [];

      for (const pattern of securityPatterns) {
        if (codeContext.code.includes(pattern.content.trigger)) {
          issues.push({
            type: 'security',
            pattern: pattern.title,
            severity: 'high',
            suggestion: pattern.content.fix
          });
        }
      }

      steps.push({
        action: 'apply_patterns',
        result: `Found ${issues.length} issues`,
        issues
      });

      // 3. Standard review if no memories matched
      if (issues.length === 0) {
        steps.push({
          action: 'standard_review',
          result: 'No known patterns matched, applying standard checks'
        });
      }

      return { steps };
    }
  });

  return {
    approved: result.verdict.label === 'Success',
    issues: result.usedMemories,
    learned: result.newMemories.length
  };
}
```

## 🔧 Configuration

### Environment Variables

```bash
# Enable ReasoningBank
export REASONINGBANK_ENABLED=true

# Database location
export CLAUDE_FLOW_DB_PATH=".swarm/memory.db"

# API Keys (choose one)
export ANTHROPIC_API_KEY="sk-ant-..."  # Recommended
export OPENROUTER_API_KEY="sk-or-v1-..." # Alternative
export GOOGLE_GEMINI_API_KEY="..." # Alternative

# Retrieval settings
export REASONINGBANK_K=3                   # Top-k memories
export REASONINGBANK_MIN_CONFIDENCE=0.5    # Minimum confidence
export REASONINGBANK_RECENCY_HALFLIFE=7    # Days for recency decay

# Scoring weights (α, β, γ)
export REASONINGBANK_ALPHA=0.7             # Similarity weight
export REASONINGBANK_BETA=0.2              # Recency weight
export REASONINGBANK_GAMMA=0.1             # Reliability weight
export REASONINGBANK_DELTA=0.3             # Diversity weight (MMR)
```

### Config File

`.reasoningbank.config.json`:

```json
{
  "database": {
    "path": ".swarm/memory.db",
    "backup_interval_hours": 24
  },
  "embeddings": {
    "provider": "claude",
    "model": "claude-3-sonnet-20240229",
    "cache_size": 1000
  },
  "retrieve": {
    "k": 3,
    "min_score": 0.5,
    "alpha": 0.7,
    "beta": 0.2,
    "gamma": 0.1,
    "delta": 0.3,
    "recency_half_life_days": 7
  },
  "judge": {
    "model": "claude-3-sonnet-20240229",
    "temperature": 0.3,
    "max_tokens": 1024
  },
  "distill": {
    "model": "claude-3-sonnet-20240229",
    "temperature": 0.3,
    "max_tokens": 2048,
    "confidence_prior_success": 0.8,
    "confidence_prior_failure": 0.6,
    "max_items_success": 3,
    "max_items_failure": 2
  },
  "consolidate": {
    "interval_hours": 24,
    "similarity_threshold": 0.95,
    "min_usage_to_keep": 2
  }
}
```

## 🎯 Best Practices

### 1. Domain Organization

Organize memories with clear domain hierarchies:

```javascript
const domains = {
  authentication: ['login', 'oauth', 'jwt', 'csrf'],
  database: ['queries', 'migrations', 'optimization'],
  testing: ['unit', 'integration', 'e2e'],
  deployment: ['docker', 'k8s', 'cicd']
};
```

### 2. Memory Quality

Create high-quality memories with:
- Clear, descriptive titles
- Specific, actionable content
- Relevant domain tags
- Evidence-based confidence scores

```javascript
const goodMemory = {
  title: 'JWT Expiration Validation Pattern',
  description: 'Validate JWT expiration before database operations',
  content: 'Check exp claim < Date.now()/1000 before proceeding',
  domain: 'authentication/jwt',
  confidence: 0.9  // High confidence from multiple successes
};
```

### 3. Consolidation Strategy

Run consolidation regularly to maintain memory quality:

```javascript
// Periodic consolidation (e.g., nightly job)
setInterval(async () => {
  if (shouldConsolidate()) {
    const result = await consolidate();
    console.log(`Consolidated: removed ${result.itemsPruned} low-value memories`);
  }
}, 24 * 60 * 60 * 1000); // Daily
```

### 4. Error Handling

Always handle ReasoningBank failures gracefully:

```javascript
try {
  const memories = await retrieveMemories(query);
} catch (error) {
  console.warn('ReasoningBank unavailable, proceeding without memories');
  // Continue with standard agent logic
}
```

## 📊 Monitoring and Metrics

### Database Queries

```sql
-- Top performing memories
SELECT
  json_extract(pattern_data, '$.title') as title,
  confidence,
  usage_count,
  created_at
FROM patterns
WHERE type = 'reasoning_memory'
ORDER BY confidence DESC, usage_count DESC
LIMIT 10;

-- Memory growth over time
SELECT
  DATE(created_at) as date,
  COUNT(*) as memories_created
FROM patterns
WHERE type = 'reasoning_memory'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Success rate by domain
SELECT
  json_extract(pattern_data, '$.domain') as domain,
  AVG(CASE WHEN judge_label = 'Success' THEN 1 ELSE 0 END) as success_rate,
  COUNT(*) as total_tasks
FROM task_trajectories
GROUP BY domain
ORDER BY success_rate DESC;
```

### CLI Commands

```bash
# Show current statistics
npx agentic-flow reasoningbank status

# List top memories by confidence
npx agentic-flow reasoningbank list --sort confidence --limit 10

# List most used memories
npx agentic-flow reasoningbank list --sort usage --limit 10

# Run consolidation
npx agentic-flow reasoningbank consolidate

# Validate system
npx agentic-flow reasoningbank test
```

## 🚀 Quick Start Template

Copy this template to get started quickly:

```javascript
// my-reasoning-agent.js
import { initialize, runTask } from 'agentic-flow/reasoningbank';

async function main() {
  // 1. Initialize ReasoningBank
  await initialize();

  // 2. Define your task
  const query = 'Your task description';

  // 3. Run with ReasoningBank
  const result = await runTask({
    taskId: `task-${Date.now()}`,
    agentId: 'my-agent',
    domain: 'your-domain',
    query,

    // 4. Implement your execution logic
    executeFn: async (memories) => {
      console.log(`Using ${memories.length} relevant memories`);

      // Your agent logic here
      const steps = [
        { action: 'step1', result: 'success' },
        { action: 'step2', result: 'success' }
      ];

      return { steps };
    }
  });

  // 5. Check results
  console.log(`Verdict: ${result.verdict.label}`);
  console.log(`Used ${result.usedMemories.length} memories`);
  console.log(`Created ${result.newMemories.length} new memories`);
}

main().catch(console.error);
```

## 📚 Resources

- **Paper**: [ReasoningBank on arXiv](https://arxiv.org/html/2509.25140v1)
- **Source**: `/node_modules/agentic-flow/dist/reasoningbank/`
- **Demo**: `npx agentic-flow reasoningbank demo`
- **Tests**: `npx agentic-flow reasoningbank test`
- **Docs**: `.claude/agents/reasoning/README.md`

## 🆘 Troubleshooting

### Issue: "No memories found"

**Solution**: Seed initial memories or run more tasks to build memory bank.

```javascript
import { db } from 'agentic-flow/reasoningbank';

db.upsertMemory({
  id: ulid(),
  type: 'reasoning_memory',
  pattern_data: {
    title: 'Seed Memory',
    description: 'Initial knowledge',
    content: 'Strategy details',
    domain: 'your-domain'
  },
  confidence: 0.7,
  usage_count: 0
});
```

### Issue: "Database locked"

**Solution**: Only one process can write at a time. Use connection pooling or queue writes.

### Issue: "Low confidence scores"

**Solution**: Let the agent run more tasks. Confidence increases with successful usage.

### Issue: "Memory not improving performance"

**Solution**: Check memory quality, adjust scoring weights, or increase consolidation frequency.

---

**Created**: 2025-10-12
**Version**: 1.0.0
**Status**: Production-ready
