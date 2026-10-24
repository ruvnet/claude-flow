#!/usr/bin/env node
/**
 * ReasoningBank Model Validation Suite
 * Validates trained models before and after optimization
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class ModelValidator {
  constructor(modelPath, modelName) {
    this.modelPath = modelPath;
    this.modelName = modelName;
    this.dbPath = path.join(modelPath, 'memory.db');
  }

  async runValidation() {
    console.log(`\n🔍 Validating ${this.modelName} model...`);

    const results = {
      model: this.modelName,
      timestamp: new Date().toISOString(),
      checks: {}
    };

    // 1. Database exists
    results.checks.databaseExists = fs.existsSync(this.dbPath);

    // 2. Schema validation
    results.checks.schema = this.validateSchema();

    // 3. Pattern count
    results.checks.patternCount = this.getPatternCount();

    // 4. Embedding quality
    results.checks.embeddings = this.validateEmbeddings();

    // 5. Confidence scores
    results.checks.confidence = this.validateConfidence();

    // 6. Pattern links
    results.checks.links = this.validateLinks();

    // 7. Query performance
    results.checks.performance = await this.benchmarkQueries();

    // 8. Storage efficiency
    results.checks.storage = this.analyzeStorage();

    // Generate report
    this.generateReport(results);

    return results;
  }

  validateSchema() {
    const tables = execSync(
      `sqlite3 ${this.dbPath} "SELECT name FROM sqlite_master WHERE type='table'"`,
      { encoding: 'utf-8' }
    ).trim().split('\n');

    const required = ['patterns', 'pattern_embeddings', 'task_trajectories', 'pattern_links'];
    const hasAll = required.every(t => tables.includes(t));

    return { valid: hasAll, tables: tables.length, required: 4 };
  }

  getPatternCount() {
    const count = parseInt(execSync(
      `sqlite3 ${this.dbPath} "SELECT COUNT(*) FROM patterns"`,
      { encoding: 'utf-8' }
    ).trim());

    return { count, valid: count >= 1000 && count <= 10000 };
  }

  validateEmbeddings() {
    const embCount = parseInt(execSync(
      `sqlite3 ${this.dbPath} "SELECT COUNT(*) FROM pattern_embeddings"`,
      { encoding: 'utf-8' }
    ).trim());

    const patCount = this.getPatternCount().count;

    // Check embedding dimensions (should be 1024)
    const sample = execSync(
      `sqlite3 ${this.dbPath} "SELECT embedding FROM pattern_embeddings LIMIT 1"`,
      { encoding: 'utf-8' }
    ).trim();

    const dims = sample ? JSON.parse(sample).length : 0;

    return {
      count: embCount,
      dimensions: dims,
      coverage: (embCount / patCount * 100).toFixed(2) + '%',
      valid: embCount === patCount && dims === 1024
    };
  }

  validateConfidence() {
    const stats = execSync(
      `sqlite3 ${this.dbPath} "SELECT AVG(confidence), MIN(confidence), MAX(confidence), COUNT(*) FROM patterns WHERE confidence > 0"`,
      { encoding: 'utf-8' }
    ).trim().split('|');

    return {
      average: parseFloat(stats[0]).toFixed(3),
      min: parseFloat(stats[1]).toFixed(3),
      max: parseFloat(stats[2]).toFixed(3),
      withConfidence: parseInt(stats[3]),
      valid: parseFloat(stats[0]) >= 0.5 && parseFloat(stats[0]) <= 1.0
    };
  }

  validateLinks() {
    const linkCount = parseInt(execSync(
      `sqlite3 ${this.dbPath} "SELECT COUNT(*) FROM pattern_links"`,
      { encoding: 'utf-8' }
    ).trim());

    const typeDistribution = execSync(
      `sqlite3 ${this.dbPath} "SELECT link_type, COUNT(*) FROM pattern_links GROUP BY link_type"`,
      { encoding: 'utf-8' }
    ).trim();

    return {
      total: linkCount,
      types: typeDistribution || 'none',
      valid: linkCount > 0
    };
  }

  async benchmarkQueries() {
    const start = Date.now();

    // Run 100 semantic queries
    for (let i = 0; i < 100; i++) {
      execSync(
        `npx claude-flow@alpha memory query "test query ${i}" --namespace ${this.modelName} --reasoningbank`,
        { stdio: 'pipe' }
      );
    }

    const duration = Date.now() - start;
    const avgLatency = duration / 100;

    return {
      queries: 100,
      totalTime: duration + 'ms',
      avgLatency: avgLatency.toFixed(2) + 'ms',
      valid: avgLatency < 10 // Should be under 10ms
    };
  }

  analyzeStorage() {
    const stats = fs.statSync(this.dbPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    const patternCount = this.getPatternCount().count;
    const perPattern = (stats.size / patternCount / 1024).toFixed(2);

    return {
      totalSize: sizeKB + ' KB',
      patterns: patternCount,
      perPattern: perPattern + ' KB',
      valid: parseFloat(perPattern) < 10 // Should be under 10KB per pattern
    };
  }

  generateReport(results) {
    const report = `
# Validation Report: ${results.model}
**Generated**: ${results.timestamp}

## ✅ Database Checks
- Database exists: ${results.checks.databaseExists ? '✅' : '❌'}
- Schema valid: ${results.checks.schema.valid ? '✅' : '❌'} (${results.checks.schema.tables}/4 tables)
- Pattern count: ${results.checks.patternCount.valid ? '✅' : '❌'} (${results.checks.patternCount.count} patterns)

## 📊 Data Quality
- Embeddings: ${results.checks.embeddings.valid ? '✅' : '❌'}
  - Coverage: ${results.checks.embeddings.coverage}
  - Dimensions: ${results.checks.embeddings.dimensions}
- Confidence scores: ${results.checks.confidence.valid ? '✅' : '❌'}
  - Average: ${results.checks.confidence.average}
  - Range: ${results.checks.confidence.min} - ${results.checks.confidence.max}
- Pattern links: ${results.checks.links.valid ? '✅' : '❌'} (${results.checks.links.total} links)

## ⚡ Performance
- Query latency: ${results.checks.performance.valid ? '✅' : '❌'}
  - Average: ${results.checks.performance.avgLatency}
  - Queries tested: ${results.checks.performance.queries}

## 💾 Storage Efficiency
- Total size: ${results.checks.storage.totalSize}
- Per pattern: ${results.checks.storage.perPattern}
- Efficiency: ${results.checks.storage.valid ? '✅' : '❌'}

---
**Overall Status**: ${this.isValid(results) ? '✅ PASSED' : '❌ FAILED'}
`;

    fs.writeFileSync(
      path.join(this.modelPath, 'validation-report.md'),
      report
    );

    console.log(report);
  }

  isValid(results) {
    return results.checks.databaseExists &&
           results.checks.schema.valid &&
           results.checks.patternCount.valid &&
           results.checks.embeddings.valid &&
           results.checks.confidence.valid &&
           results.checks.performance.valid &&
           results.checks.storage.valid;
  }
}

module.exports = ModelValidator;

// CLI usage
if (require.main === module) {
  const modelPath = process.argv[2];
  const modelName = process.argv[3] || path.basename(modelPath);

  if (!modelPath) {
    console.error('Usage: node validation-suite.js <model-path> [model-name]');
    process.exit(1);
  }

  const validator = new ModelValidator(modelPath, modelName);
  validator.runValidation().then(results => {
    process.exit(validator.isValid(results) ? 0 : 1);
  });
}
