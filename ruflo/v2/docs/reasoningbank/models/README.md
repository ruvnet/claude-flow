# Pre-Trained ReasoningBank Models

Welcome to the ReasoningBank model zoo! This directory contains 5 production-ready, pre-trained models with thousands of optimized patterns for immediate use.

## 🚀 Quick Start

```bash
# Choose a model
cd safla  # or google-research, code-reasoning, problem-solving, domain-expert

# Install it
cp memory.db ~/.swarm/memory.db

# Try it!
npx claude-flow@alpha memory query "your question here" --reasoningbank
```

**That's it!** You now have expert-level patterns ready to use.

---

## 📦 Available Models

### 1. SAFLA (Self-Aware Feedback Loop Algorithm)
**Best for**: Self-learning systems that improve from experience

- **Patterns**: 2,000
- **Size**: 10.35 MB
- **Confidence**: 83.8% average
- **Success Rate**: 90.3% average
- **Specialties**:
  - Self-learning patterns
  - Feedback loop optimization
  - Bayesian confidence adjustment
  - Success/failure distillation
  - Recursive improvement cycles

**Use when**: Building agents that learn automatically, no retraining needed

```bash
cp safla/memory.db ~/.swarm/memory.db
```

### 2. Google Research (Strategy-Level Memory)
**Best for**: Following latest AI research best practices

