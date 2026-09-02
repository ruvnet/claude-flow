---
name: worker-benchmarks
description: Run comprehensive worker system benchmarks and performance analysis
version: 1.0.0
invocable: true
author: agentic-flow
capabilities:
  - performance_testing
  - metrics_collection
  - optimization_recommendations
---

# Worker Benchmarks Skill

Run comprehensive performance benchmarks for the agentic-flow worker system.

## Quick Start

```bash
# Run full benchmark suite
npx agentic-flow workers benchmark

# Run specific benchmark
npx agentic-flow workers benchmark --type trigger-detection
npx agentic-flow workers benchmark --type registry
npx agentic-flow workers benchmark --type agent-selection
npx agentic-flow workers benchmark --type concurrent
```

## Benchmark Types

### 1. Trigger Detection (`trigger-detection`)
Tests keyword detection speed across 12 worker triggers.
- **Target**: p95 < 5ms
- **Iterations**: 1000
- **Metrics**: latency, throughput, histogram

### 2. Worker Registry (`registry`)
Tests CRUD operations on worker entries.
- **Target**: p95 < 10ms
- **Iterations**: 500 creates, gets, updates
- **Metrics**: per-operation latency breakdown

### 3. Agent Selection (`agent-selection`)
Tests performance-based agent selection.
- **Target**: p95 < 1ms
- **Iterations**: 1000
- **Metrics**: selection confidence, agent scores

### 4. Model Cache (`cache`)
Tests model caching performance.
- **Target**: p95 < 0.5ms
- **Metrics**: hit rate, cache size, eviction stats

### 5. Concurrent Workers (`concurrent`)
Tests parallel worker creation and updates.
- **Target**: < 1000ms for 10 workers
- **Metrics**: per-worker latency, memory usage

### 6. Memory Key Generation (`memory-keys`)
Tests memory pattern key generation.
- **Target**: p95 < 0.1ms
- **Iterations**: 5000
- **Metrics**: unique patterns, throughput

## Output Format

```
═══════════════════════════════════════════════════════════
📈 BENCHMARK RESULTS
═══════════════════════════════════════════════════════════

✅ Trigger Detection
   Operation: detect
   Count: 1,000
   Avg: 0.045ms | p95: 0.120ms (target: 5ms)
   Throughput: 22,222 ops/s
   Memory Δ: 0.12MB

✅ Worker Registry
   Operation: crud
   Count: 1,500
   Avg: 1.234ms | p95: 3.456ms (target: 10ms)
   Throughput: 810 ops/s
   Memory Δ: 2.34MB

───────────────────────────────────────────────────────────
📊 SUMMARY
───────────────────────────────────────────────────────────
Total Tests: 6
Passed: 6 | Failed: 0
Avg Latency: 0.567ms
Total Duration: 2345ms
Peak Memory: 8.90MB
═══════════════════════════════════════════════════════════
```

## Integration with Settings

Benchmark thresholds are configured in `.claude/settings.json`:

```json
{
  "performance": {
    "benchmarkThresholds": {
      "triggerDetection": { "p95Ms": 5 },
      "workerRegistry": { "p95Ms": 10 },
      "agentSelection": { "p95Ms": 1 },
      "memoryKeyGeneration": { "p95Ms": 0.1 },
      "concurrentWorkers": { "totalMs": 1000 }
    }
  }
}
```

## Programmatic Usage

```typescript
import { workerBenchmarks, runBenchmarks } from 'agentic-flow/workers/worker-benchmarks';

// Run full suite
const suite = await runBenchmarks();
console.log(suite.summary);

// Run individual benchmarks
const triggerResult = await workerBenchmarks.benchmarkTriggerDetection(1000);
const registryResult = await workerBenchmarks.benchmarkRegistryOperations(500);
```

## Performance Optimization Tips

1. **Model Cache**: Enable with `CLAUDE_FLOW_MODEL_CACHE_MB=512`
2. **Parallel Workers**: Enable with `CLAUDE_FLOW_WORKER_PARALLEL=true`
3. **Warning Suppression**: Enable with `CLAUDE_FLOW_SUPPRESS_WARNINGS=true`
4. **SQLite WAL Mode**: Automatic for better concurrent performance
