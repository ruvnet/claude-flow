#!/usr/bin/env node

/**
 * Baseline Performance Measurement for Current Claude-Flow Memory System
 *
 * Measures:
 * - Pattern search latency
 * - Batch insert throughput
 * - Large-scale query performance
 * - Memory usage baseline
 *
 * This establishes the baseline before AgentDB integration.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class BaselinePerformanceBenchmark {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      system: 'claude-flow-current',
      version: this.getVersion(),
      benchmarks: {}
    };
    this.memoryDir = path.join(process.cwd(), '.swarm');
    this.testDataDir = path.join(process.cwd(), 'tests/performance/baseline/test-data');
  }

  getVersion() {
    try {
      const pkg = require('../../../package.json');
      return pkg.version;
    } catch {
      return 'unknown';
    }
  }

  // Generate test vectors for benchmarking
  generateTestVectors(count, dimensions = 384) {
    const vectors = [];
    for (let i = 0; i < count; i++) {
      const vector = {
        id: `test-vector-${i}`,
        embedding: Array.from({ length: dimensions }, () => Math.random()),
        metadata: {
          type: 'test',
          index: i,
          category: `cat-${i % 10}`,
          timestamp: Date.now()
        }
      };
      vectors.push(vector);
    }
    return vectors;
  }

  // Measure memory usage
  measureMemory() {
    const usage = process.memoryUsage();
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100, // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
      rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100,
      external: Math.round(usage.external / 1024 / 1024 * 100) / 100
    };
  }

  // Cosine similarity (current implementation approach)
  cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Benchmark 1: Pattern Search Latency (linear search)
  async benchmarkPatternSearch() {
    console.log('\n📊 Benchmarking Pattern Search (Linear)...');

    const testSizes = [100, 1000, 10000];
    const results = {};

    for (const size of testSizes) {
      console.log(`  Testing with ${size} vectors...`);
      const vectors = this.generateTestVectors(size);
      const queryVector = this.generateTestVectors(1)[0].embedding;

      // Warmup
      for (let i = 0; i < 10; i++) {
        vectors.forEach(v => this.cosineSimilarity(v.embedding, queryVector));
      }

      // Actual benchmark
      const iterations = 100;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const similarities = vectors.map(v => ({
          vector: v,
          score: this.cosineSimilarity(v.embedding, queryVector)
        }));
        similarities.sort((a, b) => b.score - a.score);
        const top10 = similarities.slice(0, 10);
      }

      const end = performance.now();
      const avgLatency = (end - start) / iterations;

      results[`${size}_vectors`] = {
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
        avgLatencyUs: Math.round(avgLatency * 1000),
        throughputQps: Math.round(1000 / avgLatency)
      };

      console.log(`    Average: ${results[`${size}_vectors`].avgLatencyMs}ms (${results[`${size}_vectors`].avgLatencyUs}µs)`);
    }

    this.results.benchmarks.patternSearch = results;
    return results;
  }

  // Benchmark 2: Batch Insert Throughput
  async benchmarkBatchInsert() {
    console.log('\n📊 Benchmarking Batch Insert...');

    const batchSizes = [10, 100, 1000];
    const results = {};

    for (const batchSize of batchSizes) {
      console.log(`  Testing batch size ${batchSize}...`);
      const vectors = this.generateTestVectors(batchSize);

      // Simulate current insert approach (JSON serialization + file write)
      const start = performance.now();

      const data = JSON.stringify({
        vectors: vectors,
        timestamp: Date.now(),
        count: batchSize
      });

      // Simulate disk I/O
      const tempFile = path.join(this.testDataDir, `batch-${batchSize}.json`);
      fs.mkdirSync(this.testDataDir, { recursive: true });
      fs.writeFileSync(tempFile, data);

      const end = performance.now();
      const latency = end - start;

      results[`batch_${batchSize}`] = {
        latencyMs: Math.round(latency * 100) / 100,
        throughputVectorsPerSec: Math.round(batchSize / (latency / 1000)),
        dataSize: Math.round(data.length / 1024 * 100) / 100 // KB
      };

      console.log(`    Latency: ${results[`batch_${batchSize}`].latencyMs}ms`);
      console.log(`    Throughput: ${results[`batch_${batchSize}`].throughputVectorsPerSec} vectors/sec`);

      // Cleanup
      fs.unlinkSync(tempFile);
    }

    this.results.benchmarks.batchInsert = results;
    return results;
  }

  // Benchmark 3: Large-Scale Query Performance
  async benchmarkLargeScaleQuery() {
    console.log('\n📊 Benchmarking Large-Scale Query...');

    const scales = [
      { size: 10000, name: '10K' },
      { size: 50000, name: '50K' },
      { size: 100000, name: '100K' }
    ];

    const results = {};

    for (const scale of scales) {
      console.log(`  Testing with ${scale.name} vectors...`);
      const vectors = this.generateTestVectors(scale.size);
      const queryVector = this.generateTestVectors(1)[0].embedding;

      const memBefore = this.measureMemory();
      const start = performance.now();

      // Linear scan with similarity computation
      const similarities = vectors.map(v => ({
        id: v.id,
        score: this.cosineSimilarity(v.embedding, queryVector),
        metadata: v.metadata
      }));

      // Sort and get top 10
      similarities.sort((a, b) => b.score - a.score);
      const top10 = similarities.slice(0, 10);

      const end = performance.now();
      const memAfter = this.measureMemory();

      results[scale.name] = {
        latencyMs: Math.round((end - start) * 100) / 100,
        memoryUsedMB: Math.round((memAfter.heapUsed - memBefore.heapUsed) * 100) / 100,
        qps: Math.round(1000 / (end - start) * 100) / 100
      };

      console.log(`    Latency: ${results[scale.name].latencyMs}ms`);
      console.log(`    Memory: ${results[scale.name].memoryUsedMB}MB`);

      // Cleanup to prevent OOM
      vectors.length = 0;
      global.gc && global.gc();
    }

    this.results.benchmarks.largeScaleQuery = results;
    return results;
  }

  // Benchmark 4: Memory Usage Baseline
  async benchmarkMemoryUsage() {
    console.log('\n📊 Benchmarking Memory Usage...');

    const results = {};
    const memBefore = this.measureMemory();

    // Store increasing amounts of data
    const dataSizes = [1000, 5000, 10000];

    for (const size of dataSizes) {
      console.log(`  Testing with ${size} vectors in memory...`);
      const vectors = this.generateTestVectors(size);

      // Simulate in-memory storage
      const storage = {
        vectors: vectors,
        index: new Map(vectors.map(v => [v.id, v])),
        metadata: vectors.map(v => v.metadata)
      };

      const mem = this.measureMemory();

      results[`${size}_vectors`] = {
        heapUsedMB: mem.heapUsed,
        rssMB: mem.rss,
        vectorSizeMB: Math.round(JSON.stringify(vectors).length / 1024 / 1024 * 100) / 100
      };

      console.log(`    Heap: ${results[`${size}_vectors`].heapUsedMB}MB`);
      console.log(`    RSS: ${results[`${size}_vectors`].rssMB}MB`);
    }

    this.results.benchmarks.memoryUsage = results;
    return results;
  }

  // Generate performance report
  generateReport() {
    const reportPath = path.join(process.cwd(), 'docs/agentdb/benchmarks/baseline-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('📊 BASELINE PERFORMANCE REPORT');
    console.log('='.repeat(80));
    console.log(`\n🕐 Timestamp: ${this.results.timestamp}`);
    console.log(`📦 Version: ${this.results.version}`);
    console.log(`\n📁 Full report saved to: ${reportPath}`);

    return reportPath;
  }

  // Run all benchmarks
  async runAll() {
    console.log('🚀 Starting Baseline Performance Benchmarks for Claude-Flow');
    console.log('='.repeat(80));

    await this.benchmarkPatternSearch();
    await this.benchmarkBatchInsert();
    await this.benchmarkLargeScaleQuery();
    await this.benchmarkMemoryUsage();

    const reportPath = this.generateReport();

    console.log('\n✅ All baseline benchmarks complete!');
    console.log(`📊 Results: ${reportPath}\n`);

    return this.results;
  }
}

// Run if called directly
if (require.main === module) {
  const benchmark = new BaselinePerformanceBenchmark();
  benchmark.runAll()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Benchmark failed:', err);
      process.exit(1);
    });
}

module.exports = BaselinePerformanceBenchmark;
