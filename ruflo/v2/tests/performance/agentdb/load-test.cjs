#!/usr/bin/env node

/**
 * AgentDB Load Testing Suite
 *
 * Tests system under load:
 * - Scalability: 1K → 1M vectors
 * - Concurrent access: Multiple simultaneous queries
 * - Stress testing: High throughput scenarios
 * - Resource limits: Memory and CPU constraints
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const cluster = require('cluster');
const os = require('os');

class LoadTestSuite {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      system: {
        cpus: os.cpus().length,
        memory: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 100) / 100, // GB
        platform: os.platform()
      },
      tests: {}
    };
    this.agentdb = null;
  }

  // Initialize AgentDB
  async initialize(config = {}) {
    const AgentDB = require('../../../src/agentdb');
    this.agentdb = new AgentDB({
      dbPath: config.dbPath || ':memory:',
      enableHNSW: true,
      hnswConfig: config.hnswConfig || {
        M: 16,
        efConstruction: 200,
        efSearch: 50
      },
      ...config
    });

    await this.agentdb.initialize();
  }

  // Generate test vectors
  generateVectors(count, dimensions = 384) {
    const vectors = [];
    for (let i = 0; i < count; i++) {
      vectors.push({
        id: `load-test-${i}`,
        embedding: Array.from({ length: dimensions }, () => Math.random()),
        metadata: {
          type: 'load-test',
          index: i,
          batch: Math.floor(i / 1000),
          timestamp: Date.now()
        }
      });
    }
    return vectors;
  }

  // Test 1: Scalability Test (1K → 1M vectors)
  async testScalability() {
    console.log('\n📊 Test 1: Scalability (1K → 1M vectors)');
    console.log('='.repeat(80));

    const scales = [
      { size: 1000, name: '1K' },
      { size: 10000, name: '10K' },
      { size: 100000, name: '100K' },
      { size: 1000000, name: '1M' }
    ];

    const results = {};

    for (const scale of scales) {
      console.log(`\n  Testing ${scale.name} vectors...`);

      // Reinitialize for clean test
      if (this.agentdb) await this.agentdb.close();
      await this.initialize();

      // Insert in batches
      const batchSize = 10000;
      const numBatches = Math.ceil(scale.size / batchSize);

      const insertStart = performance.now();
      let insertedCount = 0;

      for (let i = 0; i < numBatches; i++) {
        const vectors = this.generateVectors(
          Math.min(batchSize, scale.size - insertedCount)
        );

        await this.agentdb.insertBatch(vectors);
        insertedCount += vectors.length;

        if ((i + 1) % 10 === 0 || i === numBatches - 1) {
          console.log(`    Progress: ${insertedCount}/${scale.size} vectors (${Math.round(insertedCount/scale.size*100)}%)`);
        }
      }

      const insertEnd = performance.now();
      const insertTime = insertEnd - insertStart;

      // Query performance at this scale
      const queryVector = this.generateVectors(1)[0].embedding;
      const queryIterations = 100;
      const queryLatencies = [];

      const queryStart = performance.now();
      for (let i = 0; i < queryIterations; i++) {
        const start = performance.now();
        await this.agentdb.search(queryVector, { topK: 10 });
        queryLatencies.push(performance.now() - start);
      }
      const queryEnd = performance.now();

      const avgQueryLatency = queryLatencies.reduce((a, b) => a + b, 0) / queryIterations;
      const p95QueryLatency = queryLatencies.sort((a, b) => a - b)[Math.floor(queryIterations * 0.95)];

      // Memory usage
      const mem = process.memoryUsage();

      results[scale.name] = {
        vectorCount: scale.size,
        insertTimeMs: Math.round(insertTime),
        insertThroughput: Math.round(scale.size / (insertTime / 1000)),
        avgQueryLatencyMs: Math.round(avgQueryLatency * 100) / 100,
        p95QueryLatencyMs: Math.round(p95QueryLatency * 100) / 100,
        queryThroughputQps: Math.round(1000 / avgQueryLatency),
        memoryUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        memoryRssMB: Math.round(mem.rss / 1024 / 1024)
      };

      console.log(`\n    ✅ Results for ${scale.name}:`);
      console.log(`       Insert: ${results[scale.name].insertTimeMs}ms (${results[scale.name].insertThroughput} vectors/sec)`);
      console.log(`       Query: ${results[scale.name].avgQueryLatencyMs}ms avg, ${results[scale.name].p95QueryLatencyMs}ms P95`);
      console.log(`       QPS: ${results[scale.name].queryThroughputQps}`);
      console.log(`       Memory: ${results[scale.name].memoryUsedMB}MB heap, ${results[scale.name].memoryRssMB}MB RSS`);
    }

    this.results.tests.scalability = results;
    return results;
  }

  // Test 2: Concurrent Access Test
  async testConcurrentAccess() {
    console.log('\n📊 Test 2: Concurrent Access (10+ simultaneous queries)');
    console.log('='.repeat(80));

    // Prepare database with 10K vectors
    console.log('\n  Preparing database with 10K vectors...');
    if (this.agentdb) await this.agentdb.close();
    await this.initialize();

    const vectors = this.generateVectors(10000);
    await this.agentdb.insertBatch(vectors);
    console.log('  ✅ Database ready');

    const concurrencyLevels = [1, 5, 10, 20, 50];
    const results = {};

    for (const concurrency of concurrencyLevels) {
      console.log(`\n  Testing ${concurrency} concurrent queries...`);

      const queryVector = this.generateVectors(1)[0].embedding;
      const queriesPerThread = 20;

      // Create concurrent query promises
      const start = performance.now();
      const promises = [];

      for (let i = 0; i < concurrency; i++) {
        const threadPromise = (async () => {
          const latencies = [];
          for (let j = 0; j < queriesPerThread; j++) {
            const qStart = performance.now();
            await this.agentdb.search(queryVector, { topK: 10 });
            latencies.push(performance.now() - qStart);
          }
          return latencies;
        })();
        promises.push(threadPromise);
      }

      const allLatencies = (await Promise.all(promises)).flat();
      const end = performance.now();

      const totalTime = end - start;
      const totalQueries = concurrency * queriesPerThread;
      const avgLatency = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
      const p95Latency = allLatencies.sort((a, b) => a - b)[Math.floor(allLatencies.length * 0.95)];
      const p99Latency = allLatencies[Math.floor(allLatencies.length * 0.99)];

      results[`${concurrency}_concurrent`] = {
        concurrency,
        totalQueries,
        totalTimeMs: Math.round(totalTime),
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
        p95LatencyMs: Math.round(p95Latency * 100) / 100,
        p99LatencyMs: Math.round(p99Latency * 100) / 100,
        throughputQps: Math.round(totalQueries / (totalTime / 1000))
      };

      console.log(`    Total time: ${results[`${concurrency}_concurrent`].totalTimeMs}ms`);
      console.log(`    Avg latency: ${results[`${concurrency}_concurrent`].avgLatencyMs}ms`);
      console.log(`    P95: ${results[`${concurrency}_concurrent`].p95LatencyMs}ms`);
      console.log(`    P99: ${results[`${concurrency}_concurrent`].p99LatencyMs}ms`);
      console.log(`    Throughput: ${results[`${concurrency}_concurrent`].throughputQps} QPS`);
    }

    this.results.tests.concurrentAccess = results;
    return results;
  }

  // Test 3: Stress Test (High Throughput)
  async testStress() {
    console.log('\n📊 Test 3: Stress Test (Sustained High Load)');
    console.log('='.repeat(80));

    console.log('\n  Preparing database...');
    if (this.agentdb) await this.agentdb.close();
    await this.initialize();

    const vectors = this.generateVectors(50000);
    await this.agentdb.insertBatch(vectors);
    console.log('  ✅ Database ready with 50K vectors');

    const durationSeconds = 30;
    const concurrentClients = 10;

    console.log(`\n  Running stress test: ${concurrentClients} clients for ${durationSeconds} seconds...`);

    const startTime = Date.now();
    const endTime = startTime + (durationSeconds * 1000);

    let totalQueries = 0;
    const latencies = [];
    const errors = [];

    // Start concurrent clients
    const clients = Array.from({ length: concurrentClients }, async (_, clientId) => {
      let clientQueries = 0;
      const queryVector = this.generateVectors(1)[0].embedding;

      while (Date.now() < endTime) {
        try {
          const start = performance.now();
          await this.agentdb.search(queryVector, { topK: 10 });
          const latency = performance.now() - start;

          latencies.push(latency);
          clientQueries++;
          totalQueries++;

          // Brief pause to simulate realistic load
          await new Promise(resolve => setTimeout(resolve, 10));
        } catch (error) {
          errors.push({ clientId, error: error.message, time: Date.now() });
        }
      }

      return clientQueries;
    });

    const clientCounts = await Promise.all(clients);
    const actualDuration = (Date.now() - startTime) / 1000;

    // Calculate statistics
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const sortedLatencies = latencies.sort((a, b) => a - b);
    const p50 = sortedLatencies[Math.floor(latencies.length * 0.50)];
    const p95 = sortedLatencies[Math.floor(latencies.length * 0.95)];
    const p99 = sortedLatencies[Math.floor(latencies.length * 0.99)];

    const results = {
      durationSeconds: Math.round(actualDuration * 100) / 100,
      concurrentClients,
      totalQueries,
      queriesPerSecond: Math.round(totalQueries / actualDuration),
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      p50LatencyMs: Math.round(p50 * 100) / 100,
      p95LatencyMs: Math.round(p95 * 100) / 100,
      p99LatencyMs: Math.round(p99 * 100) / 100,
      minLatencyMs: Math.round(sortedLatencies[0] * 100) / 100,
      maxLatencyMs: Math.round(sortedLatencies[sortedLatencies.length - 1] * 100) / 100,
      errorCount: errors.length,
      errorRate: Math.round(errors.length / totalQueries * 10000) / 100
    };

    console.log(`\n  ✅ Stress Test Complete:`);
    console.log(`     Duration: ${results.durationSeconds}s`);
    console.log(`     Total Queries: ${results.totalQueries.toLocaleString()}`);
    console.log(`     QPS: ${results.queriesPerSecond.toLocaleString()}`);
    console.log(`     Latency: avg=${results.avgLatencyMs}ms, P50=${results.p50LatencyMs}ms, P95=${results.p95LatencyMs}ms, P99=${results.p99LatencyMs}ms`);
    console.log(`     Range: ${results.minLatencyMs}ms - ${results.maxLatencyMs}ms`);
    console.log(`     Errors: ${results.errorCount} (${results.errorRate}%)`);

    this.results.tests.stress = results;
    return results;
  }

  // Generate report
  generateReport() {
    const reportPath = path.join(process.cwd(), 'docs/agentdb/benchmarks/load-test-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('📊 LOAD TEST REPORT');
    console.log('='.repeat(80));
    console.log(`\n🕐 Timestamp: ${this.results.timestamp}`);
    console.log(`💻 System: ${this.results.system.cpus} CPUs, ${this.results.system.memory}GB RAM`);
    console.log(`\n📁 Full report saved to: ${reportPath}`);

    return reportPath;
  }

  // Run all load tests
  async runAll() {
    console.log('🚀 Starting AgentDB Load Testing Suite');
    console.log('='.repeat(80));
    console.log(`System: ${this.results.system.cpus} CPUs, ${this.results.system.memory}GB RAM`);

    try {
      await this.testScalability();
      await this.testConcurrentAccess();
      await this.testStress();

      const reportPath = this.generateReport();

      console.log('\n✅ All load tests complete!');
      console.log(`📊 Results: ${reportPath}\n`);
    } finally {
      if (this.agentdb) {
        await this.agentdb.close();
      }
    }

    return this.results;
  }
}

// Run if called directly
if (require.main === module) {
  const loadTest = new LoadTestSuite();
  loadTest.runAll()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Load test failed:', err);
      process.exit(1);
    });
}

module.exports = LoadTestSuite;
