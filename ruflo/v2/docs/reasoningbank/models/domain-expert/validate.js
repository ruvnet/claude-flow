#!/usr/bin/env node

/**
 * Domain Expert Model Validation
 * Quick validation script for the trained model
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { statSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, 'memory.db');

console.log('\n🔍 Validating Domain Expert Model\n');

const db = new Database(dbPath, { readonly: true });

// 1. Pattern count by domain
const domainCounts = db.prepare(`
  SELECT domain, COUNT(*) as count
  FROM patterns
  GROUP BY domain
  ORDER BY domain
`).all();

console.log('📊 Domain Distribution:');
domainCounts.forEach(({ domain, count }) => {
  console.log(`   ${domain}: ${count} patterns`);
});

// 2. Overall statistics
const stats = db.prepare(`
  SELECT
    COUNT(*) as total,
    AVG(confidence) as avg_confidence,
    AVG(success_rate) as avg_success_rate,
    MIN(confidence) as min_confidence,
    MAX(confidence) as max_confidence
  FROM patterns
`).get();

console.log('\n📈 Statistics:');
console.log(`   Total Patterns: ${stats.total}`);
console.log(`   Avg Confidence: ${(stats.avg_confidence * 100).toFixed(1)}%`);
console.log(`   Avg Success Rate: ${(stats.avg_success_rate * 100).toFixed(1)}%`);
console.log(`   Confidence Range: ${(stats.min_confidence * 100).toFixed(1)}% - ${(stats.max_confidence * 100).toFixed(1)}%`);

// 3. Pattern links
const linkStats = db.prepare(`
  SELECT
    COUNT(*) as total,
    COUNT(DISTINCT source_id) as sources,
    COUNT(DISTINCT target_id) as targets
  FROM pattern_links
`).get();

const linkTypes = db.prepare(`
  SELECT link_type, COUNT(*) as count
  FROM pattern_links
  GROUP BY link_type
`).all();

console.log('\n🔗 Pattern Links:');
console.log(`   Total Links: ${linkStats.total}`);
console.log(`   Unique Sources: ${linkStats.sources}`);
console.log(`   Link Types:`);
linkTypes.forEach(({ link_type, count }) => {
  console.log(`      ${link_type}: ${count}`);
});

// 4. Embeddings
const embCount = db.prepare('SELECT COUNT(*) as count FROM pattern_embeddings').get().count;
const coverage = ((embCount / stats.total) * 100).toFixed(1);

console.log('\n🧮 Embeddings:');
console.log(`   Total Embeddings: ${embCount}`);
console.log(`   Coverage: ${coverage}%`);

// 5. Database size
const dbSize = statSync(dbPath).size;
const sizeMB = (dbSize / 1024 / 1024).toFixed(2);
const perPattern = (dbSize / stats.total / 1024).toFixed(2);

console.log('\n💾 Storage:');
console.log(`   Database Size: ${sizeMB} MB`);
console.log(`   Per Pattern: ${perPattern} KB`);

// 6. Sample patterns
console.log('\n🔍 Sample Patterns:');
const samples = db.prepare(`
  SELECT problem, domain, confidence, success_rate
  FROM patterns
  ORDER BY RANDOM()
  LIMIT 3
`).all();

samples.forEach((pattern, i) => {
  console.log(`\n   ${i + 1}. ${pattern.domain}`);
  console.log(`      Problem: ${pattern.problem.substring(0, 80)}...`);
  console.log(`      Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
  console.log(`      Success Rate: ${(pattern.success_rate * 100).toFixed(1)}%`);
});

// 7. Validation summary
console.log('\n' + '='.repeat(60));
console.log('✅ VALIDATION SUMMARY');
console.log('='.repeat(60));

const checks = [
  { name: 'Total patterns (1500)', passed: stats.total === 1500 },
  { name: 'Equal domain distribution', passed: domainCounts.every(d => d.count === 300) },
  { name: 'High confidence (>80%)', passed: stats.avg_confidence > 0.80 },
  { name: 'High success rate (>75%)', passed: stats.avg_success_rate > 0.75 },
  { name: 'Pattern links (>2000)', passed: linkStats.total > 2000 },
  { name: 'Full embedding coverage (100%)', passed: embCount === stats.total },
  { name: 'Efficient storage (<12 MB)', passed: dbSize < 12 * 1024 * 1024 }
];

checks.forEach(check => {
  const status = check.passed ? '✅' : '❌';
  console.log(`${status} ${check.name}`);
});

const allPassed = checks.every(c => c.passed);
console.log('\n' + '='.repeat(60));
console.log(`Overall: ${allPassed ? '✅ ALL CHECKS PASSED' : '⚠️  SOME CHECKS FAILED'}`);
console.log('='.repeat(60) + '\n');

// Write validation report
const report = `# Domain Expert Model - Validation Report

**Validation Date**: ${new Date().toISOString()}
**Database**: ${dbPath}

## ✅ Validation Results

${checks.map(c => `- [${c.passed ? 'x' : ' '}] ${c.name}`).join('\n')}

**Overall Status**: ${allPassed ? '✅ PASSED' : '❌ FAILED'}

## 📊 Statistics

### Pattern Distribution
${domainCounts.map(d => `- **${d.domain}**: ${d.count} patterns`).join('\n')}

### Quality Metrics
- **Total Patterns**: ${stats.total}
- **Average Confidence**: ${(stats.avg_confidence * 100).toFixed(1)}%
- **Average Success Rate**: ${(stats.avg_success_rate * 100).toFixed(1)}%
- **Confidence Range**: ${(stats.min_confidence * 100).toFixed(1)}% - ${(stats.max_confidence * 100).toFixed(1)}%

### Cross-Domain Links
- **Total Links**: ${linkStats.total}
- **Unique Sources**: ${linkStats.sources}
- **Unique Targets**: ${linkStats.targets}

### Link Type Distribution
${linkTypes.map(l => `- **${l.link_type}**: ${l.count} links`).join('\n')}

### Embeddings
- **Total Embeddings**: ${embCount}
- **Coverage**: ${coverage}%

### Storage Efficiency
- **Database Size**: ${sizeMB} MB
- **Per Pattern**: ${perPattern} KB

## 🎯 Model Capabilities

The Domain Expert model provides:

1. **Multi-Domain Expertise**: 5 domains with 300 patterns each
2. **High Confidence**: ${(stats.avg_confidence * 100).toFixed(1)}% average expert consensus
3. **Proven Success**: ${(stats.avg_success_rate * 100).toFixed(1)}% average production success rate
4. **Rich Context**: ${linkStats.total} cross-domain pattern links
5. **Semantic Search**: Full embedding coverage for similarity queries

## 📝 Usage Examples

### Query DevOps patterns
\`\`\`bash
npx claude-flow@alpha memory search "kubernetes autoscaling" \\
  --namespace domain-expert --reasoningbank --limit 5
\`\`\`

### Query Security patterns
\`\`\`bash
npx claude-flow@alpha memory search "OAuth 2.0 security" \\
  --namespace domain-expert --reasoningbank --limit 5
\`\`\`

### Query Performance patterns
\`\`\`bash
npx claude-flow@alpha memory search "database query optimization" \\
  --namespace domain-expert --reasoningbank --limit 5
\`\`\`

## 🚀 Next Steps

1. Test semantic search with domain-specific queries
2. Integrate with agentic-flow agents
3. Benchmark query performance
4. Collect feedback for model improvements

---

**Report Generated**: ${new Date().toISOString()}
`;

writeFileSync(join(__dirname, 'validation-report.md'), report);
console.log('📄 Validation report saved to: validation-report.md\n');

db.close();

process.exit(allPassed ? 0 : 1);
