# 🌊 Claude-Flow: Agent Orchestration Platform for Claude-Code 

<div align="center">

[![🌟 Star on GitHub](https://img.shields.io/github/stars/ruvnet/claude-code-flow?style=for-the-badge&logo=github&color=gold)](https://github.com/ruvnet/claude-code-flow)
[![📦 NPX Ready](https://img.shields.io/npm/v/claude-flow?style=for-the-badge&logo=npm&color=blue&label=NPX%20INSTALL)](https://www.npmjs.com/package/claude-flow)
[![✅ 95% Test Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen?style=for-the-badge&logo=codecov)](./test-results/coverage-html/index.html)
[![🦕 Deno Powered](https://img.shields.io/badge/deno-v1.40+-blue?style=for-the-badge&logo=deno)](https://deno.land/)
[![⚡ TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![📖 Documentation](https://img.shields.io/badge/docs-comprehensive-green?style=for-the-badge&logo=gitbook)](./docs/)
[![🛡️ MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge&logo=opensourceinitiative)](https://opensource.org/licenses/MIT)

</div>

## 🎯 **Transform Your Development Workflow**

**Claude-Flow** is the ultimate multi-terminal orchestration platform that revolutionizes how you work with Claude Code. Imagine coordinating **dozens of AI agents** simultaneously, each working on different aspects of your project while sharing knowledge through an intelligent memory bank.

> 🔥 **One command to rule them all**: `npx claude-flow` - Deploy a full AI agent coordination system in seconds!


## 🎉 **What's New in v1.0.53** 🆕

### 🤖 **NEW: Claude Task Master Integration - Autonomous Intelligence Complete!**
- **🧠 Autonomous Project Director**: Self-directing AI agents managing complete project lifecycles with 85%+ autonomous decision-making
- **🔮 Self-Improving Algorithm Engine**: Continuous model enhancement with 95%+ accuracy improvement and automated deployment
- **🌍 Global Synchronization Engine**: Sub-500ms worldwide sync with CRDT conflict resolution and automatic failover
- **💬 Intent-Based Natural Language Interface**: Conversational project management with 90%+ intent accuracy and contextual understanding
- **📈 Predictive Intelligence Engine**: Multi-horizon forecasting with uncertainty quantification and 95%+ prediction accuracy
- **⚡ Autonomous Infrastructure**: Self-healing systems with 99.99% uptime and automatic capacity optimization

### 🏢 Enterprise Foundation (v1.0.52)**
- **🧠 Advanced Machine Learning Platform**: ML-driven effort estimation, requirement classification, and personalized recommendations with 90%+ accuracy
- **👥 Real-time Team Collaboration**: Multi-user sessions with intelligent conflict resolution, role-based access control, and WebRTC communication
- **🔗 Enterprise Integration Hub**: Bidirectional sync with 6+ platforms (Jira, Asana, GitHub, GitLab, Azure DevOps, Slack) with AI-assisted data mapping
- **📊 Advanced Analytics Engine**: Project health monitoring, predictive risk analysis, team performance insights, and custom reporting with AI-generated insights  
- **🛡️ Enterprise Security Suite**: Advanced access control (RBAC/ABAC/risk-based), end-to-end encryption, comprehensive audit logging, and SOC 2/GDPR compliance
- **🎯 Custom Model Training**: Privacy-preserving ML pipelines for organization-specific fine-tuning with automated deployment and drift detection

### 🚀 **Foundation (v1.0.51)**
- **🤖 Real AI Model Integration**: 6 major AI providers (Anthropic, OpenAI, Google, Perplexity, xAI, Mistral) with intelligent fallback
- **📄 Enhanced PRD Processing**: Advanced document analysis with multi-format support (Markdown, HTML, PDF, DOCX)
- **🧠 Smart Task Generation**: AI-powered task breakdown with automatic dependency detection and SPARC mapping
- **⚡ Production-Ready Performance**: Circuit breakers, caching, batching, and enterprise-grade error handling
- **🎯 Intelligent Model Selection**: Context-aware AI model selection with cost optimization and performance tracking
- **🔄 Advanced SPARC Integration**: AI-enhanced phase mapping with intelligent agent recommendations
- **📋 AI-Powered Task Management**: Complete integration with Claude Task Master for PRD-based task generation
- **🔄 Bidirectional Task Sync**: Seamless synchronization between TaskMaster and ClaudeFlow formats
- **🎯 SPARC-Integrated Workflows**: Automatic task mapping to SPARC development phases with agent assignment
- **📄 PRD Processing**: AI-powered parsing of Product Requirements Documents with intelligent task hierarchy generation
- **⚡ Real-time Monitoring**: Performance tracking, conflict resolution, and sync status monitoring
- **🛠️ Production-Ready CLI**: Complete command-line interface for task generation, sync, and management

### 🚀 **Major Release: Enterprise-Grade Swarm System**
- **🐝 Advanced Swarm Orchestration**: Complete multi-agent coordination system with timeout-free execution
- **🧠 Distributed Memory Sharing**: Cross-agent knowledge sharing with persistent state management
- **⚡ Intelligent Task Scheduling**: 7+ scheduling algorithms with dependency resolution and load balancing
- **🔄 Work Stealing & Load Balancing**: Automatic workload distribution across agents
- **🛡️ Circuit Breaker Patterns**: Enterprise fault tolerance with retry and recovery mechanisms
- **📊 Real-Time Monitoring**: Comprehensive metrics, health checks, and performance tracking
- **🔒 Security & Validation**: Encryption, access control, audit logging, and input validation
- **🎯 Comprehensive CLI**: 30+ options for swarm configuration and management

### 🆕 **Enhanced User Experience**
- **🚀 Text-Based Process Management UI**: New `--ui` flag for `start` command provides interactive process control
- **🎯 Simplified SPARC Syntax**: `npx claude-flow sparc "build app"` (no more double sparc!)
- **⚡ Auto-Skip Permissions**: `--dangerously-skip-permissions` by default (use `--enable-permissions` to restore prompts)
- **🤖 Non-Interactive Mode**: JSON output with `--non-interactive` flag for automation
- **📁 Directory Safety**: Enhanced guidance to prevent files in node_modules
- **🎯 17+ SPARC Modes**: Including new `sparc-orchestrator` for complex workflows
- **📂 Local Executable**: `init` now creates `./claude-flow` wrapper to ensure correct working directory
- **🔧 Fixed SPARC Path Resolution**: `.roomodes` now correctly found in project directory
- **📝 Claude Code Slash Commands**: `init --sparc` now creates `.claude/commands/` with slash commands for all SPARC modes
- **🏗️ Modular Init Structure**: Refactored init command into clean, maintainable modules for better extensibility

### 🐝 **Swarm System Features**
- **Timeout-Free Execution**: Background Claude processes that never timeout
- **Agent Specialization**: 9 agent types (coordinator, developer, researcher, analyzer, tester, reviewer, documenter, monitor, specialist)
- **Multiple Coordination Modes**: Centralized, distributed, hierarchical, mesh, hybrid
- **Advanced Scheduling**: FIFO, priority, deadline, shortest-job, critical-path, resource-aware, adaptive
- **Fault Tolerance**: Retry, redundancy, checkpoint, circuit-breaker, bulkhead, timeout, graceful-degradation
- **Communication Patterns**: Direct, broadcast, publish-subscribe, request-response, event-driven, gossip, hierarchical

### 🌟 **Why Claude-Flow?**

- **🚀 10x Faster Development**: Parallel AI agent execution with intelligent task distribution
- **🧠 Persistent Memory**: Agents learn and share knowledge across sessions
- **⚡ SPARC Methodology**: Systematic development with Specification → Pseudocode → Architecture → Refinement → Completion
- **🔄 Zero Configuration**: Works out-of-the-box with sensible defaults
- **🤖 VSCode Native**: Seamless integration with your favorite IDE
- **🔒 Enterprise Ready**: Production-grade security, monitoring, and scaling
- **🌐 MCP Compatible**: Full Model Context Protocol support for tool integration
- **🐝 Swarm Intelligence**: Advanced multi-agent coordination with timeout-free execution

## 📦 **Installation**

### 🚀 Get started in 30 seconds
```bash
# Initialize with SPARC development environment
Step 1. Install Claude Code: ``` npm install -g @anthropic-ai/claude-code ```
Step 2. ``` npx -y claude-flow@latest init --sparc ```

# Use the local wrapper after init
./claude-flow sparc "build and test my project"  # SPARC development
./claude-flow swarm "Build a REST API" --strategy development --monitor  # Swarm coordination
Optional: ./claude-flow start --ui  # Interactive process management
```

```bash
# ⚡ SPARC Development Workflow (NEW: Simplified!)
./claude-flow claude-flow sparc "build a todo app" # Orchestrator mode (default)
./claude-flow claude-flow sparc modes              # List 17+ development modes
./claude-flow claude-flow sparc tdd "user auth"    # Run TDD workflow

# 🐝 Advanced Swarm System (NEW!)
./claude-flow swarm "Build a REST API" --strategy development --parallel --monitor
./claude-flow swarm "Research AI trends" --strategy research --distributed --ui
./claude-flow swarm "Optimize performance" --strategy optimization --background

# 🎯 Run specific SPARC modes
npx claude-flow sparc run code "implement API"  # Code generation
npx claude-flow sparc run tdd "auth tests"      # Test-driven development
npx claude-flow sparc run architect "system"    # Architecture design

# 🤖 Spawn a research team
./claude-flow agent spawn researcher --name "Senior Researcher"
./claude-flow agent spawn analyst --name "Data Analyst"
./claude-flow agent spawn implementer --name "Code Developer"

# 📋 Create and execute tasks
./claude-flow task create research "Research AI optimization techniques"
./claude-flow task list

# 📊 Monitor in real-time
./claude-flow status
./claude-flow monitor
```

## 🏗️ **Core Features**

<table>
<tr>
<td width="33%" align="center">

### 🐝 **Advanced Swarm Orchestration**
Enterprise-grade multi-agent coordination with timeout-free execution, distributed memory sharing, and intelligent load balancing across specialized AI agents.

</td>
<td width="33%" align="center">

### 🧠 **Intelligent Memory Bank**
Advanced CRDT-based memory system with SQLite performance and Markdown readability. Agents learn and share knowledge across sessions with cross-agent collaboration.

</td>
<td width="33%" align="center">

### ⚡ **SPARC Development**
Systematic AI-assisted development using Specification → Pseudocode → Architecture → Refinement → Completion methodology with 17+ specialized modes.

</td>
</tr>
<tr>
<td width="33%" align="center">

### 🎯 **Smart Task Scheduling**
7+ scheduling algorithms with dependency resolution, deadlock detection, work stealing, load balancing, and automatic retry with exponential backoff.

</td>
<td width="33%" align="center">

### 🔒 **Enterprise Security**
Token-based authentication, encryption, rate limiting, circuit breakers, audit logging, access control, and role-based permissions.

</td>
<td width="33%" align="center">

### 🌐 **MCP Integration**
Full Model Context Protocol support with stdio and HTTP transports, enabling seamless integration with external tools and services.

</td>
</tr>
</table>

## ⚡ **Quick Start**

### 🎯 **Option 1: NPX (Recommended)**
```bash
# Install and run in one command
npx claude-flow

# Or install globally for repeated use
npm install -g claude-flow
claude-flow --version
```

### 🦕 **Option 2: Deno (For Developers)**
```bash
# Clone and run from source
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-code-flow
./bin/claude-flow --version
```

### 🔧 **Option 3: From Source (For Contributors)**
```bash
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-code-flow

```

## 🐝 **Swarm System Usage**

### **🚀 Basic Swarm Commands**
```bash
# Initialize with swarm support
npx claude-flow init --sparc

# Start a basic development swarm
./claude-flow swarm "Build a REST API" --strategy development

# Research-focused swarm with UI
./claude-flow swarm "Research AI trends" --strategy research --distributed --ui

# Background optimization swarm
./claude-flow swarm "Optimize performance" --strategy optimization --background --monitor

# Testing swarm with review
./claude-flow swarm "Test application" --strategy testing --review --verbose
```

### **🎛️ Advanced Swarm Configuration**
```bash
# Full-featured swarm with all options
./claude-flow swarm "Complex project development" \
  --strategy development \
  --mode distributed \
  --max-agents 10 \
  --parallel \
  --monitor \
  --review \
  --testing \
  --encryption \
  --verbose

# Dry run to see configuration
./claude-flow swarm "Test task" --dry-run --strategy development

# Get comprehensive help
./claude-flow swarm --help
```

### **🤖 Swarm Agent Types**
- **Coordinator**: Plans and delegates tasks to other agents
- **Developer**: Writes code and implements solutions  
- **Researcher**: Gathers and analyzes information
- **Analyzer**: Identifies patterns and generates insights
- **Tester**: Creates and runs tests for quality assurance
- **Reviewer**: Performs code and design reviews
- **Documenter**: Creates documentation and guides
- **Monitor**: Tracks performance and system health
- **Specialist**: Domain-specific expert agents

### **🔄 Coordination Strategies**
- **Centralized**: Single coordinator manages all agents (default)
- **Distributed**: Multiple coordinators share management
- **Hierarchical**: Tree structure with nested coordination
- **Mesh**: Peer-to-peer agent collaboration
- **Hybrid**: Mixed coordination strategies

### **📊 Swarm Features**
- **Timeout-Free Execution**: Background Claude processes that never timeout
- **Work Stealing**: Automatic load balancing across agents
- **Circuit Breakers**: Fault tolerance with automatic recovery
- **Real-Time Monitoring**: Live metrics and progress tracking
- **Distributed Memory**: Cross-agent knowledge sharing
- **Quality Controls**: Configurable thresholds and validation
- **Background Mode**: Long-running swarms with persistent state
- **Interactive UI**: Terminal-based swarm management interface

## 📚 **Documentation**

Comprehensive documentation is available to help you get the most out of Claude-Flow:

- **[Getting Started Guide](./docs/01-getting-started.md)** - Quick setup and first steps
- **[Architecture Overview](./docs/02-architecture-overview.md)** - System design and components
- **[Configuration Guide](./docs/03-configuration-guide.md)** - Detailed configuration options
- **[Agent Management](./docs/04-agent-management.md)** - Working with AI agents
- **[Task Coordination](./docs/05-task-coordination.md)** - Task scheduling and workflows
- **[Memory Bank Usage](./docs/06-memory-bank-usage.md)** - Persistent memory system
- **[MCP Integration](./docs/07-mcp-integration.md)** - Model Context Protocol tools
- **[Terminal Management](./docs/08-terminal-management.md)** - Terminal pooling and sessions
- **[Swarm System Guide](./docs/09-swarm-system.md)** - Advanced multi-agent coordination
- **[Troubleshooting](./docs/10-troubleshooting.md)** - Common issues and solutions
- **[Advanced Usage](./docs/11-advanced-usage.md)** - Power user features
- **[Claude Spawning](./docs/12-claude-spawning.md)** - Spawning Claude instances
- **[TaskMaster Integration](./docs/13-taskmaster-integration.md)** - Autonomous AI-powered task management (Phase 4) 🤖
- **[CLI Reference](./docs/cli-reference.md)** - Complete command documentation

## 💡 **Quick Start Guide**

### 1. **Initialize Claude Code Integration**
```bash
# Basic init (without SPARC modes)
npx claude-flow init

# Recommended: Initialize with SPARC development modes
npx claude-flow init --sparc
```
The `--sparc` flag creates:
- `CLAUDE.md` - SPARC-enhanced Claude Code configuration
- `.claude/commands/` - Claude Code slash commands for all SPARC modes
- `memory-bank.md` - Memory system documentation
- `coordination.md` - Agent coordination documentation
- `.roomodes` - SPARC development mode configurations
- `.roo/` - SPARC templates and workflows
- Memory folder structure with placeholders
- `./claude-flow` - Local executable wrapper (use instead of npx)

Claude Code slash commands available after init:
- `/sparc` - Execute SPARC methodology workflows
- `/sparc-<mode>` - Run specific SPARC modes (e.g., /sparc-architect)
- `/claude-flow-help` - Show all claude-flow commands
- `/claude-flow-memory` - Interact with memory system
- `/claude-flow-swarm` - Coordinate multi-agent swarms

### 2. **Start the Orchestrator**
```bash
# After init, use the local wrapper:
./claude-flow start

# Or run as daemon
./claude-flow start --daemon

# With interactive UI
./claude-flow start --ui
```

### 3. **Spawn Agents**
```bash
# Spawn different agent types with specific capabilities
./claude-flow agent spawn researcher --name "Research Assistant" --priority 8
./claude-flow agent spawn implementer --name "Code Developer" --priority 7
./claude-flow agent spawn analyst --name "Data Analyst" --priority 6
./claude-flow agent spawn coordinator --name "Project Manager" --priority 9

# List all active agents
./claude-flow agent list

# Get detailed information about an agent
./claude-flow agent info agent-123
```

### 4. **Create and Manage Tasks**
```bash
# Create tasks with different priorities
./claude-flow task create research "Analyze authentication best practices" --priority 8
./claude-flow task create implementation "Build JWT authentication" --priority 9
./claude-flow task create analysis "Review security vulnerabilities" --priority 10

# Create task with dependencies
./claude-flow task create implementation "Build user management" \
  --priority 7 --deps task-123,task-456

# Assign tasks to agents
./claude-flow task assign task-123 agent-456

# List all tasks
./claude-flow task list
./claude-flow task list --verbose  # Show detailed task information

# Check specific task status
./claude-flow task status task-123

# Cancel a task
./claude-flow task cancel task-789
```

### 5. **Spawn Claude Instances** 🆕
```bash
# Spawn Claude with enhanced Claude-Flow guidance
./claude-flow claude spawn "implement user authentication" --research --parallel

# Backend-only mode with high coverage
./claude-flow claude spawn "create REST API" --mode backend-only --coverage 95

# Frontend development with feature commits
./claude-flow claude spawn "build React components" --mode frontend-only --commit feature

# Full stack with all options
./claude-flow claude spawn "build complete app" --research --parallel --coverage 90 --verbose

# Execute workflow
./claude-flow claude batch workflow.json --dry-run
```

**Enhanced Claude Instances receive:**
- Detailed Claude-Flow system guidance
- Proper `npx claude-flow` command syntax
- Mode-specific instructions (backend/frontend/api/full)
- Memory bank operations with examples
- Configuration-aware development guidance

### 6. **Monitor System Status**
```bash
# Check system health
./claude-flow status

# Real-time monitoring
./claude-flow monitor

# View MCP tools
./claude-flow mcp tools
```

## 🚀 **SPARC Development Methodology**

Claude-Flow integrates the **SPARC** (Specification, Pseudocode, Architecture, Refinement, Completion) methodology for systematic AI-assisted development:

### **Available SPARC Modes**
```bash
# List all development modes
./claude-flow sparc modes

# Key modes include:
# 🏗️ architect      - System design and architecture
# 🧠 code           - Clean, modular implementation  
# 🧪 tdd            - Test-driven development
# 🛡️ security-review - Security analysis
# 📚 docs-writer    - Documentation creation
# 🔗 integration    - System integration
```

### **SPARC Workflow**
```bash
# Simplified orchestration (NEW!)
./claude-flow sparc "build complete authentication system"

# Run specific SPARC modes:
./claude-flow sparc run code "implement API"  # Code generation
./claude-flow sparc run tdd "auth tests"      # Test-driven development
./claude-flow sparc run architect "system"    # Architecture design

# TDD shorthand
./claude-flow sparc tdd "implement JWT authentication"
```

### **Non-Interactive Mode**

The `--non-interactive` flag outputs JSON for integration with CI/CD pipelines and automation tools:

```bash
# Run SPARC modes with JSON output
./claude-flow sparc run code "user service" --non-interactive
./claude-flow sparc run tdd "test suite" --non-interactive
```

### **SPARC Features**
- **17+ Specialized AI Modes** for different development phases
- **Memory Persistence** across SPARC sessions with namespaced storage
- **TDD Enforcement** with Red-Green-Refactor cycle automation
- **Modular Design** with <500 line file constraints
- **Environment Safety** preventing credential exposure
- **CI/CD Integration** via `--non-interactive` flag for automation
- **Non-Interactive Mode** for automation and CI/CD integration
- **Auto-Skip Permissions** by default (use --enable-permissions to prompt)
- **Quality Gates** with automated code analysis and security review

## Architecture

Claude-Flow uses a modular architecture with the following components:

- **Orchestrator**: Central coordinator managing all system components
- **Swarm System**: Advanced multi-agent coordination with timeout-free execution
- **Terminal Manager**: Handles terminal sessions with pooling and recycling
- **Memory Manager**: Persistent storage with caching and indexing
- **Coordination Manager**: Task scheduling and resource management
- **MCP Server**: Tool integration via Model Context Protocol

## Configuration

Default configuration file (`claude-flow.config.json`):

```json
{
  "orchestrator": {
    "maxConcurrentAgents": 10,
    "taskQueueSize": 100,
    "healthCheckInterval": 30000,
    "shutdownTimeout": 30000
  },
  "swarm": {
    "maxAgents": 10,
    "defaultStrategy": "auto",
    "defaultMode": "centralized",
    "timeoutMinutes": 60,
    "qualityThreshold": 0.8,
    "enableMonitoring": true,
    "enableEncryption": false
  },
  "terminal": {
    "type": "auto",
    "poolSize": 5,
    "recycleAfter": 10,
    "healthCheckInterval": 60000,
    "commandTimeout": 300000
  },
  "memory": {
    "backend": "hybrid",
    "cacheSizeMB": 100,
    "syncInterval": 5000,
    "conflictResolution": "crdt",
    "retentionDays": 30
  },
  "coordination": {
    "maxRetries": 3,
    "retryDelay": 1000,
    "deadlockDetection": true,
    "resourceTimeout": 60000,
    "messageTimeout": 30000
  },
  "mcp": {
    "transport": "stdio",
    "port": 3000,
    "tlsEnabled": false
  },
  "logging": {
    "level": "info",
    "format": "json",
    "destination": "console"
  }
}
```

## Agent Types

Claude-Flow supports multiple agent types:

- **Coordinator**: Plans and delegates tasks to other agents
- **Researcher**: Gathers and analyzes information
- **Implementer**: Writes code and creates solutions
- **Analyst**: Identifies patterns and generates insights
- **Developer**: Full-stack development capabilities
- **Tester**: Quality assurance and testing
- **Reviewer**: Code and design review
- **Documenter**: Documentation creation
- **Monitor**: System monitoring and health checks
- **Specialist**: Domain-specific expertise
- **Custom**: User-defined agent types

## 🛠️ **CLI Commands**

Claude-Flow provides a comprehensive CLI for managing your AI orchestration system. For detailed command documentation, see the [CLI Reference](./docs/cli-reference.md).

### 🌐 **Global Options**
- `-c, --config <path>`: Path to configuration file
- `-v, --verbose`: Enable verbose logging
- `--log-level <level>`: Set log level (debug, info, warn, error)
- `--version`: Show version information
- `--help`: Show help for any command

### 📋 **Core Commands**

#### `init` - Initialize Claude Code Integration
```bash
npx claude-flow@latest init [options]
  -s, --sparc               Initialize with SPARC development environment (recommended)
  -f, --force               Overwrite existing files
  -m, --minimal             Create minimal configuration files
```

**Recommended first-time setup:**
```bash
npx -y claude-flow@latest init --sparc
```

Creates:
- `CLAUDE.md` - AI-readable project instructions
- `.roomodes` - 17 pre-configured SPARC development modes
- `memory-bank.md` - Persistent memory documentation
- `coordination.md` - Agent coordination guide
- Complete folder structure for development

#### `start` - Start Orchestration System
```bash
npx claude-flow start [options]
  -d, --daemon              Run as daemon in background
  -p, --port <port>         MCP server port (default: 3000)
  -u, --ui                  Launch interactive process management UI
  -v, --verbose             Show detailed system activity
```

**Process Management UI Features (--ui flag):**
- Start/stop individual components (press 1-6 to toggle)
- Real-time status monitoring
- Process health visualization
- Commands: A (start all), Z (stop all), R (restart all), Q (quit)

#### `swarm` - Advanced Multi-Agent Coordination 🆕
```bash
npx claude-flow swarm <objective> [options]
  --strategy <type>          Execution strategy (auto/research/development/analysis/testing/optimization/maintenance)
  --mode <type>              Coordination mode (centralized/distributed/hierarchical/mesh/hybrid)
  --max-agents <n>           Maximum agents (default: 5)
  --timeout <minutes>        Timeout in minutes (default: 60)
  --parallel                 Enable parallel execution
  --distributed              Enable distributed coordination
  --monitor                  Enable real-time monitoring
  --ui                       Launch terminal UI interface
  --background               Run in background mode
  --review                   Enable peer review
  --testing                  Enable automated testing
  --encryption               Enable encryption
  --verbose                  Enable detailed logging
  --dry-run                  Show configuration without executing
```

**Swarm Examples:**
```bash
# Basic development swarm
./claude-flow swarm "Build a REST API" --strategy development

# Research swarm with UI
./claude-flow swarm "Research AI trends" --strategy research --distributed --ui

# Background optimization
./claude-flow swarm "Optimize performance" --strategy optimization --background --monitor
```

#### `status` - Show System Status
```bash
npx claude-flow status [options]
  -v, --verbose             Show detailed status information
```

#### `taskmaster` - PRD to Task Generation 🆕
```bash
npx claude-flow taskmaster <subcommand> [options]
  parse <prd-file>          Parse PRD and show structure
  generate <prd-file>       Generate tasks from PRD
    --output <file>         Output file (default: stdout)
    --format <type>         Output format: json|markdown|csv
    --sparc-mapping         Map tasks to SPARC phases
    --ai                    Enable AI enhancement (requires ANTHROPIC_API_KEY)
    --detailed              Generate detailed descriptions
    --enhance               Enhance with AI suggestions
  list                      List stored PRDs and tasks
  update <task-id> <status> Update task status (pending|in_progress|completed|blocked)
  export                    Export stored tasks
    --format <type>         Export format: json|markdown|csv
    --output <file>         Output file
  ai-status                 Check AI configuration status
  analyze <prd-file>        Analyze PRD with AI (requires API key)
  templates list            List available templates (partially implemented)
  info                      Show TaskMaster information
```

**TaskMaster Examples:**
```bash
# Basic task generation (no AI)
./claude-flow taskmaster generate requirements.prd --sparc-mapping --output tasks.json

# AI-enhanced generation (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY='your-api-key'
./claude-flow taskmaster generate requirements.prd --ai --detailed --enhance

# Analyze PRD with AI
./claude-flow taskmaster analyze requirements.prd

# Export tasks as markdown
./claude-flow taskmaster export --format markdown --output project-tasks.md
```

**Note:** VS Code sync features are implemented but not yet connected to CLI.

#### `agent` - Manage AI Agents
```bash
npx claude-flow agent <subcommand>
  spawn <type>              Spawn a new agent (researcher/implementer/analyst/coordinator)
    --name <name>           Agent name
    --priority <1-10>       Agent priority
    --max-tasks <n>         Max concurrent tasks
  list                      List all active agents
  info <agent-id>          Get detailed agent information
  terminate <agent-id>      Terminate an agent
```

#### `task` - Manage Tasks
```bash
npx claude-flow task <subcommand>
  create <type> <desc>      Create a new task
    --priority <1-10>       Task priority
    --deps <task-ids>       Comma-separated dependency IDs
  list                      List all tasks
    --verbose               Show task descriptions
  status <task-id>          Get task status
  cancel <task-id>          Cancel a task
  workflow <file>           Execute workflow from file
    --async                 Run workflow asynchronously
```

#### `memory` - Manage Memory Bank
```bash
npx claude-flow memory <subcommand>
  query <search>            Search memory entries
    --namespace <ns>        Filter by namespace
    --limit <n>             Limit results
  store <key> <value>       Store information
    --namespace <ns>        Target namespace
  export <file>             Export memory to file
  import <file>             Import memory from file
  stats                     Show memory statistics
  cleanup                   Clean up old entries
    --days <n>              Entries older than n days
```

#### `mcp` - MCP Server Management
```bash
npx claude-flow mcp <subcommand>
  status                    Show MCP server status
  tools                     List available MCP tools
  config                    Show MCP configuration
  logs                      View MCP server logs
    --lines <n>             Number of log lines (default: 50)
```

#### `monitor` - Real-time Monitoring
```bash
npx claude-flow monitor [options]
  -i, --interval <seconds>  Update interval (default: 2)
  -c, --compact             Compact view mode
  -f, --focus <component>   Focus on specific component
```

#### `sparc` - SPARC Development Methodology 🆕
```bash
npx claude-flow sparc [subcommand] [options]
  "<task>"                  Run SPARC orchestrator (default mode)
  modes [--verbose]         List available SPARC development modes
  info <mode>               Show detailed mode information
  run <mode> "<task>"       Execute specific SPARC mode
  tdd "<feature>"           Run full TDD workflow
    --namespace <ns>        Use custom memory namespace
    --dry-run               Show configuration without executing
    --verbose               Show detailed output
    --non-interactive       Run with stream-json output (for automation)
    --enable-permissions    Enable permission prompts (default: skip)
```

**Default Behavior Updates:**
- Simplified syntax: `npx claude-flow sparc "build app"` (no need for `run sparc`)
- Permissions auto-skipped by default (use `--enable-permissions` to prompt)
- Non-interactive mode for BatchTool orchestration

#### `claude` - Spawn Claude Instances with Enhanced Guidance 🆕
```bash
npx claude-flow claude <subcommand>
  spawn <task>              Spawn Claude with enhanced Claude-Flow guidance
    -t, --tools <tools>     Allowed tools (comma-separated)
    --no-permissions        Use --dangerously-skip-permissions flag
    -c, --config <file>     MCP config file path
    -m, --mode <mode>       Development mode (full/backend-only/frontend-only/api-only)
    --parallel              Enable multi-agent support
    --research              Enable web research capabilities
    --coverage <n>          Test coverage target percentage (default: 80)
    --commit <freq>         Commit frequency (phase/feature/manual)
    -v, --verbose           Enable verbose output
    -d, --dry-run           Show what would be executed without running
    
  batch <workflow-file>     Execute workflow configuration
    --dry-run               Show what would be executed without running
```

**Each spawned Claude instance receives comprehensive guidance including:**
- Claude-Flow memory operations (`npx claude-flow memory store/query`)
- System management commands (`npx claude-flow status/monitor`)
- Agent coordination (when --parallel is used)
- Mode-specific development focus
- Coverage and commit strategy awareness
- Example commands ready to use with the Bash tool

#### `config` - Configuration Management
```bash
npx claude-flow config <subcommand>
  show                      Show current configuration
  get <path>                Get specific config value
  set <path> <value>        Set config value
  init [file]               Initialize config file
  validate <file>           Validate config file
```

#### `session` - Session Management
```bash
npx claude-flow session <subcommand>
  list                      List active sessions
  info <session-id>         Get session information
  terminate <session-id>    End a session
```

#### `workflow` - Workflow Execution
```bash
npx claude-flow workflow <file> [options]
  --validate                Validate workflow without executing
  --async                   Run workflow asynchronously
  --watch                   Watch workflow progress
```

#### `help` - Get Help
```bash
npx claude-flow help [command]
```

### 🎯 **Common Use Cases**

**Complete Agent & Task Workflow:**
```bash
# Initialize and start the system
npx claude-flow init --sparc
./claude-flow start --ui  # Use interactive UI for process management

# In another terminal, spawn agents
./claude-flow agent spawn researcher --name "Senior Researcher" --priority 8
./claude-flow agent spawn analyst --name "Data Analyst" --priority 7
./claude-flow agent spawn implementer --name "Lead Developer" --priority 9

# Create and manage tasks
./claude-flow task create research "Analyze authentication patterns" --priority 8
./claude-flow task create analysis "Security audit findings" --priority 7
./claude-flow task create implementation "Build secure auth system" --priority 9

# Monitor the workflow
./claude-flow monitor
```

**Advanced Swarm Workflows:**
```bash
# Initialize swarm system
npx claude-flow init --sparc

# Development swarm with parallel execution
./claude-flow swarm "Build microservices architecture" \
  --strategy development --parallel --monitor --review

# Research swarm with distributed coordination
./claude-flow swarm "Analyze blockchain technologies" \
  --strategy research --distributed --ui --verbose

# Background optimization swarm
./claude-flow swarm "Optimize application performance" \
  --strategy optimization --background --testing --encryption

# Quality assurance swarm
./claude-flow swarm "Comprehensive security audit" \
  --strategy testing --review --verbose --max-agents 8
```

**Code Development Workflow:**
```bash
npx claude-flow agent spawn implementer --name "Backend Dev" --max-tasks 3
npx claude-flow agent spawn implementer --name "Frontend Dev" --max-tasks 3
npx claude-flow agent spawn coordinator --name "Tech Lead"
npx claude-flow workflow development-pipeline.json --watch
```

**SPARC Development Workflow:**
```bash
# Initialize SPARC environment
npx claude-flow init --sparc

# Complete feature development using SPARC methodology
npx claude-flow sparc run spec-pseudocode "user authentication system"
npx claude-flow sparc run architect "JWT auth service design"
npx claude-flow sparc tdd "implement secure authentication"
npx claude-flow sparc run security-review "auth vulnerability scan"
npx claude-flow sparc run integration "connect auth to user service"

# TDD-focused development
npx claude-flow sparc tdd "payment processing system"
npx claude-flow sparc tdd "real-time notifications"

# Architecture and design
npx claude-flow sparc run architect "microservices architecture"
npx claude-flow sparc run docs-writer "API documentation"
```

**TaskMaster Integration Examples (Phase 4 Autonomous Intelligence Complete):**
```bash
# Phase 4 Autonomous Intelligence Features 🤖
# Autonomous Project Management
./claude-flow taskmaster autonomous start --project PROJECT-456 --autonomy 0.8 --learning
./claude-flow taskmaster autonomous status --detailed
./claude-flow taskmaster autonomous decisions --detailed
./claude-flow taskmaster autonomous escalations --resolve ESC-123

# Self-Improving Algorithm Engine
./claude-flow taskmaster self-improve start
./claude-flow taskmaster self-improve improvements --deployed
./claude-flow taskmaster self-improve report

# Global Synchronization
./claude-flow taskmaster global-sync start
./claude-flow taskmaster global-sync status --regions
./claude-flow taskmaster global-sync conflicts --resolve CONF-789

# Intent-Based Natural Language Interface
./claude-flow taskmaster intent process "Create a mobile app project for customer onboarding"
./claude-flow taskmaster intent process "Show me the status of Project Alpha with predictions"
./claude-flow taskmaster intent history

# Predictive Intelligence
./claude-flow taskmaster predict project-success PROJECT-123 --horizon months --scenarios
./claude-flow taskmaster predict resource-demand --organization ORG-456 --timeframe quarters
./claude-flow taskmaster predict quality PROJECT-789 --metrics "code_quality,user_satisfaction"
./claude-flow taskmaster predict risks PROJECT-101 --categories "technical,schedule,budget"
./claude-flow taskmaster predict team-performance TEAM-202 --members "all"
./claude-flow taskmaster predict market-opportunities --industry "fintech"

# Phase 3 Enterprise Foundation Features 🏢
# Machine Learning & Analytics
./claude-flow taskmaster ml train historical-data.json --model-type effort_estimation --privacy-mode
./claude-flow taskmaster ml predict new-project.json --model effort-v2.1 --explain
./claude-flow taskmaster ml analyze-history --timeframe 365 --generate-report

# Real-time Team Collaboration
./claude-flow taskmaster collaboration session create PROJECT-123 --max-users 10 --conflict-mode ai-assisted
./claude-flow taskmaster collaboration session join sess_abc123
./claude-flow taskmaster collaboration session monitor sess_abc123

# Enterprise Integration Hub
./claude-flow taskmaster integrations setup jira --bidirectional --ai-mapping --webhook
./claude-flow taskmaster integrations sync github --direction bidirectional --resolve-conflicts
./claude-flow taskmaster integrations status --all

# Advanced Analytics & Reporting
./claude-flow taskmaster analytics health PROJECT-123 --predictions --recommendations
./claude-flow taskmaster analytics team TEAM-456 --timeframe 90 --benchmarks
./claude-flow taskmaster analytics dashboard --port 8080
./claude-flow taskmaster analytics export project-report --format pdf

# Security & Compliance
./claude-flow taskmaster security audit --framework soc2 --detailed
./claude-flow taskmaster security compliance gdpr --remediation
./claude-flow taskmaster security encrypt sensitive-data.json --key-rotation

# Phase 2 Foundation Features
# Generate tasks from PRD with AI-enhanced analysis
./claude-flow taskmaster generate-from-prd requirements.md --ai-enhanced --sparc-mapping --assign-agents

# Advanced PRD processing with complexity analysis
./claude-flow taskmaster generate-from-prd project-spec.docx --provider anthropic --complexity-analysis --dependency-detection

# Analyze project complexity using AI
./claude-flow taskmaster analyze-complexity requirements.md --detailed --recommendations

# AI provider management
./claude-flow taskmaster providers status
./claude-flow taskmaster providers test anthropic
./claude-flow taskmaster providers recommend prd-parsing

# Initialize with enterprise features
./claude-flow taskmaster init --with-ai --enterprise
./claude-flow taskmaster import ./existing-tasks --merge --backup --enhance

# AI-optimized sync and monitoring
./claude-flow taskmaster sync --ai-optimize
./claude-flow taskmaster status --detailed --performance --enterprise
./claude-flow taskmaster watch --directory ./tasks --ai-monitor

# Enhanced task operations with AI recommendations
./claude-flow task next --smart --ai-recommend
./claude-flow task estimate TASK-123 --breakdown --ai-analysis
./claude-flow task expand TASK-456 --depth 3 --intelligent-breakdown
./claude-flow task dependencies --format mermaid --optimize-critical-path
```

**Enhanced Claude Spawn Examples:**
```bash
# Backend API development with high test coverage
./claude-flow claude spawn "build REST API with authentication" \
  --mode backend-only --coverage 95 --commit feature

# Frontend development with research capabilities
./claude-flow claude spawn "create responsive dashboard" \
  --mode frontend-only --research --verbose

# Full-stack development with parallel execution
./claude-flow claude spawn "implement user management system" \
  --parallel --coverage 90 --commit phase

# API design focus with custom tools
./claude-flow claude spawn "design GraphQL schema" \
  --mode api-only --tools "View,Edit,GrepTool,LS"
```

**Workflow Execution:**
```bash
# Execute a workflow file
./claude-flow workflow my-workflow.json

# Validate workflow before execution
./claude-flow workflow my-workflow.json --validate

# Execute with monitoring
./claude-flow workflow my-workflow.json --watch
```

## Workflow Example

Create a workflow file (`example-workflow.json`):

```json
{
  "name": "Research and Analysis Workflow",
  "tasks": [
    {
      "id": "research-1",
      "type": "research",
      "description": "Research quantum computing basics",
      "assignTo": "researcher"
    },
    {
      "id": "analyze-1",
      "type": "analysis",
      "description": "Analyze research findings",
      "dependencies": ["research-1"],
      "assignTo": "analyst"
    },
    {
      "id": "report-1",
      "type": "report",
      "description": "Generate summary report",
      "dependencies": ["analyze-1"],
      "assignTo": "coordinator"
    }
  ]
}
```

Execute the workflow:
```bash
./claude-flow workflow example-workflow.json
```

## Development

### Prerequisites
- Deno 1.40+ (Install: https://deno.land/#installation)
- Node.js 16+ (for npm wrapper)
- Git

### Setup
```bash
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-code-flow
./bin/claude-flow --version  # Verify installation
```

### Testing
```bash
deno task test
```

### Building
```bash
deno task build
```

### Running from source
```bash
./bin/claude-flow --help  # Use the binary wrapper
```

## API Usage

Claude-Flow can also be used programmatically:

```typescript
import { Orchestrator, SwarmCoordinator } from 'claude-flow';

// Basic orchestrator
const orchestrator = new Orchestrator(config);
await orchestrator.initialize();

// Advanced swarm coordination
const swarm = new SwarmCoordinator({
  strategy: 'development',
  mode: 'distributed',
  maxAgents: 10,
  monitoring: { metricsEnabled: true }
});

await swarm.initialize();

// Create objective and agents
const objectiveId = await swarm.createObjective(
  'API Development',
  'Build a scalable REST API',
  'development'
);

const agentId = await swarm.registerAgent(
  'Lead Developer',
  'developer',
  { codeGeneration: true, testing: true }
);

// Execute with timeout-free background processing
await swarm.executeObjective(objectiveId);
```

## 🎯 **TaskMaster Integration: PRD to Task Generation**

### 🤔 **Why Use TaskMaster Integration?**

TaskMaster streamlines project planning by automatically converting Product Requirements Documents (PRDs) into structured, actionable tasks mapped to SPARC development phases.

#### **The Problem TaskMaster Solves:**
- **Manual Task Creation**: Hours spent breaking down requirements into tasks
- **Inconsistent Structure**: Different task formats across projects
- **SPARC Mapping**: Manual assignment of tasks to development phases
- **Task Management**: Scattered tasks across different tools

#### **The TaskMaster Solution:**
- **⚡ Automated Generation**: Convert PRDs to tasks in seconds
- **📐 Consistent Structure**: Standardized hierarchical task format
- **🎯 SPARC Integration**: Automatic mapping to development phases
- **🤖 Optional AI Enhancement**: Improved descriptions with Claude API
- **💾 Memory Integration**: Persistent storage in Claude-Flow

### 🚀 **How to Use TaskMaster**

#### **Step 1: Create Your PRD**
```markdown
# E-commerce Platform

## Overview
Build a modern e-commerce platform with user authentication and payment processing.

## Requirements
### User Management
- User registration and login
- Profile management
- Order history

### Product Catalog
- Product listing with search
- Category filters
- Product details

### Shopping Cart
- Add/remove items
- Cart persistence
- Checkout flow

## Technical Specifications
- Frontend: React/TypeScript
- Backend: Node.js/Express
- Database: PostgreSQL
- Payment: Stripe integration

## Timeline
- Phase 1: User system (2 weeks)
- Phase 2: Product catalog (3 weeks)
- Phase 3: Cart & checkout (2 weeks)
```

#### **Step 2: Generate Tasks (Basic)**
```bash
# Parse and generate tasks
claude-flow taskmaster generate ecommerce.prd --sparc-mapping --output tasks.json

# View generated tasks
claude-flow taskmaster list

# Export as markdown for team
claude-flow taskmaster export --format markdown --output project-tasks.md
```

#### **Step 3: AI Enhancement (Optional)**
```bash
# Set up Claude API
export ANTHROPIC_API_KEY='your-api-key'

# Check AI status
claude-flow taskmaster ai-status

# Generate with AI enhancement
claude-flow taskmaster generate ecommerce.prd \
  --ai \
  --detailed \
  --enhance \
  --sparc-mapping

# Analyze PRD with AI
claude-flow taskmaster analyze ecommerce.prd
```

#### **Step 4: Manage Tasks**
```bash
# Update task status as you work
claude-flow taskmaster update task-001 in_progress
claude-flow taskmaster update task-001 completed

# Export current status
claude-flow taskmaster export --format csv --output status.csv
```

### 📈 **Real-World Use Cases**

#### **Example 1: Web Application Project**
**Scenario:** Convert a detailed PRD into actionable development tasks

```bash
# Input: 50-line PRD with user stories and technical requirements
claude-flow taskmaster generate webapp-prd.md --sparc-mapping

# Output: 
# ✅ 47 hierarchical tasks generated
# ✅ Tasks mapped to SPARC phases (spec: 8, architect: 12, code: 20, tdd: 7)
# ✅ Priority levels assigned based on dependencies
# ✅ Subtasks created for complex features
# ✅ Export ready for project management tools
```

**Time Saved:** 2-3 hours of manual task breakdown

#### **Example 2: API Development with AI Enhancement**
**Scenario:** Generate tasks from PRD with AI-powered descriptions

```bash
# With Anthropic API key configured
export ANTHROPIC_API_KEY='sk-ant-...'

# Generate AI-enhanced tasks
claude-flow taskmaster generate api-prd.md --ai --detailed --enhance

# AI provides:
# ✅ Detailed task descriptions with implementation hints
# ✅ Effort estimations based on complexity
# ✅ SPARC mode recommendations
# ✅ Risk assessments for complex features
# ✅ Dependency analysis
```

**Benefits:** Better task clarity and more accurate planning

#### **Example 3: Team Collaboration Workflow**
**Scenario:** Share generated tasks with development team

```bash
# 1. Generate tasks from PRD
claude-flow taskmaster generate project.prd --sparc-mapping

# 2. Export for different team members
claude-flow taskmaster export --format markdown --output project-tasks.md   # For developers
claude-flow taskmaster export --format csv --output project-timeline.csv    # For PM tools
claude-flow taskmaster export --format json --output project-data.json     # For automation

# 3. Track progress
claude-flow taskmaster update task-001 in_progress
claude-flow taskmaster update task-002 completed
claude-flow taskmaster list  # View current status
```

### 💡 **TaskMaster Tips**

1. **PRD Structure Matters**: Well-structured markdown PRDs generate better tasks
2. **Use SPARC Mapping**: Automatically assigns tasks to appropriate development phases
3. **AI Enhancement**: Requires API key but provides much richer task descriptions
4. **Memory Integration**: All tasks are stored in Claude-Flow memory for persistence
5. **Export Flexibility**: Generate outputs for different tools and team members

### 🚧 **Current Limitations**

- **Markdown Only**: PRDs must be in markdown format
- **Single AI Provider**: Currently only supports Anthropic Claude API
- **No Real-time Sync**: VS Code integration exists but isn't connected to CLI
- **Basic Templates**: Template system is partially implemented
- **No External Integrations**: Jira, Asana, GitHub sync not available

### 🔧 **Getting Started with TaskMaster**

```bash
# 1. Check TaskMaster is available
./claude-flow taskmaster info

# 2. Create a simple PRD
cat > my-project.prd << 'EOF'
# My Project

## Overview
A web application for task management.

## Requirements
- User authentication
- Create, read, update, delete tasks
- Task categories and tags
- Due date reminders

## Technical Stack
- Frontend: React
- Backend: Node.js
- Database: PostgreSQL
EOF

# 3. Generate tasks
./claude-flow taskmaster generate my-project.prd --sparc-mapping

# 4. View and export
./claude-flow taskmaster list
./claude-flow taskmaster export --format markdown
```

**For more details, see the [TaskMaster Integration Guide](./docs/13-taskmaster-integration.md)**

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔌 **Integration with Claude Code**

Claude-Flow seamlessly integrates with Claude Code through the `CLAUDE.md` file created by `npx claude-flow init`. This enables:

- **Automatic Context Loading**: Claude Code reads your project configuration
- **Build Command Integration**: All build/test commands are available to Claude
- **Memory Persistence**: Claude remembers context across sessions
- **Enhanced Guidance**: Spawned Claude instances receive detailed Claude-Flow instructions
- **SPARC Methodology**: Built-in support for systematic development with 17+ specialized AI modes
- **Swarm Integration**: Claude Code SDK used for timeout-free multi-agent execution

Use with Claude Code:
```bash
# Initialize integration with SPARC and swarm support
npx -y claude-flow@latest init --sparc

# Use local wrapper after initialization
./claude-flow start --ui  # Interactive process management

# Spawn Claude with enhanced guidance
./claude-flow claude spawn "your task here" --research --parallel

# Use advanced swarm system
./claude-flow swarm "Build a REST API" --strategy development --monitor

# Claude receives:
# - Instructions on using npx claude-flow commands
# - Memory operations (store/query)
# - Agent coordination capabilities
# - Mode-specific development guidance
# - Swarm system access for complex workflows
```

## 🏢 **Enterprise Features**

- **🔐 Security**: Token-based auth, encryption, rate limiting, audit logging
- **📊 Monitoring**: Real-time metrics, performance tracking, health checks
- **🔄 Reliability**: Circuit breakers, automatic retries, graceful degradation
- **📈 Scalability**: Horizontal scaling, load balancing, resource pooling
- **🛡️ Compliance**: Audit trails, data retention policies, access controls
- **🐝 Swarm Intelligence**: Advanced multi-agent coordination with enterprise fault tolerance

## 📖 **Resources**

### Documentation
- **[Complete Documentation](./docs/)** - All guides and references
- **[API Documentation](./docs/api/)** - Programmatic usage
- **[Examples](./examples/)** - Sample configurations and workflows
- **[Memory System Docs](./memory/docs/)** - In-depth memory bank documentation
- **[Swarm System Guide](./docs/swarm-system.md)** - Advanced multi-agent coordination

### Community & Support
- **[GitHub Issues](https://github.com/ruvnet/claude-code-flow/issues)** - Bug reports and feature requests
- **[GitHub Discussions](https://github.com/ruvnet/claude-code-flow/discussions)** - Community forum

## 🚀 **Roadmap**

### Current Features
- ✅ Core orchestration with multi-agent support
- ✅ Enterprise-grade swarm system with timeout-free execution
- ✅ CRDT-based memory bank with SQLite backend
- ✅ MCP server integration (stdio transport)
- ✅ Claude Code integration via `init` command
- ✅ Text-based process management UI
- ✅ 17+ SPARC development modes
- ✅ Comprehensive CLI with 15+ commands
- ✅ Advanced multi-agent coordination
- ✅ Distributed memory sharing
- ✅ Real-time monitoring and metrics

### Planned Features
- Web UI for visual orchestration
- Plugin system for custom agent types
- Enhanced monitoring dashboard
- Workflow templates library
- Advanced swarm visualization
- Multi-language support for agents

## 🤝 **Contributing**

We welcome contributions! See our [Contributing Guide](CONTRIBUTING.md) for:
- Code of Conduct
- Development setup
- Submission guidelines
- Coding standards
- Testing requirements

## 📄 **License**

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 **Acknowledgments**

- Built on top of Claude Code and Anthropic's Claude AI
- Inspired by the SPARC methodology
- Thanks to all contributors and the Claude community

## 📊 **Stats**

![GitHub stars](https://img.shields.io/github/stars/ruvnet/claude-code-flow?style=social)
![npm downloads](https://img.shields.io/npm/dm/claude-flow)
![Contributors](https://img.shields.io/github/contributors/ruvnet/claude-code-flow)
![Last commit](https://img.shields.io/github/last-commit/ruvnet/claude-code-flow)

---

Built with ❤️ by [rUv](https://github.com/ruvnet) for the Claude community