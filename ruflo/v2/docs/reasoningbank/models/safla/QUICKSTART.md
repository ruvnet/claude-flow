# SAFLA Model - Quick Start Guide

## 🚀 Get Started in 60 Seconds

### Step 1: Install the Model (10 seconds)

```bash
# Copy pre-trained model to your home directory
cp /workspaces/claude-code-flow/docs/reasoningbank/models/safla/memory.db ~/.swarm/memory.db

# Or for project-specific installation
mkdir -p .swarm
cp /workspaces/claude-code-flow/docs/reasoningbank/models/safla/memory.db ./.swarm/memory.db
```

### Step 2: Verify Installation (10 seconds)

```bash
# Check model is accessible
npx claude-flow@alpha memory search "test" --namespace safla

# Expected: Returns SAFLA patterns related to testing
```

### Step 3: Try Your First Query (40 seconds)

```bash
# Search for API optimization patterns
npx claude-flow@alpha memory search "optimize API performance" --namespace safla

# Expected output:
# 🔍 Found patterns related to:
# - API endpoint optimization through usage monitoring
# - Performance metric feedback loops
# - Resource allocation learning from load patterns
```

---

## 📖 Common Use Cases

### 1. During API Development

```bash
# Get patterns for API optimization
npx claude-flow@alpha memory search "API optimization" --namespace safla

# Get high-confidence REST patterns
npx claude-flow@alpha memory retrieve "domain:self-learning AND tags:rest" --namespace safla
```

### 2. During Code Review

```bash
# Get feedback loop patterns
npx claude-flow@alpha memory search "code review feedback" --namespace safla

# Get patterns that improve review quality
npx claude-flow@alpha memory retrieve "domain:feedback-optimization AND confidence:>0.80" --namespace safla
```

### 3. During Debugging

```bash
# Get error recovery patterns
npx claude-flow@alpha memory search "error recovery adaptation" --namespace safla

# Get distilled failure patterns
npx claude-flow@alpha memory retrieve "domain:distillation AND tags:error" --namespace safla
```

### 4. During Performance Optimization

```bash
# Get optimization patterns
npx claude-flow@alpha memory search "performance optimization" --namespace safla

# Get recursive improvement patterns
npx claude-flow@alpha memory retrieve "domain:recursive-cycles AND success_rate:>0.90" --namespace safla
```

### 5. During Architecture Design

```bash
# Get architecture patterns
npx claude-flow@alpha memory search "architecture refinement" --namespace safla

# Get high-confidence system design patterns
npx claude-flow@alpha memory retrieve "domain:recursive-cycles AND tags:architecture" --namespace safla
```

---

## 🎯 Programmatic Access (Node.js)

```javascript
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

// Connect to SAFLA model
const dbPath = join(homedir(), '.swarm', 'memory.db');
const db = new Database(dbPath, { readonly: true });

// Get high-confidence self-learning patterns
const patterns = db.prepare(`
  SELECT description, context, confidence, success_rate, tags
  FROM patterns
  WHERE domain = ? AND confidence >= ?
  ORDER BY confidence DESC
  LIMIT 10
`).all('self-learning', 0.85);

console.log('Top Self-Learning Patterns:');
for (const pattern of patterns) {
  console.log(`\n- ${pattern.description}`);
  console.log(`  Confidence: ${pattern.confidence.toFixed(2)}`);
  console.log(`  Success: ${pattern.success_rate.toFixed(2)}`);
  console.log(`  Tags: ${JSON.parse(pattern.tags).join(', ')}`);
}

// Get related patterns via knowledge graph
const getRelated = db.prepare(`
  SELECT
    p.description,
    pl.relationship,
    pl.strength
  FROM patterns p
  JOIN pattern_links pl ON p.id = pl.target_id
  WHERE pl.source_id = ?
  ORDER BY pl.strength DESC
  LIMIT 5
`);

const relatedPatterns = getRelated.all(patterns[0].id);

console.log('\nRelated Patterns:');
for (const rel of relatedPatterns) {
  console.log(`\n- ${rel.relationship}: ${rel.description}`);
  console.log(`  Strength: ${rel.strength.toFixed(2)}`);
}

db.close();
```

---

## 🔍 Example Queries by Domain

### Self-Learning Domain (400 patterns)

```bash
# API optimization patterns
npx claude-flow@alpha memory search "API endpoint optimization" --namespace safla

# Database query learning
npx claude-flow@alpha memory search "database query learning" --namespace safla

# Resource allocation patterns
npx claude-flow@alpha memory search "resource allocation learning" --namespace safla
```

### Feedback-Optimization Domain (400 patterns)

```bash
# User feedback patterns
npx claude-flow@alpha memory search "user interaction feedback" --namespace safla

# A/B testing integration
npx claude-flow@alpha memory search "A/B test result integration" --namespace safla

# Performance monitoring
npx claude-flow@alpha memory search "performance metric feedback" --namespace safla
```

