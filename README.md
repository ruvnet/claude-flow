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


## 🎉 **What's New in v1.0.50** 🆕

### 🚀 **NEW: Claude Task Master Integration - Phase 1 Complete!**
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
deno task build && deno task install
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
- **[TaskMaster Integration](./docs/13-taskmaster-integration.md)** - AI-powered task management 🆕
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

#### `taskmaster` - TaskMaster Integration 🆕
```bash
npx claude-flow taskmaster <subcommand> [options]
  generate-from-prd <file>  Generate tasks from Product Requirements Document
    -m, --model <model>     AI model to use (default: claude-3-haiku)
    -d, --depth <level>     Task breakdown depth (default: 2)
    --sparc-mapping         Auto-map tasks to SPARC phases
    --assign-agents         Auto-assign tasks to agents
    -o, --output <file>     Output file for generated tasks
    -f, --format <format>   Output format (json|markdown|csv)
    --dry-run               Preview tasks without saving
  
  init                      Initialize TaskMaster integration
    --force                 Force initialization
  
  import <directory>        Import existing TaskMaster project
    --merge                 Merge with existing tasks
    --backup                Create backup before import
  
  sync                      Manually synchronize tasks
    --direction <dir>       Sync direction (to-taskmaster|from-taskmaster|bidirectional)
    --project <id>          Specific project ID to sync
  
  config                    Configure TaskMaster integration
    --set <key=value>       Set configuration value
    --get <key>             Get configuration value
    --list                  List all configuration
  
  status                    Show TaskMaster integration status
    --detailed              Show detailed status information
  
  watch                     Start file system watcher for real-time sync
    --directory <dir>       Directory to watch
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

**TaskMaster Integration Examples:**
```bash
# Generate tasks from PRD with SPARC mapping
./claude-flow taskmaster generate-from-prd requirements.md --sparc-mapping --assign-agents

# Initialize and sync existing project
./claude-flow taskmaster init
./claude-flow taskmaster import ./existing-tasks --merge --backup

# Monitor sync status and watch for changes
./claude-flow taskmaster status --detailed
./claude-flow taskmaster watch --directory ./tasks

# Enhanced task operations
./claude-flow task next --smart
./claude-flow task estimate TASK-123 --breakdown
./claude-flow task expand TASK-456 --depth 3
./claude-flow task dependencies --format mermaid
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