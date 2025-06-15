---
name: sparc
description: Execute SPARC methodology workflows with Claude-Flow
---

# ⚡️ SPARC Development Methodology

SPARC orchestrator for complex workflows



## Available SPARC Modes

- `/sparc-architect` - System Architect
- `/sparc-code` - Code Generator
- `/sparc-tdd` - Test-Driven Developer
- `/sparc-debug` - Debug Specialist
- `/sparc-security-review` - Security Analyst
- `/sparc-docs-writer` - Documentation Expert
- `/sparc-integration` - Integration Engineer
- `/sparc-spec-pseudocode` - Specification Designer
- `/sparc-devops` - DevOps Engineer
- `/sparc-swarm` - Swarm Coordinator
- `/sparc-mcp` - MCP Integration Specialist
- `/sparc-refinement-optimization-mode` - Performance Optimizer
- `/sparc-monitoring` - System Monitor
- `/sparc-ask` - Interactive Assistant
- `/sparc-generic` - General Purpose
- `/sparc-supabase-admin` - Supabase Administrator
- `/sparc-tutorial` - Tutorial Creator

## Quick Start

### Run SPARC orchestrator (default):
```bash
./claude-flow sparc "build complete authentication system"
```

### Run a specific mode:
```bash
./claude-flow sparc run <mode> "your task"
./claude-flow sparc run architect "design API structure"
./claude-flow sparc run tdd "implement user service"
```

### Execute full TDD workflow:
```bash
./claude-flow sparc tdd "implement user authentication"
```

### List all modes with details:
```bash
./claude-flow sparc modes --verbose
```

## SPARC Methodology Phases

1. **📋 Specification**: Define requirements, constraints, and acceptance criteria
2. **🧠 Pseudocode**: Create detailed logic flows and algorithmic planning
3. **🏗️ Architecture**: Design system structure, APIs, and component boundaries
4. **🔄 Refinement**: Implement with TDD (Red-Green-Refactor cycle)
5. **✅ Completion**: Integrate, document, and validate against requirements

## Memory Integration

Use memory commands to persist context across SPARC sessions:
```bash
# Store specifications
./claude-flow memory store "spec_auth" "OAuth2 + JWT requirements" --namespace spec

# Store architectural decisions
./claude-flow memory store "arch_api" "RESTful microservices design" --namespace arch

# Query previous work
./claude-flow memory query "authentication" --limit 10

# Export project memory
./claude-flow memory export sparc-project-backup.json
```

## Advanced Swarm Mode

For complex tasks requiring multiple agents with timeout-free execution:
```bash
# Development swarm with monitoring
./claude-flow swarm "Build e-commerce platform" --strategy development --monitor --review

# Background optimization swarm
./claude-flow swarm "Optimize system performance" --strategy optimization --background

# Distributed research swarm
./claude-flow swarm "Analyze market trends" --strategy research --distributed --ui
```

## Non-Interactive Mode

For CI/CD integration and automation:
```bash
./claude-flow sparc run code "implement API" --non-interactive
./claude-flow sparc tdd "user tests" --non-interactive --enable-permissions
```

## Best Practices

✅ **Modular Design**: Keep files under 500 lines
✅ **Environment Safety**: Never hardcode secrets or env values
✅ **Test-First**: Always write tests before implementation
✅ **Memory Usage**: Store important decisions and context
✅ **Task Completion**: All tasks should end with `attempt_completion`

See `/claude-flow-help` for all available commands.
