#!/usr/bin/env node

/**
 * AgentDB Performance Validation
 *
 * Validates AgentDB v1.3.9 performance claims:
 * - 150x faster search (target: <100µs)
 * - 500x faster batch insert (target: <2ms for 100 vectors)
 * - 12,500x faster large queries (target: <10ms for 1M vectors)
 * - Memory efficiency with quantization
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class AgentDBPerformanceBenchmark {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      system: 'agentdb',
      version: '1.3.9',
      benchmarks: {},
      comparisons: {}
    };
    this.agentdb = null;
    this.baselineResults = null;
  }

  // Initialize AgentDB
  async initialize() {
    try {
      // Dynamic import of AgentDB (will be available after Agent 1 completes)
      const AgentDB = require('../../../src/agentdb');
      this.agentdb = new AgentDB({
        dbPath: ':memory:', // In-memory for benchmarking
        enableHNSW: true,
        hnswConfig: {
          M: 16, // Default configuration
          efConstruction: 200,
          efSearch: 50
        }
      });

      await this.agentdb.initialize();
      console.log('✅ AgentDB initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize AgentDB:', error.message);
      throw new Error('AgentDB not available. Ensure Agent 1 has completed implementation.');
    }
  }

  // Load baseline results for comparison
  loadBaseline() {
    try {
      const baselinePath = path.join(process.cwd(), 'docs/agentdb/benchmarks/baseline-report.json');
      this.baselineResults = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      console.log('✅ Baseline results loaded for comparison');
    } catch (error) {
      console.warn('⚠️  No baseline results found. Run baseline benchmarks first.');
    }
  }

  // Generate test vectors
  generateTestVectors(count, dimensions = 384) {
    const vectors = [];
    for (let i = 0; i < count; i++) {
      vectors.push({
        id: `agentdb-vector-${i}`,
        embedding: Array.from({ length: dimensions }, () => Math.random()),
        metadata: {
          type: 'test',
          index: i,
          category: `cat-${i % 10}`,
          timestamp: Date.now()
        }
      });
    }
    return vectors;
  }

  // Benchmark 1: Verify 150x Search Improvement (Target: <100µs)
  async benchmarkHNSWSearch() {
    console.log('\n📊 Benchmarking HNSW Search Performance...');
    console.log('   Target: <100µs per query (150x improvement)');

    const testSizes = [100, 1000, 10000];
    const results = {};

    for (const size of testSizes) {
      console.log(`\n  Testing with ${size} vectors...`);

      // Insert test data
      const vectors = this.generateTestVectors(size);
      await this.agentdb.insertBatch(vectors);

      const queryVector = this.generateTestVectors(1)[0].embedding;

      // Warmup
      for (let i = 0; i < 10; i++) {
        await this.agentdb.search(queryVector, { topK: 10 });
      }

      // Benchmark
      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await this.agentdb.search(queryVector, { topK: 10 });
      }

      const end = performance.now();
      const avgLatencyMs = (end - start) / iterations;
      const avgLatencyUs = avgLatencyMs * 1000;

      results[`${size}_vectors`] = {
        avgLatencyMs: Math.round(avgLatencyMs * 1000) / 1000,
        avgLatencyUs: Math.round(avgLatencyUs * 10) / 10,
        throughputQps: Math.round(1000 / avgLatencyMs),
        targetMet: avgLatencyUs < 100
      };

      const status = results[`${size}_vectors`].targetMet ? '✅' : '❌';
      console.log(`    ${status} Average: ${results[`${size}_vectors`].avgLatencyUs}µs`);
      console.log(`       Throughput: ${results[`${size}_vectors`].throughputQps} QPS`);

      // Compare with baseline
      if (this.baselineResults?.benchmarks?.patternSearch?.[`${size}_vectors`]) {
        const baseline = this.baselineResults.benchmarks.patternSearch[`${size}_vectors`].avgLatencyUs;
        const improvement = baseline / avgLatencyUs;
        results[`${size}_vectors`].improvement = Math.round(improvement * 10) / 10;
        console.log(`       Improvement: ${results[`${size}_vectors`].improvement}x faster`);
      }

      // Clear for next test
      await this.agentdb.clear();
    }

    this.results.benchmarks.hnswSearch = results;
    return results;
  }

  // Benchmark 2: Verify 500x Batch Insert Improvement (Target: <2ms for 100)
  async benchmarkBatchInsert() {
    console.log('\n📊 Benchmarking Batch Insert Performance...');
    console.log('   Target: <2ms for 100 vectors (500x improvement)');

    const batchSizes = [10, 100, 1000];
    const results = {};

    for (const batchSize of batchSizes) {
      console.log(`\n  Testing batch size ${batchSize}...`);

      const iterations = 100;
      const latencies = [];

      for (let i = 0; i < iterations; i++) {
        const vectors = this.generateTestVectors(batchSize);

        const start = performance.now();
        await this.agentdb.insertBatch(vectors);
        const end = performance.now();

        latencies.push(end - start);

        // Clear to avoid memory issues
        if (i % 10 === 0) await this.agentdb.clear();
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      results[`batch_${batchSize}`] = {
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
        p95LatencyMs: Math.round(p95Latency * 100) / 100,
        throughputVectorsPerSec: Math.round(batchSize / (avgLatency / 1000)),
        targetMet: batchSize === 100 ? avgLatency < 2 : true
      };

      const status = results[`batch_${batchSize}`].targetMet ? '✅' : '❌';
      console.log(`    ${status} Average: ${results[`batch_${batchSize}`].avgLatencyMs}ms`);
      console.log(`       P95: ${results[`batch_${batchSize}`].p95LatencyMs}ms`);
      console.log(`       Throughput: ${results[`batch_${batchSize}`].throughputVectorsPerSec} vectors/sec`);

      // Compare with baseline
      if (this.baselineResults?.benchmarks?.batchInsert?.[`batch_${batchSize}`]) {
        const baseline = this.baselineResults.benchmarks.batchInsert[`batch_${batchSize}`].latencyMs;
        const improvement = baseline / avgLatency;
        results[`batch_${batchSize}`].improvement = Math.round(improvement * 10) / 10;
        console.log(`       Improvement: ${results[`batch_${batchSize}`].improvement}x faster`);
      }
    }

    this.results.benchmarks.batchInsert = results;
    return results;
  }

  // Benchmark 3: Verify 12,500x Large Query Improvement (Target: <10ms for 1M)
  async benchmarkLargeScaleQuery() {
    console.log('\n📊 Benchmarking Large-Scale Query Performance...');
    console.log('   Target: <10ms for 1M vectors (12,500x improvement)');

    const scales = [
      { size: 10000, name: '10K', target: null },
      { size: 50000, name: '50K', target: null },
      { size: 100000, name: '100K', target: 50 }, // ~50ms for 100K
      { size: 1000000, name: '1M', target: 10 } // <10ms for 1M
    ];

    const results = {};

    for (const scale of scales) {
      console.log(`\n  Testing with ${scale.name} vectors...`);

      // Insert data in batches
      const batchSize = 10000;
      const numBatches = Math.ceil(scale.size / batchSize);

      console.log(`    Inserting ${scale.size} vectors...`);
      const insertStart = performance.now();

      for (let i = 0; i < numBatches; i++) {
        const vectors = this.generateTestVectors(Math.min(batchSize, scale.size - i * batchSize));
        await this.agentdb.insertBatch(vectors);

        if ((i + 1) % 10 === 0) {
          console.log(`    Progress: ${i + 1}/${numBatches} batches inserted`);
        }
      }

      const insertEnd = performance.now();
      console.log(`    ✅ Insertion complete in ${Math.round(insertEnd - insertStart)}ms`);

      // Query benchmark
      const queryVector = this.generateTestVectors(1)[0].embedding;
      const iterations = 100;
      const latencies = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await this.agentdb.search(queryVector, { topK: 10 });
        const end = performance.now();
        latencies.push(end - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
      const p99Latency = latencies[Math.floor(latencies.length * 0.99)];

      results[scale.name] = {
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
        p95LatencyMs: Math.round(p95Latency * 100) / 100,
        p99LatencyMs: Math.round(p99Latency * 100) / 100,
        qps: Math.round(1000 / avgLatency),
        targetMet: scale.target ? avgLatency < scale.target : true
      };

      const status = results[scale.name].targetMet ? '✅' : '❌';
      console.log(`    ${status} Average: ${results[scale.name].avgLatencyMs}ms`);
      console.log(`       P95: ${results[scale.name].p95LatencyMs}ms`);
      console.log(`       P99: ${results[scale.name].p99LatencyMs}ms`);
      console.log(`       QPS: ${results[scale.name].qps}`);

      // Compare with baseline
      if (this.baselineResults?.benchmarks?.largeScaleQuery?.[scale.name]) {
        const baseline = this.baselineResults.benchmarks.largeScaleQuery[scale.name].latencyMs;
        const improvement = baseline / avgLatency;
        results[scale.name].improvement = Math.round(improvement * 10) / 10;
        console.log(`       Improvement: ${results[scale.name].improvement}x faster`);
      }

      // Clear for next test
      await this.agentdb.clear();
    }

    this.results.benchmarks.largeScaleQuery = results;
    return results;
  }

  // Benchmark 4: Memory Efficiency with Quantization
  async benchmarkQuantization() {
    console.log('\n📊 Benchmarking Quantization Memory Savings...');

    const quantizationMethods = ['none', 'binary', 'scalar', 'product'];
    const vectorCount = 10000;
    const results = {};

    for (const method of quantizationMethods) {
      console.log(`\n  Testing ${method} quantization...`);

      // Reinitialize with specific quantization
      await this.agentdb.close();
      const AgentDB = require('../../../src/agentdb');
      this.agentdb = new AgentDB({
        dbPath: ':memory:',
        enableHNSW: true,
        quantization: method !== 'none' ? { type: method } : null
      });
      await this.agentdb.initialize();

      // Insert vectors
      const vectors = this.generateTestVectors(vectorCount);
      const memBefore = process.memoryUsage();

      await this.agentdb.insertBatch(vectors);

      const memAfter = process.memoryUsage();

      // Query performance with quantization
      const queryVector = this.generateTestVectors(1)[0].embedding;
      const iterations = 100;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await this.agentdb.search(queryVector, { topK: 10 });
      }

      const end = performance.now();
      const avgLatency = (end - start) / iterations;

      results[method] = {
        memoryUsedMB: Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024 * 100) / 100,
        queryLatencyMs: Math.round(avgLatency * 100) / 100,
        memorySavingsPercent: null
      };

      if (method === 'none') {
        results.baseline = results[method].memoryUsedMB;
      } else {
        const savings = ((results.baseline - results[method].memoryUsedMB) / results.baseline * 100);
        results[method].memorySavingsPercent = Math.round(savings * 10) / 10;
      }

      console.log(`    Memory: ${results[method].memoryUsedMB}MB`);
      console.log(`    Query: ${results[method].queryLatencyMs}ms`);
      if (results[method].memorySavingsPercent !== null) {
        console.log(`    Savings: ${results[method].memorySavingsPercent}%`);
      }
    }

    this.results.benchmarks.quantization = results;
    return results;
  }

  // Generate performance report
  generateReport() {
    const reportPath = path.join(process.cwd(), 'docs/agentdb/benchmarks/agentdb-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('📊 AGENTDB PERFORMANCE REPORT');
    console.log('='.repeat(80));
    console.log(`\n🕐 Timestamp: ${this.results.timestamp}`);
    console.log(`📦 AgentDB Version: ${this.results.version}`);
    console.log(`\n📁 Full report saved to: ${reportPath}`);

    return reportPath;
  }

  // Run all benchmarks
  async runAll() {
    console.log('🚀 Starting AgentDB Performance Validation');
    console.log('='.repeat(80));

    await this.initialize();
    this.loadBaseline();

    await this.benchmarkHNSWSearch();
    await this.benchmarkBatchInsert();
    await this.benchmarkLargeScaleQuery();
    await this.benchmarkQuantization();

    const reportPath = this.generateReport();

    console.log('\n✅ All AgentDB benchmarks complete!');
    console.log(`📊 Results: ${reportPath}\n`);

    await this.agentdb.close();

    return this.results;
  }
}

// Run if called directly
if (require.main === module) {
  const benchmark = new AgentDBPerformanceBenchmark();
  benchmark.runAll()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Benchmark failed:', err);
      process.exit(1);
    });
}

module.exports = AgentDBPerformanceBenchmark;
