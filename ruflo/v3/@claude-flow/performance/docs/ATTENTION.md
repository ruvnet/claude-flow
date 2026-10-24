# Flash Attention Integration

Integration of `@ruvector/attention` Flash Attention capabilities into the V3 performance module.

## Overview

This module provides high-performance attention mechanisms optimized for V3's 2.49x-7.47x speedup targets. Flash Attention reduces memory usage by ~50% while achieving significant performance improvements through block-wise computation.

## Features

- **Flash Attention Optimizer**: Memory-efficient attention with automatic runtime selection (NAPI/WASM/JS)
- **Comprehensive Benchmarking**: Validate performance against V3 targets
- **Memory Profiling**: Track memory usage and reduction metrics
- **Performance Metrics**: Continuous tracking of speedup and efficiency

## Installation

The `@ruvector/attention` package is already installed as a dependency:

```bash
npm install @ruvector/attention@latest
```

## Quick Start

### Basic Usage

```typescript
import { createFlashAttentionOptimizer } from '@claude-flow/performance';

// Create optimizer
const optimizer = createFlashAttentionOptimizer(512, 64);

// Prepare input
const input = {
  query: new Float32Array(512).fill(1.0),
  keys: Array.from({ length: 100 }, () => new Float32Array(512).fill(1.0)),
  values: Array.from({ length: 100 }, () => new Float32Array(512).fill(1.0)),
};

// Run optimized attention
const output = await optimizer.optimize(input);
console.log(`Execution time: ${output.executionTimeMs}ms`);
console.log(`Runtime: ${output.runtime}`); // 'napi', 'wasm', or 'js'
```

### Performance Benchmarking

```typescript
import { quickBenchmark } from '@claude-flow/performance';

// Quick benchmark
const result = await quickBenchmark(512);
console.log(`Speedup: ${result.speedup.toFixed(2)}x`);
console.log(`Meets target: ${result.meetsTarget ? 'YES' : 'NO'}`);
```

### V3 Target Validation

```typescript
import { quickValidation } from '@claude-flow/performance';

// Validate V3 performance targets (2.49x-7.47x)
const isValid = await quickValidation();
// Prints detailed validation report
```

### Comprehensive Benchmark Suite

```typescript
import { runAndDisplaySuite } from '@claude-flow/performance';

// Run full benchmark suite across multiple dimensions
const suite = await runAndDisplaySuite();
// Prints detailed report with all benchmarks
```

## API Reference

### FlashAttentionOptimizer

Main class for optimizing attention computations.

#### Constructor

```typescript
new FlashAttentionOptimizer(dim?: number, blockSize?: number)
```

- `dim`: Vector dimension (default: 512)
- `blockSize`: Flash Attention block size (default: 64)

#### Methods

##### optimize(input: AttentionInput): Promise<AttentionOutput>

Optimize attention computation using Flash Attention.

```typescript
const output = await optimizer.optimize({
  query: Float32Array,
  keys: Float32Array[],
  values: Float32Array[],
});
```

##### benchmark(): Promise<BenchmarkResult>

Run comprehensive benchmark comparing Flash Attention vs baseline.

```typescript
const result = await optimizer.benchmark();
console.log(result.speedup); // e.g., 4.23x
```

##### getSpeedup(): number

Get current average speedup from accumulated metrics.

```typescript
const speedup = optimizer.getSpeedup();
```

##### getMetrics(): PerformanceMetrics

Get detailed performance metrics.

```typescript
const metrics = optimizer.getMetrics();
console.log(metrics.averageSpeedup);
console.log(metrics.peakSpeedup);
console.log(metrics.successRate);
```

### AttentionBenchmarkRunner

Comprehensive benchmark suite runner.

#### Methods

##### runComprehensiveSuite(): Promise<SuiteResult>

Run benchmarks across multiple dimensions (128, 256, 512, 768, 1024).

```typescript
const runner = new AttentionBenchmarkRunner();
const suite = await runner.runComprehensiveSuite();
```

##### runComparison(dim, numKeys, iterations): Promise<ComparisonBenchmark>

Run single benchmark comparing Flash vs baseline.

```typescript
const result = await runner.runComparison(512, 100, 1000);
```

##### runMemoryProfile(dimensions): Promise<MemoryProfile[]>

Profile memory usage across different dimensions.

```typescript
const profiles = await runner.runMemoryProfile([256, 512, 1024]);
```

##### validateV3Targets(): Promise<ValidationResult>

Validate against V3 performance targets (2.49x-7.47x).

```typescript
const validation = await runner.validateV3Targets();
console.log(validation.meetsMinimum); // true if ≥2.49x
```

## Performance Targets

The V3 module targets the following Flash Attention performance improvements:

- **Minimum Speedup**: 2.49x
- **Maximum Speedup**: 7.47x
- **Memory Reduction**: ~50%
- **Target Use Cases**:
  - Small (128D): Mobile/edge devices
  - Medium (256D): Standard applications
  - Large (512D): High-performance scenarios
  - XL (768D): Transformer models
  - XXL (1024D): Large language models

## Examples

See `/src/examples/flash-attention-demo.ts` for comprehensive examples:

```bash
# Run all examples
npx tsx v3/@claude-flow/performance/src/examples/flash-attention-demo.ts
```

## Technical Details

### Runtime Selection

The optimizer automatically selects the best available runtime:

1. **NAPI** (Native): Best performance, requires native bindings
2. **WebAssembly**: Good performance, works in browser and Node.js
3. **JavaScript**: Fallback, pure JS implementation

### Memory Efficiency

Flash Attention achieves memory efficiency through:

- Block-wise computation (default block size: 64)
- Reduced intermediate storage
- Optimized memory access patterns

### Benchmark Methodology

Benchmarks measure:

- **Average execution time** over multiple iterations
- **Operations per second**
- **Memory usage** before/after operations
- **Speedup ratio** vs baseline attention

## Integration with V3 Metrics Dashboard

Performance metrics are automatically exported for the V3 metrics dashboard:

```typescript
import { FlashAttentionOptimizer } from '@claude-flow/performance';

const optimizer = new FlashAttentionOptimizer();
// ... run operations ...

// Export metrics for dashboard
const metrics = optimizer.getMetrics();
// Can be integrated with hooks metrics system
```

## Troubleshooting

### Low Speedup (<2.49x)

- Increase `dim` parameter (larger dimensions benefit more)
- Increase `numKeys` (more keys = more benefit)
- Check if NAPI runtime is available (native bindings)
- Ensure sufficient memory for optimal performance

### Memory Usage

- Reduce `blockSize` for lower memory footprint
- Use smaller dimensions for memory-constrained environments
- Monitor with `getMetrics().totalMemorySavedBytes`

### Platform Compatibility

The package includes native bindings for:

- Windows (x64, ARM64)
- macOS (x64, ARM64)
- Linux (x64, ARM64)

Falls back to WebAssembly or JavaScript if native bindings unavailable.

## Contributing

When adding new attention mechanisms or optimizations:

1. Add implementation to `attention-integration.ts`
2. Add benchmarks to `attention-benchmarks.ts`
3. Update exports in `index.ts`
4. Add examples to `examples/flash-attention-demo.ts`
5. Update this README

## License

MIT OR Apache-2.0 (follows @ruvector/attention license)
