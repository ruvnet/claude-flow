#!/usr/bin/env node

/**
 * SAFLA Model Validation Script
 * Validates the trained SAFLA model for quality and performance
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { statSync } from 'fs';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, 'memory.db');

console.log('🔍 SAFLA Model Validation Suite\n');
console.log(`📁 Database: ${dbPath}\n`);

const db = new Database(dbPath, { readonly: true });

// Enable optimizations for read queries
db.pragma('cache_size = 10000');
db.pragma('temp_store = MEMORY');

const results = {
  model: 'SAFLA',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  checks: {}
};

// 1. Database Structure Validation
console.log('📊 Validating Database Structure...');
const tables = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table'
`).all().map(t => t.name);

const requiredTables = ['patterns', 'pattern_embeddings', 'pattern_links', 'metadata'];
const hasAllTables = requiredTables.every(t => tables.includes(t));

results.checks.schema = {
  valid: hasAllTables,
  tables: tables.length,
  required: requiredTables.length,
  found: tables
};

console.log(`  ${hasAllTables ? '✅' : '❌'} Schema: ${tables.length}/${requiredTables.length} tables found`);

// 2. Pattern Count Validation
console.log('\n📈 Validating Pattern Count...');
const patternCount = db.prepare('SELECT COUNT(*) as count FROM patterns').get().count;
const patternCountValid = patternCount === 2000;

results.checks.patternCount = {
  count: patternCount,
  expected: 2000,
  valid: patternCountValid
};

console.log(`  ${patternCountValid ? '✅' : '❌'} Patterns: ${patternCount}/2000`);

// 3. Embedding Validation
console.log('\n🧠 Validating Embeddings...');
const embeddingCount = db.prepare('SELECT COUNT(*) as count FROM pattern_embeddings').get().count;
const embeddingCoverage = (embeddingCount / patternCount * 100).toFixed(2);

// Check embedding dimensions
const sampleEmbedding = db.prepare('SELECT embedding FROM pattern_embeddings LIMIT 1').get();
const embeddingSize = sampleEmbedding ? sampleEmbedding.embedding.length / 4 : 0; // Float32 = 4 bytes each

const embeddingValid = embeddingCount === patternCount && embeddingSize === 1024;

results.checks.embeddings = {
  count: embeddingCount,
  coverage: embeddingCoverage + '%',
  dimensions: embeddingSize,
  expected: 1024,
  valid: embeddingValid
};

console.log(`  ${embeddingValid ? '✅' : '❌'} Embeddings: ${embeddingCount} patterns, ${embeddingSize} dimensions`);
console.log(`  Coverage: ${embeddingCoverage}%`);

// 4. Domain Distribution Validation
console.log('\n🎯 Validating Domain Distribution...');
const domainDistribution = db.prepare(`
  SELECT domain, COUNT(*) as count
  FROM patterns
  GROUP BY domain
  ORDER BY count DESC
`).all();

const expectedDomains = {
  'self-learning': 400,
  'feedback-optimization': 400,
  'confidence-adjustment': 400,
  'distillation': 400,
  'recursive-cycles': 400
};

const domainValid = domainDistribution.every(d =>
  expectedDomains[d.domain] === d.count
);

results.checks.domains = {
  distribution: domainDistribution,
  expected: expectedDomains,
  valid: domainValid
};

console.log(`  ${domainValid ? '✅' : '❌'} Domain Distribution:`);
for (const domain of domainDistribution) {
  const expected = expectedDomains[domain.domain] || 0;
  const match = domain.count === expected ? '✅' : '❌';
  console.log(`    ${match} ${domain.domain}: ${domain.count}/${expected}`);
}

// 5. Confidence Score Validation
console.log('\n🎲 Validating Confidence Scores...');
const confidenceStats = db.prepare(`
  SELECT
    AVG(confidence) as avg,
    MIN(confidence) as min,
    MAX(confidence) as max,
    COUNT(*) as count
  FROM patterns
`).get();

const confidenceRanges = db.prepare(`
  SELECT
    CASE
      WHEN confidence < 0.6 THEN 'low (0.5-0.6)'
      WHEN confidence < 0.7 THEN 'medium (0.6-0.7)'
      WHEN confidence < 0.8 THEN 'high (0.7-0.8)'
      WHEN confidence < 0.9 THEN 'very-high (0.8-0.9)'
      ELSE 'expert (0.9-0.95)'
    END as range,
    COUNT(*) as count
  FROM patterns
  GROUP BY range
  ORDER BY MIN(confidence)
`).all();

const confidenceValid =
  confidenceStats.avg >= 0.70 && confidenceStats.avg <= 0.85 &&
  confidenceStats.min >= 0.50 && confidenceStats.max <= 0.95;

results.checks.confidence = {
  average: confidenceStats.avg.toFixed(4),
  min: confidenceStats.min.toFixed(4),
  max: confidenceStats.max.toFixed(4),
  ranges: confidenceRanges,
  valid: confidenceValid
};

console.log(`  ${confidenceValid ? '✅' : '❌'} Confidence: avg=${confidenceStats.avg.toFixed(3)}, min=${confidenceStats.min.toFixed(3)}, max=${confidenceStats.max.toFixed(3)}`);
console.log('\n  Distribution:');
for (const range of confidenceRanges) {
  console.log(`    ${range.range}: ${range.count} patterns`);
}

// 6. Success Rate Validation
console.log('\n✨ Validating Success Rates...');
const successStats = db.prepare(`
  SELECT
    AVG(success_rate) as avg,
    MIN(success_rate) as min,
    MAX(success_rate) as max
  FROM patterns
`).get();

const successValid =
  successStats.avg >= 0.80 && successStats.avg <= 0.92 &&
  successStats.min >= 0.70 && successStats.max <= 0.95;

results.checks.successRate = {
  average: successStats.avg.toFixed(4),
  min: successStats.min.toFixed(4),
  max: successStats.max.toFixed(4),
  valid: successValid
};

console.log(`  ${successValid ? '✅' : '❌'} Success Rate: avg=${successStats.avg.toFixed(3)}, min=${successStats.min.toFixed(3)}, max=${successStats.max.toFixed(3)}`);

// 7. Pattern Links Validation
console.log('\n🔗 Validating Pattern Links (Knowledge Graph)...');
const linkCount = db.prepare('SELECT COUNT(*) as count FROM pattern_links').get().count;
const linkRelationships = db.prepare(`
  SELECT relationship, COUNT(*) as count
  FROM pattern_links
  GROUP BY relationship
  ORDER BY count DESC
`).all();

const avgLinksPerPattern = (linkCount / patternCount).toFixed(2);
const linkValid = linkCount >= 3000 && parseFloat(avgLinksPerPattern) >= 1.5;

results.checks.links = {
  total: linkCount,
  minimum: 3000,
  avgPerPattern: avgLinksPerPattern,
  relationships: linkRelationships,
  valid: linkValid
};

console.log(`  ${linkValid ? '✅' : '❌'} Links: ${linkCount} total (${avgLinksPerPattern} per pattern)`);
console.log('\n  Relationship Types:');
for (const rel of linkRelationships) {
  console.log(`    ${rel.relationship}: ${rel.count}`);
}

// 8. Query Performance Validation
console.log('\n⚡ Validating Query Performance...');
const queryTests = [
  { name: 'Pattern by ID', query: 'SELECT * FROM patterns WHERE id = ?', params: [100] },
  { name: 'Domain filter', query: 'SELECT * FROM patterns WHERE domain = ? LIMIT 10', params: ['self-learning'] },
  { name: 'Confidence filter', query: 'SELECT * FROM patterns WHERE confidence >= ? LIMIT 10', params: [0.85] },
  { name: 'Success rate filter', query: 'SELECT * FROM patterns WHERE success_rate >= ? LIMIT 10', params: [0.90] },
  { name: 'Knowledge graph', query: 'SELECT * FROM pattern_links WHERE source_id = ? LIMIT 10', params: [100] }
];

const performanceResults = [];

for (const test of queryTests) {
  const iterations = 100;
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    db.prepare(test.query).all(...test.params);
  }

  const duration = Date.now() - start;
  const avgLatency = duration / iterations;

  performanceResults.push({
    name: test.name,
    avgLatency: avgLatency.toFixed(3) + 'ms',
    iterations,
    valid: avgLatency < 5
  });

  const status = avgLatency < 5 ? '✅' : '❌';
  console.log(`  ${status} ${test.name}: ${avgLatency.toFixed(2)}ms avg`);
}

const allPerformanceValid = performanceResults.every(r => r.valid);

results.checks.performance = {
  tests: performanceResults,
  valid: allPerformanceValid
};

// 9. Storage Efficiency Validation
console.log('\n💾 Validating Storage Efficiency...');
const fileStats = statSync(dbPath);
const fileSizeBytes = fileStats.size;
const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
const bytesPerPattern = (fileSizeBytes / patternCount).toFixed(0);
const kbPerPattern = (bytesPerPattern / 1024).toFixed(2);

const storageValid = fileSizeBytes < 15 * 1024 * 1024; // Under 15 MB

results.checks.storage = {
  totalSize: fileSizeMB + ' MB',
  totalBytes: fileSizeBytes,
  patterns: patternCount,
  bytesPerPattern: bytesPerPattern,
  kbPerPattern: kbPerPattern,
  maxSizeMB: 15,
  valid: storageValid
};

console.log(`  ${storageValid ? '✅' : '❌'} Size: ${fileSizeMB} MB (< 15 MB target)`);
console.log(`  Per pattern: ${kbPerPattern} KB`);

// 10. Metadata Validation
console.log('\n📋 Validating Metadata...');
const metadata = db.prepare('SELECT * FROM metadata').all();
const metadataMap = {};
for (const m of metadata) {
  metadataMap[m.key] = m.value;
}

const requiredMetadata = ['model_name', 'version', 'pattern_count', 'embedding_dimensions', 'training_date'];
const hasAllMetadata = requiredMetadata.every(k => metadataMap[k]);

results.checks.metadata = {
  entries: metadata.length,
  required: requiredMetadata.length,
  metadata: metadataMap,
  valid: hasAllMetadata
};

console.log(`  ${hasAllMetadata ? '✅' : '❌'} Metadata: ${metadata.length} entries`);
for (const [key, value] of Object.entries(metadataMap)) {
  console.log(`    ${key}: ${value}`);
}

db.close();

// Overall Validation Status
console.log('\n' + '='.repeat(60));
const allValid = Object.values(results.checks).every(check => check.valid);
const overallStatus = allValid ? '✅ PASSED' : '❌ FAILED';

console.log(`\n🎯 Overall Status: ${overallStatus}\n`);

// Count passed/failed checks
const totalChecks = Object.keys(results.checks).length;
const passedChecks = Object.values(results.checks).filter(c => c.valid).length;
console.log(`Passed: ${passedChecks}/${totalChecks} checks`);

// Generate detailed validation report
const report = `# SAFLA Model Validation Report

**Model**: ${results.model}
**Version**: ${results.version}
**Validation Date**: ${results.timestamp}
**Overall Status**: ${overallStatus}

## Summary
- **Total Checks**: ${totalChecks}
- **Passed**: ${passedChecks}
- **Failed**: ${totalChecks - passedChecks}

## Detailed Results

### 1. Database Schema
- **Status**: ${results.checks.schema.valid ? '✅ PASSED' : '❌ FAILED'}
- **Tables Found**: ${results.checks.schema.tables}/${results.checks.schema.required}
- **Tables**: ${results.checks.schema.found.join(', ')}

### 2. Pattern Count
- **Status**: ${results.checks.patternCount.valid ? '✅ PASSED' : '❌ FAILED'}
- **Count**: ${results.checks.patternCount.count}/${results.checks.patternCount.expected}

### 3. Embeddings
- **Status**: ${results.checks.embeddings.valid ? '✅ PASSED' : '❌ FAILED'}
- **Coverage**: ${results.checks.embeddings.coverage}
- **Dimensions**: ${results.checks.embeddings.dimensions}/${results.checks.embeddings.expected}

### 4. Domain Distribution
- **Status**: ${results.checks.domains.valid ? '✅ PASSED' : '❌ FAILED'}

${results.checks.domains.distribution.map(d => {
  const expected = results.checks.domains.expected[d.domain] || 0;
  const status = d.count === expected ? '✅' : '❌';
  return `- ${status} **${d.domain}**: ${d.count}/${expected} patterns`;
}).join('\n')}

### 5. Confidence Scores
- **Status**: ${results.checks.confidence.valid ? '✅ PASSED' : '❌ FAILED'}
- **Average**: ${results.checks.confidence.average}
- **Range**: ${results.checks.confidence.min} - ${results.checks.confidence.max}

**Distribution**:
${results.checks.confidence.ranges.map(r =>
  `- ${r.range}: ${r.count} patterns`
).join('\n')}

### 6. Success Rates
- **Status**: ${results.checks.successRate.valid ? '✅ PASSED' : '❌ FAILED'}
- **Average**: ${results.checks.successRate.average}
- **Range**: ${results.checks.successRate.min} - ${results.checks.successRate.max}

### 7. Pattern Links (Knowledge Graph)
- **Status**: ${results.checks.links.valid ? '✅ PASSED' : '❌ FAILED'}
- **Total Links**: ${results.checks.links.total}
- **Average per Pattern**: ${results.checks.links.avgPerPattern}

**Relationship Types**:
${results.checks.links.relationships.map(r =>
  `- **${r.relationship}**: ${r.count} links`
).join('\n')}

### 8. Query Performance
- **Status**: ${results.checks.performance.valid ? '✅ PASSED' : '❌ FAILED'}

${results.checks.performance.tests.map(t =>
  `- ${t.valid ? '✅' : '❌'} **${t.name}**: ${t.avgLatency} (${t.iterations} iterations)`
).join('\n')}

### 9. Storage Efficiency
- **Status**: ${results.checks.storage.valid ? '✅ PASSED' : '❌ FAILED'}
- **Total Size**: ${results.checks.storage.totalSize}
- **Per Pattern**: ${results.checks.storage.kbPerPattern} KB
- **Target**: < ${results.checks.storage.maxSizeMB} MB

### 10. Metadata
- **Status**: ${results.checks.metadata.valid ? '✅ PASSED' : '❌ FAILED'}
- **Entries**: ${results.checks.metadata.entries}/${results.checks.metadata.required}

${Object.entries(results.checks.metadata.metadata).map(([k, v]) =>
  `- **${k}**: ${v}`
).join('\n')}

## Recommendations

${allValid ? `
✅ **Model is production-ready!**

The SAFLA model has passed all validation checks and meets quality standards:
- All 2,000 patterns generated successfully
- Confidence scores follow expected SAFLA learning progression
- Knowledge graph has sufficient connectivity (${results.checks.links.avgPerPattern} links per pattern)
- Query performance meets sub-5ms latency target
- Storage efficiency is excellent (${results.checks.storage.totalSize})

**Next Steps**:
1. Deploy model to production \`.swarm/memory.db\`
2. Monitor real-world usage patterns
3. Collect feedback for future model improvements
` : `
⚠️ **Model requires attention**

Some validation checks failed. Please review the following:

${Object.entries(results.checks)
  .filter(([_, check]) => !check.valid)
  .map(([name, check]) => `- **${name}**: Review and fix issues`)
  .join('\n')}

**Action Items**:
1. Re-run training script with adjustments
2. Verify database schema matches requirements
3. Check data generation logic for accuracy
`}

---

**Validation completed**: ${new Date().toISOString()}
`;

writeFileSync(join(__dirname, 'validation-report.md'), report);

console.log(`\n📄 Detailed report saved to: validation-report.md\n`);

// Save JSON results
writeFileSync(
  join(__dirname, 'validation-results.json'),
  JSON.stringify(results, null, 2)
);

console.log(`📊 JSON results saved to: validation-results.json\n`);

process.exit(allValid ? 0 : 1);
