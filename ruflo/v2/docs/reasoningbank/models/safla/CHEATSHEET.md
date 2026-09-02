# SAFLA Model - Quick Reference Cheatsheet

## 🚀 Installation (One Command)

```bash
cp /workspaces/claude-code-flow/docs/reasoningbank/models/safla/memory.db ~/.swarm/memory.db
```

---

## 🔍 Search Patterns (Most Common Queries)

### Basic Search
```bash
npx claude-flow@alpha memory search "YOUR_QUERY" --namespace safla
```

### By Domain (5 categories)
```bash
# Self-learning patterns (confidence evolution)
npx claude-flow@alpha memory search "API optimization" --domain self-learning

# Feedback loops (user/system feedback)
npx claude-flow@alpha memory search "feedback" --domain feedback-optimization

# Bayesian confidence (probability updates)
npx claude-flow@alpha memory search "uncertainty" --domain confidence-adjustment

# Success/failure learning (distillation)
npx claude-flow@alpha memory search "deployment success" --domain distillation

# Meta-learning (recursive improvement)
npx claude-flow@alpha memory search "meta-learning" --domain recursive-cycles
```

### By Confidence Level
```bash
# Expert patterns (0.9-0.95)
npx claude-flow@alpha memory retrieve "confidence:>0.90" --namespace safla

# High confidence (0.8-0.9)
npx claude-flow@alpha memory retrieve "confidence:>0.80" --namespace safla

# Learning patterns (0.5-0.7)
npx claude-flow@alpha memory retrieve "confidence:<0.70" --namespace safla
```

### By Technology
```bash
npx claude-flow@alpha memory search "Node.js optimization" --namespace safla
npx claude-flow@alpha memory search "PostgreSQL patterns" --namespace safla
npx claude-flow@alpha memory search "Kubernetes deployment" --namespace safla
npx claude-flow@alpha memory search "React performance" --namespace safla
```

---

## 📊 Quick Stats (SQL Queries)

```bash
# Pattern count by domain
sqlite3 ~/.swarm/memory.db "SELECT domain, COUNT(*) FROM patterns GROUP BY domain;"

# Top 10 highest confidence patterns
sqlite3 ~/.swarm/memory.db "SELECT description, confidence FROM patterns ORDER BY confidence DESC LIMIT 10;"

# Top 10 highest success rate patterns
sqlite3 ~/.swarm/memory.db "SELECT description, success_rate FROM patterns ORDER BY success_rate DESC LIMIT 10;"

# Knowledge graph relationships
sqlite3 ~/.swarm/memory.db "SELECT relationship, COUNT(*) FROM pattern_links GROUP BY relationship;"
```

---

## 🎯 Use Case Quick Reference

| Task | Command |
|------|---------|
| **API Development** | `npx claude-flow@alpha memory search "API endpoint optimization" --namespace safla` |
| **Code Review** | `npx claude-flow@alpha memory search "code review feedback" --namespace safla` |
| **Debugging** | `npx claude-flow@alpha memory search "error recovery" --namespace safla` |
| **Performance** | `npx claude-flow@alpha memory search "performance optimization" --namespace safla` |
| **Architecture** | `npx claude-flow@alpha memory search "architecture refinement" --namespace safla` |
| **Testing** | `npx claude-flow@alpha memory search "test suite evolution" --namespace safla` |
| **Deployment** | `npx claude-flow@alpha memory search "deployment success" --namespace safla` |
| **CI/CD** | `npx claude-flow@alpha memory search "CI/CD pipeline optimization" --namespace safla` |
| **Monitoring** | `npx claude-flow@alpha memory search "monitoring feedback loop" --namespace safla` |

---

## 🧠 Pattern Categories Quick Reference

| Domain | Patterns | Confidence | Use For |
|--------|----------|------------|---------|
| **self-learning** | 400 | 0.55-0.85 | Learning from system behavior |
| **feedback-optimization** | 400 | 0.60-0.90 | Incorporating feedback |
| **confidence-adjustment** | 400 | 0.65-0.95 | Bayesian confidence updates |
| **distillation** | 400 | 0.70-0.92 | Success/failure learning |
| **recursive-cycles** | 400 | 0.75-0.95 | Meta-learning, self-improvement |

---

## 🔗 Integration with Claude Flow Hooks

```bash
# Before task (get relevant patterns)
npx claude-flow@alpha hooks pre-task --description "API optimization"
npx claude-flow@alpha memory search "API optimization" --namespace safla

# After editing (store pattern usage)
npx claude-flow@alpha hooks post-edit --file "src/api.ts" --memory-key "swarm/safla/api"

# After task (record success)
npx claude-flow@alpha hooks post-task --task-id "api-opt-123"
```