### Confidence-Adjustment Domain (400 patterns)

```bash
# Bayesian updating
npx claude-flow@alpha memory search "prior belief updating" --namespace safla

# Uncertainty quantification
npx claude-flow@alpha memory search "uncertainty quantification" --namespace safla

# Multi-source evidence
npx claude-flow@alpha memory search "multi-source evidence integration" --namespace safla
```

### Distillation Domain (400 patterns)

```bash
# Deployment success patterns
npx claude-flow@alpha memory search "deployment success pattern extraction" --namespace safla

# Incident learning
npx claude-flow@alpha memory search "incident post-mortem learning" --namespace safla

# Test failure analysis
npx claude-flow@alpha memory search "test failure root cause" --namespace safla
```

### Recursive-Cycles Domain (400 patterns)

```bash
# Meta-learning patterns
npx claude-flow@alpha memory search "meta-learning from optimization" --namespace safla

# Self-improving tests
npx claude-flow@alpha memory search "self-improving test suite" --namespace safla

# Architecture refinement
npx claude-flow@alpha memory search "architecture refinement cycles" --namespace safla
```

---

## 🛠️ Integration with Claude Flow

### During Development

```bash
# Before starting a task
npx claude-flow@alpha hooks pre-task --description "API optimization task"

# Query SAFLA for relevant patterns
npx claude-flow@alpha memory search "API optimization microservices" --namespace safla

# After completing work
npx claude-flow@alpha hooks post-task --task-id "api-opt-task"
```

### With Swarm Coordination

```bash
# Initialize swarm
npx claude-flow@alpha swarm init --topology mesh

# Spawn agents with SAFLA context
npx claude-flow@alpha agent spawn --type coder --context "Use SAFLA patterns"

# Share patterns in swarm memory
npx claude-flow@alpha memory store "swarm/patterns/api" "$(npx claude-flow@alpha memory search 'API' --namespace safla)" --namespace swarm
```

---

## 📊 Model Statistics

```bash
# Get domain distribution
npx claude-flow@alpha memory query "SELECT domain, COUNT(*) FROM patterns GROUP BY domain" --namespace safla

# Get confidence distribution
npx claude-flow@alpha memory query "SELECT ROUND(confidence, 1) as conf, COUNT(*) FROM patterns GROUP BY conf" --namespace safla

# Get top technologies
npx claude-flow@alpha memory query "SELECT tags FROM patterns LIMIT 100" --namespace safla | grep -o '"[^"]*"' | sort | uniq -c | sort -rn | head -20
```

---

## 🎓 Learning Path

### Beginner (Week 1)
1. Install model
2. Try basic search queries
3. Explore one domain in depth (start with self-learning)
4. Use patterns in one small project

### Intermediate (Week 2-3)
1. Use programmatic access with Node.js
2. Explore knowledge graph relationships
3. Filter by confidence and success rates
4. Integrate with Claude Flow hooks

### Advanced (Week 4+)
1. Build custom query functions
2. Combine patterns from multiple domains
3. Track pattern effectiveness in your projects
4. Contribute feedback for future model improvements

---

## 🆘 Troubleshooting

### Model Not Found

```bash
# Check if model exists
ls -lh ~/.swarm/memory.db

# If not, reinstall
cp /workspaces/claude-code-flow/docs/reasoningbank/models/safla/memory.db ~/.swarm/memory.db
```

### No Results Returned

```bash
# Check namespace
npx claude-flow@alpha memory search "your query" --namespace safla

# Try broader search
npx claude-flow@alpha memory search "optimization" --namespace safla
```

### Slow Queries

```bash
# Verify database is optimized
sqlite3 ~/.swarm/memory.db "PRAGMA optimize; VACUUM;"

# Check WAL mode is enabled
sqlite3 ~/.swarm/memory.db "PRAGMA journal_mode;"
# Expected: wal
```

---

## 📚 Next Steps

1. **Read Full Documentation**: See `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/README.md`
2. **Explore Validation Report**: See `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/validation-report.md`
3. **Review Training Details**: See `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/TRAINING_SUMMARY.md`
4. **Try Advanced Queries**: Experiment with SQL queries directly
5. **Integrate with Your Workflow**: Use hooks for automatic pattern retrieval

---

## 💡 Pro Tips

1. **Use Filters**: Combine `domain`, `confidence`, and `tags` for precise results
2. **Explore Graph**: Use `pattern_links` table to discover related patterns
3. **Track Success**: Note which patterns work best for your use cases
4. **Start Broad**: Begin with general searches, then refine
5. **Learn Progressively**: Start with low-confidence patterns, work up to expert level

---

## 🔗 Resources

- **ReasoningBank CLI**: `npx claude-flow@alpha memory --help`
- **GitHub**: https://github.com/ruvnet/claude-flow
- **Full README**: `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/README.md`

---

**Happy Learning with SAFLA! 🎉**

The model is ready to help you become more self-aware and continuously improve your development practices.