- **Patterns**: 3,000
- **Size**: 8.92 MB
- **Confidence**: 88% average
- **Paper**: [arXiv:2509.25140](https://arxiv.org/abs/2509.25140)
- **Specialties**:
  - Strategy-level memory (40% from failures!)
  - MaTTS parallel & sequential scaling
  - Closed-loop learning
  - Success AND failure patterns
  - Research-backed approaches

**Use when**: Implementing cutting-edge AI research

```bash
cp google-research/memory.db ~/.swarm/memory.db
```

### 3. Code Reasoning (Programming Best Practices)
**Best for**: Software development and code generation

- **Patterns**: 2,500
- **Size**: 2.66 MB
- **Confidence**: 91.5% average
- **Success Rate**: 91.2% average
- **Specialties**:
  - Design patterns & architecture (SOLID, MVC, microservices)
  - Algorithm optimization (O(n²) → O(n))
  - Code quality & refactoring (DRY, KISS, clean code)
  - Language-specific patterns (JS, Python, Go, Rust, Java)
  - Debugging & error handling

**Use when**: Code generation, review, or refactoring

```bash
cp code-reasoning/.swarm/memory.db ~/.swarm/memory.db
```

### 4. Problem Solving (Cognitive Diversity)
**Best for**: General reasoning and problem analysis

- **Patterns**: 2,000
- **Size**: 5.85 MB
- **Confidence**: 83.7% average
- **Success Rate**: 84.6% average
- **Specialties**:
  - Convergent thinking (logical, systematic)
  - Divergent thinking (creative, exploratory)
  - Lateral thinking (pattern-breaking, unconventional)
  - Systems thinking (holistic, emergent behavior)
  - Critical thinking (bias detection, validation)

**Use when**: Complex problems requiring multiple reasoning approaches

```bash
cp problem-solving/memory.db ~/.swarm/memory.db
```

### 5. Domain Expert (Multi-Domain Expertise)
**Best for**: Specialized technical domains

- **Patterns**: 1,500
- **Size**: 2.39 MB
- **Confidence**: 89.4% average
- **Success Rate**: 88.5% average
- **Domains**:
  - DevOps & Infrastructure (CI/CD, Kubernetes, monitoring)
  - Data Engineering & ML (ETL, MLOps, feature engineering)
  - Security & Compliance (GDPR, SOC2, encryption)
  - API Design & Integration (REST, GraphQL, webhooks)
  - Performance & Scalability (caching, load balancing, CDN)

**Use when**: Domain-specific expertise needed

```bash
cp domain-expert/memory.db ~/.swarm/memory.db
```

---

## 📊 Model Comparison

| Model | Patterns | Size | Avg Confidence | Use Case |
|-------|----------|------|----------------|----------|
| SAFLA | 2,000 | 10.35 MB | 83.8% | Self-learning systems |
| Google Research | 3,000 | 8.92 MB | 88.0% | Research best practices |
| Code Reasoning | 2,500 | 2.66 MB | 91.5% | Software development |
| Problem Solving | 2,000 | 5.85 MB | 83.7% | General reasoning |
| Domain Expert | 1,500 | 2.39 MB | 89.4% | Technical expertise |

---

## 🎯 How to Choose

**I want to...**
- ✅ Build AI that learns from experience → **SAFLA**
- ✅ Follow latest research best practices → **Google Research**
- ✅ Generate/review code → **Code Reasoning**
- ✅ Solve complex problems → **Problem Solving**
- ✅ Get domain expertise → **Domain Expert**

**My project is...**
- 🤖 AI agent development → **SAFLA** or **Google Research**
- 💻 Software development → **Code Reasoning**
- 🧩 Problem-solving system → **Problem Solving**
- 🏗️ Infrastructure/DevOps → **Domain Expert**

---

## 📖 Documentation

Each model directory contains:
- **README.md** - Model overview and usage guide
- **memory.db** - Pre-trained database (ready to use!)
- **train-*.js** - Training script (see how it was made)
- **validation-report.md** - Quality validation results
- **TRAINING_SUMMARY.md** - Detailed training information

**General Guides:**
- [**HOW-TO-USE.md**](./HOW-TO-USE.md) - Installation and usage guide
- [**HOW-TO-TRAIN.md**](./HOW-TO-TRAIN.md) - Train your own models
- [**INDEX.md**](./INDEX.md) - Complete navigation index

**Technical Documentation:**
- [**_docs/**](./_docs/) - Technical references and completion reports
- [**_scripts/**](./_scripts/) - Utility scripts for validation and training

---

## 🔧 Advanced Usage

### Merge Multiple Models

```bash
# Combine patterns from multiple models
cp safla/memory.db ~/.swarm/memory.db

# Merge Google Research patterns
sqlite3 ~/.swarm/memory.db << SQL
ATTACH DATABASE 'google-research/memory.db' AS source;
INSERT OR IGNORE INTO patterns SELECT * FROM source.patterns;
INSERT OR IGNORE INTO pattern_embeddings SELECT * FROM source.pattern_embeddings;
DETACH DATABASE source;
SQL
```

### Project-Specific Models

```bash
# Use different models per project
mkdir ./my-project/.swarm
cp code-reasoning/.swarm/memory.db ./my-project/.swarm/

# Set environment variable
export CLAUDE_FLOW_DB_PATH=./my-project/.swarm/memory.db

# Or use --db-path flag
npx claude-flow@alpha memory query "test" --db-path ./my-project/.swarm/memory.db
```

### Query Examples

```bash
# Find patterns by domain
npx claude-flow@alpha memory query "API authentication" --namespace security

# High confidence only
npx claude-flow@alpha memory query "database optimization" --min-confidence 0.8

# Specific domain
sqlite3 ~/.swarm/memory.db "SELECT * FROM patterns WHERE domain = 'api-development' LIMIT 5"
```

---

## 🎓 Training Your Own Models

Want to create custom models? See [HOW-TO-TRAIN.md](./HOW-TO-TRAIN.md) for:
- Pattern generation strategies
- Embedding creation
- Relationship mapping
- Benchmarking & validation
- Parallel training with agents

**Training Scripts Provided:**
- `safla/train-safla.js` - 2,000 self-learning patterns
- `google-research/train-google.js` - 3,000 strategy patterns
- `code-reasoning/train-code.js` - 2,500 programming patterns
- `problem-solving/train-problem.js` - 2,000 reasoning patterns
- `domain-expert/train-domain.js` - 1,500 domain patterns

---

## ✅ Quality Assurance

All models have been:
- ✅ Validated for schema compliance
- ✅ Benchmarked for performance (<5ms queries)
- ✅ Tested for data quality (>70% confidence)
- ✅ Optimized for storage efficiency (<10 KB/pattern)
- ✅ Verified for production readiness

**Run validation yourself:**

```bash
cd safla  # or any model directory
node ../_scripts/validation-suite.cjs . safla
```

---

## 🚀 Integration

### With agentic-flow

```javascript
import { AgenticFlow } from 'agentic-flow';

const agent = new AgenticFlow('coder', {
  reasoningBank: {
    enabled: true,
    dbPath: process.env.HOME + '/.swarm/memory.db',
    minConfidence: 0.7
  }
});

// Agent automatically uses ReasoningBank patterns
await agent.execute({ task: 'Implement JWT auth' });
```

### With Claude Code

```bash
# Load patterns as context
npx claude-flow@alpha memory query "authentication patterns" > context.json

# Use in Claude Code
claude code --context context.json "Implement auth"
```

### Direct SQL

```javascript
const Database = require('better-sqlite3');
const db = new Database(process.env.HOME + '/.swarm/memory.db');

const patterns = db.prepare(`
  SELECT * FROM patterns
  WHERE domain = ? AND confidence > 0.8
  ORDER BY success_rate DESC
  LIMIT 10
`).all('api-development');
```

---

## 🏆 Performance Benchmarks

All models meet or exceed these criteria:

| Metric | Target | All Models |
|--------|--------|------------|
| Query Latency | <5ms | ✅ 0.05-2ms |
| Storage | <10 KB/pattern | ✅ 2-6 KB/pattern |
| Confidence | >70% | ✅ 83-91% |
| Embedding Coverage | 100% | ✅ 100% |

---

## 📝 License

All models are MIT licensed and free to use in commercial and non-commercial projects.

---

## 🤝 Contributing

Want to contribute a model? See [HOW-TO-TRAIN.md](./HOW-TO-TRAIN.md) and submit a PR!

**Model submission requirements:**
- Minimum 1,000 patterns
- 100% embedding coverage
- >70% average confidence
- <10 KB per pattern
- Comprehensive README
- Validation report

---

## 💡 Support

- **Documentation**: See HOW-TO-USE.md and HOW-TO-TRAIN.md
- **Issues**: [GitHub Issues](https://github.com/ruvnet/claude-flow/issues)
- **Examples**: Check each model's README.md

---

**Happy reasoning!** 🧠✨

> _"The best AI doesn't just answer questions - it learns from experience."_
