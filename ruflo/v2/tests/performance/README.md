# AgentDB Performance Testing Suite

Comprehensive performance testing and optimization tools for AgentDB v1.3.9 integration.

## Overview

This suite validates the claimed performance improvements of AgentDB over the current claude-flow memory system:
- **150x faster** search with HNSW indexing
- **500x faster** batch inserts
- **12,500x faster** large-scale queries
- **4-32x** memory reduction with quantization

## Test Suites

### 1. Baseline Performance (`baseline/current-system.js`)

Measures current system performance to establish baselines:
- Pattern search latency (linear scan)
- Batch insert throughput
- Large-scale query performance (10K-100K vectors)
- Memory usage patterns

**Run:**
```bash
node tests/performance/baseline/current-system.js
```

**Output:** `docs/agentdb/benchmarks/baseline-report.json`

### 2. AgentDB Performance Validation (`agentdb/agentdb-perf.js`)

Validates AgentDB performance claims:
- HNSW search performance (<100µs target)
- Batch insert performance (<2ms for 100 vectors)
- Large-scale queries (<10ms for 1M vectors)
- Quantization memory efficiency

**Run:**
```bash
node tests/performance/agentdb/agentdb-perf.js
```

**Output:** `docs/agentdb/benchmarks/agentdb-report.json`

**Prerequisites:** Agent 1 must complete AgentDB implementation first.

### 3. HNSW Optimization (`agentdb/hnsw-optimizer.js`)

Analyzes HNSW configurations to find optimal settings:
- Tests different M, efConstruction, efSearch values
- Measures build time vs search accuracy trade-offs
- Calculates recall@K for accuracy validation
- Recommends configurations for different use cases

**Run:**
```bash
node tests/performance/agentdb/hnsw-optimizer.js
```

**Output:** `docs/agentdb/benchmarks/hnsw-optimization.json`

**Recommendations:**
- Fastest search
- Highest recall
- Best balance
- Fastest build
- Most efficient (QPS/Memory)

### 4. Load Testing (`agentdb/load-test.js`)

Tests system under realistic production loads:
- **Scalability**: 1K → 1M vectors
- **Concurrent Access**: 1-50 simultaneous queries
- **Stress Test**: Sustained high load (30s+)
- **Resource Limits**: CPU and memory constraints

**Run:**
```bash
node tests/performance/agentdb/load-test.js
```

**Output:** `docs/agentdb/benchmarks/load-test-report.json`

**Tests:**
- Insertion throughput at scale
- Query latency under load
- Concurrent query handling
- System stability over time

### 5. Memory Profiling (`agentdb/memory-profile.js`)

Analyzes memory usage patterns and efficiency:
- Baseline memory usage
- Quantization impact (binary, scalar, product)
- Memory leak detection
- Peak memory under load

**Run with GC exposure for accurate profiling:**
```bash
node --expose-gc tests/performance/agentdb/memory-profile.js
```

**Output:** `docs/agentdb/benchmarks/memory-profile-report.json`

**Analysis:**
- Bytes per vector
- Memory scaling (100K, 1M, 10M vectors)
- Quantization savings percentages
- Leak detection (trend analysis)

## Running All Tests

### Sequential Execution

```bash
# 1. Baseline (run first, before AgentDB implementation)
node tests/performance/baseline/current-system.js

# 2. Wait for Agent 1 to complete AgentDB implementation

# 3. Run AgentDB benchmarks
node tests/performance/agentdb/agentdb-perf.js
node tests/performance/agentdb/hnsw-optimizer.js
node tests/performance/agentdb/load-test.js
node --expose-gc tests/performance/agentdb/memory-profile.js
```

### Automated Suite

```bash
# Create test runner script
npm run benchmark:all
```

## Results & Reports

All benchmark results are saved to `docs/agentdb/benchmarks/`:

```
docs/agentdb/benchmarks/
├── baseline-report.json        # Current system baseline
├── agentdb-report.json         # AgentDB performance validation
├── hnsw-optimization.json      # HNSW configuration analysis
├── load-test-report.json       # Load testing results
└── memory-profile-report.json  # Memory profiling analysis
```

## Interpreting Results

### Performance Metrics

**Query Latency:**
- **Target**: <100µs (0.1ms) for HNSW search
- **Current**: ~15ms for 10K vectors (linear scan)
- **Improvement**: Should be 150x faster

**Batch Insert:**
- **Target**: <2ms for 100 vectors
- **Current**: ~1000ms for 100 vectors
- **Improvement**: Should be 500x faster

**Large Queries:**
- **Target**: <10ms for 1M vectors
- **Current**: ~125 seconds for 1M vectors
- **Improvement**: Should be 12,500x faster

### Memory Metrics

**Quantization Savings:**
- **None**: Baseline
- **Binary**: ~75% savings (4x capacity)
- **Scalar**: ~87.5% savings (8x capacity)
- **Product**: ~96.875% savings (32x capacity)

### Quality Metrics

**Recall@K:**
- **Target**: >95% for production
- **Acceptable**: >90% for most use cases
- **Trade-off**: Higher M and efSearch = better recall but slower

## Configuration Recommendations

Based on benchmark results, choose configuration:

### Development
```javascript
{ M: 16, efConstruction: 200, efSearch: 50, quantization: null }
```

### Production (Small-Medium)
```javascript
{ M: 16, efConstruction: 200, efSearch: 100, quantization: 'binary' }
```

### Production (Large Scale)
```javascript
{ M: 32, efConstruction: 400, efSearch: 200, quantization: 'product' }
```

### High Performance (Low Latency)
```javascript
{ M: 64, efConstruction: 800, efSearch: 400, quantization: null }
```

## Troubleshooting

### "AgentDB not available" Error

**Cause:** Agent 1 hasn't completed implementation yet.

**Solution:** Wait for Agent 1 to implement core AgentDB integration, then run tests.

### High Memory Usage

**Cause:** Testing with large datasets without quantization.

**Solution:**
1. Enable quantization: `quantization: { type: 'binary' }`
2. Reduce test dataset sizes
3. Run with `--max-old-space-size=8192` for Node.js

### "Garbage collection not exposed" Warning

**Cause:** Running memory profiler without `--expose-gc` flag.

**Solution:** Run with: `node --expose-gc tests/performance/agentdb/memory-profile.js`

### Benchmark Timeouts

**Cause:** Large-scale tests taking too long.

**Solution:**
1. Reduce dataset sizes in test configuration
2. Increase Node.js timeout
3. Run on more powerful hardware

## Contributing

When adding new benchmarks:

1. Follow existing patterns for consistency
2. Generate JSON reports for automated analysis
3. Include clear console output for human readability
4. Document new metrics and thresholds
5. Update this README

## References

- AgentDB Documentation: https://github.com/rUv-Swarm/agentdb
- HNSW Algorithm: https://arxiv.org/abs/1603.09320
- Vector Quantization: https://en.wikipedia.org/wiki/Vector_quantization
- Claude-Flow Integration Plan: `/docs/AGENTDB_INTEGRATION_PLAN.md`
- Production Readiness: `/docs/agentdb/PRODUCTION_READINESS.md`
