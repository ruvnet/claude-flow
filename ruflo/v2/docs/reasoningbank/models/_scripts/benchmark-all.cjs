#!/usr/bin/env node
/**
 * Comprehensive Benchmark Suite for All ReasoningBank Models
 * Tests performance, quality, and production readiness
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class ModelBenchmark {
  constructor(modelPath, modelName) {
    this.modelPath = modelPath;
    this.modelName = modelName;
    this.dbPath = path.join(modelPath, 'memory.db');
    this.db = new Database(this.dbPath, { readonly: true });
  }

  async runAllBenchmarks() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Benchmarking: ${this.modelName}`);
    console.log(`${'='.repeat(60)}\n`);

    const results = {
      model: this.modelName,
      timestamp: new Date().toISOString(),
      benchmarks: {}
    };

    // Run all benchmark tests
    results.benchmarks.schema = this.benchmarkSchema();
    results.benchmarks.data = this.benchmarkDataQuality();
    results.benchmarks.performance = this.benchmarkPerformance();
    results.benchmarks.storage = this.benchmarkStorage();
    results.benchmarks.relationships = this.benchmarkRelationships();

    // Calculate overall score
    results.overallScore = this.calculateScore(results.benchmarks);
    results.productionReady = results.overallScore >= 80;

    return results;
  }

  benchmarkSchema() {
    console.log('🔍 Schema Validation...');

    const requiredTables = [
      'patterns', 'pattern_embeddings', 'task_trajectories', 'pattern_links',
      'memories', 'memory_embeddings', 'sessions', 'session_metrics',
      'neural_patterns', 'training_data'
    ];

    const existingTables = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all().map(row => row.name);

    const missingTables = requiredTables.filter(t => !existingTables.includes(t));
    const score = ((requiredTables.length - missingTables.length) / requiredTables.length) * 100;

    console.log(`  Tables: ${existingTables.length}/${requiredTables.length}`);
    console.log(`  Score: ${score.toFixed(1)}%\n`);

    return {
      totalTables: existingTables.length,
      requiredTables: requiredTables.length,
      missingTables,
      score,
      passed: score === 100
    };
  }

  benchmarkDataQuality() {
    console.log('📊 Data Quality...');

    // Pattern count
    const { patternCount } = this.db.prepare('SELECT COUNT(*) as patternCount FROM patterns').get();

    // Embedding coverage
    const { embeddingCount } = this.db.prepare('SELECT COUNT(*) as embeddingCount FROM pattern_embeddings').get();
    const embeddingCoverage = (embeddingCount / patternCount) * 100;

    // Confidence stats
    const confStats = this.db.prepare(`
      SELECT
        AVG(confidence) as avgConf,
        MIN(confidence) as minConf,
        MAX(confidence) as maxConf
      FROM patterns
    `).get();

    // Success rate stats
    const successStats = this.db.prepare(`
      SELECT
        AVG(success_rate) as avgSuccess,
        MIN(success_rate) as minSuccess,
        MAX(success_rate) as maxSuccess
      FROM patterns
    `).get();

    // Domain coverage
    const { domainCount } = this.db.prepare('SELECT COUNT(DISTINCT domain) as domainCount FROM patterns').get();

    console.log(`  Patterns: ${patternCount.toLocaleString()}`);
    console.log(`  Embeddings: ${embeddingCoverage.toFixed(1)}% coverage`);
    console.log(`  Avg Confidence: ${(confStats.avgConf * 100).toFixed(1)}%`);
    console.log(`  Avg Success: ${(successStats.avgSuccess * 100).toFixed(1)}%`);
    console.log(`  Domains: ${domainCount}\n`);

    const score = Math.min(100,
      (patternCount >= 1000 ? 25 : 0) +
      (embeddingCoverage === 100 ? 25 : 0) +
      (confStats.avgConf >= 0.7 ? 25 : 0) +
      (successStats.avgSuccess >= 0.75 ? 25 : 0)
    );

    return {
      patternCount,
      embeddingCoverage,
      avgConfidence: confStats.avgConf,
      avgSuccess: successStats.avgSuccess,
      domainCount,
      score,
      passed: score >= 75
    };
  }

  benchmarkPerformance() {
    console.log('⚡ Performance Tests...');

    const iterations = 100;

    // Test 1: Simple SELECT
    let start = Date.now();
    for (let i = 0; i < iterations; i++) {
      this.db.prepare('SELECT * FROM patterns LIMIT 10').all();
    }
    const simpleQueryMs = (Date.now() - start) / iterations;

    // Test 2: Filtered SELECT
    start = Date.now();
    for (let i = 0; i < iterations; i++) {
      this.db.prepare('SELECT * FROM patterns WHERE confidence > 0.7 LIMIT 10').all();
    }
    const filteredQueryMs = (Date.now() - start) / iterations;

    // Test 3: JOIN query
    start = Date.now();
    for (let i = 0; i < iterations; i++) {
      this.db.prepare(`
        SELECT p.*, pe.embedding
        FROM patterns p
        JOIN pattern_embeddings pe ON p.id = pe.pattern_id
        LIMIT 10
      `).all();
    }
    const joinQueryMs = (Date.now() - start) / iterations;

    // Test 4: Aggregate query
    start = Date.now();
    for (let i = 0; i < iterations; i++) {
      this.db.prepare(`
        SELECT domain, COUNT(*) as count, AVG(confidence) as avg_conf
        FROM patterns
        GROUP BY domain
      `).all();
    }
    const aggregateQueryMs = (Date.now() - start) / iterations;

    console.log(`  Simple query: ${simpleQueryMs.toFixed(2)}ms`);
    console.log(`  Filtered query: ${filteredQueryMs.toFixed(2)}ms`);
    console.log(`  JOIN query: ${joinQueryMs.toFixed(2)}ms`);
    console.log(`  Aggregate query: ${aggregateQueryMs.toFixed(2)}ms\n`);

    const avgLatency = (simpleQueryMs + filteredQueryMs + joinQueryMs + aggregateQueryMs) / 4;
    const score = avgLatency < 5 ? 100 : (avgLatency < 10 ? 75 : 50);

    return {
      simpleQueryMs,
      filteredQueryMs,
      joinQueryMs,
      aggregateQueryMs,
      avgLatency,
      score,
      passed: avgLatency < 10
    };
  }

  benchmarkStorage() {
    console.log('💾 Storage Efficiency...');

    const stats = fs.statSync(this.dbPath);
    const sizeBytes = stats.size;
    const sizeMB = sizeBytes / 1024 / 1024;
    const sizeKB = sizeBytes / 1024;

    const { patternCount } = this.db.prepare('SELECT COUNT(*) as patternCount FROM patterns').get();
    const bytesPerPattern = sizeBytes / patternCount;
    const kbPerPattern = bytesPerPattern / 1024;

    console.log(`  Total size: ${sizeMB.toFixed(2)} MB`);
    console.log(`  Per pattern: ${kbPerPattern.toFixed(2)} KB`);
    console.log(`  Patterns: ${patternCount.toLocaleString()}\n`);

    const score = kbPerPattern < 10 ? 100 : (kbPerPattern < 20 ? 75 : 50);

    return {
      totalBytes: sizeBytes,
      totalMB: sizeMB,
      totalKB: sizeKB,
      patternCount,
      bytesPerPattern,
      kbPerPattern,
      score,
      passed: kbPerPattern < 20
    };
  }

  benchmarkRelationships() {
    console.log('🔗 Relationship Network...');

    const { linkCount } = this.db.prepare('SELECT COUNT(*) as linkCount FROM pattern_links').get();
    const { patternCount } = this.db.prepare('SELECT COUNT(*) as patternCount FROM patterns').get();

    const linksPerPattern = linkCount / patternCount;

    // Link type distribution
    const linkTypes = this.db.prepare(`
      SELECT link_type, COUNT(*) as count
      FROM pattern_links
      GROUP BY link_type
    `).all();

    console.log(`  Total links: ${linkCount.toLocaleString()}`);
    console.log(`  Per pattern: ${linksPerPattern.toFixed(1)}`);
    console.log(`  Link types: ${linkTypes.length}\n`);

    const score = linksPerPattern >= 2 ? 100 : (linksPerPattern >= 1 ? 75 : 50);

    return {
      linkCount,
      patternCount,
      linksPerPattern,
      linkTypes: linkTypes.length,
      score,
      passed: linksPerPattern >= 1
    };
  }

  calculateScore(benchmarks) {
    const weights = {
      schema: 0.20,
      data: 0.30,
      performance: 0.25,
      storage: 0.15,
      relationships: 0.10
    };

    let totalScore = 0;
    for (const [category, weight] of Object.entries(weights)) {
      totalScore += benchmarks[category].score * weight;
    }

    return Math.round(totalScore);
  }

  generateReport(results) {
    const report = `
# Benchmark Report: ${results.model}

**Generated**: ${results.timestamp}
**Overall Score**: ${results.overallScore}/100
**Production Ready**: ${results.productionReady ? '✅ YES' : '❌ NO'}

---

## Schema Validation
- **Score**: ${results.benchmarks.schema.score.toFixed(1)}/100
- **Status**: ${results.benchmarks.schema.passed ? '✅ PASSED' : '❌ FAILED'}
- **Tables**: ${results.benchmarks.schema.totalTables}/${results.benchmarks.schema.requiredTables}
- **Missing**: ${results.benchmarks.schema.missingTables.length > 0 ? results.benchmarks.schema.missingTables.join(', ') : 'None'}

## Data Quality
- **Score**: ${results.benchmarks.data.score}/100
- **Status**: ${results.benchmarks.data.passed ? '✅ PASSED' : '❌ FAILED'}
- **Patterns**: ${results.benchmarks.data.patternCount.toLocaleString()}
- **Embedding Coverage**: ${results.benchmarks.data.embeddingCoverage.toFixed(1)}%
- **Avg Confidence**: ${(results.benchmarks.data.avgConfidence * 100).toFixed(1)}%
- **Avg Success Rate**: ${(results.benchmarks.data.avgSuccess * 100).toFixed(1)}%
- **Domains**: ${results.benchmarks.data.domainCount}

## Performance
- **Score**: ${results.benchmarks.performance.score}/100
- **Status**: ${results.benchmarks.performance.passed ? '✅ PASSED' : '❌ FAILED'}
- **Avg Latency**: ${results.benchmarks.performance.avgLatency.toFixed(2)}ms
- **Simple Query**: ${results.benchmarks.performance.simpleQueryMs.toFixed(2)}ms
- **Filtered Query**: ${results.benchmarks.performance.filteredQueryMs.toFixed(2)}ms
- **JOIN Query**: ${results.benchmarks.performance.joinQueryMs.toFixed(2)}ms
- **Aggregate Query**: ${results.benchmarks.performance.aggregateQueryMs.toFixed(2)}ms

## Storage Efficiency
- **Score**: ${results.benchmarks.storage.score}/100
- **Status**: ${results.benchmarks.storage.passed ? '✅ PASSED' : '❌ FAILED'}
- **Total Size**: ${results.benchmarks.storage.totalMB.toFixed(2)} MB
- **Per Pattern**: ${results.benchmarks.storage.kbPerPattern.toFixed(2)} KB

## Relationship Network
- **Score**: ${results.benchmarks.relationships.score}/100
- **Status**: ${results.benchmarks.relationships.passed ? '✅ PASSED' : '❌ FAILED'}
- **Total Links**: ${results.benchmarks.relationships.linkCount.toLocaleString()}
- **Links per Pattern**: ${results.benchmarks.relationships.linksPerPattern.toFixed(1)}
- **Link Types**: ${results.benchmarks.relationships.linkTypes}

---

## Summary

${results.productionReady ? '✅ This model is **PRODUCTION READY**' : '⚠️  This model needs improvements before production use'}

${results.overallScore >= 90 ? '🏆 **Excellent** - Top-tier model quality' :
  results.overallScore >= 80 ? '✅ **Good** - Production ready with minor optimizations possible' :
  results.overallScore >= 70 ? '⚠️  **Acceptable** - Consider improvements' :
  '❌ **Needs Work** - Significant improvements required'}
`;

    return report;
  }

  close() {
    this.db.close();
  }
}

// Run benchmarks for all models
async function benchmarkAllModels() {
  const modelsDir = __dirname;
  const models = [
    { name: 'SAFLA', path: 'safla' },
    { name: 'Google Research', path: 'google-research' },
    { name: 'Code Reasoning', path: 'code-reasoning' },
    { name: 'Problem Solving', path: 'problem-solving' },
    { name: 'Domain Expert', path: 'domain-expert' }
  ];

  const allResults = [];

  for (const model of models) {
    const modelPath = path.join(modelsDir, model.path);
    if (!fs.existsSync(path.join(modelPath, 'memory.db'))) {
      console.log(`⚠️  Skipping ${model.name} - memory.db not found\n`);
      continue;
    }

    const benchmark = new ModelBenchmark(modelPath, model.name);
    const results = await benchmark.runAllBenchmarks();

    // Generate report
    const report = benchmark.generateReport(results);
    fs.writeFileSync(
      path.join(modelPath, 'benchmark-report.md'),
      report
    );

    benchmark.close();
    allResults.push(results);
  }

  // Generate summary
  generateSummary(allResults);
}

function generateSummary(allResults) {
  console.log('\n\n' + '='.repeat(70));
  console.log('📊 BENCHMARK SUMMARY - ALL MODELS');
  console.log('='.repeat(70) + '\n');

  console.log('| Model | Score | Patterns | Avg Latency | Size | Status |');
  console.log('|-------|-------|----------|-------------|------|--------|');

  for (const result of allResults) {
    console.log(
      `| ${result.model.padEnd(17)} | ` +
      `${result.overallScore}/100 | ` +
      `${result.benchmarks.data.patternCount.toLocaleString().padEnd(8)} | ` +
      `${result.benchmarks.performance.avgLatency.toFixed(2)}ms${' '.repeat(8)} | ` +
      `${result.benchmarks.storage.totalMB.toFixed(1)}MB${' '.repeat(2)} | ` +
      `${result.productionReady ? '✅' : '❌'}${' '.repeat(6)} |`
    );
  }

  console.log('\n' + '='.repeat(70) + '\n');

  // Save JSON summary
  fs.writeFileSync(
    path.join(__dirname, 'benchmark-summary.json'),
    JSON.stringify(allResults, null, 2)
  );

  console.log('✅ Benchmark reports saved to each model directory');
  console.log('✅ Summary saved to benchmark-summary.json\n');
}

// Run if called directly
if (require.main === module) {
  benchmarkAllModels().catch(console.error);
}

module.exports = ModelBenchmark;
