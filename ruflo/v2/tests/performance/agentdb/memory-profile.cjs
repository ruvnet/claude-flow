#!/usr/bin/env node

/**
 * AgentDB Memory Profiling Tool
 *
 * Analyzes memory usage patterns:
 * - Baseline memory usage
 * - Memory with different quantization types
 * - Memory leak detection
 * - Peak memory usage under load
 * - Memory efficiency vs dataset size
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class MemoryProfiler {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      profiles: {},
      leakDetection: null,
      recommendations: {}
    };
    this.snapshots = [];
  }

  // Take memory snapshot
  takeSnapshot(label) {
    const usage = process.memoryUsage();
    const snapshot = {
      label,
      timestamp: Date.now(),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
      rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100,
      external: Math.round(usage.external / 1024 / 1024 * 100) / 100,
      arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024 * 100) / 100
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  // Force garbage collection if available
  forceGC() {
    if (global.gc) {
      global.gc();
      return true;
    }
    console.warn('  ⚠️  Garbage collection not exposed. Run with --expose-gc flag for accurate memory profiling.');
    return false;
  }

  // Generate test vectors
  generateVectors(count, dimensions = 384) {
    const vectors = [];
    for (let i = 0; i < count; i++) {
      vectors.push({
        id: `mem-test-${i}`,
        embedding: Array.from({ length: dimensions }, () => Math.random()),
        metadata: {
          type: 'memory-test',
          index: i,
          timestamp: Date.now()
        }
      });
    }
    return vectors;
  }

  // Test 1: Baseline Memory Usage
  async profileBaseline() {
    console.log('\n📊 Profile 1: Baseline Memory Usage');
    console.log('='.repeat(80));

    this.forceGC();
    const baselineSnapshot = this.takeSnapshot('baseline');

    console.log(`  Baseline: ${baselineSnapshot.heapUsed}MB heap, ${baselineSnapshot.rss}MB RSS`);

    const AgentDB = require('../../../src/agentdb');

    // Test with no quantization
    const agentdb = new AgentDB({
      dbPath: ':memory:',
      enableHNSW: true,
      quantization: null
    });

    await agentdb.initialize();
    this.forceGC();
    const afterInitSnapshot = this.takeSnapshot('after-init');

    console.log(`  After init: ${afterInitSnapshot.heapUsed}MB heap (${Math.round((afterInitSnapshot.heapUsed - baselineSnapshot.heapUsed) * 100) / 100}MB increase)`);

    // Insert different dataset sizes
    const sizes = [1000, 5000, 10000, 50000];
    const results = {};

    for (const size of sizes) {
      console.log(`\n  Testing ${size.toLocaleString()} vectors...`);

      const vectors = this.generateVectors(size);

      this.forceGC();
      const beforeInsert = this.takeSnapshot(`before-insert-${size}`);

      await agentdb.insertBatch(vectors);

      this.forceGC();
      const afterInsert = this.takeSnapshot(`after-insert-${size}`);

      // Calculate memory per vector
      const memoryIncrease = afterInsert.heapUsed - beforeInsert.heapUsed;
      const bytesPerVector = (memoryIncrease * 1024 * 1024) / size;

      results[`${size}_vectors`] = {
        totalMemoryMB: afterInsert.heapUsed,
        increaseFromBaselineMB: Math.round((afterInsert.heapUsed - baselineSnapshot.heapUsed) * 100) / 100,
        increaseFromInsertMB: Math.round(memoryIncrease * 100) / 100,
        bytesPerVector: Math.round(bytesPerVector),
        rssMB: afterInsert.rss
      };

      console.log(`    Memory: ${results[`${size}_vectors`].totalMemoryMB}MB heap (${results[`${size}_vectors`].increaseFromInsertMB}MB increase)`);
      console.log(`    Per vector: ${results[`${size}_vectors`].bytesPerVector} bytes`);

      // Clear for next test
      await agentdb.clear();
      this.forceGC();
    }

    await agentdb.close();

    this.results.profiles.baseline = results;
    return results;
  }

  // Test 2: Quantization Impact
  async profileQuantization() {
    console.log('\n📊 Profile 2: Memory Impact of Quantization');
    console.log('='.repeat(80));

    const quantizationMethods = ['none', 'binary', 'scalar', 'product'];
    const vectorCount = 10000;
    const results = {};

    for (const method of quantizationMethods) {
      console.log(`\n  Testing ${method} quantization...`);

      this.forceGC();
      const beforeInit = this.takeSnapshot(`before-${method}`);

      const AgentDB = require('../../../src/agentdb');
      const agentdb = new AgentDB({
        dbPath: ':memory:',
        enableHNSW: true,
        quantization: method !== 'none' ? { type: method } : null
      });

      await agentdb.initialize();

      const vectors = this.generateVectors(vectorCount);
      await agentdb.insertBatch(vectors);

      this.forceGC();
      const afterInsert = this.takeSnapshot(`after-${method}`);

      const memoryUsed = afterInsert.heapUsed - beforeInit.heapUsed;
      const bytesPerVector = (memoryUsed * 1024 * 1024) / vectorCount;

      results[method] = {
        totalMemoryMB: Math.round(memoryUsed * 100) / 100,
        bytesPerVector: Math.round(bytesPerVector),
        heapUsedMB: afterInsert.heapUsed,
        rssMB: afterInsert.rss
      };

      console.log(`    Memory: ${results[method].totalMemoryMB}MB`);
      console.log(`    Per vector: ${results[method].bytesPerVector} bytes`);

      await agentdb.close();
      this.forceGC();
    }

    // Calculate savings
    const baselineMemory = results['none'].totalMemoryMB;
    for (const method of quantizationMethods) {
      if (method !== 'none') {
        const savings = ((baselineMemory - results[method].totalMemoryMB) / baselineMemory * 100);
        results[method].savingsPercent = Math.round(savings * 10) / 10;
        console.log(`\n  ${method}: ${results[method].savingsPercent}% memory savings`);
      }
    }

    this.results.profiles.quantization = results;
    return results;
  }

  // Test 3: Memory Leak Detection
  async detectMemoryLeaks() {
    console.log('\n📊 Profile 3: Memory Leak Detection');
    console.log('='.repeat(80));

    const AgentDB = require('../../../src/agentdb');
    const agentdb = new AgentDB({
      dbPath: ':memory:',
      enableHNSW: true
    });

    await agentdb.initialize();

    console.log('\n  Running repeated insert/delete cycles...');

    const cycles = 20;
    const vectorsPerCycle = 1000;
    const memorySnapshots = [];

    this.forceGC();
    const initialMemory = this.takeSnapshot('leak-test-start');

    for (let cycle = 0; cycle < cycles; cycle++) {
      // Insert vectors
      const vectors = this.generateVectors(vectorsPerCycle);
      await agentdb.insertBatch(vectors);

      // Delete half
      for (let i = 0; i < vectorsPerCycle / 2; i++) {
        await agentdb.delete(`mem-test-${i}`);
      }

      // Clear all
      await agentdb.clear();

      // Force GC and snapshot
      this.forceGC();
      const snapshot = this.takeSnapshot(`leak-test-cycle-${cycle}`);
      memorySnapshots.push(snapshot.heapUsed);

      if ((cycle + 1) % 5 === 0) {
        console.log(`    Cycle ${cycle + 1}/${cycles}: ${snapshot.heapUsed}MB heap`);
      }
    }

    this.forceGC();
    const finalMemory = this.takeSnapshot('leak-test-end');

    // Analyze trend
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
    const averageIncrease = memoryIncrease / cycles;

    // Linear regression to detect leak
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < memorySnapshots.length; i++) {
      sumX += i;
      sumY += memorySnapshots[i];
      sumXY += i * memorySnapshots[i];
      sumX2 += i * i;
    }

    const n = memorySnapshots.length;
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    const leakDetected = slope > 0.1; // >0.1MB increase per cycle indicates leak

    const results = {
      cycles,
      initialMemoryMB: initialMemory.heapUsed,
      finalMemoryMB: finalMemory.heapUsed,
      totalIncreaseMB: Math.round(memoryIncrease * 100) / 100,
      averageIncreasePerCycleMB: Math.round(averageIncrease * 1000) / 1000,
      trendSlope: Math.round(slope * 1000) / 1000,
      leakDetected,
      status: leakDetected ? '❌ Potential leak detected' : '✅ No leak detected'
    };

    console.log(`\n  Results:`);
    console.log(`    Initial: ${results.initialMemoryMB}MB`);
    console.log(`    Final: ${results.finalMemoryMB}MB`);
    console.log(`    Increase: ${results.totalIncreaseMB}MB over ${cycles} cycles`);
    console.log(`    Avg increase per cycle: ${results.averageIncreasePerCycleMB}MB`);
    console.log(`    Trend slope: ${results.trendSlope}MB/cycle`);
    console.log(`    ${results.status}`);

    await agentdb.close();

    this.results.leakDetection = results;
    return results;
  }

  // Test 4: Peak Memory Under Load
  async profilePeakMemory() {
    console.log('\n📊 Profile 4: Peak Memory Under Load');
    console.log('='.repeat(80));

    const AgentDB = require('../../../src/agentdb');
    const agentdb = new AgentDB({
      dbPath: ':memory:',
      enableHNSW: true
    });

    await agentdb.initialize();

    console.log('\n  Loading 50K vectors and running concurrent queries...');

    this.forceGC();
    const beforeLoad = this.takeSnapshot('before-load');

    // Insert large dataset
    const vectorCount = 50000;
    const batchSize = 5000;

    for (let i = 0; i < vectorCount / batchSize; i++) {
      const vectors = this.generateVectors(batchSize);
      await agentdb.insertBatch(vectors);
    }

    this.forceGC();
    const afterLoad = this.takeSnapshot('after-load');

    console.log(`  Loaded ${vectorCount.toLocaleString()} vectors: ${afterLoad.heapUsed}MB heap`);

    // Run concurrent queries and monitor peak memory
    const concurrency = 20;
    const queriesPerThread = 50;
    const queryVector = this.generateVectors(1)[0].embedding;

    let peakMemory = afterLoad.heapUsed;

    const queries = Array.from({ length: concurrency }, async () => {
      for (let i = 0; i < queriesPerThread; i++) {
        await agentdb.search(queryVector, { topK: 10 });

        // Sample memory periodically
        if (i % 10 === 0) {
          const current = process.memoryUsage().heapUsed / 1024 / 1024;
          if (current > peakMemory) {
            peakMemory = current;
          }
        }
      }
    });

    await Promise.all(queries);

    this.forceGC();
    const afterQueries = this.takeSnapshot('after-queries');

    const results = {
      vectorCount,
      baselineMemoryMB: beforeLoad.heapUsed,
      afterLoadMemoryMB: afterLoad.heapUsed,
      loadMemoryIncreaseMB: Math.round((afterLoad.heapUsed - beforeLoad.heapUsed) * 100) / 100,
      peakMemoryDuringQueriesMB: Math.round(peakMemory * 100) / 100,
      afterQueriesMemoryMB: afterQueries.heapUsed,
      peakIncreaseMB: Math.round((peakMemory - afterLoad.heapUsed) * 100) / 100
    };

    console.log(`\n  Results:`);
    console.log(`    After load: ${results.afterLoadMemoryMB}MB`);
    console.log(`    Peak during queries: ${results.peakMemoryDuringQueriesMB}MB`);
    console.log(`    After queries: ${results.afterQueriesMemoryMB}MB`);
    console.log(`    Peak increase: ${results.peakIncreaseMB}MB`);

    await agentdb.close();

    this.results.profiles.peakMemory = results;
    return results;
  }

  // Generate recommendations
  generateRecommendations() {
    console.log('\n📊 Generating Recommendations...\n');

    const recommendations = {
      quantization: null,
      scaling: null,
      monitoring: null
    };

    // Quantization recommendation
    if (this.results.profiles.quantization) {
      const methods = Object.entries(this.results.profiles.quantization)
        .filter(([key]) => key !== 'none')
        .map(([key, data]) => ({ method: key, ...data }))
        .sort((a, b) => b.savingsPercent - a.savingsPercent);

      recommendations.quantization = {
        recommended: methods[0].method,
        savings: methods[0].savingsPercent,
        reason: `Best memory savings (${methods[0].savingsPercent}%) with acceptable performance`
      };

      console.log('  Quantization Recommendation:');
      console.log(`    Use '${recommendations.quantization.recommended}' quantization`);
      console.log(`    Expected savings: ${recommendations.quantization.savings}%`);
    }

    // Scaling recommendation
    if (this.results.profiles.baseline) {
      const sizes = Object.entries(this.results.profiles.baseline);
      const avgBytesPerVector = sizes.reduce((acc, [_, data]) => acc + data.bytesPerVector, 0) / sizes.length;

      recommendations.scaling = {
        bytesPerVector: Math.round(avgBytesPerVector),
        estimatedMemory: {
          '100K': Math.round(100000 * avgBytesPerVector / 1024 / 1024),
          '1M': Math.round(1000000 * avgBytesPerVector / 1024 / 1024),
          '10M': Math.round(10000000 * avgBytesPerVector / 1024 / 1024)
        }
      };

      console.log('\n  Scaling Recommendations:');
      console.log(`    Average: ${recommendations.scaling.bytesPerVector} bytes/vector`);
      console.log(`    Estimated memory for 100K vectors: ${recommendations.scaling.estimatedMemory['100K']}MB`);
      console.log(`    Estimated memory for 1M vectors: ${recommendations.scaling.estimatedMemory['1M']}MB`);
      console.log(`    Estimated memory for 10M vectors: ${recommendations.scaling.estimatedMemory['10M']}MB`);
    }

    // Leak detection recommendation
    if (this.results.leakDetection) {
      recommendations.monitoring = {
        leakDetected: this.results.leakDetection.leakDetected,
        action: this.results.leakDetection.leakDetected
          ? 'Monitor memory closely in production. Consider memory limits and restart strategies.'
          : 'Memory management appears stable. Standard monitoring recommended.'
      };

      console.log('\n  Monitoring Recommendation:');
      console.log(`    ${recommendations.monitoring.action}`);
    }

    this.results.recommendations = recommendations;
  }

  // Generate report
  generateReport() {
    const reportPath = path.join(process.cwd(), 'docs/agentdb/benchmarks/memory-profile-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('📊 MEMORY PROFILING REPORT');
    console.log('='.repeat(80));
    console.log(`\n🕐 Timestamp: ${this.results.timestamp}`);
    console.log(`\n📁 Full report saved to: ${reportPath}`);

    return reportPath;
  }

  // Run all profiling tests
  async runAll() {
    console.log('🚀 Starting AgentDB Memory Profiling');
    console.log('='.repeat(80));

    if (!global.gc) {
      console.log('\n⚠️  WARNING: Run with --expose-gc flag for accurate memory profiling');
      console.log('   Example: node --expose-gc memory-profile.js\n');
    }

    await this.profileBaseline();
    await this.profileQuantization();
    await this.detectMemoryLeaks();
    await this.profilePeakMemory();

    this.generateRecommendations();

    const reportPath = this.generateReport();

    console.log('\n✅ Memory profiling complete!');
    console.log(`📊 Results: ${reportPath}\n`);

    return this.results;
  }
}

// Run if called directly
if (require.main === module) {
  const profiler = new MemoryProfiler();
  profiler.runAll()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Memory profiling failed:', err);
      process.exit(1);
    });
}

module.exports = MemoryProfiler;