---

## 💻 Node.js Quick Access

```javascript
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const db = new Database(join(homedir(), '.swarm', 'memory.db'), { readonly: true });

// Get high-confidence patterns
const patterns = db.prepare(`
  SELECT * FROM patterns
  WHERE confidence >= 0.85 AND domain = ?
  ORDER BY success_rate DESC
  LIMIT 10
`).all('self-learning');

// Get related patterns
const related = db.prepare(`
  SELECT p.*, pl.relationship
  FROM patterns p
  JOIN pattern_links pl ON p.id = pl.target_id
  WHERE pl.source_id = ?
`).all(patternId);

db.close();
```

---

## 🎲 Confidence Level Guide

| Level | Range | Count | Description |
|-------|-------|-------|-------------|
| **Learning** | 0.5-0.6 | 28 | Early learning phase |
| **Medium** | 0.6-0.7 | 184 | Gaining experience |
| **High** | 0.7-0.8 | 455 | Experienced |
| **Very High** | 0.8-0.9 | 632 | Highly confident |
| **Expert** | 0.9-0.95 | 701 | Expert level |

---

## 📈 Model Stats At-A-Glance

| Metric | Value |
|--------|-------|
| **Total Patterns** | 2,000 |
| **Embeddings** | 2,000 (1024-dim) |
| **Knowledge Links** | 3,999 |
| **Avg Confidence** | 0.838 |
| **Avg Success** | 0.903 |
| **Database Size** | 10.35 MB |
| **Query Latency** | 0.02-0.05ms |

---

## 🛠️ Troubleshooting One-Liners

```bash
# Verify model installed
ls -lh ~/.swarm/memory.db

# Check pattern count
sqlite3 ~/.swarm/memory.db "SELECT COUNT(*) FROM patterns;"

# Test query performance
time npx claude-flow@alpha memory search "test" --namespace safla

# Optimize database
sqlite3 ~/.swarm/memory.db "PRAGMA optimize; VACUUM;"

# Check WAL mode
sqlite3 ~/.swarm/memory.db "PRAGMA journal_mode;"
```

---

## 📚 Documentation Locations

| Document | Path |
|----------|------|
| **Quick Start** | `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/QUICKSTART.md` |
| **Full README** | `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/README.md` |
| **Training Report** | `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/TRAINING_SUMMARY.md` |
| **Validation Report** | `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/validation-report.md` |
| **This Cheatsheet** | `/workspaces/claude-code-flow/docs/reasoningbank/models/safla/CHEATSHEET.md` |

---

## 🎯 Top 10 Most Useful Patterns (By Confidence)

```bash
sqlite3 ~/.swarm/memory.db "
SELECT description, confidence, success_rate
FROM patterns
ORDER BY confidence DESC, success_rate DESC
LIMIT 10;
"
```

---

## 🔗 Knowledge Graph Quick Queries

```bash
# Get all relationships
sqlite3 ~/.swarm/memory.db "SELECT DISTINCT relationship FROM pattern_links;"

# Find patterns that CAUSE others
sqlite3 ~/.swarm/memory.db "
SELECT p.description
FROM patterns p
JOIN pattern_links pl ON p.id = pl.source_id
WHERE pl.relationship = 'causes'
LIMIT 10;
"

# Find patterns that ENHANCE others
sqlite3 ~/.swarm/memory.db "
SELECT p.description
FROM patterns p
JOIN pattern_links pl ON p.id = pl.source_id
WHERE pl.relationship = 'enhances'
ORDER BY pl.strength DESC
LIMIT 10;
"
```

---

## 💡 Pro Tips

1. **Start Broad**: Begin with general searches, refine with filters
2. **Use High Confidence**: Filter by `confidence:>0.85` for production
3. **Explore Graph**: Follow `pattern_links` for related patterns
4. **Track Success**: Note which patterns work best for you
5. **Combine Domains**: Use patterns from multiple categories together

---

## 📞 Quick Help

```bash
# ReasoningBank CLI help
npx claude-flow@alpha memory --help

# GitHub Issues
https://github.com/ruvnet/claude-flow/issues

# Model location
~/.swarm/memory.db
```

---

**Remember**: The SAFLA model learns with you. Start with learning-level patterns, progress to expert patterns as you gain experience!

🎉 **Happy Learning!**
