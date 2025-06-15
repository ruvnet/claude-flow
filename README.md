# 🌊 Claude-Flow: AI Agent Orchestration Platform

<div align="center">

[![NPM Package](https://img.shields.io/npm/v/claude-flow?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/claude-flow)
[![Test Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen?style=for-the-badge)](./test-results/coverage-html/index.html)
[![Documentation](https://img.shields.io/badge/docs-comprehensive-green?style=for-the-badge)](./docs/)

**Orchestrate parallel AI agents with persistent memory and enterprise-grade reliability**

[Get Started](#-quick-start) • [Features](#-why-claude-flow) • [Docs](./docs/) • [Examples](#-example-workflows)

</div>

## 🚀 Quick Start

```bash
# 1. Install Claude Code (required)
npm install -g @anthropic-ai/claude-code

# 2. Initialize Claude-Flow
npx -y claude-flow@latest init --sparc

# 3. Start orchestrating
./claude-flow sparc "build my application"
```

## 🎯 Why Claude-Flow?

Claude-Flow transforms how you work with AI by enabling:

- **🐝 Parallel AI Agents** - Run multiple Claude instances simultaneously without timeouts
- **🧠 Persistent Memory** - Agents share knowledge across sessions
- **⚡ SPARC Methodology** - Systematic development from specification to completion
- **🤖 Autonomous Intelligence** - Self-directing AI with 85%+ autonomous decision-making
- **🔒 Enterprise Ready** - Production-grade security, monitoring, and compliance

## 📋 Core Capabilities

### 1. SPARC Development Workflow
```bash
# Orchestrate complete development cycle
./claude-flow sparc "build authentication system"

# Or run specific phases
./claude-flow sparc run architect "design microservices"
./claude-flow sparc run tdd "implement user auth"
./claude-flow sparc run security-review "audit endpoints"
```

### 2. Swarm Orchestration
```bash
# Deploy specialized agent teams
./claude-flow swarm "Build REST API" --strategy development --monitor
./claude-flow swarm "Research AI trends" --strategy research --ui
```

### 3. Memory Management
```bash
# Store and query persistent knowledge
./claude-flow memory store insights "API uses JWT with refresh tokens"
./claude-flow memory query "authentication approach"
```

### 4. TaskMaster AI Project Management 🆕
```bash
# Initialize TaskMaster with autonomous features
./claude-flow taskmaster init --with-ai --enterprise --autonomous

# Natural language project creation
./claude-flow taskmaster intent process "Create mobile app project with 8 developers, 
  $500k budget, 6 months timeline, iOS/Android support"

# Start autonomous management
./claude-flow taskmaster autonomous start --project PROJECT-123 --autonomy 0.8
```

## 🎯 Example Workflows

### Feature Development with SPARC
```bash
# Complete feature with SPARC methodology
./claude-flow sparc "implement payment processing"

# Monitor progress
./claude-flow monitor
```

### Autonomous Project Management
```bash
# Generate tasks from requirements
./claude-flow taskmaster generate-from-prd requirements.md \
  --ai-enhanced --sparc-mapping --assign-agents

# Enable autonomous operations
./claude-flow taskmaster autonomous start --learning
./claude-flow taskmaster self-improve start
./claude-flow taskmaster global-sync start

# Monitor autonomous decisions
./claude-flow taskmaster autonomous decisions --detailed
```

### Predictive Intelligence
```bash
# Project success prediction
./claude-flow taskmaster predict project-success PROJECT-123 \
  --horizon quarters --scenarios

# Resource demand forecasting
./claude-flow taskmaster predict resource-demand \
  --organization ORG-456 --timeframe quarters

# Risk assessment
./claude-flow taskmaster predict risks PROJECT-789 \
  --categories "technical,schedule,budget"
```

### Team Collaboration
```bash
# Create collaboration session
./claude-flow taskmaster collaboration session create PROJECT-123 \
  --max-users 10 --conflict-mode ai-assisted

# Real-time team analytics
./claude-flow taskmaster analytics team TEAM-456 \
  --timeframe 90 --benchmarks
```

### Enterprise Integration
```bash
# Setup bidirectional Jira sync
./claude-flow taskmaster integrations setup jira \
  --bidirectional --ai-mapping --webhook

# Sync with GitHub
./claude-flow taskmaster integrations sync github \
  --direction bidirectional --resolve-conflicts
```

## 🛠️ Key Commands

### Core Operations
- `init --sparc` - Initialize with SPARC development modes
- `start --ui` - Launch with interactive process manager
- `sparc <task>` - Run SPARC orchestration
- `swarm <objective>` - Deploy agent swarm

### TaskMaster AI Features
- `taskmaster init --autonomous` - Setup autonomous AI management
- `taskmaster intent process` - Natural language commands
- `taskmaster predict` - AI-powered predictions
- `taskmaster ml train` - Custom ML model training
- `taskmaster autonomous status` - Monitor AI operations

### System Management
- `agent spawn <type>` - Create specialized agent
- `memory query <search>` - Search knowledge base
- `monitor` - Real-time system monitoring
- `status` - System health check

[Full CLI Reference →](./docs/cli-reference.md)

## 🤖 TaskMaster Autonomous Features

### Self-Directing Intelligence
```bash
# AI handles 85% of decisions autonomously
./claude-flow taskmaster autonomous start --autonomy 0.85

# View recent decisions
./claude-flow taskmaster autonomous decisions --detailed
```

### Machine Learning Platform
```bash
# Train on your data
./claude-flow taskmaster ml train project-history.json \
  --model-type effort_estimation --privacy-mode

# Get predictions with explanations
./claude-flow taskmaster ml predict new-task.json \
  --model effort-v2 --explain
```

### Global Synchronization
```bash
# Sub-500ms worldwide sync
./claude-flow taskmaster global-sync start
./claude-flow taskmaster global-sync status --regions
```

## 📈 Real-World Results

**Enterprise Software (500 employees):**
- Project delivery: 67% → **94% on-time** ⬆️ 40%
- Budget accuracy: ±23% → **±5% variance** ⬆️ 350%
- Team utilization: 68% → **89%** ⬆️ 31%

**Startup Team (25 people):**
- Delivered MVP **2 weeks early**
- **Under budget by $43k**
- **Zero critical bugs** in production

[View Case Studies →](./docs/taskmaster-case-studies.md)

## 📖 Documentation

- [Getting Started](./docs/01-getting-started.md) - Installation and first steps
- [SPARC Methodology](./docs/sparc.md) - Development workflow guide
- [Swarm System](./docs/09-swarm-system.md) - Multi-agent coordination
- [TaskMaster Integration](./docs/13-taskmaster-integration.md) - AI project management
- [CLI Reference](./docs/cli-reference.md) - Complete command documentation

## 🚦 Latest Updates

- **v1.0.53** - Autonomous AI project management with 85%+ decision automation
- **v1.0.52** - Enterprise ML platform and real-time collaboration
- **v1.0.51** - Multi-provider AI support (Anthropic, OpenAI, Google, etc.)

[View Changelog →](./CHANGELOG.md)

## 🤝 Contributing

We welcome contributions! See [Contributing Guide](CONTRIBUTING.md).

## 📄 License

MIT License - see [LICENSE](LICENSE).

---

<div align="center">
Built with ❤️ by <a href="https://github.com/ruvnet">rUv</a> for the Claude community
</div>