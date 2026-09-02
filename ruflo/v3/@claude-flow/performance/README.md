# @claude-flow/performance

[![npm version](https://img.shields.io/npm/v/@claude-flow/performance.svg)](https://www.npmjs.com/package/@claude-flow/performance)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/performance.svg)](https://www.npmjs.com/package/@claude-flow/performance)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Benchmarks](https://img.shields.io/badge/Benchmarks-Vitest-green.svg)](https://vitest.dev/)

> Comprehensive performance benchmarking module for Claude Flow V3 - statistical analysis, memory tracking, regression detection, and Flash Attention validation.

## Features

- **Statistical Benchmarking** - Mean, median, P95, P99, standard deviation, outlier removal
- **Memory Tracking** - Heap, RSS, external, and array buffer monitoring
- **Auto-Calibration** - Automatically adjusts iterations for statistical significance
- **Regression Detection** - Compare against baselines with significance testing
- **V3 Performance Targets** - Built-in targets for CLI, memory, swarm, and attention
- **Flash Attention Validation** - Validate 2.49x-7.47x speedup targets
- **Multiple Output Formats** - Console, JSON, and programmatic access

## Installation

```bash
npm install @claude-flow/performance
```

## Quick Start

```typescript
import { benchmark, BenchmarkRunner, V3_PERFORMANCE_TARGETS } from '@claude-flow/performance';

// Single benchmark
const result = await benchmark('vector-search', async () => {
  await index.search(queryVector, 10);
}, {
  iterations: 100,
  warmup: 10
});

console.log(`Mean: ${result.mean}ms, P99: ${result.p99}ms`);

// Check against target
if (result.mean <= V3_PERFORMANCE_TARGETS['vector-search']) {
  console.log('Target met!');
}
```

## API Reference

### Single Benchmark

```typescript
import { benchmark } from '@claude-flow/performance';

const result = await benchmark(
  'my-benchmark',
  async () => {
    // Code to benchmark
    await someOperation();
  },
  {
    iterations: 100,      // Number of iterations
    warmup: 10,           // Warmup iterations
    timeout: 30000,       // Timeout per iteration (ms)
    forceGC: false,       // Force GC between iterations
    minRuns: 10,          // Minimum runs for significance
    targetTime: 1000,     // Target time for auto-calibration (ms)
    metadata: {}          // Custom metadata
  }
);

// Result structure
{
  name: 'my-benchmark',
  iterations: 100,
  mean: 5.23,
  median: 4.98,
  p95: 8.12,
  p99: 12.45,
  min: 3.21,
  max: 15.67,
  stdDev: 1.45,
  opsPerSecond: 191.20,
  memoryUsage: { heapUsed, heapTotal, external, arrayBuffers, rss },
  memoryDelta: 1024000,
  timestamp: 1704067200000
}
```

### Benchmark Suite

```typescript
import { BenchmarkRunner } from '@claude-flow/performance';

const runner = new BenchmarkRunner('Memory Operations');

// Run individual benchmarks
await runner.run('vector-search', async () => {
  await index.search(query, 10);
});

await runner.run('memory-write', async () => {
  await store.write(entry);
});

// Or run all at once
const suite = await runner.runAll([
  { name: 'search', fn: () => search() },
  { name: 'write', fn: () => write() },
  { name: 'index', fn: () => index() }
]);

// Print results
runner.printResults();

// Export as JSON
const json = runner.toJSON();
```

### Comparison & Regression Detection

```typescript
import { compareResults, printComparisonReport } from '@claude-flow/performance';

// Compare current vs baseline
const comparisons = compareResults(baselineResults, currentResults, {
  'vector-search': 1,      // Target: <1ms
  'memory-write': 5,       // Target: <5ms
  'cli-startup': 500       // Target: <500ms
});

// Print formatted report
printComparisonReport(comparisons);

// Programmatic access
for (const comp of comparisons) {
  if (!comp.targetMet) {
    console.error(`${comp.benchmark} missed target!`);
  }
  if (comp.significant && !comp.improved) {
    console.warn(`${comp.benchmark} regressed by ${comp.changePercent}%`);
  }
}
```

### V3 Performance Targets

```typescript
import { V3_PERFORMANCE_TARGETS, meetsTarget } from '@claude-flow/performance';

// Built-in targets
V3_PERFORMANCE_TARGETS = {
  // Startup Performance
  'cli-cold-start': 500,        // <500ms (5x faster)
  'cli-warm-start': 100,        // <100ms
  'mcp-server-init': 400,       // <400ms (4.5x faster)
  'agent-spawn': 200,           // <200ms (4x faster)

  // Memory Operations
  'vector-search': 1,           // <1ms (150x faster)
  'hnsw-indexing': 10,          // <10ms
  'memory-write': 5,            // <5ms (10x faster)
  'cache-hit': 0.1,             // <0.1ms

  // Swarm Coordination
  'agent-coordination': 50,     // <50ms
  'task-decomposition': 20,     // <20ms
  'consensus-latency': 100,     // <100ms (5x faster)
  'message-throughput': 0.1,    // <0.1ms per message

  // SONA Learning
  'sona-adaptation': 0.05       // <0.05ms
};

// Check if target is met
const { met, target, ratio } = meetsTarget('vector-search', 0.8);
// { met: true, target: 1, ratio: 0.8 }
```

### Formatting Utilities

```typescript
import { formatBytes, formatTime } from '@claude-flow/performance';

formatTime(0.00005);  // '50.00 ns'
formatTime(0.5);      // '500.00 us'
formatTime(5);        // '5.00 ms'
formatTime(5000);     // '5.00 s'

formatBytes(1024);          // '1.00 KB'
formatBytes(1048576);       // '1.00 MB'
formatBytes(1073741824);    // '1.00 GB'
```

## Running Benchmarks

```bash
# Run all benchmarks
npm run bench

# Run attention benchmarks
npm run bench:attention

# Run startup benchmarks
npm run bench:startup
```

## Example Benchmark File

```typescript
// benchmarks/memory.bench.ts
import { describe, bench } from 'vitest';
import { HNSWIndex } from '@claude-flow/memory';

describe('Memory Benchmarks', () => {
  const index = new HNSWIndex({ dimensions: 1536 });

  bench('vector-search', async () => {
    await index.search(queryVector, 10);
  }, { iterations: 1000 });

  bench('hnsw-indexing', async () => {
    await index.addPoint(id, vector);
  }, { iterations: 100 });
});
```

## TypeScript Types

```typescript
import type {
  BenchmarkResult,
  BenchmarkOptions,
  BenchmarkSuite,
  MemoryUsage,
  EnvironmentInfo,
  ComparisonResult,
  PerformanceTarget
} from '@claude-flow/performance';
```

## Dependencies

- `@ruvector/attention` - Flash Attention implementation
- `@ruvector/sona` - SONA learning engine
- `vitest` - Test/benchmark runner

## Related Packages

- [@claude-flow/memory](../memory) - Memory operations to benchmark
- [@claude-flow/swarm](../swarm) - Swarm coordination to benchmark
- [@claude-flow/neural](../neural) - Neural operations to benchmark

## License

MIT
