# ReasoningBank Models - Complete Index

## 📚 Quick Navigation

| Document | Description | Audience |
|----------|-------------|----------|
| [**README.md**](./README.md) | Model overview and quick start | Everyone |
| [**HOW-TO-USE.md**](./HOW-TO-USE.md) | Installation and usage guide | Users |
| [**HOW-TO-TRAIN.md**](./HOW-TO-TRAIN.md) | Create your own models | Developers |
| [**_docs/**](./_docs/) | Technical documentation | Developers |
| [**_scripts/**](./_scripts/) | Utility scripts | Developers |

## 🎯 Models

| Model | Patterns | Best For | Directory |
|-------|----------|----------|-----------|
| **SAFLA** | 2,000 | Self-learning systems | [safla/](./safla/) |
| **Google Research** | 3,000 | Research best practices | [google-research/](./google-research/) |
| **Code Reasoning** | 2,500 | Software development | [code-reasoning/](./code-reasoning/) |
| **Problem Solving** | 2,000 | General reasoning | [problem-solving/](./problem-solving/) |
| **Domain Expert** | 1,500 | Technical expertise | [domain-expert/](./domain-expert/) |

## 📖 Documentation by Topic

### Getting Started
1. [Quick Start (30 seconds)](./README.md#quick-start)
2. [Choose Your Model](./README.md#how-to-choose)
3. [Install Model](./HOW-TO-USE.md#installation-methods)
4. [First Query](./HOW-TO-USE.md#usage-examples)

### Using Models
1. [Installation Methods](./HOW-TO-USE.md#installation-methods) - 4 ways to install
2. [Model Selection Guide](./HOW-TO-USE.md#model-selection-guide) - Which model for what?
3. [Usage Examples](./HOW-TO-USE.md#usage-examples) - CLI, JavaScript, Python
4. [Integration Patterns](./HOW-TO-USE.md#integration-patterns) - With agentic-flow, Claude Code
5. [Troubleshooting](./HOW-TO-USE.md#troubleshooting) - Common issues

### Training Models
1. [Quick Start Training](./HOW-TO-TRAIN.md#quick-start) - 100 patterns in minutes
2. [Training Architecture](./HOW-TO-TRAIN.md#training-architecture) - How it works
3. [Step-by-Step Guide](./HOW-TO-TRAIN.md#step-by-step-training) - Complete walkthrough
4. [Benchmarking & Validation](./HOW-TO-TRAIN.md#benchmarking--validation) - Quality assurance
5. [Advanced Techniques](./HOW-TO-TRAIN.md#advanced-techniques) - Parallel training, merging

### Tools & Scripts
| Script | Purpose | Usage |
|--------|---------|-------|
| `schema-validator.cjs` | Validate/fix database schema | `node _scripts/schema-validator.cjs <db> fix` |
| `validation-suite.cjs` | Comprehensive quality checks | `node _scripts/validation-suite.cjs <model> <name>` |
| `benchmark-all.cjs` | Performance benchmarks | `node _scripts/benchmark-all.cjs` |
| `training-coordinator.cjs` | Multi-agent training | Used by training agents |

See [_scripts/README.md](./_scripts/README.md) for detailed documentation.

## 🎓 Tutorials

### Tutorial 1: Install and Use a Model (5 minutes)
```bash
# 1. Choose model
cd /workspaces/claude-code-flow/docs/reasoningbank/models/safla

# 2. Copy to claude-flow
cp memory.db ~/.swarm/memory.db

# 3. Try it
npx claude-flow@alpha memory query "API optimization best practices"
```

### Tutorial 2: Merge Multiple Models (10 minutes)
See [HOW-TO-USE.md - Method 2: Merge Multiple Models](./HOW-TO-USE.md#method-2-merge-multiple-models)

### Tutorial 3: Create Custom Model (30 minutes)
See [HOW-TO-TRAIN.md - Create a Simple Model](./HOW-TO-TRAIN.md#create-a-simple-model-100-patterns)

### Tutorial 4: Integrate with Agentic-Flow (15 minutes)
See [HOW-TO-USE.md - Pattern 1: Agentic-Flow Integration](./HOW-TO-USE.md#pattern-1-agentic-flow-integration)

## 📊 Model Details

### SAFLA (Self-Aware Feedback Loop Algorithm)
- **📁 Location**: [safla/](./safla/)
- **📚 Documentation**: [safla/README.md](./safla/README.md)
- **🎯 Patterns**: 2,000
- **💾 Size**: 10.35 MB
- **📈 Confidence**: 83.8%
- **✅ Success Rate**: 90.3%
- **🔧 Training Script**: [safla/train-safla.js](./safla/train-safla.js)

**Pattern Categories:**
- Self-learning patterns (400)
- Feedback loop optimization (400)
- Confidence adjustment (400)
- Success/failure distillation (400)
- Recursive improvement (400)

### Google Research (Strategy-Level Memory)
- **📁 Location**: [google-research/](./google-research/)
- **📚 Documentation**: [google-research/README.md](./google-research/README.md)
- **🎯 Patterns**: 3,000
- **💾 Size**: 8.92 MB
- **📈 Confidence**: 88.0%
- **📄 Paper**: [arXiv:2509.25140](https://arxiv.org/abs/2509.25140)
- **🔧 Training Script**: [google-research/train-google.js](./google-research/train-google.js)

**Pattern Categories:**
- Success strategies (600)
- Failure learnings (600)
- MaTTS parallel (600)
- MaTTS sequential (600)
- Closed-loop learning (600)

### Code Reasoning (Programming Best Practices)
- **📁 Location**: [code-reasoning/](./code-reasoning/)
- **📚 Documentation**: [code-reasoning/README.md](./code-reasoning/README.md)
- **🎯 Patterns**: 2,500
- **💾 Size**: 2.66 MB
- **📈 Confidence**: 91.5%
- **✅ Success Rate**: 91.2%
- **🔧 Training Script**: [code-reasoning/train-code.js](./code-reasoning/train-code.js)

**Pattern Categories:**
- Design patterns & architecture (500)
- Algorithm optimization (500)
- Code quality & refactoring (500)
- Language-specific practices (500)
- Debugging & error handling (500)

### Problem Solving (Cognitive Diversity)
- **📁 Location**: [problem-solving/](./problem-solving/)
- **📚 Documentation**: [problem-solving/README.md](./problem-solving/README.md)
- **🎯 Patterns**: 2,000
- **💾 Size**: 5.85 MB
- **📈 Confidence**: 83.7%
- **✅ Success Rate**: 84.6%
- **🔧 Training Script**: [problem-solving/train-problem.js](./problem-solving/train-problem.js)

**Pattern Categories:**
- Convergent thinking (400)
- Divergent thinking (400)
- Lateral thinking (400)
- Systems thinking (400)
- Critical thinking (400)

### Domain Expert (Multi-Domain Expertise)
- **📁 Location**: [domain-expert/](./domain-expert/)
- **📚 Documentation**: [domain-expert/README.md](./domain-expert/README.md)
- **🎯 Patterns**: 1,500
- **💾 Size**: 2.39 MB
- **📈 Confidence**: 89.4%
- **✅ Success Rate**: 88.5%
- **🔧 Training Script**: [domain-expert/train-domain.js](./domain-expert/train-domain.js)

**Domains:**
- DevOps & Infrastructure (300)
- Data Engineering & ML (300)
- Security & Compliance (300)
- API Design & Integration (300)
- Performance & Scalability (300)

## 🎯 Use Case Matrix

| Your Need | Recommended Model(s) | Why |
|-----------|---------------------|-----|
| AI agent that learns | SAFLA | Self-improvement without retraining |
| Follow research best practices | Google Research | Based on latest AI research paper |
| Code generation | Code Reasoning | 2,500 programming patterns |
| Code review | Code Reasoning | Design patterns, anti-patterns |
| Algorithm optimization | Code Reasoning | O(n) improvements, caching |
| Complex problem solving | Problem Solving | 5 cognitive approaches |
| Debugging | Code Reasoning | Common bugs, edge cases |
| API development | Domain Expert + Code Reasoning | Combined expertise |
| DevOps/Infrastructure | Domain Expert | Kubernetes, CI/CD, monitoring |
| Security implementation | Domain Expert | GDPR, encryption, auth |
| Performance tuning | Domain Expert | Caching, load balancing |
| Multi-step reasoning | Problem Solving | Task trajectories |
| Strategic planning | Google Research | Strategy-level memory |

## 🔧 Common Tasks

### Task: Install a model
**Guide**: [HOW-TO-USE.md - Quick Start](./HOW-TO-USE.md#quick-start)
**Time**: 30 seconds

### Task: Query patterns
**Guide**: [HOW-TO-USE.md - Usage Examples](./HOW-TO-USE.md#usage-examples)
**Example**:
```bash
npx claude-flow@alpha memory query "JWT authentication" --reasoningbank
```

### Task: Merge models
**Guide**: [HOW-TO-USE.md - Merge Multiple Models](./HOW-TO-USE.md#method-2-merge-multiple-models)
**Time**: 5 minutes

### Task: Train custom model
**Guide**: [HOW-TO-TRAIN.md - Quick Start](./HOW-TO-TRAIN.md#quick-start)
**Time**: 30-60 minutes

### Task: Validate model quality
**Command**: `node _scripts/validation-suite.cjs <model-dir> <model-name>`
**Time**: 1 minute

### Task: Benchmark performance
**Command**: `node _scripts/benchmark-all.cjs`
**Time**: 2-3 minutes

## 🚀 Advanced Topics

### Parallel Training with Agents
See [HOW-TO-TRAIN.md - Parallel Training](./HOW-TO-TRAIN.md#parallel-training-with-agents)

### Memory Coordination
See [HOW-TO-TRAIN.md - Memory Coordination](./HOW-TO-TRAIN.md#memory-coordination)

### Incremental Training
See [HOW-TO-TRAIN.md - Incremental Training](./HOW-TO-TRAIN.md#incremental-training)

### Custom Embeddings
See [HOW-TO-TRAIN.md - Step 3: Create Embeddings](./HOW-TO-TRAIN.md#step-3-create-embeddings)

### Pattern Linking
See [HOW-TO-TRAIN.md - Step 4: Create Pattern Links](./HOW-TO-TRAIN.md#step-4-create-pattern-links)

## 📈 Performance Standards

All models meet these production criteria:

| Metric | Standard | Typical Performance |
|--------|----------|---------------------|
| **Query Latency** | <5ms | 0.05-2ms ✅ |
| **Storage Efficiency** | <10 KB/pattern | 2-6 KB/pattern ✅ |
| **Avg Confidence** | >70% | 83-91% ✅ |
| **Embedding Coverage** | 100% | 100% ✅ |
| **Pattern Count** | >1,000 | 1,500-3,000 ✅ |
| **Domain Coverage** | >3 domains | 5-6 domains ✅ |

## 🤝 Contributing

Want to contribute a model? We'd love to have it!

**Requirements:**
1. ✅ Minimum 1,000 unique patterns
2. ✅ 100% embedding coverage
3. ✅ >70% average confidence
4. ✅ <10 KB per pattern
5. ✅ Comprehensive README.md
6. ✅ Validation report
7. ✅ Training script included

**Submission Process:**
1. Create model using [HOW-TO-TRAIN.md](./HOW-TO-TRAIN.md)
2. Run validation: `node _scripts/validation-suite.cjs your-model your-model-name`
3. Create PR with model directory
4. Include README.md and validation report

## 📝 License

All models are MIT licensed and free for commercial/non-commercial use.

## 💡 Support

- **Documentation Issues**: Open issue on GitHub
- **Model Questions**: See model-specific README.md
- **Training Help**: [HOW-TO-TRAIN.md](./HOW-TO-TRAIN.md)
- **Usage Help**: [HOW-TO-USE.md](./HOW-TO-USE.md)

---

**Last Updated**: 2025-10-15
**Total Models**: 5
**Total Patterns**: 11,000
**Total Storage**: 29.17 MB

---

**Happy reasoning!** 🧠✨
