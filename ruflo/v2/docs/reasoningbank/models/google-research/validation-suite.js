#!/usr/bin/env node

/**
 * ReasoningBank Model Validation Suite
 * Validates model quality, performance, and paper benchmark compliance
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Validation metrics from the paper
const PAPER_BENCHMARKS = {
  minPatterns: 3000,
  minLinks: 5000,
  maxDbSizeMB: 20,
  maxQueryLatencyMs: 5,
  minConfidence: 0.7,
  successFailureRatio: 0.4, // Minimum 40% failure patterns
  minDomainCoverage: 4,
  minStrategyTypes: 2
};

function validateDatabase(dbPath, modelName) {
  console.log(`🔍 Validating ${modelName} ReasoningBank Model`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const results = {
    modelName,
    timestamp: new Date().toISOString(),
    passed: true,
    checks: []
  };

  // Check file exists
  if (!fs.existsSync(dbPath)) {
    results.passed = false;
    results.checks.push({
      name: 'Database File Exists',
      passed: false,
      message: `Database not found at ${dbPath}`
    });
    return results;
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    // 1. Pattern Count
    const patternCount = db.prepare('SELECT COUNT(*) as count FROM patterns').get().count;
    const patternCheck = {
      name: 'Minimum Pattern Count',
      passed: patternCount >= PAPER_BENCHMARKS.minPatterns,
      expected: PAPER_BENCHMARKS.minPatterns,
      actual: patternCount,
      message: `${patternCount} patterns (minimum ${PAPER_BENCHMARKS.minPatterns})`
    };
    results.checks.push(patternCheck);
    if (!patternCheck.passed) results.passed = false;

    // 2. Link Count
    const linkCount = db.prepare('SELECT COUNT(*) as count FROM pattern_links').get().count;
    const linkCheck = {
      name: 'Minimum Link Count',
      passed: linkCount >= PAPER_BENCHMARKS.minLinks,
      expected: PAPER_BENCHMARKS.minLinks,
      actual: linkCount,
      message: `${linkCount} strategic links (minimum ${PAPER_BENCHMARKS.minLinks})`
    };
    results.checks.push(linkCheck);
    if (!linkCheck.passed) results.passed = false;

    // 3. Database Size
    const dbSizeMB = fs.statSync(dbPath).size / 1024 / 1024;
    const sizeCheck = {
      name: 'Database Size Limit',
      passed: dbSizeMB <= PAPER_BENCHMARKS.maxDbSizeMB,
      expected: `<= ${PAPER_BENCHMARKS.maxDbSizeMB} MB`,
      actual: `${dbSizeMB.toFixed(2)} MB`,
      message: `${dbSizeMB.toFixed(2)} MB (maximum ${PAPER_BENCHMARKS.maxDbSizeMB} MB)`
    };
    results.checks.push(sizeCheck);
    if (!sizeCheck.passed) results.passed = false;

    // 4. Query Performance
    const queryTests = [
      "SELECT * FROM patterns WHERE domain = 'web-automation' LIMIT 10",
      "SELECT * FROM patterns WHERE strategy_type = 'success' ORDER BY confidence DESC LIMIT 10",
      'SELECT p.*, pl.* FROM patterns p JOIN pattern_links pl ON p.id = pl.source_id LIMIT 10'
    ];

    let maxLatency = 0;
    for (const query of queryTests) {
      const start = process.hrtime.bigint();
      db.prepare(query).all();
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;
      maxLatency = Math.max(maxLatency, latencyMs);
    }

    const latencyCheck = {
      name: 'Query Performance',
      passed: maxLatency <= PAPER_BENCHMARKS.maxQueryLatencyMs,
      expected: `<= ${PAPER_BENCHMARKS.maxQueryLatencyMs} ms`,
      actual: `${maxLatency.toFixed(2)} ms`,
      message: `${maxLatency.toFixed(2)} ms max latency (target ${PAPER_BENCHMARKS.maxQueryLatencyMs} ms)`
    };
    results.checks.push(latencyCheck);
    if (!latencyCheck.passed) results.passed = false;

    // 5. Average Confidence
    const avgConfidence = db.prepare('SELECT AVG(confidence) as avg FROM patterns').get().avg;
    const confidenceCheck = {
      name: 'Average Confidence',
      passed: avgConfidence >= PAPER_BENCHMARKS.minConfidence,
      expected: `>= ${PAPER_BENCHMARKS.minConfidence}`,
      actual: avgConfidence.toFixed(3),
      message: `${(avgConfidence * 100).toFixed(1)}% (minimum ${PAPER_BENCHMARKS.minConfidence * 100}%)`
    };
    results.checks.push(confidenceCheck);
    if (!confidenceCheck.passed) results.passed = false;

    // 6. Success/Failure Balance (Paper Innovation)
    const successCount = db.prepare("SELECT COUNT(*) as count FROM patterns WHERE strategy_type = 'success'").get().count;
    const failureCount = db.prepare("SELECT COUNT(*) as count FROM patterns WHERE strategy_type = 'failure'").get().count;
    const failureRatio = failureCount / patternCount;
    const balanceCheck = {
      name: 'Failure Pattern Learning',
      passed: failureRatio >= PAPER_BENCHMARKS.successFailureRatio,
      expected: `>= ${PAPER_BENCHMARKS.successFailureRatio * 100}% failure patterns`,
      actual: `${(failureRatio * 100).toFixed(1)}%`,
      message: `${failureCount} failure patterns (${(failureRatio * 100).toFixed(1)}% of total)`
    };
    results.checks.push(balanceCheck);
    if (!balanceCheck.passed) results.passed = false;

    // 7. Domain Coverage
    const domains = db.prepare('SELECT DISTINCT domain FROM patterns').all();
    const domainCheck = {
      name: 'Domain Coverage',
      passed: domains.length >= PAPER_BENCHMARKS.minDomainCoverage,
      expected: `>= ${PAPER_BENCHMARKS.minDomainCoverage} domains`,
      actual: domains.length,
      message: `${domains.length} domains covered`
    };
    results.checks.push(domainCheck);
    if (!domainCheck.passed) results.passed = false;

    // 8. Strategy Type Diversity
    const strategyTypes = db.prepare('SELECT DISTINCT strategy_type FROM patterns').all();
    const strategyCheck = {
      name: 'Strategy Type Diversity',
      passed: strategyTypes.length >= PAPER_BENCHMARKS.minStrategyTypes,
      expected: `>= ${PAPER_BENCHMARKS.minStrategyTypes} types`,
      actual: strategyTypes.length,
      message: `${strategyTypes.length} strategy types`
    };
    results.checks.push(strategyCheck);
    if (!strategyCheck.passed) results.passed = false;

    // 9. MaTTS Mode Coverage
    const matsParallel = db.prepare("SELECT COUNT(*) as count FROM patterns WHERE mats_mode = 'parallel'").get().count;
    const matsSequential = db.prepare("SELECT COUNT(*) as count FROM patterns WHERE mats_mode = 'sequential'").get().count;
    const matsCheck = {
      name: 'MaTTS Mode Coverage',
      passed: matsParallel > 0 && matsSequential > 0,
      expected: 'Both parallel and sequential patterns',
      actual: `${matsParallel} parallel, ${matsSequential} sequential`,
      message: `MaTTS: ${matsParallel} parallel, ${matsSequential} sequential`
    };
    results.checks.push(matsCheck);
    if (!matsCheck.passed) results.passed = false;

    // 10. Schema Integrity
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const requiredTables = ['patterns', 'pattern_embeddings', 'pattern_links'];
    const hasAllTables = requiredTables.every(t => tables.some(table => table.name === t));
    const schemaCheck = {
      name: 'Schema Integrity',
      passed: hasAllTables,
      expected: requiredTables.join(', '),
      actual: tables.map(t => t.name).join(', '),
      message: hasAllTables ? 'All required tables present' : 'Missing required tables'
    };
    results.checks.push(schemaCheck);
    if (!schemaCheck.passed) results.passed = false;

    // Print results
    console.log('📋 Validation Results:');
    console.log('');
    results.checks.forEach((check, i) => {
      const icon = check.passed ? '✅' : '❌';
      console.log(`${icon} ${i + 1}. ${check.name}`);
      console.log(`   ${check.message}`);
      if (!check.passed) {
        console.log(`   Expected: ${check.expected}, Got: ${check.actual}`);
      }
      console.log('');
    });

    // Summary statistics
    const stats = {
      patterns: patternCount,
      links: linkCount,
      domains: domains.length,
      strategyTypes: strategyTypes.length,
      avgConfidence: (avgConfidence * 100).toFixed(1),
      failureRatio: (failureRatio * 100).toFixed(1),
      matsParallel,
      matsSequential,
      dbSizeMB: dbSizeMB.toFixed(2),
      maxQueryLatency: maxLatency.toFixed(2)
    };

    console.log('📊 Summary Statistics:');
    console.log(`   Total Patterns: ${stats.patterns}`);
    console.log(`   Strategic Links: ${stats.links}`);
    console.log(`   Domains: ${stats.domains}`);
    console.log(`   Strategy Types: ${stats.strategyTypes}`);
    console.log(`   Avg Confidence: ${stats.avgConfidence}%`);
    console.log(`   Failure Learning: ${stats.failureRatio}%`);
    console.log(`   MaTTS Parallel: ${stats.matsParallel}`);
    console.log(`   MaTTS Sequential: ${stats.matsSequential}`);
    console.log(`   Database Size: ${stats.dbSizeMB} MB`);
    console.log(`   Max Query Latency: ${stats.maxQueryLatency} ms`);
    console.log('');

    results.stats = stats;

  } finally {
    db.close();
  }

  console.log('═══════════════════════════════════════════════════════');
  if (results.passed) {
    console.log('✅ ALL VALIDATIONS PASSED');
    console.log('🎉 Model meets paper benchmark requirements');
  } else {
    console.log('❌ SOME VALIDATIONS FAILED');
    console.log('⚠️  Model needs improvement');
  }
  console.log('');

  return results;
}

// Save validation report
function saveReport(results, outputPath) {
  const report = `# ${results.modelName} Validation Report

**Generated:** ${results.timestamp}
**Status:** ${results.passed ? '✅ PASSED' : '❌ FAILED'}

## Validation Checks

${results.checks.map((check, i) => `
### ${i + 1}. ${check.name}
- **Status:** ${check.passed ? '✅ Passed' : '❌ Failed'}
- **Result:** ${check.message}
${!check.passed ? `- **Expected:** ${check.expected}\n- **Actual:** ${check.actual}` : ''}
`).join('\n')}

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Patterns | ${results.stats.patterns} |
| Strategic Links | ${results.stats.links} |
| Domains Covered | ${results.stats.domains} |
| Strategy Types | ${results.stats.strategyTypes} |
| Avg Confidence | ${results.stats.avgConfidence}% |
| Failure Learning Ratio | ${results.stats.failureRatio}% |
| MaTTS Parallel | ${results.stats.matsParallel} |
| MaTTS Sequential | ${results.stats.matsSequential} |
| Database Size | ${results.stats.dbSizeMB} MB |
| Max Query Latency | ${results.stats.maxQueryLatency} ms |

## Benchmark Compliance

${results.passed ?
  '✅ This model meets all requirements from the ReasoningBank paper (arXiv:2509.25140).' :
  '⚠️ This model does not yet meet all paper requirements. See failed checks above.'
}

## Expected Performance Improvements

Based on paper benchmarks, this model should provide:
- **+8.3%** improvement on WebArena-style tasks
- **Strategy-level reasoning** rather than task-level recall
- **Failure learning** from both successes and mistakes
- **MaTTS scaling** with parallel and sequential patterns
- **Closed-loop learning** through iterative refinement

---

*Generated by validation-suite.js*
`;

  fs.writeFileSync(outputPath, report);
  console.log(`📄 Validation report saved to ${outputPath}`);
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.argv[2];
  const modelName = process.argv[3] || 'ReasoningBank';

  if (!dbPath) {
    console.error('Usage: node validation-suite.js <db-path> [model-name]');
    process.exit(1);
  }

  const results = validateDatabase(dbPath, modelName);

  // Save report in same directory as database
  const reportPath = path.join(path.dirname(dbPath), 'validation-report.md');
  saveReport(results, reportPath);

  process.exit(results.passed ? 0 : 1);
}

export { validateDatabase, saveReport };
