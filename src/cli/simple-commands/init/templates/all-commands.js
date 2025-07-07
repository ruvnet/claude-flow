// all-commands.js - Complete command templates for all directories

export function createAllCommandTemplates() {
  return {
    analysis: {
      'performance-bottlenecks.md': `# Performance Bottleneck Analysis

## Overview
Analyze and identify performance bottlenecks in your codebase using AI-powered profiling and analysis.

## Usage
\`\`\`bash
claude-flow analyze bottlenecks [options]
\`\`\`

## Features
- 🔍 Deep code analysis for performance issues
- 📊 Memory usage profiling
- ⚡ CPU usage patterns
- 🌐 Network bottleneck detection
- 📈 Algorithmic complexity analysis

## Commands
- \`analyze performance\` - Run performance analysis
- \`analyze memory\` - Memory usage analysis
- \`analyze cpu\` - CPU profiling
- \`analyze network\` - Network performance
- \`analyze complexity\` - Big-O analysis

## Integration with MCP Tools
- Uses \`mcp__claude-mcp__bottleneck_analyze\`
- Integrates with \`mcp__claude-mcp__performance_report\`
- Leverages \`mcp__claude-mcp__metrics_collect\`
`,
      'token-efficiency.md': `# Token Efficiency Analysis

## Overview
Optimize token usage and reduce costs by analyzing and improving prompt efficiency.

## Usage
\`\`\`bash
claude-flow analyze tokens [options]
\`\`\`

## Features
- 💰 Token usage tracking
- 📉 Cost optimization suggestions
- 🔄 Prompt compression techniques
- 📊 Usage statistics and trends
- 🎯 Efficiency scoring

## Commands
- \`analyze tokens\` - Token usage analysis
- \`optimize prompts\` - Prompt optimization
- \`compress context\` - Context compression
- \`track usage\` - Usage tracking
- \`estimate costs\` - Cost estimation

## MCP Integration
- \`mcp__claude-mcp__token_usage\` - Token tracking
- \`mcp__claude-mcp__cost_analysis\` - Cost analysis
- \`mcp__claude-mcp__neural_compress\` - Neural compression
`
    },
    
    automation: {
      'self-healing.md': `# Self-Healing Workflows

## Overview
Implement self-healing mechanisms that automatically detect and fix common issues.

## Usage
\`\`\`bash
claude-flow heal [component] [options]
\`\`\`

## Features
- 🔧 Automatic error detection
- 🏥 Self-repair mechanisms
- 🔄 Retry with exponential backoff
- 📊 Health monitoring
- 🚨 Alert systems

## Commands
- \`heal workflow\` - Heal workflow issues
- \`heal agents\` - Fix agent problems
- \`heal memory\` - Repair memory corruption
- \`heal connections\` - Fix network issues
- \`monitor health\` - Health monitoring

## MCP Tools
- \`mcp__claude-mcp__health_check\`
- \`mcp__claude-mcp__diagnostic_run\`
- \`mcp__claude-mcp__daa_fault_tolerance\`
`,
      'session-memory.md': `# Session Memory Persistence

## Overview
Maintain context and memory across Claude Code sessions for seamless continuity.

## Usage
\`\`\`bash
claude-flow memory session [action] [options]
\`\`\`

## Features
- 💾 Automatic session saving
- 🔄 Context restoration
- 📝 Session summaries
- 🗂️ Memory namespacing
- ⏰ TTL management

## Commands
- \`memory session save\` - Save current session
- \`memory session restore\` - Restore session
- \`memory session list\` - List sessions
- \`memory session export\` - Export session
- \`memory session clean\` - Clean old sessions

## MCP Integration
- \`mcp__claude-mcp__memory_persist\`
- \`mcp__claude-mcp__context_restore\`
- \`mcp__claude-mcp__state_snapshot\`
`,
      'smart-agents.md': `# Smart Agent Auto-Spawning

## Overview
Automatically spawn and manage agents based on task requirements and system load.

## Usage
\`\`\`bash
claude-flow agents auto [options]
\`\`\`

## Features
- 🤖 Intelligent agent spawning
- ⚖️ Load-based scaling
- 🎯 Capability matching
- 📊 Performance tracking
- 🔄 Dynamic rebalancing

## Commands
- \`agents auto spawn\` - Auto-spawn agents
- \`agents auto scale\` - Auto-scale swarm
- \`agents auto balance\` - Load balancing
- \`agents auto optimize\` - Optimization
- \`agents auto monitor\` - Monitoring

## MCP Tools
- \`mcp__claude-mcp__daa_agent_create\`
- \`mcp__claude-mcp__daa_capability_match\`
- \`mcp__claude-mcp__swarm_scale\`
- \`mcp__claude-mcp__topology_optimize\`
`
    },
    
    github: {
      'github-modes.md': `# GitHub Integration Modes

## Overview
Comprehensive GitHub integration with specialized modes for different workflows.

## Available Modes

### 1. Issue Tracker Mode
Track and manage GitHub issues with AI assistance.

### 2. PR Manager Mode
Automate pull request reviews and management.

### 3. Release Manager Mode
Coordinate releases across repositories.

### 4. Code Review Mode
AI-powered code review assistance.

### 5. Project Board Mode
Sync with GitHub project boards.

### 6. Multi-Repo Mode
Coordinate across multiple repositories.

## Usage
\`\`\`bash
claude-flow github [mode] [action] [options]
\`\`\`

## MCP Integration
All GitHub modes use the comprehensive MCP GitHub tools:
- \`mcp__claude-mcp__github_repo_analyze\`
- \`mcp__claude-mcp__github_pr_manage\`
- \`mcp__claude-mcp__github_issue_track\`
- \`mcp__claude-mcp__github_release_coord\`
`,
      'issue-tracker.md': `# GitHub Issue Tracker

## Overview
Track, manage, and automate GitHub issue workflows with AI assistance.

## Usage
\`\`\`bash
claude-flow github issues [action] [options]
\`\`\`

## Features
- 🐛 Issue creation and tracking
- 🏷️ Automatic labeling
- 👥 Assignment automation
- 📊 Issue analytics
- 🔄 Status synchronization

## Commands
- \`github issues create\` - Create new issue
- \`github issues track\` - Track issues
- \`github issues assign\` - Auto-assign
- \`github issues label\` - Auto-label
- \`github issues analyze\` - Analytics

## MCP Integration
- \`mcp__claude-mcp__github_issue_track\`
- \`mcp__claude-mcp__github_metrics\`
`,
      'pr-manager.md': `# GitHub Pull Request Manager

## Overview
Automate pull request workflows with intelligent review and merge capabilities.

## Usage
\`\`\`bash
claude-flow github pr [action] [options]
\`\`\`

## Features
- 🔍 Automated code review
- 🤖 AI review comments
- 🔄 Auto-merge capabilities
- 📊 PR metrics tracking
- 🏷️ Label management

## Commands
- \`github pr review\` - Review PR
- \`github pr merge\` - Merge PR
- \`github pr comment\` - Add comments
- \`github pr label\` - Manage labels
- \`github pr analyze\` - PR analytics

## MCP Integration
- \`mcp__claude-mcp__github_pr_manage\`
- \`mcp__claude-mcp__github_code_review\`
`,
      'release-manager.md': `# GitHub Release Manager

## Overview
Coordinate and automate releases across single or multiple repositories.

## Usage
\`\`\`bash
claude-flow github release [action] [options]
\`\`\`

## Features
- 📦 Release coordination
- 📝 Changelog generation
- 🏷️ Version management
- 🔄 Multi-repo sync
- 📊 Release metrics

## Commands
- \`github release create\` - Create release
- \`github release coordinate\` - Coordinate
- \`github release changelog\` - Changelog
- \`github release publish\` - Publish
- \`github release rollback\` - Rollback

## MCP Integration
- \`mcp__claude-mcp__github_release_coord\`
- \`mcp__claude-mcp__github_sync_coord\`
`,
      'code-review-swarm.md': `# Code Review Swarm

## Overview
Deploy a swarm of specialized agents for comprehensive code reviews.

## Usage
\`\`\`bash
claude-flow github review-swarm [pr-url] [options]
\`\`\`

## Swarm Agents
- 🏗️ Architecture Reviewer
- 🔒 Security Reviewer
- ⚡ Performance Reviewer
- 🧪 Test Coverage Reviewer
- 📝 Documentation Reviewer
- 🎨 Style Guide Reviewer

## Features
- Parallel review execution
- Comprehensive feedback
- Priority-based findings
- Automated suggestions
- Review summary generation

## MCP Integration
- Spawns multiple specialized agents
- Coordinates through \`mcp__claude-mcp__swarm_init\`
- Uses \`mcp__claude-mcp__github_code_review\`
`,
      'multi-repo-swarm.md': `# Multi-Repository Swarm Coordination

## Overview
Coordinate development across multiple repositories with intelligent agent swarms.

## Usage
\`\`\`bash
claude-flow github multi-repo [action] [repos...] [options]
\`\`\`

## Features
- 🔄 Cross-repo synchronization
- 🤖 Distributed agent coordination
- 📊 Unified metrics dashboard
- 🔗 Dependency management
- 🚀 Parallel operations

## Commands
- \`github multi-repo sync\` - Sync repos
- \`github multi-repo deploy\` - Deploy across repos
- \`github multi-repo analyze\` - Cross-repo analysis
- \`github multi-repo coordinate\` - Coordinate changes
- \`github multi-repo monitor\` - Monitor all repos

## MCP Integration
- \`mcp__claude-mcp__github_sync_coord\`
- \`mcp__claude-mcp__swarm_init\` with distributed topology
- \`mcp__claude-mcp__task_orchestrate\` for coordination
`,
      'workflow-automation.md': `# GitHub Workflow Automation

## Overview
Create and manage GitHub Actions workflows with AI assistance.

## Usage
\`\`\`bash
claude-flow github workflow [action] [options]
\`\`\`

## Features
- 🔄 Workflow generation
- 🤖 Action recommendations
- 📊 Workflow analytics
- 🔧 Debugging assistance
- 📝 Documentation generation

## Commands
- \`github workflow create\` - Create workflow
- \`github workflow analyze\` - Analyze workflows
- \`github workflow optimize\` - Optimize
- \`github workflow debug\` - Debug issues
- \`github workflow document\` - Generate docs

## MCP Integration
- \`mcp__claude-mcp__github_workflow_auto\`
- \`mcp__claude-mcp__workflow_create\`
`,
      'project-board-sync.md': `# GitHub Project Board Synchronization

## Overview
Keep GitHub project boards synchronized with your development workflow.

## Usage
\`\`\`bash
claude-flow github board [action] [options]
\`\`\`

## Features
- 📋 Board synchronization
- 🔄 Status updates
- 📊 Progress tracking
- 🏷️ Label management
- 👥 Assignment automation

## Commands
- \`github board sync\` - Sync board
- \`github board update\` - Update cards
- \`github board report\` - Progress report
- \`github board automate\` - Automation
- \`github board analyze\` - Analytics

## MCP Integration
- Uses GitHub API through MCP tools
- Integrates with task orchestration
`,
      'repo-architect.md': `# Repository Architecture Analysis

## Overview
Analyze and improve repository architecture with AI-powered insights.

## Usage
\`\`\`bash
claude-flow github architect [repo] [options]
\`\`\`

## Features
- 🏗️ Architecture analysis
- 📊 Dependency mapping
- 🔍 Code quality metrics
- 📝 Documentation gaps
- 🚀 Performance insights

## Commands
- \`github architect analyze\` - Full analysis
- \`github architect dependencies\` - Dependency analysis
- \`github architect quality\` - Code quality
- \`github architect security\` - Security scan
- \`github architect recommend\` - Recommendations

## MCP Integration
- \`mcp__claude-mcp__github_repo_analyze\`
- \`mcp__claude-mcp__quality_assess\`
`,
      'swarm-issue.md': `# Swarm-Based Issue Resolution

## Overview
Deploy agent swarms to analyze and resolve complex GitHub issues.

## Usage
\`\`\`bash
claude-flow github swarm-issue [issue-url] [options]
\`\`\`

## Swarm Agents
- 🔍 Root Cause Analyzer
- 🛠️ Solution Designer
- 💻 Implementation Coder
- 🧪 Test Writer
- 📝 Documentation Writer

## Features
- Parallel issue analysis
- Multiple solution proposals
- Automated implementation
- Test generation
- PR creation

## MCP Integration
- Spawns specialized agent swarm
- Coordinates through swarm orchestration
- Creates PR with \`mcp__claude-mcp__github_pr_manage\`
`,
      'swarm-pr.md': `# Swarm-Based Pull Request Creation

## Overview
Use agent swarms to create comprehensive pull requests with full implementation.

## Usage
\`\`\`bash
claude-flow github swarm-pr [description] [options]
\`\`\`

## Swarm Agents
- 📋 Requirements Analyst
- 🏗️ Architecture Designer
- 💻 Implementation Team
- 🧪 Testing Team
- 📝 Documentation Team

## Features
- Requirements analysis
- Architecture design
- Parallel implementation
- Comprehensive testing
- Full documentation

## Process
1. Analyze requirements
2. Design architecture
3. Implement in parallel
4. Write tests
5. Create documentation
6. Submit PR

## MCP Integration
- Complex swarm coordination
- Multiple agent types
- Automated PR creation
`,
      'sync-coordinator.md': `# Repository Sync Coordinator

## Overview
Coordinate synchronized changes across multiple repositories.

## Usage
\`\`\`bash
claude-flow github sync [repos...] [options]
\`\`\`

## Features
- 🔄 Multi-repo sync
- 🔗 Dependency tracking
- 📊 Change impact analysis
- 🚀 Parallel execution
- 🔧 Conflict resolution

## Commands
- \`github sync plan\` - Plan sync
- \`github sync execute\` - Execute sync
- \`github sync verify\` - Verify sync
- \`github sync rollback\` - Rollback
- \`github sync monitor\` - Monitor

## MCP Integration
- \`mcp__claude-mcp__github_sync_coord\`
- Multi-repo orchestration
`,
      'issue-tracker-enhanced.md': `# GitHub Issue Tracker - Enhanced with CLI Integration

## Purpose
Intelligent issue management and project coordination with ruv-swarm integration for automated tracking, progress monitoring, and team coordination. Enhanced with GitHub CLI commands for direct issue manipulation.

## Capabilities
- **Automated issue creation** with smart templates and labeling
- **Progress tracking** with swarm-coordinated updates
- **Multi-agent collaboration** on complex issues
- **Project milestone coordination** with integrated workflows
- **Cross-repository issue synchronization** for monorepo management
- **GitHub CLI integration** for direct issue operations
- **Real-time issue verification** and status updates

## GitHub CLI Issue Operations

### 1. View Issue Details (e.g., Issue #137)
\`\`\`bash
# View issue details
gh issue view 137 --repo ruvnet/claude-flow

# View with comments
gh issue view 137 --repo ruvnet/claude-flow --comments

# View in web browser
gh issue view 137 --repo ruvnet/claude-flow --web
\`\`\`

### 2. Reply to Issues
\`\`\`bash
# Add a comment to issue #137
gh issue comment 137 --repo ruvnet/claude-flow --body "Progress update: Fixed 400+ TypeScript errors"

# Add formatted comment
gh issue comment 137 --repo ruvnet/claude-flow --body "$(cat <<'EOF'
## 🚀 Progress Update
- ✅ Fixed 528 TypeScript compilation errors
- ✅ Reduced errors by 71%
- ✅ All critical blockers resolved
EOF
)"
\`\`\`

### 3. Update Issue Status and Labels
\`\`\`bash
# Update issue labels
gh issue edit 137 --repo ruvnet/claude-flow --add-label "in-progress,typescript"

# Update title
gh issue edit 137 --repo ruvnet/claude-flow --title "fix: TypeScript errors [IN PROGRESS]"

# Assign issue
gh issue edit 137 --repo ruvnet/claude-flow --add-assignee "@me"
\`\`\`

### 4. Verify Issue Updates
\`\`\`bash
# List issues with labels
gh issue list --repo ruvnet/claude-flow --label "typescript,bug"

# Get issue status in JSON
gh issue view 137 --repo ruvnet/claude-flow --json state,labels,assignees
\`\`\`

### 5. Batch Operations
\`\`\`bash
# Update multiple issues
for issue in 137 138 139; do
  gh issue edit $issue --repo ruvnet/claude-flow --add-label "typescript-fixed"
done

# Close with comment
gh issue close 137 --repo ruvnet/claude-flow --comment "Fixed in commit 26cf0ff"
\`\`\`

## Issue #137 Example Pattern

### Swarm Coordination for Issue Fixes
\`\`\`javascript
[BatchTool - Single Message]:
  mcp__ruv-swarm__swarm_init { topology: "mesh", maxAgents: 6 }
  mcp__ruv-swarm__agent_spawn { type: "coordinator", name: "TS Fix Coordinator" }
  mcp__ruv-swarm__agent_spawn { type: "coder", name: "CLI Error Fixer" }
  mcp__ruv-swarm__agent_spawn { type: "coder", name: "Executor Error Fixer" }
  mcp__ruv-swarm__agent_spawn { type: "analyst", name: "Error Analyzer" }
  mcp__ruv-swarm__agent_spawn { type: "tester", name: "Build Validator" }
  
  Bash("gh issue comment 137 --repo ruvnet/claude-flow --body '🐝 Swarm initialized with 6 agents'")
\`\`\`

## GitHub CLI Quick Reference
\`\`\`bash
# View commands
gh issue view <number>              # View issue details
gh issue list                       # List all issues
gh issue status                     # Show status of your issues

# Modify commands  
gh issue create                     # Create new issue
gh issue edit <number>              # Edit issue properties
gh issue comment <number>           # Add comment
gh issue close <number>             # Close issue
gh issue reopen <number>            # Reopen issue

# Search and filter
gh issue list --label "bug"         # Filter by label
gh issue list --assignee @me        # Your assigned issues
gh issue list --search "TypeScript" # Search issues
\`\`\`

## MCP Integration
- \`mcp__github__*\` tools for issue operations
- \`mcp__ruv-swarm__*\` for swarm coordination
- GitHub CLI via Bash tool
`,
      'release-swarm.md': `# Release Coordination Swarm

## Overview
Deploy specialized agent swarms for complex release coordination.

## Usage
\`\`\`bash
claude-flow github release-swarm [version] [options]
\`\`\`

## Swarm Agents
- 📋 Release Manager
- 🧪 QA Coordinator
- 📝 Changelog Writer
- 🔒 Security Checker
- 📊 Metrics Collector
- 🚀 Deployment Agent

## Features
- Automated release process
- Cross-repo coordination
- Quality gates
- Security scanning
- Deployment automation

## MCP Integration
- Complex swarm orchestration
- \`mcp__claude-mcp__github_release_coord\`
- Multi-agent coordination
`
    },
    
    coordination: {
      'init.md': `# Swarm Initialization

## Overview
Initialize and configure agent swarms with various topologies and strategies.

## Usage
\`\`\`bash
claude-flow swarm init [topology] [options]
\`\`\`

## Topologies
- 🔗 **Mesh**: Fully connected agents
- 📊 **Hierarchical**: Tree structure
- 🔄 **Ring**: Circular communication
- ⭐ **Star**: Central coordinator

## Options
- \`--max-agents\`: Maximum agents (default: 8)
- \`--strategy\`: Coordination strategy
- \`--auto-scale\`: Enable auto-scaling
- \`--monitor\`: Real-time monitoring

## MCP Integration
- \`mcp__claude-mcp__swarm_init\`
- \`mcp__claude-mcp__topology_optimize\`
`,
      'spawn.md': `# Agent Spawning

## Overview
Spawn specialized agents for various tasks and capabilities.

## Usage
\`\`\`bash
claude-flow agent spawn [type] [options]
\`\`\`

## Agent Types
- 💻 **coder**: Code implementation
- 🔍 **researcher**: Information gathering
- 🏗️ **architect**: System design
- 🧪 **tester**: Testing and QA
- 📊 **analyst**: Data analysis
- 📝 **documenter**: Documentation
- 🔧 **optimizer**: Performance optimization
- 🎯 **coordinator**: Task coordination

## Options
- \`--capability\`: Specific capabilities
- \`--task\`: Assign immediate task
- \`--swarm\`: Join specific swarm

## MCP Integration
- \`mcp__claude-mcp__agent_spawn\`
- \`mcp__claude-mcp__daa_agent_create\`
`,
      'orchestrate.md': `# Task Orchestration

## Overview
Orchestrate complex tasks across multiple agents with intelligent coordination.

## Usage
\`\`\`bash
claude-flow orchestrate [task] [options]
\`\`\`

## Strategies
- **Parallel**: Maximum parallelization
- **Sequential**: Step-by-step execution
- **Adaptive**: Dynamic adjustment
- **Balanced**: Resource-aware distribution

## Features
- 🎯 Intelligent task breakdown
- 🔄 Dynamic rebalancing
- 📊 Progress tracking
- 🔧 Error recovery
- 📈 Performance optimization

## MCP Integration
- \`mcp__claude-mcp__task_orchestrate\`
- \`mcp__claude-mcp__load_balance\`
- \`mcp__claude-mcp__coordination_sync\`
`
    },
    
    hooks: {
      'overview.md': `# Claude Flow Hooks System

## Overview
Automated hooks for seamless integration and workflow enhancement.

## Available Hooks

### Pre-Operation Hooks
- **pre-task**: Before task execution
- **pre-edit**: Before file modifications
- **pre-search**: Before search operations
- **pre-command**: Before command execution

### Post-Operation Hooks
- **post-task**: After task completion
- **post-edit**: After file changes
- **post-search**: After search results
- **post-command**: After command execution

### Session Hooks
- **session-start**: Session initialization
- **session-end**: Session cleanup
- **session-save**: Periodic saves
- **session-restore**: Context restoration

## Usage
\`\`\`bash
claude-flow hook [name] [options]
\`\`\`

## Configuration
Configure hooks in \`.claude/settings.json\`:
\`\`\`json
{
  "hooks": {
    "pre-edit": {
      "autoFormat": true,
      "validateSyntax": true
    },
    "post-task": {
      "updateMemory": true,
      "generateSummary": true
    }
  }
}
\`\`\`
`,
      'setup.md': `# Hook Setup Guide

## Overview
Step-by-step guide to setting up and configuring Claude Flow hooks.

## Installation

### 1. Initialize Hooks
\`\`\`bash
claude-flow hooks init
\`\`\`

### 2. Configure Settings
Edit \`.claude/settings.json\`:
\`\`\`json
{
  "hooks": {
    "enabled": true,
    "pre-edit": {
      "commands": [
        "npx ruv-swarm hook pre-edit --file {file}"
      ]
    },
    "post-task": {
      "commands": [
        "npx ruv-swarm hook post-task --task-id {taskId}"
      ]
    }
  }
}
\`\`\`

### 3. Test Hooks
\`\`\`bash
claude-flow hooks test
\`\`\`

## Custom Hooks

### Creating Custom Hooks
1. Create hook script in \`.claude/hooks/\`
2. Register in settings.json
3. Test with \`claude-flow hooks test [name]\`

### Example Custom Hook
\`\`\`javascript
// .claude/hooks/my-hook.js
module.exports = async (context) => {
  console.log('Hook triggered:', context);
  // Your custom logic here
};
\`\`\`

## Best Practices
- Keep hooks lightweight
- Handle errors gracefully
- Log important events
- Use async/await for async operations
- Test thoroughly before production use
`
    },
    
    memory: {
      'usage.md': `# Memory Usage Guide

## Overview
Comprehensive guide to using Claude Flow's memory system for persistence and context.

## Basic Usage
\`\`\`bash
claude-flow memory [action] [key] [value]
\`\`\`

## Actions
- **store**: Save data to memory
- **retrieve**: Get data from memory
- **list**: List all keys
- **delete**: Remove data
- **search**: Search memory

## Examples
\`\`\`bash
# Store data
claude-flow memory store "project-context" "Building an AI assistant"

# Retrieve data
claude-flow memory retrieve "project-context"

# Search memory
claude-flow memory search "project"

# List all keys
claude-flow memory list
\`\`\`

## Namespacing
\`\`\`bash
# Use namespaces for organization
claude-flow memory store "team/frontend/config" "{...}"
claude-flow memory list --namespace "team/frontend"
\`\`\`

## MCP Integration
- \`mcp__claude-mcp__memory_usage\`
- \`mcp__claude-mcp__memory_search\`
- \`mcp__claude-mcp__memory_namespace\`
`,
      'neural.md': `# Neural Memory Patterns

## Overview
Advanced neural network-based memory patterns for intelligent context management.

## Features
- 🧠 Pattern recognition
- 🔮 Predictive recall
- 📊 Associative memory
- 🎯 Context clustering
- 🔄 Adaptive learning

## Usage
\`\`\`bash
claude-flow memory neural [action] [options]
\`\`\`

## Actions
- **train**: Train patterns
- **predict**: Predict context
- **analyze**: Analyze patterns
- **optimize**: Optimize memory
- **export**: Export models

## Examples
\`\`\`bash
# Train on project patterns
claude-flow memory neural train --data ./history

# Predict next context
claude-flow memory neural predict --context "current task"

# Analyze memory patterns
claude-flow memory neural analyze
\`\`\`

## MCP Integration
- \`mcp__claude-mcp__neural_train\`
- \`mcp__claude-mcp__neural_patterns\`
- \`mcp__claude-mcp__neural_predict\`
- \`mcp__claude-mcp__pattern_recognize\`
`
    },
    
    monitoring: {
      'status.md': `# System Status Monitoring

## Overview
Real-time monitoring of Claude Flow system health and performance.

## Usage
\`\`\`bash
claude-flow status [component] [options]
\`\`\`

## Components
- **system**: Overall system health
- **agents**: Agent status
- **memory**: Memory usage
- **tasks**: Task queue
- **performance**: Performance metrics

## Display Options
- \`--json\`: JSON output
- \`--verbose\`: Detailed info
- \`--watch\`: Real-time updates
- \`--interval\`: Update interval

## Examples
\`\`\`bash
# System overview
claude-flow status

# Agent monitoring
claude-flow status agents --watch

# Performance metrics
claude-flow status performance --verbose
\`\`\`

## MCP Integration
- \`mcp__claude-mcp__swarm_status\`
- \`mcp__claude-mcp__health_check\`
- \`mcp__claude-mcp__performance_report\`
`,
      'agents.md': `# Agent Monitoring

## Overview
Monitor and manage individual agents and swarms in real-time.

## Usage
\`\`\`bash
claude-flow monitor agents [options]
\`\`\`

## Features
- 👥 Agent lifecycle tracking
- 📊 Performance metrics
- 🔄 Task distribution
- 💾 Resource usage
- 🚨 Alert management

## Views
- **Dashboard**: Overview of all agents
- **Individual**: Single agent details
- **Swarm**: Swarm-level metrics
- **Timeline**: Historical view

## Commands
\`\`\`bash
# Monitor all agents
claude-flow monitor agents

# Specific agent
claude-flow monitor agent [id]

# Swarm monitoring
claude-flow monitor swarm [id]

# Export metrics
claude-flow monitor export
\`\`\`

## MCP Integration
- \`mcp__claude-mcp__agent_list\`
- \`mcp__claude-mcp__agent_metrics\`
- \`mcp__claude-mcp__swarm_monitor\`
`
    },
    
    optimization: {
      'auto-topology.md': `# Automatic Topology Optimization

## Overview
Automatically optimize swarm topology based on task requirements and performance metrics.

## Usage
\`\`\`bash
claude-flow optimize topology [options]
\`\`\`

## Features
- 🔄 Dynamic topology adjustment
- 📊 Performance-based optimization
- 🎯 Task-aware configuration
- ⚡ Real-time adaptation
- 📈 Continuous improvement

## Optimization Strategies
- **Performance**: Maximize throughput
- **Efficiency**: Minimize resource usage
- **Reliability**: Maximize fault tolerance
- **Balanced**: Optimal trade-offs

## Examples
\`\`\`bash
# Auto-optimize current swarm
claude-flow optimize topology --auto

# Specific strategy
claude-flow optimize topology --strategy performance

# Continuous optimization
claude-flow optimize topology --continuous
\`\`\`

## MCP Integration
- \`mcp__claude-mcp__topology_optimize\`
- \`mcp__claude-mcp__load_balance\`
- \`mcp__claude-mcp__swarm_scale\`
`,
      'parallel-execution.md': `# Parallel Execution Optimization

## Overview
Maximize parallel execution efficiency with intelligent task distribution and resource management.

## Usage
\`\`\`bash
claude-flow optimize parallel [options]
\`\`\`

## Features
- ⚡ Maximum parallelization
- 🔄 Dynamic load balancing
- 📊 Resource optimization
- 🎯 Dependency resolution
- 📈 Performance tracking

## Strategies
- **Aggressive**: Maximum parallel tasks
- **Balanced**: Resource-aware
- **Conservative**: Stability-focused
- **Adaptive**: Dynamic adjustment

## Examples
\`\`\`bash
# Optimize current execution
claude-flow optimize parallel

# Set strategy
claude-flow optimize parallel --strategy aggressive

# With constraints
claude-flow optimize parallel --max-agents 10 --memory-limit 8GB
\`\`\`

## BatchTool Integration
Automatically uses BatchTool for:
- Multiple file operations
- Parallel agent spawning
- Concurrent task execution
- Batch memory operations

## MCP Integration
- \`mcp__claude-mcp__parallel_execute\`
- \`mcp__claude-mcp__load_balance\`
- \`mcp__claude-mcp__task_orchestrate\`
`
    },
    
    training: {
      'neural-patterns.md': `# Neural Pattern Training

## Overview
Train neural networks to recognize and optimize patterns in your development workflow.

## Usage
\`\`\`bash
claude-flow train neural [pattern] [options]
\`\`\`

## Pattern Types
- 🧠 **coordination**: Agent coordination patterns
- 🔧 **optimization**: Performance patterns
- 🔮 **prediction**: Predictive patterns
- 📝 **coding**: Code patterns
- 🐛 **debugging**: Debug patterns

## Training Process
1. Data collection
2. Pattern extraction
3. Model training
4. Validation
5. Deployment

## Examples
\`\`\`bash
# Train coordination patterns
claude-flow train neural coordination --data ./logs

# Train with custom params
claude-flow train neural optimization --epochs 100 --learning-rate 0.001

# Export trained model
claude-flow train export --model coordination --format onnx
\`\`\`

## MCP Integration
- \`mcp__claude-mcp__neural_train\`
- \`mcp__claude-mcp__neural_patterns\`
- \`mcp__claude-mcp__model_save\`
- \`mcp__claude-mcp__transfer_learn\`
`,
      'specialization.md': `# Agent Specialization Training

## Overview
Train agents to specialize in specific domains and tasks for improved performance.

## Usage
\`\`\`bash
claude-flow train agent [specialization] [options]
\`\`\`

## Specializations
- 🏗️ **Architecture**: System design
- 🔒 **Security**: Security analysis
- ⚡ **Performance**: Optimization
- 🧪 **Testing**: Test strategies
- 📝 **Documentation**: Doc writing
- 🎨 **Frontend**: UI/UX
- 🔧 **Backend**: Server-side
- 📊 **Data**: Data processing

## Training Methods
- **Supervised**: With examples
- **Reinforcement**: Through feedback
- **Transfer**: From existing models
- **Ensemble**: Multiple models

## Examples
\`\`\`bash
# Train security specialist
claude-flow train agent security --dataset ./security-examples

# Transfer learning
claude-flow train agent performance --base-model optimizer

# Ensemble training
claude-flow train agent architect --ensemble "designer,planner,reviewer"
\`\`\`

## MCP Integration
- \`mcp__claude-mcp__transfer_learn\`
- \`mcp__claude-mcp__ensemble_create\`
- \`mcp__claude-mcp__learning_adapt\`
`
    },
    
    workflows: {
      'development.md': `# Development Workflows

## Overview
Pre-configured development workflows for common scenarios.

## Available Workflows

### 1. Feature Development
Complete workflow from design to deployment:
- Requirements analysis
- Architecture design
- Implementation
- Testing
- Documentation
- PR creation

### 2. Bug Fixing
Systematic bug resolution:
- Reproduction
- Root cause analysis
- Fix implementation
- Test creation
- Verification

### 3. Refactoring
Safe refactoring workflow:
- Code analysis
- Refactor planning
- Implementation
- Test verification
- Performance check

### 4. API Development
API-first development:
- Schema design
- Implementation
- Testing
- Documentation
- Client generation

## Usage
\`\`\`bash
claude-flow workflow dev [type] [options]
\`\`\`

## Examples
\`\`\`bash
# Start feature workflow
claude-flow workflow dev feature --name "user-auth"

# Bug fix workflow
claude-flow workflow dev bugfix --issue "#123"

# Refactoring workflow
claude-flow workflow dev refactor --target "src/legacy"
\`\`\`

## MCP Integration
- \`mcp__claude-mcp__workflow_create\`
- \`mcp__claude-mcp__workflow_execute\`
- \`mcp__claude-mcp__task_orchestrate\`
`,
      'research.md': `# Research Workflows

## Overview
Structured research workflows for investigation and analysis tasks.

## Available Workflows

### 1. Technology Research
Comprehensive tech evaluation:
- Market analysis
- Technical deep-dive
- Comparison matrix
- POC development
- Recommendation report

### 2. Problem Investigation
Systematic problem solving:
- Problem definition
- Research existing solutions
- Analyze approaches
- Prototype solutions
- Document findings

### 3. Architecture Research
System design research:
- Requirements gathering
- Pattern research
- Technology selection
- Design documentation
- Trade-off analysis

### 4. Performance Research
Performance investigation:
- Baseline measurement
- Bottleneck identification
- Solution research
- Implementation testing
- Results documentation

## Usage
\`\`\`bash
claude-flow workflow research [type] [topic] [options]
\`\`\`

## Examples
\`\`\`bash
# Technology research
claude-flow workflow research tech "GraphQL vs REST"

# Problem investigation
claude-flow workflow research problem "scalability issues"

# Architecture research
claude-flow workflow research architecture "microservices"
\`\`\`

## MCP Integration
- Research-focused agent spawning
- Parallel information gathering
- Structured output generation
`
    }
  };
}

export function createCommandDirectories() {
  return [
    'analysis',
    'automation', 
    'coordination',
    'github',
    'hooks',
    'memory',
    'monitoring',
    'optimization',
    'sparc',
    'swarm',
    'training',
    'workflows'
  ];
}