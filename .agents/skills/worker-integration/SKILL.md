---
name: worker-integration
description: Worker-Agent integration for intelligent task dispatch and performance tracking
version: 1.0.0
invocable: true
author: agentic-flow
capabilities:
  - agent_selection
  - performance_tracking
  - memory_coordination
  - self_learning
---

# Worker-Agent Integration Skill

Intelligent coordination between background workers and specialized agents.

## Quick Start

```bash
# View agent recommendations for a trigger
npx agentic-flow workers agents ultralearn
npx agentic-flow workers agents optimize

# View performance metrics
npx agentic-flow workers metrics

# View integration stats
npx agentic-flow workers stats --integration
```

## Agent Mappings

Workers automatically dispatch to optimal agents based on trigger type:

| Trigger | Primary Agents | Fallback | Pipeline Phases |
|---------|---------------|----------|-----------------|
| `ultralearn` | researcher, coder | planner | discovery → patterns → vectorization → summary |
| `optimize` | performance-analyzer, coder | researcher | static-analysis → performance → patterns |
| `audit` | security-analyst, tester | reviewer | security → secrets → vulnerability-scan |
| `benchmark` | performance-analyzer | coder, tester | performance → metrics → report |
| `testgaps` | tester | coder | discovery → coverage → gaps |
| `document` | documenter, researcher | coder | api-discovery → patterns → indexing |
| `deepdive` | researcher, security-analyst | coder | call-graph → deps → trace |
| `refactor` | coder, reviewer | researcher | complexity → smells → patterns |

## Performance-Based Selection

The system learns from execution history to improve agent selection:

```typescript
// Agent selection considers:
// 1. Quality score (0-1)
// 2. Success rate
// 3. Average latency
// 4. Execution count

const { agent, confidence, reasoning } = selectBestAgent('optimize');
// agent: "performance-analyzer"
// confidence: 0.87
// reasoning: "Selected based on 45 executions with 94.2% success"
```

## Memory Key Patterns

Workers store results using consistent patterns:

```
{trigger}/{topic}/{phase}

Examples:
- ultralearn/auth-module/analysis
- optimize/database/performance
- audit/payment/vulnerabilities
- benchmark/api/metrics
```

## Benchmark Thresholds

Agents are monitored against performance thresholds:

```json
{
  "researcher": {
    "p95_latency": "<500ms",
    "memory_mb": "<256MB"
  },
  "coder": {
    "p95_latency": "<300ms",
    "quality_score": ">0.85"
  },
  "security-analyst": {
    "scan_coverage": ">95%",
    "p95_latency": "<1000ms"
  }
}
```

## Feedback Loop

Workers provide feedback for continuous improvement:

```typescript
import { workerAgentIntegration } from 'agentic-flow/workers/worker-agent-integration';

// Record execution feedback
workerAgentIntegration.recordFeedback(
  'optimize',           // trigger
  'coder',              // agent
  true,                 // success
  245,                  // latency ms
  0.92                  // quality score
);

// Check compliance
const { compliant, violations } = workerAgentIntegration.checkBenchmarkCompliance('coder');
```

## Integration Statistics

```bash
$ npx agentic-flow workers stats --integration

Worker-Agent Integration Stats
══════════════════════════════
Total Agents:       6
Tracked Agents:     4
Total Feedback:     156
Avg Quality Score:  0.89

Model Cache Stats
─────────────────
Hits:     1,234
Misses:   45
Hit Rate: 96.5%
```

## Configuration

Enable integration features in `.claude/settings.json`:

```json
{
  "workers": {
    "enabled": true,
    "parallel": true,
    "memoryDepositEnabled": true,
    "agentMappings": {
      "ultralearn": ["researcher", "coder"],
      "optimize": ["performance-analyzer", "coder"]
    }
  }
}
```
