# 📚 Claude-Flow Documentation

Welcome to the Claude-Flow documentation! This directory contains comprehensive guides and references for using Claude-Flow v2.7.0.

## 📖 Core Documentation

| Document | Description |
|----------|-------------|
| [INDEX.md](INDEX.md) | Complete documentation hub with navigation and quick start |
| [USER_GUIDE.md](USER_GUIDE.md) | Comprehensive user guide with tutorials and examples |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | Complete API reference with all 112 MCP tools |
| [AGENTS.md](AGENTS.md) | All 65+ agent types with capabilities and usage |
| [SWARM.md](SWARM.md) | Swarm intelligence, topologies, and coordination |
| [SPARC.md](SPARC.md) | SPARC methodology with all 17 development modes |
| [MCP_TOOLS.md](MCP_TOOLS.md) | Detailed reference for all MCP tools |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture and design patterns |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment guides for Docker, K8s, Cloud |
| [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) | Development setup and contribution guide |

## 📁 Documentation Categories

### 🚀 [Releases](./releases/)
Release notes, changelogs, and version documentation
- [v2.7.1](./releases/v2.7.1/) - Current stable release
- [v2.7.0-alpha.10](./releases/v2.7.0-alpha.10/) - Alpha release notes
- [v2.7.0-alpha.9](./releases/v2.7.0-alpha.9/) - Previous alpha release
- [Alpha Tag Updates](./releases/ALPHA_TAG_UPDATE.md) - Alpha versioning guide

### 🧠 [AgentDB Integration](./agentdb/)
AgentDB v1.3.9 integration documentation (96x-164x performance boost)
- [Implementation Complete](./agentdb/SWARM_IMPLEMENTATION_COMPLETE.md) - 3-agent swarm details
- [Integration Plan](./agentdb/AGENTDB_INTEGRATION_PLAN.md) - Planning and design
- [Backward Compatibility](./agentdb/BACKWARD_COMPATIBILITY_GUARANTEE.md) - 100% compatibility guarantee
- [Publishing Checklist](./agentdb/PUBLISHING_CHECKLIST.md) - Pre-release verification
- [Integration Summary](./agentdb/agentdb-integration-summary.md) - Quick overview
- [Production Readiness](./agentdb/PRODUCTION_READINESS.md) - Deployment guide
- [Optimization Report](./agentdb/OPTIMIZATION_REPORT.md) - Performance analysis

### ⚡ [Performance](./performance/)
Performance optimization guides, metrics, and benchmarks
- [JSON Improvements](./performance/PERFORMANCE-JSON-IMPROVEMENTS.md) - JSON optimization results
- [Metrics Guide](./performance/PERFORMANCE-METRICS-GUIDE.md) - Performance tracking and analysis

### 🔧 [Bug Fixes](./fixes/)
Bug fix documentation and patch reports
- [Pattern Persistence Fix](./fixes/PATTERN_PERSISTENCE_FIX.md) - v2.7.1 critical fix
- [Pattern Fix Confirmation](./fixes/PATTERN_FIX_CONFIRMATION.md) - Verification and testing
- [CLI Memory Commands](./fixes/CLI-MEMORY-COMMANDS-WORKING.md) - Memory command fixes

### 🛠️ [Development](./development/)
Internal development reports and implementation details
- [Agent 1 Completion Report](./development/AGENT1_COMPLETION_REPORT.md) - AgentDB integration agent
- [Final Init Structure](./development/FINAL_INIT_STRUCTURE.md) - Initialization architecture
- [Commands to Skills Migration](./development/COMMANDS_TO_SKILLS_MIGRATION.md) - Migration guide

### ✅ [Validation](./validation/)
Test reports and validation results
- [Docker Verification Report](./validation/DOCKER_VERIFICATION_REPORT.md) - Docker testing results

### 📚 [User Guides](./guides/)
Tutorials and learning resources
- [Skills Tutorial](./guides/skills-tutorial.md) - Complete guide to 25 Claude Flow skills

### 🔌 [Integrations](./integrations/)
Third-party platform integrations
- **ReasoningBank** (16 docs) - AI reasoning integration
- **Agentic Flow** (5 docs) - Agent flow system
- **Agent Booster** - Performance optimization
- **Epic SDK** - SDK integration

### 🏗️ Additional Resources
- [Architecture](./architecture/) - System architecture documentation
- [Experimental](./experimental/) - Experimental features
- [Reference](./reference/) - API and command reference
- [Setup](./setup/) - Setup and configuration guides
- [CI/CD](./ci-cd/) - Continuous integration workflows
- [SDK](./sdk/) - SDK documentation
- [Wiki](./wiki/) - Additional documentation

## 🚀 Quick Links

- **Getting Started**: See [USER_GUIDE.md](USER_GUIDE.md#getting-started)
- **API Reference**: See [API_DOCUMENTATION.md](API_DOCUMENTATION.md)
- **Agent Catalog**: See [AGENTS.md](AGENTS.md)
- **Deployment**: See [DEPLOYMENT.md](DEPLOYMENT.md)
- **Skills Tutorial**: See [Skills Tutorial](./guides/skills-tutorial.md)
- **AgentDB Integration**: See [AgentDB](./agentdb/)

## 🎯 By User Type

### 👨‍💻 **Developers**
1. [Quick Start Guide](../README.md#-quick-start) - Get up and running
2. [Skills Tutorial](./guides/skills-tutorial.md) - Natural language skill activation
3. [SPARC Development](SPARC.md) - Structured development methodology
4. [API Reference](API_DOCUMENTATION.md) - Complete endpoint documentation

### 🏢 **DevOps/Operations**
1. [Deployment Guide](DEPLOYMENT.md) - Production deployment
2. [Architecture Overview](ARCHITECTURE.md) - System design
3. [Docker Verification](./validation/DOCKER_VERIFICATION_REPORT.md) - Testing reports

### 👑 **Technical Leaders**
1. [System Architecture](ARCHITECTURE.md#system-overview) - High-level design
2. [Performance Metrics](./performance/) - Benchmarks and optimization
3. [AgentDB Integration](./agentdb/) - 96x-164x performance improvements

## 📊 Performance Highlights

- **96x-164x faster search** - AgentDB vector search improvements
- **4-32x memory reduction** - Quantization benefits
- **84.8% SWE-Bench solve rate** - Industry-leading performance
- **32.3% token reduction** - Efficient context management
- **2.8-4.4x speed improvement** - Parallel coordination

## 📞 Support

- **GitHub Issues**: https://github.com/ruvnet/claude-flow/issues
- **Discord**: Join our community for real-time help
- **Documentation Updates**: PRs welcome!

---

*Last Updated: January 2025 | Version: v2.7.1*
