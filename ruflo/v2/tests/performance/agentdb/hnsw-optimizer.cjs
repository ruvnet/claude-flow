#!/usr/bin/env node

/**
 * HNSW Index Optimization Analyzer
 *
 * Tests different HNSW configurations to find optimal settings:
 * - M (number of connections per layer)
 * - efConstruction (construction time accuracy)
 * - efSearch (search time accuracy)
 *
 * Analyzes trade-offs between:
 * - Search speed vs accuracy
 * - Index build time vs search performance
 * - Memory usage vs quality
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class HNSWOptimizer {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      configurations: [],
      recommendations: {}
    };
  }

  // Test configurations
  getTestConfigurations() {
    return [
      // Fast build, lower accuracy
      { M: 8, efConstruction: 100, efSearch: 25, profile: 'fast-build' },
      { M: 8, efConstruction: 100, efSearch: 50, profile: 'fast-build-better-search' },

      // Balanced
      { M: 16, efConstruction: 200, efSearch: 50, profile: 'balanced' },
      { M: 16, efConstruction: 200, efSearch: 100, profile: 'balanced-high-accuracy' },

      // High accuracy
      { M: 32, efConstruction: 400, efSearch: 100, profile: 'high-accuracy' },
      { M: 32, efConstruction: 400, efSearch: 200, profile: 'high-accuracy-premium' },

      // Maximum quality
      { M: 64, efConstruction: 800, efSearch: 200, profile: 'maximum-quality' },
      { M: 64, efConstruction: 800, efSearch: 400, profile: 'maximum-quality-premium' }
    ];
  }

  // Generate test vectors with ground truth
  generateTestVectorsWithGroundTruth(count, dimensions = 384) {
    const vectors = [];
    const queryVector = Array.from({ length: dimensions }, () => Math.random());

    // Generate vectors and calculate exact similarity
    for (let i = 0; i < count; i++) {
      const embedding = Array.from({ length: dimensions }, () => Math.random());

      // Calculate cosine similarity for ground truth
      let dotProduct = 0, normA = 0, normB = 0;
      for (let j = 0; j < dimensions; j++) {
        dotProduct += embedding[j] * queryVector[j];
        normA += embedding[j] * embedding[j];
        normB += queryVector[j] * queryVector[j];
      }
      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

      vectors.push({
        id: `vector-${i}`,
        embedding,
        trueScore: similarity,
        metadata: { index: i }
      });
    }

    // Sort by true score to get ground truth top-K
    vectors.sort((a, b) => b.trueScore - a.trueScore);

    return { vectors, queryVector };
  }

  // Calculate recall@K (accuracy metric)
  calculateRecall(trueTopK, predictedTopK) {
    const trueSet = new Set(trueTopK.map(v => v.id));
    const correctPredictions = predictedTopK.filter(v => trueSet.has(v.id)).length;
    return correctPredictions / trueTopK.length;
  }

  // Benchmark a single configuration
  async benchmarkConfiguration(config, agentdb) {
    console.log(`\n  Testing: M=${config.M}, efC=${config.efConstruction}, efS=${config.efSearch}`);

    const vectorCount = 10000;
    const { vectors, queryVector } = this.generateTestVectorsWithGroundTruth(vectorCount);
    const groundTruthTop10 = vectors.slice(0, 10);

    // Measure build time
    const buildStart = performance.now();
    await agentdb.insertBatch(vectors.map(v => ({
      id: v.id,
      embedding: v.embedding,
      metadata: v.metadata
    })));
    const buildEnd = performance.now();
    const buildTime = buildEnd - buildStart;

    // Measure search performance and accuracy
    const iterations = 100;
    const searchLatencies = [];
    let totalRecall = 0;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const results = await agentdb.search(queryVector, { topK: 10 });
      const end = performance.now();

      searchLatencies.push(end - start);

      // Calculate recall
      const recall = this.calculateRecall(groundTruthTop10, results);
      totalRecall += recall;
    }

    const avgSearchLatency = searchLatencies.reduce((a, b) => a + b, 0) / iterations;
    const avgRecall = totalRecall / iterations;
    const p95Latency = searchLatencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];

    // Measure memory usage
    const memUsage = process.memoryUsage();

    const result = {
      config,
      buildTimeMs: Math.round(buildTime),
      avgSearchLatencyMs: Math.round(avgSearchLatency * 1000) / 1000,
      p95SearchLatencyMs: Math.round(p95Latency * 1000) / 1000,
      recall: Math.round(avgRecall * 10000) / 100, // percentage
      throughputQps: Math.round(1000 / avgSearchLatency),
      memoryUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024)
    };

    console.log(`    Build: ${result.buildTimeMs}ms`);
    console.log(`    Search: ${result.avgSearchLatencyMs}ms (P95: ${result.p95SearchLatencyMs}ms)`);
    console.log(`    Recall@10: ${result.recall}%`);
    console.log(`    QPS: ${result.throughputQps}`);

    // Clear for next test
    await agentdb.clear();

    return result;
  }

  // Analyze results and generate recommendations
  analyzeResults() {
    console.log('\n📊 Analyzing Results...\n');

    const configs = this.results.configurations;

    // Find best for different use cases
    const recommendations = {
      fastestSearch: configs.reduce((best, curr) =>
        curr.avgSearchLatencyMs < best.avgSearchLatencyMs ? curr : best
      ),
      highestRecall: configs.reduce((best, curr) =>
        curr.recall > best.recall ? curr : best
      ),
      bestBalance: configs.reduce((best, curr) => {
        const currScore = curr.recall / curr.avgSearchLatencyMs;
        const bestScore = best.recall / best.avgSearchLatencyMs;
        return currScore > bestScore ? curr : best;
      }),
      fastestBuild: configs.reduce((best, curr) =>
        curr.buildTimeMs < best.buildTimeMs ? curr : best
      ),
      mostEfficient: configs.reduce((best, curr) => {
        const currScore = (curr.recall * curr.throughputQps) / curr.memoryUsedMB;
        const bestScore = (best.recall * best.throughputQps) / best.memoryUsedMB;
        return currScore > bestScore ? curr : best;
      })
    };

    this.results.recommendations = recommendations;

    console.log('🏆 RECOMMENDATIONS:\n');
    console.log('  Fastest Search:');
    console.log(`    Config: M=${recommendations.fastestSearch.config.M}, efC=${recommendations.fastestSearch.config.efConstruction}, efS=${recommendations.fastestSearch.config.efSearch}`);
    console.log(`    Latency: ${recommendations.fastestSearch.avgSearchLatencyMs}ms, Recall: ${recommendations.fastestSearch.recall}%\n`);

    console.log('  Highest Recall:');
    console.log(`    Config: M=${recommendations.highestRecall.config.M}, efC=${recommendations.highestRecall.config.efConstruction}, efS=${recommendations.highestRecall.config.efSearch}`);
    console.log(`    Latency: ${recommendations.highestRecall.avgSearchLatencyMs}ms, Recall: ${recommendations.highestRecall.recall}%\n`);

    console.log('  Best Balance (Speed/Accuracy):');
    console.log(`    Config: M=${recommendations.bestBalance.config.M}, efC=${recommendations.bestBalance.config.efConstruction}, efS=${recommendations.bestBalance.config.efSearch}`);
    console.log(`    Latency: ${recommendations.bestBalance.avgSearchLatencyMs}ms, Recall: ${recommendations.bestBalance.recall}%\n`);

    console.log('  Fastest Build:');
    console.log(`    Config: M=${recommendations.fastestBuild.config.M}, efC=${recommendations.fastestBuild.config.efConstruction}, efS=${recommendations.fastestBuild.config.efSearch}`);
    console.log(`    Build: ${recommendations.fastestBuild.buildTimeMs}ms, Recall: ${recommendations.fastestBuild.recall}%\n`);

    console.log('  Most Efficient (QPS/Memory):');
    console.log(`    Config: M=${recommendations.mostEfficient.config.M}, efC=${recommendations.mostEfficient.config.efConstruction}, efS=${recommendations.mostEfficient.config.efSearch}`);
    console.log(`    QPS: ${recommendations.mostEfficient.throughputQps}, Memory: ${recommendations.mostEfficient.memoryUsedMB}MB, Recall: ${recommendations.mostEfficient.recall}%\n`);
  }

  // Run optimization analysis
  async runAll() {
    console.log('🚀 Starting HNSW Optimization Analysis');
    console.log('='.repeat(80));

    const configs = this.getTestConfigurations();

    for (const config of configs) {
      try {
        // Initialize AgentDB with this configuration
        const AgentDB = require('../../../src/agentdb');
        const agentdb = new AgentDB({
          dbPath: ':memory:',
          enableHNSW: true,
          hnswConfig: {
            M: config.M,
            efConstruction: config.efConstruction,
            efSearch: config.efSearch
          }
        });

        await agentdb.initialize();

        const result = await this.benchmarkConfiguration(config, agentdb);
        this.results.configurations.push(result);

        await agentdb.close();
      } catch (error) {
        console.error(`❌ Failed to benchmark config ${config.profile}:`, error.message);
      }
    }

    this.analyzeResults();

    // Save results
    const reportPath = path.join(process.cwd(), 'docs/agentdb/benchmarks/hnsw-optimization.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));

    console.log(`\n📁 Full report saved to: ${reportPath}\n`);

    return this.results;
  }
}

// Run if called directly
if (require.main === module) {
  const optimizer = new HNSWOptimizer();
  optimizer.runAll()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Optimization failed:', err);
      process.exit(1);
    });
}

module.exports = HNSWOptimizer;
